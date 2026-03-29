import { execFile, spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import {
  AdapterStatusListSchema,
  type AdapterId,
  type AdapterAuthenticationCheck,
  type AdapterStatus,
  type LocalAdapterContract,
} from "@scratch-pad/shared";

const execFileAsync = promisify(execFile);
const COMMAND_TIMEOUT_MS = 1_500;
const MAX_BUFFER_BYTES = 64 * 1024;

type InstalledCommandCheck = {
  installed: boolean;
  command: string | null;
  version: string | null;
  message: string;
};

type CommandExecutionResult =
  | {
      ok: true;
      stdout: string;
      stderr: string;
    }
  | {
      ok: false;
      code: string | number | undefined;
      stdout: string;
      stderr: string;
      message: string;
      timedOut: boolean;
    };

export async function getAdapterStatuses() {
  const statuses = await Promise.all([
    getClaudeCodeStatus(),
    getCodexStatus(),
  ]);

  return AdapterStatusListSchema.parse(statuses);
}

export async function getAdapterStatusById(adapterId: AdapterId) {
  if (adapterId === "claude-code") {
    return getClaudeCodeStatus();
  }

  return getCodexStatus();
}

export async function resolveInstalledAdapterCommand(
  adapterId: AdapterId,
): Promise<{ command: string; version: string | null } | null> {
  const installedCheck =
    adapterId === "claude-code"
      ? await detectInstalledCommand(["claude", "claude-code"], "Claude Code")
      : await detectInstalledCommand(["codex"], "Codex");

  if (!installedCheck.installed || !installedCheck.command) {
    return null;
  }

  return {
    command: installedCheck.command,
    version: installedCheck.version,
  };
}

export async function openRepoInCodexApp(repoPath: string) {
  const normalizedRepoPath = repoPath.trim();

  if (!normalizedRepoPath) {
    throw new Error("Save a repo path before opening Codex Desktop.");
  }

  await assertDirectoryExists(normalizedRepoPath);

  const codexStatus = await getCodexStatus();

  if (!codexStatus.installed) {
    throw new Error(codexStatus.message);
  }

  if (!codexStatus.appLaunchSupported) {
    throw new Error(
      codexStatus.appMessage ??
        "Codex Desktop handoff is not available on this machine.",
    );
  }

  const resolvedCommand = await resolveInstalledAdapterCommand("codex");

  if (!resolvedCommand?.command) {
    throw new Error("Codex CLI could not be resolved in PATH.");
  }

  await spawnDetached(resolvedCommand.command, ["app", normalizedRepoPath]);

  return {
    repoPath: normalizedRepoPath,
    message: codexStatus.appInstalled
      ? `Asked Codex Desktop to open "${normalizedRepoPath}". Scratch Pad did not transfer the live CLI session.`
      : `Asked Codex to open "${normalizedRepoPath}" in Codex Desktop. If the desktop app is not installed yet, Codex may prompt to install it first. Scratch Pad did not transfer the live CLI session.`,
  };
}

async function getClaudeCodeStatus(): Promise<AdapterStatus> {
  const adapter: LocalAdapterContract = {
    id: "claude-code",
    name: "Claude Code",
    async checkInstalled() {
      const installedCheck = await detectInstalledCommand(
        ["claude", "claude-code"],
        "Claude Code",
      );

      return {
        installed: installedCheck.installed,
        version: installedCheck.version,
        message: installedCheck.message,
      };
    },
    async checkAuthenticated() {
      const installedCheck = await detectInstalledCommand(
        ["claude", "claude-code"],
        "Claude Code",
      );

      if (!installedCheck.installed || !installedCheck.command) {
        return {
          authenticated: "unknown",
          message: installedCheck.message,
        };
      }

      return checkClaudeAuthentication(installedCheck.command);
    },
  };

  return buildAdapterStatus(adapter);
}

async function getCodexStatus(): Promise<AdapterStatus> {
  const installedCheck = await detectInstalledCommand(["codex"], "Codex");
  const adapter: LocalAdapterContract = {
    id: "codex",
    name: "Codex",
    async checkInstalled() {
      return {
        installed: installedCheck.installed,
        version: installedCheck.version,
        message: installedCheck.message,
      };
    },
    async checkAuthenticated() {
      if (!installedCheck.installed || !installedCheck.command) {
        return {
          authenticated: "unknown",
          message: installedCheck.message,
        };
      }

      return checkCodexAuthentication(installedCheck.command);
    },
  };

  const baseStatus = await buildAdapterStatus(adapter);
  const appSupport = installedCheck.command
    ? await detectCodexAppSupport(installedCheck.command)
    : buildUnavailableCodexAppSupport(
        "Codex Desktop handoff is unavailable because the Codex CLI was not found.",
      );

  return {
    ...baseStatus,
    ...appSupport,
  };
}

async function buildAdapterStatus(
  adapter: LocalAdapterContract,
): Promise<AdapterStatus> {
  const installedCheck = await adapter.checkInstalled();

  if (!installedCheck.installed) {
    return {
      id: adapter.id,
      name: adapter.name,
      installed: false,
      authenticated: "unknown",
      ready: false,
      readiness: "not-ready",
      message: installedCheck.message,
      version: installedCheck.version,
      appInstalled: null,
      appLaunchSupported: false,
      appServerSupported: false,
      appMessage: null,
    };
  }

  const authenticationCheck = await adapter.checkAuthenticated();
  const readiness =
    authenticationCheck.authenticated === true
      ? "ready"
      : authenticationCheck.authenticated === false
        ? "not-ready"
        : "unknown";

  return {
    id: adapter.id,
    name: adapter.name,
    installed: true,
    authenticated: authenticationCheck.authenticated,
    ready: authenticationCheck.authenticated === true,
    readiness,
    message: authenticationCheck.message,
    version: installedCheck.version,
    appInstalled: null,
    appLaunchSupported: false,
    appServerSupported: false,
    appMessage: null,
  };
}

async function detectCodexAppSupport(command: string) {
  const appLaunchCheck =
    process.platform === "darwin"
      ? await runCommand(command, ["app", "--help"])
      : ({
          ok: false,
          code: "UNSUPPORTED_PLATFORM",
          stdout: "",
          stderr: "",
          message: "Codex Desktop handoff is currently wired for macOS only.",
          timedOut: false,
        } as const);
  const appServerCheck = await runCommand(command, ["app-server", "--help"]);

  const appLaunchSupported = appLaunchCheck.ok;
  const appInstalled =
    process.platform === "darwin" && appLaunchSupported
      ? await detectMacAppInstalled("Codex")
      : false;

  if (!appLaunchSupported) {
    return buildUnavailableCodexAppSupport(
      process.platform === "darwin"
        ? "This Codex CLI build does not expose the desktop app handoff command."
        : "Codex Desktop handoff is currently wired for macOS only.",
      appServerCheck.ok,
      appInstalled,
    );
  }

  return {
    appInstalled,
    appLaunchSupported: true,
    appServerSupported: appServerCheck.ok,
    appMessage: appInstalled
      ? "Codex Desktop is installed. Scratch Pad can hand off the current repo with `codex app <path>`."
      : "Codex Desktop was not found locally, but `codex app <path>` can still try to install and open it on macOS.",
  };
}

function buildUnavailableCodexAppSupport(
  appMessage: string,
  appServerSupported = false,
  appInstalled = false,
) {
  return {
    appInstalled,
    appLaunchSupported: false,
    appServerSupported,
    appMessage,
  };
}

async function detectInstalledCommand(
  commandCandidates: string[],
  adapterName: string,
): Promise<InstalledCommandCheck> {
  for (const command of commandCandidates) {
    const versionResult = await runCommand(command, ["--version"]);

    if (versionResult.ok) {
      const version = cleanOutput(versionResult.stdout) || null;

      return {
        installed: true,
        command,
        version,
        message: version
          ? `${adapterName} CLI detected.`
          : `${adapterName} CLI detected, but no version string was returned.`,
      };
    }

    if (versionResult.code === "ENOENT") {
      continue;
    }

    return {
      installed: true,
      command,
      version: null,
      message: `${adapterName} CLI was found, but version detection was inconclusive.`,
    };
  }

  return {
    installed: false,
    command: null,
    version: null,
    message: `${adapterName} CLI was not found in PATH.`,
  };
}

async function checkCodexAuthentication(
  command: string,
): Promise<AdapterAuthenticationCheck> {
  const result = await runCommand(command, ["login", "status"]);

  return interpretAuthenticationResult(
    result,
    "Codex is installed, but local login status could not be verified.",
  );
}

async function checkClaudeAuthentication(
  command: string,
): Promise<AdapterAuthenticationCheck> {
  const probes = [
    ["auth", "status"],
    ["login", "status"],
  ];

  for (const args of probes) {
    const result = await runCommand(command, args);
    const interpreted = interpretAuthenticationResult(result, "");

    if (interpreted.authenticated !== "unknown") {
      return interpreted;
    }
  }

  return {
    authenticated: "unknown",
    message:
      "Claude Code is installed, but this CLI version did not expose a clear local auth status.",
  };
}

function interpretAuthenticationResult(
  result: CommandExecutionResult,
  fallbackMessage: string,
): AdapterAuthenticationCheck {
  const output = cleanOutput(`${result.stdout}\n${result.stderr}`);

  if (matchesUnauthenticatedOutput(output)) {
    return {
      authenticated: false,
      message: firstLine(output) ?? "Authentication is required.",
    };
  }

  if (matchesAuthenticatedOutput(output)) {
    return {
      authenticated: true,
      message: firstLine(output) ?? "Authenticated.",
    };
  }

  if (!result.ok && result.timedOut) {
    return {
      authenticated: "unknown",
      message: "Authentication check timed out locally.",
    };
  }

  return {
    authenticated: "unknown",
    message: firstLine(output) ??
      fallbackMessage ??
      "Authentication status is unknown on this machine.",
  };
}

async function runCommand(
  command: string,
  args: string[],
): Promise<CommandExecutionResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args, {
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: MAX_BUFFER_BYTES,
      env: process.env,
    });

    return {
      ok: true,
      stdout,
      stderr,
    };
  } catch (error) {
    const commandError = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      killed?: boolean;
      signal?: string;
    };

    return {
      ok: false,
      code: commandError.code,
      stdout: commandError.stdout ?? "",
      stderr: commandError.stderr ?? "",
      message: commandError.message,
      timedOut:
        commandError.killed === true || commandError.signal === "SIGTERM",
    };
  }
}

function matchesAuthenticatedOutput(output: string) {
  return /logged in|authenticated|authorized/i.test(output);
}

function matchesUnauthenticatedOutput(output: string) {
  return /not logged in|logged out|not authenticated|unauthenticated|login required|authentication required|please log in/i.test(
    output,
  );
}

function cleanOutput(output: string) {
  return output.trim().replace(/\s+/g, " ");
}

function firstLine(output: string) {
  const [line] = output.split(/\r?\n/).map((entry) => entry.trim());
  return line || null;
}

async function detectMacAppInstalled(appName: string) {
  const result = await runCommand("open", ["-Ra", appName]);
  return result.ok;
}

async function assertDirectoryExists(repoPath: string) {
  try {
    const repoStats = await stat(repoPath);

    if (!repoStats.isDirectory()) {
      throw new Error();
    }
  } catch {
    throw new Error(
      `Repo path "${repoPath}" is not available on disk anymore. Save a valid local repo path before opening Codex Desktop.`,
    );
  }
}

async function spawnDetached(command: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const childProcess = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      env: process.env,
    });

    childProcess.once("error", reject);
    childProcess.once("spawn", () => {
      childProcess.unref();
      resolve();
    });
  });
}
