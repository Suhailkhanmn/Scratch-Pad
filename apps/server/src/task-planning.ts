import type { PlanVersion, Project } from "@scratch-pad/shared";
import type { TaskDraft } from "./tasks.js";

type TaskResolution =
  | {
      kind: "task";
      key: string;
      task: TaskDraft;
    }
  | {
      kind: "blocked";
      task: TaskDraft;
    }
  | {
      kind: "ignore";
    };

export function buildGeneratedTasks(
  project: Project,
  plan: PlanVersion,
): { tasks: TaskDraft[]; message: string } {
  const queuedTasks: TaskDraft[] = [];
  const blockedTasks: TaskDraft[] = [];
  const seenKeys = new Set<string>();

  for (const scopeItem of plan.scope) {
    const resolution = resolveScopeItem(scopeItem, project);

    if (resolution.kind === "ignore") {
      continue;
    }

    if (resolution.kind === "blocked") {
      blockedTasks.push(resolution.task);
      continue;
    }

    if (seenKeys.has(resolution.key)) {
      continue;
    }

    seenKeys.add(resolution.key);
    queuedTasks.push(resolution.task);
  }

  const normalizedQueued = dedupeTasks(queuedTasks).slice(0, 6);
  const normalizedBlocked = dedupeTasks(blockedTasks).slice(0, 3);
  const tasks = [...normalizedQueued, ...normalizedBlocked].slice(0, 8);

  return {
    tasks,
    message: buildTaskGenerationMessage(project, normalizedBlocked.length),
  };
}

function resolveScopeItem(scopeItem: string, project: Project): TaskResolution {
  const normalizedScope = scopeItem.trim();

  if (!normalizedScope) {
    return { kind: "ignore" };
  }

  const documentationTask = buildDocumentationTask(normalizedScope, project);

  if (documentationTask) {
    return documentationTask;
  }

  if (isConstraintOnlyScopeItem(normalizedScope)) {
    return { kind: "ignore" };
  }

  if (isMetaScopeItem(normalizedScope)) {
    return buildClarificationResolution(normalizedScope, project, "meta");
  }

  if (isVagueScopeItem(normalizedScope)) {
    return buildClarificationResolution(normalizedScope, project, "vague");
  }

  if (/desktop notifications?|desktop alerts?|notify|notification/i.test(normalizedScope)) {
    return buildQueuedResolution({
      key: "notifications",
      scopeItem: normalizedScope,
      project,
      task: {
        title: "Show desktop notification on rule match",
        description:
          "Add the desktop notification trigger when a saved rule matches.",
        status: "queued",
        riskLevel: "medium",
        adapterHint: project.preferredAdapter,
      },
    });
  }

  if (/rules?|thresholds?|filters?|conditions?/i.test(normalizedScope)) {
    return buildQueuedResolution({
      key: "rules",
      scopeItem: normalizedScope,
      project,
      task: {
        title: "Add rule configuration form",
        description:
          "Add the form and save path for creating and editing rules or thresholds.",
        status: "queued",
        riskLevel: "medium",
        adapterHint: project.preferredAdapter,
      },
    });
  }

  if (
    /local settings|preferences|configuration|config/i.test(normalizedScope)
  ) {
    return buildQueuedResolution({
      key: "local-settings",
      scopeItem: normalizedScope,
      project,
      task: {
        title: "Persist local settings",
        description:
          "Save the local settings and restore them on reload.",
        status: "queued",
        riskLevel: "low",
        adapterHint: project.preferredAdapter,
      },
    });
  }

  if (
    /persist|storage|store|saved state|local data|local-first|data local|keep .* local|database|sqlite/i.test(
      normalizedScope,
    )
  ) {
    return buildQueuedResolution({
      key: "local-state",
      scopeItem: normalizedScope,
      project,
      task: {
        title: "Persist local data",
        description:
          "Save the approved local data and restore it on reload.",
        status: "queued",
        riskLevel: "low",
        adapterHint: project.preferredAdapter,
      },
    });
  }

  if (/track|watch|monitor|fetch|poll|sync|ingest|collect/i.test(normalizedScope)) {
    return buildQueuedResolution({
      key: "tracking",
      scopeItem: normalizedScope,
      project,
      task: {
        title: "Track the primary item",
        description:
          "Add the code path that fetches or updates the primary item this product tracks.",
        status: "queued",
        riskLevel: "medium",
        adapterHint: project.preferredAdapter,
      },
    });
  }

  if (
    /review handoff|review summary|changed files|diff stats|diff summary|handoff/i.test(
      normalizedScope,
    )
  ) {
    return buildQueuedResolution({
      key: "review-handoff",
      scopeItem: normalizedScope,
      project,
      task: {
        title: "Capture changed files for review handoff",
        description:
          "Store the changed-file list and diff summary needed for review handoff.",
        status: "queued",
        riskLevel: "medium",
        adapterHint: project.preferredAdapter,
      },
    });
  }

  if (/dashboard|screen|page|panel|view|table|detail|results?/i.test(normalizedScope)) {
    return buildQueuedResolution({
      key: "ui-surface",
      scopeItem: normalizedScope,
      project,
      task: {
        title: "Show primary status on the main screen",
        description:
          "Render the main status or result for the approved flow.",
        status: "queued",
        riskLevel: "medium",
        adapterHint: project.preferredAdapter,
      },
    });
  }

  if (/input|form|setup|configure/i.test(normalizedScope)) {
    return buildQueuedResolution({
      key: "main-input",
      scopeItem: normalizedScope,
      project,
      task: {
        title: "Add main input form",
        description:
          "Capture the main input needed to start the approved flow.",
        status: "queued",
        riskLevel: "medium",
        adapterHint: project.preferredAdapter,
      },
    });
  }

  const genericTask = buildGenericActionTask(normalizedScope, project);

  if (genericTask) {
    return genericTask;
  }

  return buildBlockedResolution(
    "Clarify which user action this scope item should add",
    normalizedScope,
    "This reads as planning language, but it still does not point to one concrete implementation step.",
    project,
  );
}

