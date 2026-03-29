import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type { PreferredAdapter } from "@scratch-pad/shared";
import {
  ApiError,
  approvePrd,
  createProject,
  createScratchNote,
  deleteScratchNote,
  fetchAdapterStatuses,
  fetchHealth,
  fetchProjectWorkspace,
  generatePrd,
  generateTasks,
  openCodexApp,
  prepareReview,
  revisePrd,
  runNextTask,
  saveProjectSetup,
  updateScratchNote,
  type AdapterStatus,
  type ProjectWorkspace,
  type Run,
  type Task,
} from "./api";

type ActionMessage = {
  tone: "default" | "error";
  text: string;
};

type HealthState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

type AdapterStatusState =
  | { status: "loading" }
  | { status: "ready"; data: AdapterStatus[] }
  | { status: "error"; message: string };

type Screen = "welcome" | "projects" | "command";

const CURRENT_PROJECT_STORAGE_KEY = "scratch-pad/current-project-id";
const FALLBACK_PROJECT_SUMMARY =
  "a local-first open-source layer that sits on top of Claude Code and Codex and turns messy builder intent into a controlled execution loop. The core idea is simple: instead of bouncing between notes, prompts, terminal commands, and half-structured plans, you dump rough thoughts into the app";
const STAGE_ORDER: Array<ProjectWorkspace["currentStage"]> = [
  "project",
  "scratch",
  "plan",
  "queue",
  "run",
  "review",
];
const FIELD_CLASS =
  "w-full rounded-[18px] border border-white/10 bg-white/[0.08] px-4 py-3 font-body text-sm text-white placeholder:text-white/35 outline-none transition focus:border-white/30 focus:bg-white/[0.12]";
const PANEL_CLASS =
  "rounded-[30px] border border-white/10 bg-white/[0.08] shadow-glass backdrop-blur-[22px]";
const INNER_CARD_CLASS =
  "rounded-[22px] border border-white/10 bg-black/20 backdrop-blur-[8px]";

const adapterOptions: Array<{
  label: string;
  value: "" | Exclude<PreferredAdapter, null>;
}> = [
  { label: "No preference yet", value: "" },
  { label: "Claude Code", value: "claude-code" },
  { label: "Codex", value: "codex" },
];