function buildGenericActionTask(
  scopeItem: string,
  project: Project,
): TaskResolution | null {
  const actionMatch = scopeItem.match(
    /^(let the user|allow the user to|allow users to|enable|support|show|display|provide|build|create|add|include|save|edit|manage|document)\s+(.+)$/i,
  );

  if (!actionMatch) {
    return null;
  }

  const action = (actionMatch[1] ?? "").toLowerCase();
  const rawSubject = normalizeSubject(actionMatch[2] ?? "");

  if (!rawSubject || isWeakSubject(rawSubject)) {
    return null;
  }

  const titleLabel = toTitleLabel(rawSubject);
  const taskTitle = buildGenericTaskTitle(action, titleLabel);
  const taskDescription = buildGenericTaskDescription(action, titleLabel);

  return buildQueuedResolution({
    key: `generic:${taskTitle.toLowerCase()}`,
    scopeItem,
    project,
    task: {
      title: taskTitle,
      description: taskDescription,
      status: "queued",
      riskLevel: "medium",
      adapterHint: project.preferredAdapter,
    },
  });
}

function buildQueuedResolution(input: {
  key: string;
  scopeItem: string;
  project: Project;
  task: TaskDraft;
}): TaskResolution {
  const qualityIssue = getTaskQualityIssue(input.task, input.scopeItem);

  if (qualityIssue) {
    return buildBlockedResolution(
      qualityIssue.title,
      input.scopeItem,
      qualityIssue.explanation,
      input.project,
    );
  }

  return {
    kind: "task",
    key: input.key,
    task: input.task,
  };
}

function buildBlockedResolution(
  title: string,
  scopeItem: string,
  explanation: string,
  project: Project,
): TaskResolution {
  return {
    kind: "blocked",
    task: {
      title,
      description: `${explanation} Approved scope: "${scopeItem}".`,
      status: "blocked",
      riskLevel: "high",
      adapterHint: project.preferredAdapter,
    },
  };
}

function buildClarificationResolution(
  scopeItem: string,
  project: Project,
  reason: "meta" | "vague",
): TaskResolution {
  const clarification = buildClarificationCopy(scopeItem, reason);

  return buildBlockedResolution(
    clarification.title,
    scopeItem,
    clarification.explanation,
    project,
  );
}

function buildClarificationCopy(
  scopeItem: string,
  reason: "meta" | "vague",
) {
  if (/\breadme\b|\bdocumentation\b|\bdocs?\b/i.test(scopeItem)) {
    return {
      title: "Clarify which README change is actually required",
      explanation:
        "This scope item mentions docs, but it does not yet describe one concrete documentation update.",
    };
  }

  if (/\bscreen\b|\bpage\b|\bdashboard\b|\bpanel\b|\bview\b/i.test(scopeItem)) {
    return {
      title: "Clarify what the user should be able to do on the main screen",
      explanation:
        "This scope item points at a surface, but not the exact action or information that screen should support.",
    };
  }

  if (/\bthresholds?\b|\brules?\b|\bfilters?\b|\bconditions?\b/i.test(scopeItem)) {
    return {
      title: "Clarify what should happen after rule setup",
      explanation:
        "This scope item mentions rules or thresholds, but not the exact behavior they should trigger.",
    };
  }

  if (/\bdesktop alerts?\b|\bdesktop notifications?\b|\bnotifications?\b/i.test(scopeItem)) {
    return {
      title: "Clarify what should trigger the notification",
      explanation:
        "This scope item mentions alerts, but not the exact event that should produce one.",
    };
  }

  if (
    /\btrack\b|\bwatch\b|\bmonitor\b|\bfetch\b|\bpoll\b|\bsync\b|\bingest\b|\bcollect\b/i.test(
      scopeItem,
    )
  ) {
    return {
      title: "Clarify what the app should track or update",
      explanation:
        "This scope item implies tracking behavior, but not the exact thing that should be fetched, monitored, or refreshed.",
    };
  }

  if (/\bflow\b|\bjourney\b|\bstep\b/i.test(scopeItem)) {
    return {
      title: "Clarify which part of the flow needs to change",
      explanation:
        "This scope item talks about the flow at a high level, but not the exact step that needs product work.",
    };
  }

  if (reason === "meta") {
    return {
      title: "Clarify the product behavior behind this planning note",
      explanation:
        "This reads like copy, documentation, or internal planning guidance rather than a runnable product change.",
    };
  }

  return {
    title: "Clarify which user action this scope item should add",
    explanation:
      "This scope item is still too vague to turn into a trustworthy implementation task.",
  };
}

function buildTaskGenerationMessage(project: Project, blockedCount: number) {
  const adapterLabel =
    project.preferredAdapter === "claude-code"
      ? "Claude Code"
      : project.preferredAdapter === "codex"
        ? "Codex"
        : "the default local planning path";
  const blockedMessage =
    blockedCount > 0
      ? ` ${blockedCount} item${blockedCount === 1 ? "" : "s"} stayed blocked because the plan still needs clarification.`
      : "";

  return `Task queue generated from the latest approved plan using ${adapterLabel} as the planning hint.${blockedMessage}`;
}

function normalizeSubject(value: string) {
  return value
    .replace(/\bfor v0\.1\b|\bfor v1\b|\bin v0\.1\b|\bin v1\b/gi, "")
    .replace(/\bapproved\b|\bsmallest\b|\bminimal\b|\bcore\b|\bprimary\b|\bfirst\b/gi, "")
    .replace(/\bin the readme\b|\bin docs?\b|\bon one screen\b|\bin the main flow\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(the user can|users can)\s+/i, "")
    .replace(/^to\s+/i, "")
    .replace(/^a\s+/i, "")
    .replace(/^an\s+/i, "")
    .trim();
}

function toTitleLabel(value: string) {
  const normalized = value
    .replace(/\bthe main thing they care about\b/i, "the primary flow")
    .replace(/\bthe thing\b/i, "the primary flow")
    .replace(/\s+/g, " ")
    .trim();

  if (/ flow$/i.test(normalized)) {
    return toSentenceCase(normalized);
  }

  if (/settings|preferences|dashboard|notifications?|alerts?|rules?|thresholds?|tracking|search|filters?|import|export|upload|download|editor|table|details?/i.test(normalized)) {
    return toSentenceCase(normalized);
  }

  return toSentenceCase(normalized);
}

function isWeakSubject(value: string) {
  return /\bthing\b|\bstatement\b|\bcopy\b|\bwording\b|\bscope\b|\boutcome\b|\bversion\b|\bproduct\b|\bflow only\b|\bmanual\b/i.test(
    value,
  );
}

function isConstraintOnlyScopeItem(scopeItem: string) {
  return /\bno auth\b|\bno authentication\b|\bwithout auth\b|\bwithout authentication\b|\bno collaboration\b|\bsingle-user\b|\bno billing\b|\bmanual review\b/i.test(
    scopeItem,
  );
}

function isMetaScopeItem(scopeItem: string) {
  return /\breadme\b|\bdocumentation\b|\bdocs?\b|\bcopy\b|\bwording\b|\bsay clearly\b|\bmention\b|\bexplicitly mention\b|\bcall out\b|\bwrite\b/i.test(
    scopeItem,
  );
}

function isVagueScopeItem(scopeItem: string) {
  return /\bsmallest useful\b|\bprimary user flow\b|\bcore outcome only\b|\beasy to understand\b|\blimit the first release\b|\bkeep the first release\b|\bship one clear\b|\bnarrow and manual\b|\bprioritize\b|\bfocus the v1 on\b|\bkeep it simple\b/i.test(
    scopeItem,
  );
}