export default function App() {
  const [health, setHealth] = useState<HealthState>({ status: "loading" });
  const [adapterStatuses, setAdapterStatuses] = useState<AdapterStatusState>({
    status: "loading",
  });
  const [workspace, setWorkspace] = useState<ProjectWorkspace | null>(null);
  const [screen, setScreen] = useState<Screen>("welcome");
  const [projectName, setProjectName] = useState("");
  const [projectAdapter, setProjectAdapter] = useState<
    "" | Exclude<PreferredAdapter, null>
  >("");
  const [repoPath, setRepoPath] = useState("");
  const [setupAdapter, setSetupAdapter] = useState<
    "" | Exclude<PreferredAdapter, null>
  >("");
  const [newNoteContent, setNewNoteContent] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [revisionInstruction, setRevisionInstruction] = useState("");
  const [projectMessage, setProjectMessage] = useState<ActionMessage | null>(null);
  const [notesMessage, setNotesMessage] = useState<ActionMessage | null>(null);
  const [planMessage, setPlanMessage] = useState<ActionMessage | null>(null);
  const [queueMessage, setQueueMessage] = useState<ActionMessage | null>(null);
  const [runMessage, setRunMessage] = useState<ActionMessage | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const previousActiveRunIdRef = useRef<string | null>(null);

  const project = workspace?.project ?? null;
  const notes = workspace?.notes ?? [];
  const plan = workspace?.plan ?? null;
  const tasks = workspace?.tasks ?? [];
  const runs = workspace?.runs ?? [];
  const codexAdapterStatus =
    adapterStatuses.status === "ready"
      ? adapterStatuses.data.find((item) => item.id === "codex") ?? null
      : null;
  const claudeAdapterStatus =
    adapterStatuses.status === "ready"
      ? adapterStatuses.data.find((item) => item.id === "claude-code") ?? null
      : null;

  async function loadHealth() {
    setHealth({ status: "loading" });

    try {
      await fetchHealth();
      setHealth({ status: "ready" });
    } catch (error) {
      setHealth({
        status: "error",
        message: getErrorMessage(error),
      });
    }
  }

  async function loadAdapterStatuses() {
    setAdapterStatuses({ status: "loading" });

    try {
      const statuses = await fetchAdapterStatuses();
      setAdapterStatuses({ status: "ready", data: statuses });
    } catch (error) {
      setAdapterStatuses({
        status: "error",
        message: getErrorMessage(error),
      });
    }
  }

  function clearActionMessages() {
    setProjectMessage(null);
    setNotesMessage(null);
    setPlanMessage(null);
    setQueueMessage(null);
    setRunMessage(null);
  }

  function applyProjectWorkspace(
    nextWorkspace: ProjectWorkspace,
    options?: { syncProjectSetupFields?: boolean },
  ) {
    setWorkspace(nextWorkspace);

    if (options?.syncProjectSetupFields ?? false) {
      setRepoPath(nextWorkspace.project.repoPath ?? "");
      setSetupAdapter(nextWorkspace.project.preferredAdapter ?? "");
    }

    window.localStorage.setItem(
      CURRENT_PROJECT_STORAGE_KEY,
      nextWorkspace.project.id,
    );
  }

  async function loadProjectWorkspace(
    projectId: string,
    options?: {
      resetMessages?: boolean;
      syncProjectSetupFields?: boolean;
    },
  ) {
    const loadedWorkspace = await fetchProjectWorkspace(projectId);

    applyProjectWorkspace(
      loadedWorkspace,
      options?.syncProjectSetupFields
        ? { syncProjectSetupFields: true }
        : undefined,
    );

    if (options?.resetMessages ?? true) {
      clearActionMessages();
    }

    return loadedWorkspace;
  }

  async function syncProjectWorkspace(projectId: string) {
    await loadProjectWorkspace(projectId, {
      resetMessages: false,
    });
  }

  async function refreshCurrentProject(
    projectId: string,
    options?: { setScreenAfterLoad?: boolean },
  ) {
    try {
      const loadedWorkspace = await loadProjectWorkspace(projectId, {
        syncProjectSetupFields: true,
      });

      if (options?.setScreenAfterLoad) {
        setScreen(inferScreenFromWorkspace(loadedWorkspace));
      }
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 404) {
        clearCurrentProject();
        return;
      }

      setProjectMessage(errorMessage(error));
    }
  }

  function clearCurrentProject() {
    setWorkspace(null);
    setRepoPath("");
    setSetupAdapter("");
    setEditingNoteId(null);
    setEditingContent("");
    setRevisionInstruction("");
    setScreen("welcome");
    clearActionMessages();
    window.localStorage.removeItem(CURRENT_PROJECT_STORAGE_KEY);
  }

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProjectMessage(null);
    setBusyAction("create-project");

    try {
      const createdProject = await createProject({
        name: projectName,
        preferredAdapter: projectAdapter || null,
      });

      setProjectName("");
      setProjectAdapter("");
      await loadProjectWorkspace(createdProject.id, {
        syncProjectSetupFields: true,
      });
      setScreen("projects");
      setProjectMessage(successMessage("Project created locally."));
    } catch (error) {
      setProjectMessage(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSaveProjectSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!project) {
      return;
    }

    setProjectMessage(null);
    setBusyAction("save-project-setup");

    try {
      await saveProjectSetup(project.id, {
        repoPath,
        preferredAdapter: setupAdapter || null,
      });

      await loadProjectWorkspace(project.id, {
        resetMessages: false,
        syncProjectSetupFields: true,
      });
      setProjectMessage(successMessage("Project setup saved."));
    } catch (error) {
      setProjectMessage(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleOpenCodexApp() {
    if (!project) {
      return;
    }

    setProjectMessage(null);
    setBusyAction("open-codex-app");

    try {
      const result = await openCodexApp(project.id);
      setProjectMessage(successMessage(result.message));
    } catch (error) {
      setProjectMessage(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCreateNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!project) {
      return;
    }

    setNotesMessage(null);
    setBusyAction("create-note");

    try {
      await createScratchNote(project.id, {
        content: newNoteContent,
      });
      setNewNoteContent("");
      await syncProjectWorkspace(project.id);
      setNotesMessage(successMessage("Note saved."));
    } catch (error) {
      setNotesMessage(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSaveNote(noteId: string) {
    if (!project) {
      return;
    }

    setNotesMessage(null);
    setBusyAction(`save-note-${noteId}`);

    try {
      await updateScratchNote(noteId, {
        content: editingContent,
      });
      await syncProjectWorkspace(project.id);
      setEditingNoteId(null);
      setEditingContent("");
      setNotesMessage(successMessage("Note updated."));
    } catch (error) {
      setNotesMessage(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDeleteNote(noteId: string) {
    if (!project) {
      return;
    }

    setNotesMessage(null);
    setBusyAction(`delete-note-${noteId}`);

    try {
      await deleteScratchNote(noteId);
      await syncProjectWorkspace(project.id);

      if (editingNoteId === noteId) {
        setEditingNoteId(null);
        setEditingContent("");
      }

      setNotesMessage(successMessage("Note deleted."));
    } catch (error) {
      setNotesMessage(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleGeneratePrd() {
    if (!project) {
      return;
    }

    setPlanMessage(null);
    setBusyAction("generate-prd");

    try {
      const result = await generatePrd(project.id);
      await syncProjectWorkspace(project.id);
      setPlanMessage(successMessage(result.message));
      setRevisionInstruction("");
    } catch (error) {
      setPlanMessage(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRevisePrd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!project || !plan) {
      return;
    }

    setPlanMessage(null);
    setBusyAction("revise-prd");

    try {
      const result = await revisePrd(project.id, {
        instruction: revisionInstruction,
      });
      await syncProjectWorkspace(project.id);
      setPlanMessage(successMessage(result.message));
      setRevisionInstruction("");
    } catch (error) {
      setPlanMessage(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleApprovePrd() {
    if (!project || !plan) {
      return;
    }

    setPlanMessage(null);
    setBusyAction("approve-prd");

    try {
      const result = await approvePrd(project.id, {
        planVersionId: plan.id,
      });
      await syncProjectWorkspace(project.id);
      setPlanMessage(successMessage(result.message));
    } catch (error) {
      setPlanMessage(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleGenerateTasks() {
    if (!project) {
      return;
    }

    setQueueMessage(null);
    setBusyAction("generate-tasks");

    try {
      const result = await generateTasks(project.id);
      await syncProjectWorkspace(project.id);
      setQueueMessage(successMessage(result.message));
    } catch (error) {
      setQueueMessage(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRunNextTask() {
    if (!project) {
      return;
    }

    setRunMessage(null);
    setBusyAction("run-next-task");

    try {
      const result = await runNextTask(project.id);
      await syncProjectWorkspace(project.id);
      setRunMessage(successMessage(result.message));
    } catch (error) {
      setRunMessage(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handlePrepareReview(runId: string) {
    if (!project) {
      return;
    }

    setRunMessage(null);
    setBusyAction(`prepare-review-${runId}`);

    try {
      const result = await prepareReview(runId);
      await syncProjectWorkspace(project.id);
      setRunMessage(successMessage(result.message));
    } catch (error) {
      setRunMessage(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  useEffect(() => {
    void loadHealth();
    void loadAdapterStatuses();

    const savedProjectId = window.localStorage.getItem(
      CURRENT_PROJECT_STORAGE_KEY,
    );

    if (savedProjectId) {
      void refreshCurrentProject(savedProjectId, {
        setScreenAfterLoad: true,
      });
    }
  }, []);

  useEffect(() => {
    if (!project && screen === "command") {
      setScreen("projects");
    }
  }, [project, screen]);

  const latestRunByTaskId = new Map<string, Run>();

  for (const run of runs) {
    if (!latestRunByTaskId.has(run.taskId)) {
      latestRunByTaskId.set(run.taskId, run);
    }
  }

  const activeRun =
    runs.find((run) => run.status === "starting" || run.status === "running") ??
    null;
  const queuedTasks = tasks.filter(
    (task) =>
      task.status === "queued" &&
      latestRunByTaskId.get(task.id)?.status !== "completed",
  );
  const blockedTasks = tasks.filter((task) => task.status === "blocked");
  const reviewTasks = tasks.filter((task) => task.status === "review");
  const highRiskQueuedTasks = queuedTasks.filter(
    (task) => task.riskLevel === "high",
  );
  const nextRunnableTask = activeRun
    ? null
    : queuedTasks.find((task) => task.riskLevel !== "high") ?? null;
  const latestRun = runs[0] ?? null;
  const featuredRun = activeRun ?? latestRun;
  const recentRuns = runs.slice(0, 4);
  const recentHistoryRuns = featuredRun
    ? recentRuns.filter((run) => run.id !== featuredRun.id)
    : recentRuns;
  const canPrepareFeaturedRun = Boolean(
    featuredRun &&
      !activeRun &&
      featuredRun.status === "completed" &&
      !featuredRun.reviewPreparedAt,
  );
  const canOpenCodexDesktop = Boolean(
    project?.repoPath && codexAdapterStatus?.appLaunchSupported,
  );
  const systemReadyCount =
    adapterStatuses.status === "ready"
      ? adapterStatuses.data.filter((status) => status.ready).length
      : 0;
  const projectSynopsis = buildProjectSynopsis(project?.name ?? null, notes, plan);
  const currentScreen = screen === "command" && !project ? "projects" : screen;

  useEffect(() => {
    if (!project || !activeRun) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void syncProjectWorkspace(project.id).catch((error) => {
        setRunMessage(errorMessage(error));
      });
    }, 2000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [activeRun?.id, project?.id]);

  useEffect(() => {
    if (activeRun) {
      previousActiveRunIdRef.current = activeRun.id;
      return;
    }

    if (!previousActiveRunIdRef.current) {
      return;
    }

    const completedRun = runs.find(
      (run) => run.id === previousActiveRunIdRef.current,
    );

    previousActiveRunIdRef.current = null;

    if (!completedRun) {
      return;
    }

    if (completedRun.status === "completed") {
      setRunMessage(
        successMessage(`Run completed for "${completedRun.taskTitle}".`),
      );
      return;
    }

    if (
      completedRun.status === "failed" ||
      completedRun.status === "cancelled"
    ) {
      setRunMessage(
        errorMessage(
          `Run ${completedRun.status} for "${completedRun.taskTitle}". Check the saved log for details.`,
        ),
      );
    }
  }, [activeRun, runs]);

  return (
    <div className="min-h-screen text-white">
      <main className="mx-auto flex min-h-screen w-full max-w-[1920px] flex-col px-4 py-4 md:px-7 md:py-6">
        <FlowHeader
          currentScreen={currentScreen}
          hasProject={Boolean(project)}
          onNavigate={setScreen}
        />

        {currentScreen === "welcome" ? (
          <WelcomeScreen
            health={health}
            adapterStatuses={adapterStatuses}
            claudeAdapterStatus={claudeAdapterStatus}
            codexAdapterStatus={codexAdapterStatus}
            systemReadyCount={systemReadyCount}
            hasProject={Boolean(project)}
            onContinue={() => setScreen("projects")}
          />
        ) : null}

        {currentScreen === "projects" ? (
          <ActiveProjectsScreen
            project={project}
            projectSynopsis={projectSynopsis}
            projectMessage={projectMessage}
            projectName={projectName}
            projectAdapter={projectAdapter}
            repoPath={repoPath}
            setupAdapter={setupAdapter}
            codexAdapterStatus={codexAdapterStatus}
            busyAction={busyAction}
            onProjectNameChange={setProjectName}
            onProjectAdapterChange={setProjectAdapter}
            onRepoPathChange={setRepoPath}
            onSetupAdapterChange={setSetupAdapter}
            onCreateProject={handleCreateProject}
            onSaveProjectSetup={handleSaveProjectSetup}
            onDiveIn={() => setScreen("command")}
            onBackToWelcome={() => setScreen("welcome")}
            onOpenCodexApp={() => void handleOpenCodexApp()}
            canOpenCodexDesktop={canOpenCodexDesktop}
            currentStage={workspace?.currentStage ?? "project"}
          />
        ) : null}

        {currentScreen === "command" && project ? (
          <CommandCenterScreen
            project={project}
            currentStage={workspace?.currentStage ?? "project"}
            notes={notes}
            plan={plan}
            queuedTasks={queuedTasks}
            blockedTasks={blockedTasks}
            reviewTasks={reviewTasks}
            highRiskQueuedTasks={highRiskQueuedTasks}
            nextTask={nextRunnableTask}
            featuredRun={featuredRun}
            recentHistoryRuns={recentHistoryRuns}
            canPrepareFeaturedRun={canPrepareFeaturedRun}
            busyAction={busyAction}
            newNoteContent={newNoteContent}
            editingNoteId={editingNoteId}
            editingContent={editingContent}
            revisionInstruction={revisionInstruction}
            notesMessage={notesMessage}
            planMessage={planMessage}
            queueMessage={queueMessage}
            runMessage={runMessage}
            onBackToProjects={() => setScreen("projects")}
            onNewNoteContentChange={setNewNoteContent}
            onCreateNote={handleCreateNote}
            onEditStart={(noteId, value) => {
              setEditingNoteId(noteId);
              setEditingContent(value);
            }}
            onEditCancel={() => {
              setEditingNoteId(null);
              setEditingContent("");
            }}
            onEditingContentChange={setEditingContent}
            onSaveNote={(noteId) => void handleSaveNote(noteId)}
            onDeleteNote={(noteId) => void handleDeleteNote(noteId)}
            onGeneratePrd={() => void handleGeneratePrd()}
            onRevisionInstructionChange={setRevisionInstruction}
            onRevisePrd={handleRevisePrd}
            onApprovePrd={() => void handleApprovePrd()}
            onGenerateTasks={() => void handleGenerateTasks()}
            onRunNextTask={() => void handleRunNextTask()}
            onPrepareReview={(runId) => void handlePrepareReview(runId)}
          />
        ) : null}
      </main>
    </div>
  );
}

function FlowHeader(props: {
  currentScreen: Screen;
  hasProject: boolean;
  onNavigate: (screen: Screen) => void;
}) {
  const steps: Array<{ id: Screen; label: string; disabled?: boolean }> = [
    { id: "welcome", label: "welcome_page" },
    { id: "projects", label: "active_projects" },
    {
      id: "command",
      label: "command_center",
      disabled: !props.hasProject,
    },
  ];

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="text-[11px] uppercase tracking-[0.32em] text-white/40">
        scratch_pad / orchestration flow
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {steps.map((step) => {
          const active = step.id === props.currentScreen;

          return (
            <button
              key={step.id}
              type="button"
              onClick={() => props.onNavigate(step.id)}
              disabled={step.disabled}
              className={cx(
                "rounded-full border px-3 py-1.5 text-xs tracking-[0.18em] transition",
                active
                  ? "border-white/30 bg-white/12 text-white"
                  : "border-white/10 bg-white/[0.03] text-white/55 hover:border-white/20 hover:text-white",
                step.disabled ? "cursor-not-allowed opacity-35" : "",
              )}
            >
              {step.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WelcomeScreen(props: {
  health: HealthState;
  adapterStatuses: AdapterStatusState;
  claudeAdapterStatus: AdapterStatus | null;
  codexAdapterStatus: AdapterStatus | null;
  systemReadyCount: number;
  hasProject: boolean;
  onContinue: () => void;
}) {
  return (
    <FrameSurface>
      <div className="mx-auto flex w-full max-w-[1845px] flex-1 flex-col px-4 pb-6 pt-5 md:px-8 md:pb-8 md:pt-8 lg:px-10">
        <div className="flex items-start justify-between gap-4">
          <div className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-xs tracking-[0.22em] text-white/70">
            system_status /{" "}
            {props.health.status === "ready"
              ? "online"
              : props.health.status === "loading"
                ? "checking"
                : "offline"}
          </div>
          <div className="rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-xs tracking-[0.22em] text-white/70">
            ready_agents / {props.systemReadyCount}
          </div>
        </div>

        <div className={cx(PANEL_CLASS, "relative mt-6 flex-1 overflow-hidden px-5 py-8 md:px-9 md:py-10 lg:px-16 lg:py-12")}>
          <div className="mx-auto flex h-full w-full max-w-[1697px] flex-col">
            <h1 className="text-center font-display text-[32px] lowercase tracking-[0.08em] text-white md:text-[42px] lg:text-[50px]">
              lets_get_cooking!
            </h1>

            <div className="mt-16 text-xl lowercase tracking-[0.08em] text-white/90 md:text-[30px]">
              initialize_agents
            </div>

            <div className="mt-5 grid gap-6 lg:grid-cols-2">
              <WelcomeAgentCard
                adapterStatus={props.claudeAdapterStatus}
                fallbackLabel="claude_code"
                loading={props.adapterStatuses.status === "loading"}
              />
              <WelcomeAgentCard
                adapterStatus={props.codexAdapterStatus}
                fallbackLabel="codex"
                loading={props.adapterStatuses.status === "loading"}
              />
            </div>

            <div className="mt-6">
              {props.health.status === "error" ? (
                <InlineMessage tone="error">
                  backend_check_failed / {props.health.message}
                </InlineMessage>
              ) : null}

              {props.adapterStatuses.status === "error" ? (
                <div className="mt-3">
                  <InlineMessage tone="error">
                    adapter_diagnostics_failed / {props.adapterStatuses.message}
                  </InlineMessage>
                </div>
              ) : null}

              {props.hasProject ? (
                <div className="mt-3">
                  <InlineMessage tone="default">
                    saved_workspace_detected / resume from active_projects when you are
                    ready.
                  </InlineMessage>
                </div>
              ) : null}
            </div>

            <div className="mt-auto pt-10">
              <button
                type="button"
                onClick={props.onContinue}
                disabled={props.health.status !== "ready"}
                className="flex w-full items-center justify-center rounded-[24px] border border-white/10 bg-white/[0.12] px-6 py-7 text-center font-display text-[18px] lowercase tracking-[0.08em] text-white transition hover:bg-white/[0.16] disabled:cursor-not-allowed disabled:opacity-45 md:text-[30px]"
              >
                initialize_workspace →
              </button>
            </div>
          </div>
        </div>

        <BrandMark className="mt-5 justify-end" />
      </div>
    </FrameSurface>
  );
}

function ActiveProjectsScreen(props: {
  project: ProjectWorkspace["project"] | null;
  projectSynopsis: string;
  projectMessage: ActionMessage | null;
  projectName: string;
  projectAdapter: "" | Exclude<PreferredAdapter, null>;
  repoPath: string;
  setupAdapter: "" | Exclude<PreferredAdapter, null>;
  codexAdapterStatus: AdapterStatus | null;
  busyAction: string | null;
  onProjectNameChange: (value: string) => void;
  onProjectAdapterChange: (
    value: "" | Exclude<PreferredAdapter, null>,
  ) => void;
  onRepoPathChange: (value: string) => void;
  onSetupAdapterChange: (value: "" | Exclude<PreferredAdapter, null>) => void;
  onCreateProject: (event: FormEvent<HTMLFormElement>) => void;
  onSaveProjectSetup: (event: FormEvent<HTMLFormElement>) => void;
  onDiveIn: () => void;
  onBackToWelcome: () => void;
  onOpenCodexApp: () => void;
  canOpenCodexDesktop: boolean;
  currentStage: ProjectWorkspace["currentStage"];
}) {
  return (
    <FrameSurface>
      <div className="mx-auto flex w-full max-w-[1845px] flex-1 flex-col px-4 pb-6 pt-5 md:px-8 md:pb-8 md:pt-8 lg:px-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-[30px] lowercase tracking-[0.08em] text-white md:text-[40px] lg:text-[50px]">
            active_projects
          </h1>

          <GhostButton onClick={props.onBackToWelcome}>
            back_to_welcome
          </GhostButton>
        </div>

        <div className="mt-10 grid max-w-[1110px] gap-8 xl:grid-cols-[513px_513px] xl:items-start">
          <section className={cx(PANEL_CLASS, "min-h-[446px] overflow-hidden")}>
            <header className="border-b border-white/10 px-6 py-6">
              <div className="text-center font-display text-[20px] lowercase tracking-[0.08em] text-white md:text-[30px]">
                {props.project?.name ?? "no_active_project"}
              </div>
            </header>

            <div className="flex h-full flex-col gap-5 px-6 py-6">
              <div className="flex flex-wrap gap-2">
                <Badge>{formatProjectWorkspaceStage(props.currentStage)}</Badge>
                <Badge>
                  {props.project?.preferredAdapter
                    ? formatAdapterLabel(props.project.preferredAdapter)
                    : "adapter_not_set"}
                </Badge>
              </div>

              <p className="font-body text-sm leading-7 text-white/72">
                {props.project
                  ? props.projectSynopsis
                  : "Create a project from the new_idea panel to start the local workflow."}
              </p>

              {props.project ? (
                <form className="space-y-3" onSubmit={props.onSaveProjectSetup}>
                  <label className="block space-y-2">
                    <span className="text-xs uppercase tracking-[0.2em] text-white/45">
                      local_repo_path
                    </span>
                    <input
                      className={FIELD_CLASS}
                      placeholder="/Users/you/code/my-project"
                      value={props.repoPath}
                      onChange={(event) =>
                        props.onRepoPathChange(event.target.value)
                      }
                    />
                  </label>

                  <label className="block space-y-2">
                    <span className="text-xs uppercase tracking-[0.2em] text-white/45">
                      preferred_adapter
                    </span>
                    <select
                      className={FIELD_CLASS}
                      value={props.setupAdapter}
                      onChange={(event) =>
                        props.onSetupAdapterChange(
                          event.target.value as
                            | ""
                            | Exclude<PreferredAdapter, null>,
                        )
                      }
                    >
                      {adapterOptions.map((option) => (
                        <option key={option.label} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="flex flex-wrap gap-3">
                    <ActionButton
                      type="submit"
                      disabled={props.busyAction === "save-project-setup"}
                    >
                      {props.busyAction === "save-project-setup"
                        ? "saving..."
                        : "save_setup"}
                    </ActionButton>

                    <GhostButton
                      disabled={
                        props.busyAction === "open-codex-app" ||
                        !props.canOpenCodexDesktop
                      }
                      onClick={props.onOpenCodexApp}
                    >
                      {props.busyAction === "open-codex-app"
                        ? "opening_codex..."
                        : "open_codex_app"}
                    </GhostButton>
                  </div>

                  {props.codexAdapterStatus?.appMessage ? (
                    <p className="font-body text-xs leading-6 text-white/45">
                      {props.codexAdapterStatus.appMessage}
                    </p>
                  ) : null}
                </form>
              ) : (
                <div className={cx(INNER_CARD_CLASS, "p-5 font-body text-sm leading-7 text-white/65")}>
                  Create or load one project here, then use <span className="font-display">dive_in</span> to move into the command center.
                </div>
              )}

              <div className="mt-auto">
                <button
                  type="button"
                  onClick={props.onDiveIn}
                  disabled={!props.project}
                  className="w-full border border-white/10 bg-white/[0.12] px-5 py-4 font-display text-[18px] lowercase tracking-[0.08em] text-white transition hover:bg-white/[0.16] disabled:cursor-not-allowed disabled:opacity-40"
                  style={{
                    clipPath:
                      "polygon(10% 0%, 90% 0%, 100% 100%, 0% 100%)",
                  }}
                >
                  dive_in
                </button>
              </div>
            </div>
          </section>

          <section className={cx(PANEL_CLASS, "overflow-hidden")}>
            <header className="border-b border-white/10 px-6 py-6">
              <div className="text-center font-display text-[20px] lowercase tracking-[0.08em] text-white md:text-[30px]">
                new_idea <span className="text-white/55">+</span>
              </div>
            </header>

            <form className="space-y-4 px-6 py-6" onSubmit={props.onCreateProject}>
              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.2em] text-white/45">
                  project_name
                </span>
                <input
                  className={FIELD_CLASS}
                  placeholder="scratch_pad"
                  value={props.projectName}
                  onChange={(event) =>
                    props.onProjectNameChange(event.target.value)
                  }
                />
              </label>

              <label className="block space-y-2">
                <span className="text-xs uppercase tracking-[0.2em] text-white/45">
                  preferred_adapter
                </span>
                <select
                  className={FIELD_CLASS}
                  value={props.projectAdapter}
                  onChange={(event) =>
                    props.onProjectAdapterChange(
                      event.target.value as "" | Exclude<PreferredAdapter, null>,
                    )
                  }
                >
                  {adapterOptions.map((option) => (
                    <option key={option.label} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <p className="font-body text-sm leading-7 text-white/62">
                Start a new local idea thread, then wire in the repo path from the active project card once the concept is ready.
              </p>

              <ActionButton
                type="submit"
                disabled={
                  props.busyAction === "create-project" ||
                  props.projectName.trim().length === 0
                }
              >
                {props.busyAction === "create-project"
                  ? "creating..."
                  : "create_project"}
              </ActionButton>
            </form>
          </section>
        </div>

        {props.projectMessage ? (
          <div className="mt-5 max-w-[1110px]">
            <InlineMessage tone={props.projectMessage.tone}>
              {props.projectMessage.text}
            </InlineMessage>
          </div>
        ) : null}

        <BrandMark className="mt-auto justify-end pt-5" />
      </div>
    </FrameSurface>
  );
}

function CommandCenterScreen(props: {
  project: ProjectWorkspace["project"];
  currentStage: ProjectWorkspace["currentStage"];
  notes: ProjectWorkspace["notes"];
  plan: ProjectWorkspace["plan"];
  queuedTasks: Task[];
  blockedTasks: Task[];
  reviewTasks: Task[];
  highRiskQueuedTasks: Task[];
  nextTask: Task | null;
  featuredRun: Run | null;
  recentHistoryRuns: Run[];
  canPrepareFeaturedRun: boolean;
  busyAction: string | null;
  newNoteContent: string;
  editingNoteId: string | null;
  editingContent: string;
  revisionInstruction: string;
  notesMessage: ActionMessage | null;
  planMessage: ActionMessage | null;
  queueMessage: ActionMessage | null;
  runMessage: ActionMessage | null;
  onBackToProjects: () => void;
  onNewNoteContentChange: (value: string) => void;
  onCreateNote: (event: FormEvent<HTMLFormElement>) => void;
  onEditStart: (noteId: string, value: string) => void;
  onEditCancel: () => void;
  onEditingContentChange: (value: string) => void;
  onSaveNote: (noteId: string) => void;
  onDeleteNote: (noteId: string) => void;
  onGeneratePrd: () => void;
  onRevisionInstructionChange: (value: string) => void;
  onRevisePrd: (event: FormEvent<HTMLFormElement>) => void;
  onApprovePrd: () => void;
  onGenerateTasks: () => void;
  onRunNextTask: () => void;
  onPrepareReview: (runId: string) => void;
}) {
  const featuredRun = props.featuredRun;
  const runButtonDisabled =
    !props.project.repoPath ||
    !props.project.preferredAdapter ||
    !props.nextTask ||
    props.busyAction === "run-next-task" ||
    Boolean(
      featuredRun &&
        (featuredRun.status === "starting" || featuredRun.status === "running"),
    );
  const taskGenerationDisabled =
    !props.plan?.approved || props.busyAction === "generate-tasks";
  const stageProgress =
    (STAGE_ORDER.indexOf(props.currentStage) + 1) / STAGE_ORDER.length;
  const featuredRunPrepareAction =
    featuredRun && props.canPrepareFeaturedRun
      ? () => props.onPrepareReview(featuredRun.id)
      : null;
  const primaryStatus = buildPrimaryStatusSummary({
    project: props.project,
    currentStage: props.currentStage,
    notes: props.notes,
    plan: props.plan,
    queuedTasks: props.queuedTasks,
    blockedTasks: props.blockedTasks,
    reviewTasks: props.reviewTasks,
    nextTask: props.nextTask,
    featuredRun,
  });

  return (
    <FrameSurface>
      <div className="mx-auto flex w-full max-w-[1845px] flex-1 flex-col px-3 pb-5 pt-4 md:px-6 md:pb-7 md:pt-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{props.project.name}</Badge>
            <Badge>{formatProjectWorkspaceStage(props.currentStage)}</Badge>
            <Badge>
              {props.project.preferredAdapter
                ? formatAdapterLabel(props.project.preferredAdapter)
                : "adapter_not_set"}
            </Badge>
          </div>

          <GhostButton onClick={props.onBackToProjects}>
            active_projects
          </GhostButton>
        </div>

        <section className={cx(PANEL_CLASS, "mb-6 overflow-hidden")}>
          <div className="flex flex-col gap-5 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <div className="text-xs uppercase tracking-[0.22em] text-white/42">
                primary_status
              </div>
              <div className="mt-2 font-display text-[22px] lowercase tracking-[0.08em] text-white md:text-[30px]">
                {primaryStatus.statusLabel}
              </div>
              <div className="mt-2 font-display text-base lowercase tracking-[0.08em] text-white/84 md:text-[22px]">
                {primaryStatus.title}
              </div>
              <p className="mt-3 max-w-[780px] font-body text-sm leading-7 text-white/68">
                {primaryStatus.detail}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Badge>{formatProjectWorkspaceStage(props.currentStage)}</Badge>
              {featuredRun ? (
                <Badge>{formatRunDisplayState(featuredRun)}</Badge>
              ) : null}
              {props.nextTask ? <Badge>next_task_ready</Badge> : null}
              {props.reviewTasks.length > 0 ? (
                <Badge>{props.reviewTasks.length} review_ready</Badge>
              ) : null}
            </div>
          </div>
        </section>

        <div className="grid flex-1 gap-6 xl:grid-cols-[0.78fr_1.02fr]">
          <section className={cx(PANEL_CLASS, "relative min-h-[720px] overflow-hidden")}>
            <header className="flex items-center justify-between border-b border-white/10 px-6 py-5">
              <div className="font-display text-[20px] lowercase tracking-[0.08em] text-white md:text-[30px]">
                scratch_pad
              </div>
              <div className="font-display text-[18px] lowercase tracking-[0.08em] text-white/55 md:text-[30px]">
                PRD
              </div>
            </header>

            <div className="absolute bottom-6 left-6 top-[126px] hidden w-[11px] rounded-full bg-white/[0.08] lg:block">
              <div
                className="w-full rounded-full bg-white/[0.24] transition-all"
                style={{ height: `${Math.max(stageProgress * 100, 12)}%` }}
              />
            </div>

            <div className="max-h-[calc(100vh-220px)] space-y-6 overflow-y-auto px-5 py-5 lg:pl-10 lg:pr-6">
              <section className={cx(INNER_CARD_CLASS, "p-5")}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.22em] text-white/45">
                      project_snapshot
                    </div>
                    <div className="mt-2 font-display text-lg lowercase tracking-[0.08em] text-white">
                      {props.project.name}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Badge>{props.project.repoPath ? "repo_linked" : "repo_missing"}</Badge>
                    <Badge>
                      {props.project.preferredAdapter
                        ? formatAdapterLabel(props.project.preferredAdapter)
                        : "select_adapter"}
                    </Badge>
                  </div>
                </div>

                <p className="mt-4 break-all font-body text-sm leading-7 text-white/65">
                  {props.project.repoPath ?? "Link a local repository from active_projects before you start a run."}
                </p>
              </section>

              <section className={cx(INNER_CARD_CLASS, "p-5")}>
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div className="font-display text-lg lowercase tracking-[0.08em] text-white">
                    scratch_notes
                  </div>
                  <Badge>{props.notes.length}</Badge>
                </div>

                {props.notesMessage ? (
                  <div className="mb-4">
                    <InlineMessage tone={props.notesMessage.tone}>
                      {props.notesMessage.text}
                    </InlineMessage>
                  </div>
                ) : null}

                <form className="space-y-3" onSubmit={props.onCreateNote}>
                  <textarea
                    className={FIELD_CLASS}
                    rows={4}
                    placeholder="dump the rough idea, constraints, and desired outcome here..."
                    value={props.newNoteContent}
                    onChange={(event) =>
                      props.onNewNoteContentChange(event.target.value)
                    }
                  />

                  <ActionButton
                    type="submit"
                    disabled={
                      props.busyAction === "create-note" ||
                      props.newNoteContent.trim().length === 0
                    }
                  >
                    {props.busyAction === "create-note"
                      ? "saving_note..."
                      : "add_note"}
                  </ActionButton>
                </form>

                <div className="mt-5 space-y-3">
                  {props.notes.length === 0 ? (
                    <EmptyGlassState>
                      No notes yet. Add the first rough product note to feed the PRD.
                    </EmptyGlassState>
                  ) : (
                    props.notes.map((note) => {
                      const isEditing = props.editingNoteId === note.id;
                      const isSaving = props.busyAction === `save-note-${note.id}`;
                      const isDeleting =
                        props.busyAction === `delete-note-${note.id}`;

                      return (
                        <article
                          key={note.id}
                          className="rounded-[18px] border border-white/10 bg-white/[0.05] p-4"
                        >
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs uppercase tracking-[0.2em] text-white/38">
                              updated / {formatTimestamp(note.updatedAt)}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              {isEditing ? (
                                <>
                                  <GhostButton
                                    onClick={() => props.onSaveNote(note.id)}
                                    disabled={
                                      isSaving ||
                                      props.editingContent.trim().length === 0
                                    }
                                  >
                                    {isSaving ? "saving..." : "save"}
                                  </GhostButton>
                                  <GhostButton onClick={props.onEditCancel}>
                                    cancel
                                  </GhostButton>
                                </>
                              ) : (
                                <GhostButton
                                  onClick={() =>
                                    props.onEditStart(note.id, note.content)
                                  }
                                >
                                  edit
                                </GhostButton>
                              )}
                              <GhostButton
                                onClick={() => props.onDeleteNote(note.id)}
                                disabled={isDeleting}
                              >
                                {isDeleting ? "deleting..." : "delete"}
                              </GhostButton>
                            </div>
                          </div>

                          {isEditing ? (
                            <textarea
                              className={FIELD_CLASS}
                              rows={4}
                              value={props.editingContent}
                              onChange={(event) =>
                                props.onEditingContentChange(event.target.value)
                              }
                            />
                          ) : (
                            <p className="whitespace-pre-wrap font-body text-sm leading-7 text-white/72">
                              {note.content}
                            </p>
                          )}
                        </article>
                      );
                    })
                  )}
                </div>
              </section>

              <section className={cx(INNER_CARD_CLASS, "p-5")}>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.22em] text-white/45">
                      PRD_status
                    </div>
                    <div className="mt-2 font-display text-lg lowercase tracking-[0.08em] text-white">
                      {props.plan ? "working_prd" : "generate_prd"}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {props.plan ? (
                      <Badge>{props.plan.approved ? "approved" : "draft"}</Badge>
                    ) : null}
                    <ActionButton
                      onClick={props.onGeneratePrd}
                      disabled={
                        props.notes.length === 0 ||
                        props.busyAction === "generate-prd"
                      }
                    >
                      {props.busyAction === "generate-prd"
                        ? "generating..."
                        : props.plan
                          ? "regenerate"
                          : "generate_prd"}
                    </ActionButton>
                  </div>
                </div>

                {props.planMessage ? (
                  <div className="mb-4">
                    <InlineMessage tone={props.planMessage.tone}>
                      {props.planMessage.text}
                    </InlineMessage>
                  </div>
                ) : null}

                {props.notes.length === 0 ? (
                  <EmptyGlassState>
                    Add at least one scratch note before generating the first PRD.
                  </EmptyGlassState>
                ) : !props.plan ? (
                  <EmptyGlassState>
                    The PRD lives here once generated. Keep the notes tight, then generate a compact draft.
                  </EmptyGlassState>
                ) : (
                  <>
                    <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4">
                      <div className="text-xs uppercase tracking-[0.2em] text-white/38">
                        summary
                      </div>
                      <p className="mt-3 font-body text-sm leading-7 text-white/74">
                        {props.plan.summary}
                      </p>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-3">
                      <PlanCluster title="scope" items={props.plan.scope} />
                      <PlanCluster title="acceptance" items={props.plan.acceptance} />
                      <PlanCluster title="non_goals" items={props.plan.nonGoals} />
                    </div>

                    <form className="mt-5 space-y-3" onSubmit={props.onRevisePrd}>
                      <textarea
                        className={FIELD_CLASS}
                        rows={4}
                        placeholder="tighten a line, narrow the scope, or clarify acceptance..."
                        value={props.revisionInstruction}
                        onChange={(event) =>
                          props.onRevisionInstructionChange(event.target.value)
                        }
                      />

                      <div className="flex flex-wrap gap-3">
                        <ActionButton
                          type="submit"
                          disabled={
                            props.busyAction === "revise-prd" ||
                            props.revisionInstruction.trim().length === 0
                          }
                        >
                          {props.busyAction === "revise-prd"
                            ? "revising..."
                            : "revise_prd"}
                        </ActionButton>

                        <GhostButton
                          onClick={props.onApprovePrd}
                          disabled={
                            props.busyAction === "approve-prd" ||
                            props.plan.approved
                          }
                        >
                          {props.busyAction === "approve-prd"
                            ? "approving..."
                            : props.plan.approved
                              ? "approved"
                              : "approve_prd"}
                        </GhostButton>
                      </div>
                    </form>
                  </>
                )}
              </section>
            </div>
          </section>

          <div className="grid gap-6">
            <section className={cx(PANEL_CLASS, "overflow-hidden")}>
              <header className="border-b border-white/10 px-6 py-5">
                <div className="font-display text-[20px] lowercase tracking-[0.08em] text-white md:text-[30px]">
                  runs
                </div>
              </header>

              <div className="space-y-4 px-5 py-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-[0.22em] text-white/42">
                      run_status
                    </div>
                    <div className="mt-2 font-display text-lg lowercase tracking-[0.08em] text-white">
                      {props.featuredRun
                        ? formatRunDisplayState(props.featuredRun)
                        : "idle"}
                    </div>
                  </div>

                  <ActionButton
                    onClick={props.onRunNextTask}
                    disabled={runButtonDisabled}
                  >
                    {props.busyAction === "run-next-task"
                      ? "starting..."
                      : "run_next_task"}
                  </ActionButton>
                </div>

                {props.runMessage ? (
                  <InlineMessage tone={props.runMessage.tone}>
                    {props.runMessage.text}
                  </InlineMessage>
                ) : null}

                {featuredRun ? (
                  <RunFeedCard
                    run={featuredRun}
                    isPreparing={
                      props.busyAction ===
                      `prepare-review-${featuredRun.id}`
                    }
                    {...(featuredRunPrepareAction
                      ? {
                          onPrepareReview: featuredRunPrepareAction,
                        }
                      : {})}
                  />
                ) : (
                  <EmptyGlassState>
                    No run has started yet. Generate tasks, then launch the first one from here.
                  </EmptyGlassState>
                )}

                <div className="space-y-3">
                  {props.recentHistoryRuns.length === 0 ? (
                    <EmptyGlassState>
                      Older runs will collect here after the first execution.
                    </EmptyGlassState>
                  ) : (
                    props.recentHistoryRuns.map((run) => (
                      <RunFeedCard
                        key={run.id}
                        compact
                        run={run}
                        isPreparing={
                          props.busyAction === `prepare-review-${run.id}`
                        }
                        {...(run.status === "completed" && !run.reviewPreparedAt
                          ? {
                              onPrepareReview: () =>
                                props.onPrepareReview(run.id),
                            }
                          : {})}
                      />
                    ))
                  )}
                </div>
              </div>
            </section>

            <section className={cx(PANEL_CLASS, "overflow-hidden")}>
              <header className="border-b border-white/10 px-6 py-5">
                <div className="font-display text-[20px] lowercase tracking-[0.08em] text-white md:text-[30px]">
                  next_up
                </div>
              </header>

              <div className="space-y-4 px-5 py-5">
                {props.queueMessage ? (
                  <InlineMessage tone={props.queueMessage.tone}>
                    {props.queueMessage.text}
                  </InlineMessage>
                ) : null}

                <div className={cx(INNER_CARD_CLASS, "p-5")}>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-white/42">
                        queue_source
                      </div>
                      <div className="mt-2 font-display text-lg lowercase tracking-[0.08em] text-white">
                        {props.plan?.approved
                          ? "latest_approved_prd"
                          : props.plan
                            ? "draft_prd"
                            : "waiting_for_prd"}
                      </div>
                    </div>

                    <ActionButton
                      onClick={props.onGenerateTasks}
                      disabled={taskGenerationDisabled}
                    >
                      {props.busyAction === "generate-tasks"
                        ? "generating..."
                        : props.queuedTasks.length > 0 ||
                            props.blockedTasks.length > 0 ||
                            props.reviewTasks.length > 0
                          ? "regenerate_tasks"
                          : "generate_tasks"}
                    </ActionButton>
                  </div>
                </div>

                <div className={cx(INNER_CARD_CLASS, "p-5")}>
                  <div className="text-xs uppercase tracking-[0.2em] text-white/42">
                    next_task
                  </div>
                  <div className="mt-3 font-display text-lg lowercase tracking-[0.08em] text-white">
                    {props.nextTask ? props.nextTask.title : "nothing_runnable_right_now"}
                  </div>
                  <p className="mt-3 font-body text-sm leading-7 text-white/68">
                    {props.nextTask
                      ? props.nextTask.description
                      : props.highRiskQueuedTasks.length > 0
                        ? "The remaining queued work is high risk, so it stays visible until you explicitly review it."
                        : "Generate tasks or unblock existing work to see the next action item here."}
                  </p>
                </div>

                <div className={cx(INNER_CARD_CLASS, "p-5")}>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <QueueCount label="queued" value={props.queuedTasks.length} />
                    <QueueCount label="review" value={props.reviewTasks.length} />
                    <QueueCount label="blocked" value={props.blockedTasks.length} />
                  </div>

                  <div className="mt-5 space-y-3">
                    {props.queuedTasks.slice(0, 3).map((task) => (
                      <TaskPreviewCard key={task.id} task={task} />
                    ))}

                    {props.queuedTasks.length === 0 &&
                    props.reviewTasks.length === 0 &&
                    props.blockedTasks.length === 0 ? (
                      <EmptyGlassState>
                        The queue will appear here once tasks are generated from the approved PRD.
                      </EmptyGlassState>
                    ) : null}

                    {props.reviewTasks.slice(0, 1).map((task) => (
                      <TaskPreviewCard key={task.id} task={task} />
                    ))}

                    {props.blockedTasks.slice(0, 1).map((task) => (
                      <TaskPreviewCard key={task.id} task={task} />
                    ))}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>

        <BrandMark className="mt-5 justify-end" />
      </div>
    </FrameSurface>
  );
}

function FrameSurface(props: { children: ReactNode }) {
  return (
    <section className="relative flex min-h-[820px] flex-1 overflow-hidden rounded-[34px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05)_0%,rgba(255,255,255,0.02)_100%)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_26%),radial-gradient(circle_at_bottom_left,rgba(155,155,155,0.16),transparent_32%)]" />
      <div className="relative z-10 flex flex-1">{props.children}</div>
    </section>
  );
}

function WelcomeAgentCard(props: {
  adapterStatus: AdapterStatus | null;
  fallbackLabel: string;
  loading: boolean;
}) {
  return (
    <article className={cx(PANEL_CLASS, "min-h-[156px] px-6 py-5")}>
      <div className="flex items-center justify-between gap-3">
        <div className="font-display text-[18px] lowercase tracking-[0.08em] text-white md:text-[26px]">
          {props.adapterStatus
            ? props.adapterStatus.id.replace("-", "_")
            : props.fallbackLabel}
        </div>
        <Badge>
          {props.loading
            ? "checking"
            : props.adapterStatus
              ? formatReadinessLabel(props.adapterStatus.readiness)
              : "unknown"}
        </Badge>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Badge>
          installed /{" "}
          {props.adapterStatus ? (props.adapterStatus.installed ? "yes" : "no") : "?"}
        </Badge>
        <Badge>
          auth /{" "}
          {props.adapterStatus
            ? formatAuthenticatedLabel(props.adapterStatus.authenticated)
            : "?"}
        </Badge>
      </div>

      <p className="mt-4 font-body text-sm leading-7 text-white/65">
        {props.loading
          ? "Running lightweight checks for the local CLI and auth state..."
          : props.adapterStatus?.message ?? "Waiting for adapter diagnostics."}
      </p>
    </article>
  );
}

function PlanCluster(props: { title: string; items: string[] }) {
  return (
    <div className="rounded-[20px] border border-white/10 bg-white/[0.04] p-4">
      <div className="text-xs uppercase tracking-[0.2em] text-white/38">
        {props.title}
      </div>
      <div className="mt-3 space-y-3">
        {props.items.map((item) => (
          <div
            key={item}
            className="rounded-[16px] border border-white/10 bg-black/20 px-4 py-3 font-body text-sm leading-7 text-white/72"
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

function QueueCount(props: { label: string; value: number }) {
  return (
    <div className="rounded-[18px] border border-white/10 bg-white/[0.05] px-4 py-3 text-center">
      <div className="text-xs uppercase tracking-[0.2em] text-white/38">
        {props.label}
      </div>
      <div className="mt-2 font-display text-[22px] lowercase tracking-[0.08em] text-white">
        {props.value}
      </div>
    </div>
  );
}

function TaskPreviewCard(props: { task: Task }) {
  const tone =
    props.task.status === "blocked"
      ? "text-amber-200"
      : props.task.status === "review"
        ? "text-emerald-200"
        : "text-white";

  return (
    <article className="rounded-[18px] border border-white/10 bg-white/[0.05] px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className={cx("font-display text-base lowercase tracking-[0.08em]", tone)}>
          {props.task.orderIndex + 1}. {props.task.title}
        </div>
        <Badge>{props.task.status}</Badge>
      </div>
      <p className="mt-3 font-body text-sm leading-7 text-white/64">
        {truncateText(props.task.description, 180)}
      </p>
    </article>
  );
}

function RunFeedCard(props: {
  run: Run;
  compact?: boolean;
  onPrepareReview?: () => void;
  isPreparing?: boolean;
}) {
  return (
    <article className="rounded-[18px] border border-white/10 bg-white/[0.05] px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-display text-base lowercase tracking-[0.08em] text-white">
          {props.run.taskTitle}
        </div>
        <Badge>{formatRunDisplayState(props.run)}</Badge>
      </div>

      <div className="mt-3 space-y-2 font-body text-sm leading-7 text-white/64">
        <p>adapter / {formatAdapterLabel(props.run.adapter)}</p>
        <p>started / {formatTimestamp(props.run.startedAt)}</p>
        {!props.compact && props.run.finishedAt ? (
          <p>finished / {formatTimestamp(props.run.finishedAt)}</p>
        ) : null}
        <p className="break-all">log / {props.run.outputLogPath}</p>

        {props.run.reviewBranchName ? (
          <p>branch / {props.run.reviewBranchName}</p>
        ) : null}

        {props.run.reviewPreparedAt ? (
          <p>review / prepared {formatTimestamp(props.run.reviewPreparedAt)}</p>
        ) : null}
      </div>

      {props.onPrepareReview ? (
        <div className="mt-4">
          <GhostButton
            onClick={props.onPrepareReview}
            disabled={Boolean(props.isPreparing)}
          >
            {props.isPreparing ? "preparing_review..." : "prepare_review"}
          </GhostButton>
        </div>
      ) : null}
    </article>
  );
}

function ActionButton(props: {
  children: ReactNode;
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
}) {
  return (
    <button
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={props.disabled}
      className="rounded-[18px] border border-white/10 bg-white/[0.14] px-4 py-2.5 font-display text-sm lowercase tracking-[0.08em] text-white transition hover:bg-white/[0.18] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {props.children}
    </button>
  );
}

function GhostButton(props: {
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      disabled={props.disabled}
      className="rounded-[18px] border border-white/10 bg-transparent px-4 py-2.5 font-display text-sm lowercase tracking-[0.08em] text-white/78 transition hover:border-white/20 hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
    >
      {props.children}
    </button>
  );
}

function InlineMessage(props: {
  children: ReactNode;
  tone: "default" | "error";
}) {
  return (
    <div
      className={cx(
        "rounded-[18px] border px-4 py-3 font-body text-sm leading-7",
        props.tone === "error"
          ? "border-rose-300/35 bg-rose-500/10 text-rose-100"
          : "border-emerald-300/25 bg-emerald-500/10 text-emerald-100",
      )}
    >
      {props.children}
    </div>
  );
}

function EmptyGlassState(props: { children: ReactNode }) {
  return (
    <div className="rounded-[18px] border border-dashed border-white/10 bg-white/[0.03] px-4 py-4 font-body text-sm leading-7 text-white/52">
      {props.children}
    </div>
  );
}

function Badge(props: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-white/70">
      {props.children}
    </span>
  );
}

function BrandMark(props: { className?: string }) {
  return (
    <div className={cx("flex", props.className)}>
      <div className="font-display text-[30px] lowercase tracking-[0.08em] text-white md:text-[44px] lg:text-[60px]">
        scratch_pad
      </div>
    </div>
  );
}

function inferScreenFromWorkspace(workspace: ProjectWorkspace | null): Screen {
  if (!workspace) {
    return "welcome";
  }

  return workspace.currentStage === "project" ? "projects" : "command";
}

function buildProjectSynopsis(
  projectName: string | null,
  notes: ProjectWorkspace["notes"],
  plan: ProjectWorkspace["plan"],
) {
  const source = plan?.summary ?? notes[0]?.content ?? FALLBACK_PROJECT_SUMMARY;

  return truncateText(
    source.trim().length > 0
      ? source
      : `${projectName ?? "scratch_pad"} is ready for its first note.`,
    290,
  );
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString();
}

function formatReadinessLabel(value: AdapterStatus["readiness"]) {
  if (value === "ready") {
    return "ready";
  }

  if (value === "unknown") {
    return "unknown";
  }

  return "not_ready";
}

function formatAuthenticatedLabel(value: AdapterStatus["authenticated"]) {
  if (value === "unknown") {
    return "unknown";
  }

  return value ? "yes" : "no";
}

function formatRunDisplayState(run: Run) {
  if (run.reviewPreparedAt) {
    return "review_prepared";
  }

  if (run.status === "starting" || run.status === "running") {
    return "running";
  }

  if (run.status === "completed") {
    return "completed";
  }

  if (run.status === "failed") {
    return "failed";
  }

  return "cancelled";
}

function formatProjectWorkspaceStage(stage: ProjectWorkspace["currentStage"]) {
  switch (stage) {
    case "project":
      return "project_setup";
    case "scratch":
      return "scratch";
    case "plan":
      return "plan";
    case "queue":
      return "queue";
    case "run":
      return "run";
    case "review":
      return "review";
  }
}

function buildPrimaryStatusSummary(input: {
  project: ProjectWorkspace["project"];
  currentStage: ProjectWorkspace["currentStage"];
  notes: ProjectWorkspace["notes"];
  plan: ProjectWorkspace["plan"];
  queuedTasks: Task[];
  blockedTasks: Task[];
  reviewTasks: Task[];
  nextTask: Task | null;
  featuredRun: Run | null;
}) {
  const completedReviewRun =
    input.featuredRun?.reviewPreparedAt ? input.featuredRun : null;

  if (completedReviewRun) {
    const changedFilesCount =
      completedReviewRun.reviewChangedFiles?.length ??
      completedReviewRun.reviewDiffStats?.filesChanged ??
      0;
    const changedFilesLabel =
      changedFilesCount > 0
        ? `${changedFilesCount} changed ${changedFilesCount === 1 ? "file" : "files"}`
        : "review summary saved";

    return {
      statusLabel: "review_ready",
      title: completedReviewRun.taskTitle,
      detail: completedReviewRun.reviewSummary
        ? truncateText(completedReviewRun.reviewSummary, 180)
        : `The latest run is ready for human review with ${changedFilesLabel}.`,
    };
  }

  if (
    input.featuredRun &&
    (input.featuredRun.status === "starting" ||
      input.featuredRun.status === "running")
  ) {
    return {
      statusLabel: "run_in_progress",
      title: input.featuredRun.taskTitle,
      detail:
        "Scratch Pad is actively running the current approved task. You can keep watching the run feed while the local log updates.",
    };
  }

  if (input.featuredRun?.status === "completed") {
    return {
      statusLabel: "run_completed",
      title: input.featuredRun.taskTitle,
      detail:
        "The latest run finished cleanly. Prepare review to capture the branch context and handoff summary.",
    };
  }

  if (
    input.featuredRun &&
    (input.featuredRun.status === "failed" ||
      input.featuredRun.status === "cancelled")
  ) {
    return {
      statusLabel: "run_needs_attention",
      title: input.featuredRun.taskTitle,
      detail:
        "The latest run did not finish successfully. Check the saved log, adjust the project state, and retry when ready.",
    };
  }

  if (input.nextTask) {
    return {
      statusLabel: "ready_for_next_run",
      title: input.nextTask.title,
      detail: input.nextTask.description,
    };
  }

  if (input.reviewTasks.length > 0) {
    return {
      statusLabel: "review_ready",
      title: "human_review_pending",
      detail:
        "A completed task is waiting for review. Open the latest run to inspect the saved summary and changed files.",
    };
  }

  if (input.blockedTasks.length > 0 && input.queuedTasks.length === 0) {
    return {
      statusLabel: "queue_needs_review",
      title: "blocked_work_visible",
      detail:
        "Only blocked tasks remain in the queue right now, so the flow is waiting for a human decision before another run can start.",
    };
  }

  if (input.plan?.approved) {
    return {
      statusLabel: "ready_to_generate_tasks",
      title: "approved_prd_locked_in",
      detail:
        "The approved plan is in place. Generate the task queue to move from planning into execution.",
    };
  }

  if (input.plan) {
    return {
      statusLabel: "plan_needs_approval",
      title: "review_the_current_prd",
      detail:
        "Your draft PRD is ready. Approve it when the scope is right, or revise it before unlocking task generation.",
    };
  }

  if (input.notes.length > 0) {
    return {
      statusLabel: "ready_to_generate_prd",
      title: "scratch_notes_captured",
      detail:
        "You already have the raw idea in place. Generate the PRD to turn those notes into an approved execution path.",
    };
  }

  if (input.project.repoPath && input.project.preferredAdapter) {
    return {
      statusLabel: "ready_for_first_note",
      title: "project_setup_saved",
      detail:
        "Project setup is complete. Add the first scratch note to start the core flow on this screen.",
    };
  }

  const missingSetup = [
    input.project.repoPath ? null : "local_repo_path",
    input.project.preferredAdapter ? null : "preferred_adapter",
  ].filter(Boolean);

  return {
    statusLabel: "project_setup_needed",
    title: "finish_the_basics",
    detail: `Add ${missingSetup.join(" + ")} to unlock the approved flow and make this project runnable.`,
  };
}

function formatAdapterLabel(value: PreferredAdapter) {
  if (value === "claude-code") {
    return "claude_code";
  }

  if (value === "codex") {
    return "codex";
  }

  return "unknown";
}

function truncateText(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength).trimEnd()}...`;
}

function getErrorMessage(error: unknown) {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong. Check the server and try again.";
}

function successMessage(text: string): ActionMessage {
  return {
    tone: "default",
    text,
  };
}

function errorMessage(error: unknown): ActionMessage {
  return {
    tone: "error",
    text: getErrorMessage(error),
  };
}

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}