function buildDocumentationTask(
  scopeItem: string,
  project: Project,
): TaskResolution | null {
  if (!/\breadme\b|\bdocumentation\b|\bdocs?\b/i.test(scopeItem)) {
    return null;
  }

  if (
    /\bprerequisites?\b|\bsetup\b|\binstall(?:ation)?\b|\brequirements?\b|\bruntime\b|\benv\b|\benvironment\b|\bcommands?\b|\btroubleshooting\b/i.test(
      scopeItem,
    )
  ) {
    return buildQueuedResolution({
      key: "docs-prerequisites",
      scopeItem,
      project,
      task: {
        title: "Document local runtime prerequisites",
        description:
          "Add the required local setup steps and prerequisites to the README.",
        status: "queued",
        riskLevel: "low",
        adapterHint: project.preferredAdapter,
      },
    });
  }

  if (/\blimitations?\b|\bknown issues?\b|\bcaveats?\b|\bconstraints?\b/i.test(scopeItem)) {
    return buildQueuedResolution({
      key: "docs-limitations",
      scopeItem,
      project,
      task: {
        title: "Document current product limitations",
        description:
          "Add the approved limitation list to the README.",
        status: "queued",
        riskLevel: "low",
        adapterHint: project.preferredAdapter,
      },
    });
  }

  return buildClarificationResolution(scopeItem, project, "meta");
}

function buildGenericTaskTitle(action: string, titleLabel: string) {
  if (/^show|^display/.test(action)) {
    return `Show ${titleLabel}`;
  }

  if (/^save/.test(action)) {
    return `Persist ${titleLabel}`;
  }

  if (/^edit|^manage/.test(action)) {
    return `Manage ${titleLabel}`;
  }

  if (/^document/.test(action)) {
    return `Document ${titleLabel}`;
  }

  return `Add ${titleLabel}`;
}

function buildGenericTaskDescription(action: string, titleLabel: string) {
  const label = lowerFirst(titleLabel);

  if (/^show|^display/.test(action)) {
    return `Render ${label} in the main flow.`;
  }

  if (/^save/.test(action)) {
    return `Save ${label} and restore it on reload.`;
  }

  if (/^edit|^manage/.test(action)) {
    return `Let the user update ${label} in the app.`;
  }

  if (/^document/.test(action)) {
    return `Add ${label} to the README or local docs.`;
  }

  return `Add the ${label} needed for the approved behavior.`;
}

function getTaskQualityIssue(task: TaskDraft, scopeItem: string) {
  const normalizedTitle = task.title.trim().toLowerCase();
  const normalizedDescription = task.description.trim().toLowerCase();
  const combinedText = `${normalizedTitle} ${normalizedDescription}`;

  if (
    /\bone thing\b|\bsay clearly\b|\bmention\b|\bsmallest useful\b|\btighten\b|\bhappy path\b/.test(
      combinedText,
    )
  ) {
    return {
      title: /\breadme\b|\bdocumentation\b|\bdocs?\b/i.test(scopeItem)
        ? "Clarify which README change is actually required"
        : "Clarify what exact change this task should make",
      explanation:
        "This task still reads like planning or writing guidance rather than one concrete implementation change.",
    };
  }

  if (
    /^set up\b|^support\b|^implement\b|^verify\b/.test(normalizedTitle) ||
    /\bfoundation\b|\bworking slice\b|\bprimary flow\b|\bui flow\b|\btracking flow\b|\bsurface\b/.test(
      normalizedTitle,
    )
  ) {
    return {
      title: "Clarify what exact new capability is still missing",
      explanation:
        "This task is broad enough to invite repo-wide cleanup instead of one scoped edit.",
    };
  }

  if (/\brepo\b|\barchitecture\b|\bcleanup\b|\baud(it|iting)\b/.test(combinedText)) {
    return {
      title: "Clarify which code boundary should change",
      explanation:
        "This task points toward broad repo or architecture work instead of one concrete change.",
    };
  }

  if (
    countQualityMatches(normalizedDescription, [
      /\bapproved\b/g,
      /\bsmallest\b/g,
      /\bv1\b/g,
      /\bhappy path\b/g,
      /\bscope\b/g,
    ]) >= 2
  ) {
    return {
      title: "Clarify what exact scoped edit this task should make",
      explanation:
        "This task description is still dominated by policy language instead of the concrete change to implement.",
    };
  }

  return null;
}

function countQualityMatches(value: string, patterns: RegExp[]) {
  return patterns.reduce((count, pattern) => count + (pattern.test(value) ? 1 : 0), 0);
}

function dedupeTasks(tasks: TaskDraft[]) {
  const seen = new Set<string>();
  const results: TaskDraft[] = [];

  for (const task of tasks) {
    const key = `${task.status}:${task.title.trim().toLowerCase()}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(task);
  }

  return results;
}

function lowerFirst(value: string) {
  if (!value) {
    return value;
  }

  return value.charAt(0).toLowerCase() + value.slice(1);
}

function toSentenceCase(value: string) {
  if (!value) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}
