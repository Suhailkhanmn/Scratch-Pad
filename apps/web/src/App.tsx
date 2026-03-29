import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  DirectoryBrowserResult,
  PreferredAdapter,
  Project,
  ReviewHandoffStatus,
} from "@scratch-pad/shared";
import {
  ApiError,
  approvePrd,
  browseDirectories,
  createDirectory,
  createProject,
  createScratchNote,
  deleteProject,
  deleteScratchNote,
  fetchAdapterStatuses,
  fetchHealth,
  fetchProjects,
  fetchProjectWorkspace,
  generatePrd,
  generateTasks,
  openCodexApp,
  prepareReview,
  saveProductContext,
  revisePrd,
  rerunTask,
  runNextTask,
  saveProjectSetup,
  shapeProduct,
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

type DirectoryPickerState = {
  open: boolean;
  loading: boolean;
  currentPath: string;
  parentPath: string | null;
  directories: DirectoryBrowserResult["directories"];
  newFolderName: string;
  error: string | null;
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
type CommandMode = "product" | "code";

const CURRENT_PROJECT_STORAGE_KEY = "scratch-pad/current-project-id";
const FALLBACK_PROJECT_SUMMARY =
  "a local-first open-source layer that sits on top of Claude Code and Codex and turns messy builder intent into a controlled execution loop. The core idea is simple: instead of bouncing between notes, prompts, terminal commands, and half-structured plans, you dump rough thoughts into the app";
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [workspace, setWorkspace] = useState<ProjectWorkspace | null>(null);
  const [screen, setScreen] = useState<Screen>("welcome");
  const [commandMode, setCommandMode] = useState<CommandMode>("product");
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
  const [prdDraft, setPrdDraft] = useState("");
  const [featuresDraft, setFeaturesDraft] = useState("");
  const [decisionsDraft, setDecisionsDraft] = useState("");
  const [openQuestionsDraft, setOpenQuestionsDraft] = useState("");
  const [revisionInstruction, setRevisionInstruction] = useState("");
  const [projectMessage, setProjectMessage] = useState<ActionMessage | null>(null);
  const [notesMessage, setNotesMessage] = useState<ActionMessage | null>(null);
  const [planMessage, setPlanMessage] = useState<ActionMessage | null>(null);
  const [queueMessage, setQueueMessage] = useState<ActionMessage | null>(null);
  const [runMessage, setRunMessage] = useState<ActionMessage | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const previousActiveRunIdRef = useRef<string | null>(null);
  const latestWorkspaceRequestIdRef = useRef(0);
  const [directoryPicker, setDirectoryPicker] = useState<DirectoryPickerState>({
    open: false,
    loading: false,
    currentPath: "",
    parentPath: null,
    directories: [],
    newFolderName: "",
    error: null,
  });

  const project = workspace?.project ?? null;
  const notes = workspace?.notes ?? [];
  const productContext = workspace?.productContext ?? null;
  const plan = workspace?.plan ?? null;
  const approvedPlan = workspace?.approvedPlan ?? null;
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

  function clearSelectedProjectState(options?: {
    screen?: Exclude<Screen, "command">;
  }) {
    latestWorkspaceRequestIdRef.current += 1;
    setDirectoryPicker({
      open: false,
      loading: false,
      currentPath: "",
      parentPath: null,
      directories: [],
      newFolderName: "",
      error: null,
    });
    setWorkspace(null);
    setCommandMode("product");
    setRepoPath("");
    setSetupAdapter("");
    setNewNoteContent("");
    setEditingNoteId(null);
    setEditingContent("");
    setPrdDraft("");
    setFeaturesDraft("");
    setDecisionsDraft("");
    setOpenQuestionsDraft("");
    setRevisionInstruction("");
    setScreen(options?.screen ?? "welcome");
    clearActionMessages();
    window.localStorage.removeItem(CURRENT_PROJECT_STORAGE_KEY);
  }

  function upsertProject(project: Project) {
    setProjects((previousProjects) => {
      const nextProjects = previousProjects.filter(
        (currentProject) => currentProject.id !== project.id,
      );

      nextProjects.unshift(project);

      return nextProjects.sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt),
      );
    });
  }

  async function loadProjects() {
    const loadedProjects = await fetchProjects();
    setProjects(loadedProjects);
    return loadedProjects;
  }

  function applyProjectWorkspace(
    nextWorkspace: ProjectWorkspace,
    options?: { syncProjectSetupFields?: boolean },
  ) {
    setWorkspace(nextWorkspace);
    upsertProject(nextWorkspace.project);
    syncProductDraftFields(nextWorkspace.productContext);

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
    const requestId = ++latestWorkspaceRequestIdRef.current;
    const loadedWorkspace = await fetchProjectWorkspace(projectId);

    if (requestId !== latestWorkspaceRequestIdRef.current) {
      return loadedWorkspace;
    }

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

  function syncProductDraftFields(
    nextProductContext: ProjectWorkspace["productContext"],
  ) {
    setPrdDraft(nextProductContext?.prd.content ?? "");
    setFeaturesDraft(nextProductContext?.features.content ?? "");
    setDecisionsDraft(nextProductContext?.decisions.content ?? "");
    setOpenQuestionsDraft(nextProductContext?.openQuestions.content ?? "");
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
    clearSelectedProjectState({ screen: "welcome" });
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
      const optimisticWorkspace = buildOptimisticWorkspace(createdProject);

      setProjectName("");
      setProjectAdapter("");
      setNewNoteContent("");
      setEditingNoteId(null);
      setEditingContent("");
      setRevisionInstruction("");
      latestWorkspaceRequestIdRef.current += 1;
      applyProjectWorkspace(optimisticWorkspace, {
        syncProjectSetupFields: true,
      });
      setScreen(inferScreenFromWorkspace(optimisticWorkspace));
      setProjectMessage(null);

      void loadProjectWorkspace(createdProject.id, {
        resetMessages: false,
        syncProjectSetupFields: true,
      }).catch((error) => {
        setProjectMessage(errorMessage(error));
      });
      void loadProjects().catch(() => undefined);
    } catch (error) {
      setProjectMessage(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSelectProject(projectId: string) {
    setProjectMessage(null);
    setBusyAction(`select-project-${projectId}`);

    try {
      const loadedWorkspace = await loadProjectWorkspace(projectId, {
        resetMessages: false,
        syncProjectSetupFields: true,
      });
      setScreen(inferScreenFromWorkspace(loadedWorkspace));
    } catch (error) {
      setProjectMessage(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDeleteProject(projectId: string) {
    const targetProject =
      projects.find((savedProject) => savedProject.id === projectId) ?? null;

    if (!targetProject) {
      return;
    }

    const confirmed = window.confirm(
      `Remove "${targetProject.name}" from Scratch Pad? This does not delete the local repo folder.`,
    );

    if (!confirmed) {
      return;
    }

    setProjectMessage(null);
    setBusyAction(`delete-project-${projectId}`);

    const remainingProjects = projects.filter(
      (savedProject) => savedProject.id !== projectId,
    );
    const deletedCurrentProject = project?.id === projectId;

    try {
      await deleteProject(projectId);
      setProjects(remainingProjects);

      if (!deletedCurrentProject) {
        setProjectMessage(
          successMessage(
            "Project removed from Scratch Pad. Local files stayed on disk.",
          ),
        );
        return;
      }

      if (remainingProjects.length === 0) {
        clearSelectedProjectState({ screen: "projects" });
        setProjectMessage(
          successMessage(
            "Project removed from Scratch Pad. Local files stayed on disk.",
          ),
        );
        return;
      }

      const nextProject = remainingProjects[0];

      if (!nextProject) {
        clearSelectedProjectState({ screen: "projects" });
        setProjectMessage(
          successMessage(
            "Project removed from Scratch Pad. Local files stayed on disk.",
          ),
        );
        return;
      }

      const loadedWorkspace = await loadProjectWorkspace(nextProject.id, {
        resetMessages: false,
        syncProjectSetupFields: true,
      });
      setScreen(inferScreenFromWorkspace(loadedWorkspace));
      setProjectMessage(
        successMessage(
          `Project removed from Scratch Pad. Switched to "${nextProject.name}".`,
        ),
      );
    } catch (error) {
      setProjectMessage(errorMessage(error));
      void loadProjects().catch(() => undefined);
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
      void loadProjects().catch(() => undefined);
      setProjectMessage(successMessage("Project setup saved."));
    } catch (error) {
      setProjectMessage(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleBrowseDirectories(path?: string) {
    setDirectoryPicker((previousState) => ({
      ...previousState,
      open: true,
      loading: true,
      error: null,
    }));

    try {
      const browserResult = await browseDirectories(path);
      setDirectoryPicker((previousState) => ({
        ...previousState,
        open: true,
        loading: false,
        currentPath: browserResult.currentPath,
        parentPath: browserResult.parentPath,
        directories: browserResult.directories,
        error: null,
      }));
    } catch (error) {
      setDirectoryPicker((previousState) => ({
        ...previousState,
        open: true,
        loading: false,
        error: getErrorMessage(error),
      }));
    }
  }

  async function handleCreateDirectory() {
    if (directoryPicker.currentPath.trim().length === 0) {
      return;
    }

    setDirectoryPicker((previousState) => ({
      ...previousState,
      loading: true,
      error: null,
    }));

    try {
      const result = await createDirectory({
        parentPath: directoryPicker.currentPath,
        name: directoryPicker.newFolderName,
      });
      setRepoPath(result.path);
      setDirectoryPicker((previousState) => ({
        ...previousState,
        newFolderName: "",
      }));
      await handleBrowseDirectories(result.path);
      setProjectMessage(successMessage(result.message));
    } catch (error) {
      setDirectoryPicker((previousState) => ({
        ...previousState,
        loading: false,
        error: getErrorMessage(error),
      }));
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
      const result = await generatePrd(project.id, {
        prd: prdDraft,
        features: featuresDraft,
        decisions: decisionsDraft,
        openQuestions: openQuestionsDraft,
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

  async function handleRevisePrd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!project) {
      return;
    }

    setPlanMessage(null);
    setBusyAction("revise-prd");

    try {
      const result = await revisePrd(project.id, {
        instruction: revisionInstruction,
        prd: prdDraft,
        features: featuresDraft,
        decisions: decisionsDraft,
        openQuestions: openQuestionsDraft,
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
    if (!project) {
      return;
    }

    setPlanMessage(null);
    setBusyAction("approve-prd");

    try {
      await saveProductContext(project.id, {
        prd: prdDraft,
        features: featuresDraft,
        decisions: decisionsDraft,
        openQuestions: openQuestionsDraft,
      });
      const refreshedWorkspace = await loadProjectWorkspace(project.id, {
        resetMessages: false,
      });
      const latestPlan = refreshedWorkspace.plan ?? refreshedWorkspace.approvedPlan;

      if (!latestPlan) {
        throw new Error("Draft the PRD before approving it for code work.");
      }

      const result = await approvePrd(project.id, {
        planVersionId: latestPlan.id,
      });
      await syncProjectWorkspace(project.id);
      setPlanMessage(successMessage(result.message));
    } catch (error) {
      setPlanMessage(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSaveProductFiles() {
    if (!project) {
      return;
    }

    setPlanMessage(null);
    setBusyAction("save-product-context");

    try {
      const result = await saveProductContext(project.id, {
        prd: prdDraft,
        features: featuresDraft,
        decisions: decisionsDraft,
        openQuestions: openQuestionsDraft,
      });
      await syncProjectWorkspace(project.id);
      setPlanMessage(successMessage(result.message));
    } catch (error) {
      setPlanMessage(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleShapeProduct() {
    if (!project) {
      return;
    }

    setPlanMessage(null);
    setBusyAction("shape-product");

    try {
      const result = await shapeProduct(project.id, {
        prd: prdDraft,
        features: featuresDraft,
        decisions: decisionsDraft,
        openQuestions: openQuestionsDraft,
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
      await syncProjectWorkspace(project.id).catch(() => undefined);
      setRunMessage(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRerunTask(taskId: string) {
    if (!project) {
      return;
    }

    setRunMessage(null);
    setBusyAction(`rerun-task-${taskId}`);

    try {
      const result = await rerunTask(taskId);
      await syncProjectWorkspace(project.id);
      setRunMessage(successMessage(result.message));
    } catch (error) {
      setRunMessage(errorMessage(error));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCopyToClipboard(value: string, label: string) {
    try {
      if (!window.navigator.clipboard) {
        throw new Error("Clipboard access is not available in this browser.");
      }

      await window.navigator.clipboard.writeText(value);
      setRunMessage(successMessage(`${label} copied to the clipboard.`));
    } catch (error) {
      setRunMessage(errorMessage(error));
    }
  }

  useEffect(() => {
    void loadHealth();
    void loadAdapterStatuses();
    void loadProjects().catch((error) => {
      setProjectMessage(errorMessage(error));
    });

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
  const alignedQueuedTasks = queuedTasks.filter(
    (task) => task.driftStatus === "aligned",
  );
  const staleOpenTasks = tasks.filter(
    (task) =>
      (task.status === "queued" || task.status === "blocked") &&
      task.driftStatus !== "aligned",
  );
  const reviewTasks = tasks.filter((task) => task.status === "review");
  const reviewBlockedTasks = tasks.filter(
    (task) => task.status === "review_blocked",
  );
  const reviewBlockedTaskRuns = reviewBlockedTasks.map((task) => ({
    task,
    run: latestRunByTaskId.get(task.id) ?? null,
  }));
  const highRiskQueuedTasks = alignedQueuedTasks.filter(
    (task) => task.riskLevel === "high",
  );
  const nextRunnableTask = activeRun
    ? null
    : alignedQueuedTasks.find((task) => task.riskLevel !== "high") ?? null;
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
      featuredRun.reviewStatus !== "prepared",
  );
  const canOpenCodexDesktop = Boolean(
    project?.repoPath && codexAdapterStatus?.appLaunchSupported,
  );
  const systemReadyCount =
    adapterStatuses.status === "ready"
      ? adapterStatuses.data.filter((status) => status.ready).length
      : 0;
  const projectSynopsis = buildProjectSynopsis(
    project?.name ?? null,
    notes,
    plan,
    productContext,
  );
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
            projects={projects}
            project={project}
            projectSynopsis={projectSynopsis}
            projectMessage={projectMessage}
            projectName={projectName}
            projectAdapter={projectAdapter}
            repoPath={repoPath}
            setupAdapter={setupAdapter}
            directoryPicker={directoryPicker}
            codexAdapterStatus={codexAdapterStatus}
            busyAction={busyAction}
            onProjectNameChange={setProjectName}
            onProjectAdapterChange={setProjectAdapter}
            onRepoPathChange={setRepoPath}
            onSetupAdapterChange={setSetupAdapter}
            onDirectoryPickerNewFolderNameChange={(value) =>
              setDirectoryPicker((previousState) => ({
                ...previousState,
                newFolderName: value,
              }))
            }
            onCreateProject={handleCreateProject}
            onSaveProjectSetup={handleSaveProjectSetup}
            onDiveIn={() => setScreen("command")}
            onBackToWelcome={() => setScreen("welcome")}
            onOpenCodexApp={() => void handleOpenCodexApp()}
            onSelectProject={(projectId) => void handleSelectProject(projectId)}
            onDeleteProject={(projectId) => void handleDeleteProject(projectId)}
            onBrowseDirectories={(path) => void handleBrowseDirectories(path)}
            onSelectDirectory={(path) => {
              setRepoPath(path);
              setDirectoryPicker((previousState) => ({
                ...previousState,
                open: false,
                error: null,
              }));
            }}
            onCreateDirectory={() => void handleCreateDirectory()}
            onCloseDirectoryPicker={() =>
              setDirectoryPicker((previousState) => ({
                ...previousState,
                open: false,
                error: null,
              }))
            }
            canOpenCodexDesktop={canOpenCodexDesktop}
            currentStage={workspace?.currentStage ?? "project"}
          />
        ) : null}

        {currentScreen === "command" && project ? (
          <CommandCenterScreen
            mode={commandMode}
            project={project}
            currentStage={workspace?.currentStage ?? "project"}
            notes={notes}
            productContext={productContext}
            plan={plan}
            approvedPlan={approvedPlan}
            queuedTasks={queuedTasks}
            blockedTasks={blockedTasks}
            staleOpenTasks={staleOpenTasks}
            reviewTasks={reviewTasks}
            reviewBlockedTaskRuns={reviewBlockedTaskRuns}
            highRiskQueuedTasks={highRiskQueuedTasks}
            nextTask={nextRunnableTask}
            featuredRun={featuredRun}
            recentHistoryRuns={recentHistoryRuns}
            canPrepareFeaturedRun={canPrepareFeaturedRun}
            busyAction={busyAction}
            newNoteContent={newNoteContent}
            editingNoteId={editingNoteId}
            editingContent={editingContent}
            prdDraft={prdDraft}
            featuresDraft={featuresDraft}
            decisionsDraft={decisionsDraft}
            openQuestionsDraft={openQuestionsDraft}
            revisionInstruction={revisionInstruction}
            notesMessage={notesMessage}
            planMessage={planMessage}
            queueMessage={queueMessage}
            runMessage={runMessage}
            onBackToProjects={() => setScreen("projects")}
            onModeChange={setCommandMode}
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
            onPrdDraftChange={setPrdDraft}
            onFeaturesDraftChange={setFeaturesDraft}
            onDecisionsDraftChange={setDecisionsDraft}
            onOpenQuestionsDraftChange={setOpenQuestionsDraft}
            onSaveNote={(noteId) => void handleSaveNote(noteId)}
            onDeleteNote={(noteId) => void handleDeleteNote(noteId)}
            onSaveProductFiles={() => void handleSaveProductFiles()}
            onShapeProduct={() => void handleShapeProduct()}
            onGeneratePrd={() => void handleGeneratePrd()}
            onRevisionInstructionChange={setRevisionInstruction}
            onRevisePrd={handleRevisePrd}
            onApprovePrd={() => void handleApprovePrd()}
            onGenerateTasks={() => void handleGenerateTasks()}
            onRunNextTask={() => void handleRunNextTask()}
            onPrepareReview={(runId) => void handlePrepareReview(runId)}
            onRerunTask={(taskId) => void handleRerunTask(taskId)}
            onCopyToClipboard={(value, label) =>
              void handleCopyToClipboard(value, label)
            }
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
  projects: Project[];
  project: ProjectWorkspace["project"] | null;
  projectSynopsis: string;
  projectMessage: ActionMessage | null;
  projectName: string;
  projectAdapter: "" | Exclude<PreferredAdapter, null>;
  repoPath: string;
  setupAdapter: "" | Exclude<PreferredAdapter, null>;
  directoryPicker: DirectoryPickerState;
  codexAdapterStatus: AdapterStatus | null;
  busyAction: string | null;
  onProjectNameChange: (value: string) => void;
  onProjectAdapterChange: (
    value: "" | Exclude<PreferredAdapter, null>,
  ) => void;
  onRepoPathChange: (value: string) => void;
  onSetupAdapterChange: (value: "" | Exclude<PreferredAdapter, null>) => void;
  onDirectoryPickerNewFolderNameChange: (value: string) => void;
  onCreateProject: (event: FormEvent<HTMLFormElement>) => void;
  onSaveProjectSetup: (event: FormEvent<HTMLFormElement>) => void;
  onDiveIn: () => void;
  onBackToWelcome: () => void;
  onOpenCodexApp: () => void;
  onSelectProject: (projectId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onBrowseDirectories: (path?: string) => void;
  onSelectDirectory: (path: string) => void;
  onCreateDirectory: () => void;
  onCloseDirectoryPicker: () => void;
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

        <section className={cx(PANEL_CLASS, "mt-6 overflow-hidden")}>
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-6 py-5">
            <div>
              <div className="font-display text-[18px] lowercase tracking-[0.08em] text-white md:text-[24px]">
                saved_projects
              </div>
              <p className="mt-2 font-body text-sm leading-7 text-white/58">
                Older ideas stay visible here so you can jump between them without losing setup state.
              </p>
            </div>

            <Badge>{props.projects.length} total</Badge>
          </header>

          <div className="grid gap-4 px-6 py-5 md:grid-cols-2 xl:grid-cols-3">
            {props.projects.length === 0 ? (
              <EmptyGlassState>
                No saved projects yet. Create the first one from the panel below.
              </EmptyGlassState>
            ) : (
              props.projects.map((savedProject) => {
                const isSelected = savedProject.id === props.project?.id;

                return (
                  <button
                    key={savedProject.id}
                    type="button"
                    onClick={() => props.onSelectProject(savedProject.id)}
                    disabled={
                      props.busyAction === `select-project-${savedProject.id}`
                    }
                    className={cx(
                      "min-h-[180px] rounded-[24px] border px-5 py-5 text-left transition",
                      isSelected
                        ? "border-white/28 bg-white/[0.12] shadow-[0_0_0_1px_rgba(255,255,255,0.04)]"
                        : "border-white/10 bg-white/[0.05] hover:border-white/20 hover:bg-white/[0.08]",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-display text-[18px] lowercase tracking-[0.08em] text-white md:text-[22px]">
                          {savedProject.name}
                        </div>
                        <div className="mt-2 text-xs uppercase tracking-[0.2em] text-white/42">
                          {isSelected ? "selected_project" : "saved_project"}
                        </div>
                      </div>

                      <Badge>
                        {savedProject.repoPath ? "repo_linked" : "setup_needed"}
                      </Badge>
                    </div>

                    <div className="mt-4 font-body text-xs leading-6 text-white/55">
                      {savedProject.preferredAdapter
                        ? formatAdapterLabel(savedProject.preferredAdapter)
                        : "adapter_not_set"}
                    </div>

                    <div className="mt-4 font-body text-sm leading-7 text-white/68">
                      {savedProject.repoPath
                        ? truncateText(savedProject.repoPath, 120)
                        : "Connect a local repo path from the larger project panel below."}
                    </div>

                    <div className="mt-5 text-xs uppercase tracking-[0.2em] text-white/36">
                      updated / {formatTimestamp(savedProject.updatedAt)}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <div className="mt-10 grid max-w-[1420px] gap-8 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.72fr)] xl:items-start">
          <section className={cx(PANEL_CLASS, "min-h-[540px] overflow-hidden")}>
            <header className="border-b border-white/10 px-6 py-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.22em] text-white/42">
                    selected_project
                  </div>
                  <div className="mt-2 font-display text-[20px] lowercase tracking-[0.08em] text-white md:text-[30px]">
                    {props.project?.name ?? "no_active_project"}
                  </div>
                </div>

                {props.project ? (
                  <Badge>{formatProjectWorkspaceStage(props.currentStage)}</Badge>
                ) : null}
              </div>
            </header>

            <div className="flex h-full flex-col gap-5 px-6 py-6">
              <div className="flex flex-wrap gap-2">
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

                  <div className="flex flex-wrap gap-3">
                    <GhostButton
                      onClick={() => props.onBrowseDirectories(props.repoPath)}
                    >
                      browse_folders
                    </GhostButton>

                    {props.directoryPicker.open ? (
                      <GhostButton onClick={props.onCloseDirectoryPicker}>
                        close_browser
                      </GhostButton>
                    ) : null}
                  </div>

                  {props.directoryPicker.open ? (
                    <DirectoryPickerPanel
                      state={props.directoryPicker}
                      onNavigate={(path) => props.onBrowseDirectories(path)}
                      onSelect={props.onSelectDirectory}
                      onCreateDirectory={props.onCreateDirectory}
                      onNewFolderNameChange={
                        props.onDirectoryPickerNewFolderNameChange
                      }
                    />
                  ) : null}

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

                    <GhostButton
                      onClick={() => props.onDeleteProject(props.project!.id)}
                      disabled={
                        props.busyAction === `delete-project-${props.project!.id}`
                      }
                    >
                      {props.busyAction === `delete-project-${props.project!.id}`
                        ? "removing..."
                        : "remove_from_scratch_pad"}
                    </GhostButton>
                  </div>

                  {props.codexAdapterStatus?.appMessage ? (
                    <p className="font-body text-xs leading-6 text-white/45">
                      {props.codexAdapterStatus.appMessage}
                    </p>
                  ) : null}

                  <p className="font-body text-xs leading-6 text-white/42">
                    Removing a project only clears it from Scratch Pad. The local repo folder stays on disk.
                  </p>
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

          <section className={cx(PANEL_CLASS, "overflow-hidden xl:mt-10")}>
            <header className="border-b border-white/10 px-6 py-6">
              <div className="text-center font-display text-[18px] lowercase tracking-[0.08em] text-white md:text-[24px]">
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
                Start a new idea thread here, then use the larger saved-project surface to finish setup and move into the command center.
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
          <div className="mt-5 max-w-[1420px]">
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

function DirectoryPickerPanel(props: {
  state: DirectoryPickerState;
  onNavigate: (path?: string) => void;
  onSelect: (path: string) => void;
  onCreateDirectory: () => void;
  onNewFolderNameChange: (value: string) => void;
}) {
  return (
    <div className={cx(INNER_CARD_CLASS, "space-y-4 p-4")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-white/42">
            current_folder
          </div>
          <div className="mt-2 break-all font-body text-sm leading-7 text-white/74">
            {props.state.currentPath || "loading..."}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <GhostButton
            onClick={() => props.onNavigate(props.state.parentPath ?? undefined)}
            disabled={props.state.loading || !props.state.parentPath}
          >
            up
          </GhostButton>
          <ActionButton
            onClick={() => props.onSelect(props.state.currentPath)}
            disabled={props.state.loading || props.state.currentPath.length === 0}
          >
            use_this_folder
          </ActionButton>
        </div>
      </div>

      {props.state.error ? (
        <InlineMessage tone="error">{props.state.error}</InlineMessage>
      ) : null}

      <div className="space-y-2">
        {props.state.loading ? (
          <EmptyGlassState>Loading local folders...</EmptyGlassState>
        ) : props.state.directories.length === 0 ? (
          <EmptyGlassState>No subfolders found here.</EmptyGlassState>
        ) : (
          props.state.directories.slice(0, 12).map((directory) => (
            <button
              key={directory.path}
              type="button"
              onClick={() => props.onNavigate(directory.path)}
              className="w-full rounded-[16px] border border-white/10 bg-white/[0.04] px-4 py-3 text-left font-body text-sm leading-7 text-white/72 transition hover:border-white/20 hover:bg-white/[0.08]"
            >
              {directory.name}
            </button>
          ))
        )}
      </div>

      <div className="space-y-3 border-t border-white/10 pt-4">
        <div className="text-xs uppercase tracking-[0.2em] text-white/42">
          create_new_folder_here
        </div>
        <input
          className={FIELD_CLASS}
          placeholder="new-project-folder"
          value={props.state.newFolderName}
          onChange={(event) =>
            props.onNewFolderNameChange(event.target.value)
          }
        />
        <ActionButton
          onClick={props.onCreateDirectory}
          disabled={
            props.state.loading || props.state.newFolderName.trim().length === 0
          }
        >
          create_folder
        </ActionButton>
      </div>
    </div>
  );
}

function CommandCenterScreen(props: {
  mode: CommandMode;
  project: ProjectWorkspace["project"];
  currentStage: ProjectWorkspace["currentStage"];
  notes: ProjectWorkspace["notes"];
  productContext: ProjectWorkspace["productContext"];
  plan: ProjectWorkspace["plan"];
  approvedPlan: ProjectWorkspace["approvedPlan"];
  queuedTasks: Task[];
  blockedTasks: Task[];
  staleOpenTasks: Task[];
  reviewTasks: Task[];
  reviewBlockedTaskRuns: Array<{ task: Task; run: Run | null }>;
  highRiskQueuedTasks: Task[];
  nextTask: Task | null;
  featuredRun: Run | null;
  recentHistoryRuns: Run[];
  canPrepareFeaturedRun: boolean;
  busyAction: string | null;
  newNoteContent: string;
  editingNoteId: string | null;
  editingContent: string;
  prdDraft: string;
  featuresDraft: string;
  decisionsDraft: string;
  openQuestionsDraft: string;
  revisionInstruction: string;
  notesMessage: ActionMessage | null;
  planMessage: ActionMessage | null;
  queueMessage: ActionMessage | null;
  runMessage: ActionMessage | null;
  onBackToProjects: () => void;
  onModeChange: (mode: CommandMode) => void;
  onNewNoteContentChange: (value: string) => void;
  onCreateNote: (event: FormEvent<HTMLFormElement>) => void;
  onEditStart: (noteId: string, value: string) => void;
  onEditCancel: () => void;
  onEditingContentChange: (value: string) => void;
  onPrdDraftChange: (value: string) => void;
  onFeaturesDraftChange: (value: string) => void;
  onDecisionsDraftChange: (value: string) => void;
  onOpenQuestionsDraftChange: (value: string) => void;
  onSaveNote: (noteId: string) => void;
  onDeleteNote: (noteId: string) => void;
  onSaveProductFiles: () => void;
  onShapeProduct: () => void;
  onGeneratePrd: () => void;
  onRevisionInstructionChange: (value: string) => void;
  onRevisePrd: (event: FormEvent<HTMLFormElement>) => void;
  onApprovePrd: () => void;
  onGenerateTasks: () => void;
  onRunNextTask: () => void;
  onPrepareReview: (runId: string) => void;
  onRerunTask: (taskId: string) => void;
  onCopyToClipboard: (value: string, label: string) => void;
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
    !props.approvedPlan || props.busyAction === "generate-tasks";
  const productActionsDisabled = !props.project.repoPath;
  const featuredRunPrepareAction =
    featuredRun && props.canPrepareFeaturedRun
      ? () => props.onPrepareReview(featuredRun.id)
      : null;
  const draftAheadOfCode = Boolean(
    props.plan &&
      props.approvedPlan &&
      props.plan.id !== props.approvedPlan.id,
  );
  const primaryStatus = buildPrimaryStatusSummary({
    project: props.project,
    currentStage: props.currentStage,
    notes: props.notes,
    productContext: props.productContext,
    plan: props.plan,
    approvedPlan: props.approvedPlan,
    queuedTasks: props.queuedTasks,
    blockedTasks: props.blockedTasks,
    staleOpenTaskCount: props.staleOpenTasks.length,
    reviewTasks: props.reviewTasks,
    reviewBlockedCount: props.reviewBlockedTaskRuns.length,
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
              <Badge>{props.mode}</Badge>
              <Badge>{formatProjectWorkspaceStage(props.currentStage)}</Badge>
              {featuredRun ? (
                <Badge>{formatRunDisplayState(featuredRun)}</Badge>
              ) : null}
              {props.approvedPlan ? (
                <Badge>approved_prd_v{props.approvedPlan.versionNumber}</Badge>
              ) : null}
              {draftAheadOfCode ? <Badge>draft_ahead_of_code</Badge> : null}
              {props.nextTask ? <Badge>next_task_ready</Badge> : null}
              {props.reviewTasks.length > 0 ? (
                <Badge>{props.reviewTasks.length} review_ready</Badge>
              ) : null}
              {props.staleOpenTasks.length > 0 ? (
                <Badge>{props.staleOpenTasks.length} maybe_stale</Badge>
              ) : null}
              {props.reviewBlockedTaskRuns.length > 0 ? (
                <Badge>
                  {props.reviewBlockedTaskRuns.length} review_blocked
                </Badge>
              ) : null}
            </div>
          </div>
        </section>

        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <CommandModeSwitch
            mode={props.mode}
            onModeChange={props.onModeChange}
          />

          <div className="font-body text-sm leading-7 text-white/55">
            {props.mode === "product"
              ? "Product mode shapes repo-local meaning: notes, features, PRD, decisions, and open questions."
              : "Code mode executes only from the approved repo-local PRD and keeps review handoff visible."}
          </div>
        </div>

        {props.mode === "product" ? (
          <ProductModePanel
            project={props.project}
            notes={props.notes}
            productContext={props.productContext}
            plan={props.plan}
            approvedPlan={props.approvedPlan}
            staleOpenTasks={props.staleOpenTasks}
            busyAction={props.busyAction}
            newNoteContent={props.newNoteContent}
            editingNoteId={props.editingNoteId}
            editingContent={props.editingContent}
            prdDraft={props.prdDraft}
            featuresDraft={props.featuresDraft}
            decisionsDraft={props.decisionsDraft}
            openQuestionsDraft={props.openQuestionsDraft}
            revisionInstruction={props.revisionInstruction}
            notesMessage={props.notesMessage}
            planMessage={props.planMessage}
            productActionsDisabled={productActionsDisabled}
            onNewNoteContentChange={props.onNewNoteContentChange}
            onCreateNote={props.onCreateNote}
            onEditStart={props.onEditStart}
            onEditCancel={props.onEditCancel}
            onEditingContentChange={props.onEditingContentChange}
            onPrdDraftChange={props.onPrdDraftChange}
            onFeaturesDraftChange={props.onFeaturesDraftChange}
            onDecisionsDraftChange={props.onDecisionsDraftChange}
            onOpenQuestionsDraftChange={props.onOpenQuestionsDraftChange}
            onSaveNote={props.onSaveNote}
            onDeleteNote={props.onDeleteNote}
            onSaveProductFiles={props.onSaveProductFiles}
            onShapeProduct={props.onShapeProduct}
            onGeneratePrd={props.onGeneratePrd}
            onRevisionInstructionChange={props.onRevisionInstructionChange}
            onRevisePrd={props.onRevisePrd}
            onApprovePrd={props.onApprovePrd}
          />
        ) : (
          <CodeModePanel
            project={props.project}
            plan={props.plan}
            approvedPlan={props.approvedPlan}
            queuedTasks={props.queuedTasks}
            blockedTasks={props.blockedTasks}
            staleOpenTasks={props.staleOpenTasks}
            reviewTasks={props.reviewTasks}
            reviewBlockedTaskRuns={props.reviewBlockedTaskRuns}
            highRiskQueuedTasks={props.highRiskQueuedTasks}
            nextTask={props.nextTask}
            featuredRun={featuredRun}
            recentHistoryRuns={props.recentHistoryRuns}
            runButtonDisabled={runButtonDisabled}
            taskGenerationDisabled={taskGenerationDisabled}
            featuredRunPrepareAction={featuredRunPrepareAction}
            busyAction={props.busyAction}
            queueMessage={props.queueMessage}
            runMessage={props.runMessage}
            onGenerateTasks={props.onGenerateTasks}
            onRunNextTask={props.onRunNextTask}
            onPrepareReview={props.onPrepareReview}
            onRerunTask={props.onRerunTask}
            onCopyToClipboard={props.onCopyToClipboard}
          />
        )}

        <BrandMark className="mt-5 justify-end" />
      </div>
    </FrameSurface>
  );
}

function CommandModeSwitch(props: {
  mode: CommandMode;
  onModeChange: (mode: CommandMode) => void;
}) {
  const modes: CommandMode[] = ["product", "code"];

  return (
    <div className="inline-flex rounded-full border border-white/10 bg-white/[0.05] p-1">
      {modes.map((mode) => {
        const active = props.mode === mode;

        return (
          <button
            key={mode}
            type="button"
            onClick={() => props.onModeChange(mode)}
            className={cx(
              "rounded-full px-4 py-2 font-display text-sm lowercase tracking-[0.08em] transition",
              active
                ? "bg-white/[0.14] text-white"
                : "text-white/58 hover:text-white",
            )}
          >
            {mode}
          </button>
        );
      })}
    </div>
  );
}

function ProductModePanel(props: {
  project: ProjectWorkspace["project"];
  notes: ProjectWorkspace["notes"];
  productContext: ProjectWorkspace["productContext"];
  plan: ProjectWorkspace["plan"];
  approvedPlan: ProjectWorkspace["approvedPlan"];
  staleOpenTasks: Task[];
  busyAction: string | null;
  newNoteContent: string;
  editingNoteId: string | null;
  editingContent: string;
  prdDraft: string;
  featuresDraft: string;
  decisionsDraft: string;
  openQuestionsDraft: string;
  revisionInstruction: string;
  notesMessage: ActionMessage | null;
  planMessage: ActionMessage | null;
  productActionsDisabled: boolean;
  onNewNoteContentChange: (value: string) => void;
  onCreateNote: (event: FormEvent<HTMLFormElement>) => void;
  onEditStart: (noteId: string, value: string) => void;
  onEditCancel: () => void;
  onEditingContentChange: (value: string) => void;
  onPrdDraftChange: (value: string) => void;
  onFeaturesDraftChange: (value: string) => void;
  onDecisionsDraftChange: (value: string) => void;
  onOpenQuestionsDraftChange: (value: string) => void;
  onSaveNote: (noteId: string) => void;
  onDeleteNote: (noteId: string) => void;
  onSaveProductFiles: () => void;
  onShapeProduct: () => void;
  onGeneratePrd: () => void;
  onRevisionInstructionChange: (value: string) => void;
  onRevisePrd: (event: FormEvent<HTMLFormElement>) => void;
  onApprovePrd: () => void;
}) {
  const canDraftPrd =
    !props.productActionsDisabled &&
    (props.notes.length > 0 ||
      props.featuresDraft.trim().length > 0 ||
      props.decisionsDraft.trim().length > 0 ||
      props.openQuestionsDraft.trim().length > 0 ||
      props.prdDraft.trim().length > 0);
  const approvedVersionLabel = props.approvedPlan
    ? `approved_v${props.approvedPlan.versionNumber}`
    : "approval_pending";
  const latestVersionLabel = props.plan
    ? `draft_v${props.plan.versionNumber}`
    : "draft_not_started";

  return (
    <div className="grid flex-1 gap-6 xl:grid-cols-[0.9fr_1.1fr]">
      <div className="grid gap-6">
        <section className={cx(PANEL_CLASS, "overflow-hidden")}>
          <header className="border-b border-white/10 px-6 py-5">
            <div className="font-display text-[20px] lowercase tracking-[0.08em] text-white md:text-[30px]">
              product_context
            </div>
          </header>

          <div className="space-y-4 px-5 py-5">
            <section className={cx(INNER_CARD_CLASS, "p-5")}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-xs uppercase tracking-[0.22em] text-white/45">
                    repo_local_source_of_truth
                  </div>
                  <div className="mt-2 font-display text-lg lowercase tracking-[0.08em] text-white">
                    {props.productContext?.rootPath ?? ".scratchpad/product"}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Badge>
                    {props.project.repoPath ? "repo_linked" : "repo_missing"}
                  </Badge>
                  <Badge>{approvedVersionLabel}</Badge>
                  <Badge>{latestVersionLabel}</Badge>
                </div>
              </div>

              <p className="mt-4 break-all font-body text-sm leading-7 text-white/65">
                {props.project.repoPath ??
                  "Link a local repository from active_projects before shaping product context."}
              </p>

              <div className="mt-4 grid gap-2 md:grid-cols-2">
                <RepoFileBadge
                  label="prd"
                  path={props.productContext?.prd.path ?? ".scratchpad/product/prd.md"}
                />
                <RepoFileBadge
                  label="features"
                  path={
                    props.productContext?.features.path ??
                    ".scratchpad/product/features.md"
                  }
                />
                <RepoFileBadge
                  label="decisions"
                  path={
                    props.productContext?.decisions.path ??
                    ".scratchpad/product/decisions.md"
                  }
                />
                <RepoFileBadge
                  label="open_questions"
                  path={
                    props.productContext?.openQuestions.path ??
                    ".scratchpad/product/open-questions.md"
                  }
                />
              </div>
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
                  placeholder="capture rough product intent, user pain, and constraints..."
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
                    No notes yet. Add raw product context here, then shape the repo-local files from it.
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
                    product_shaping
                  </div>
                  <div className="mt-2 font-display text-lg lowercase tracking-[0.08em] text-white">
                    notes_features_decisions_questions
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <ActionButton
                    onClick={props.onSaveProductFiles}
                    disabled={
                      props.productActionsDisabled ||
                      props.busyAction === "save-product-context"
                    }
                  >
                    {props.busyAction === "save-product-context"
                      ? "saving..."
                      : "save_product_files"}
                  </ActionButton>

                  <GhostButton
                    onClick={props.onShapeProduct}
                    disabled={
                      props.productActionsDisabled ||
                      props.notes.length === 0 ||
                      props.busyAction === "shape-product"
                    }
                  >
                    {props.busyAction === "shape-product"
                      ? "shaping..."
                      : "shape_from_notes"}
                  </GhostButton>
                </div>
              </div>

              {props.planMessage ? (
                <div className="mb-4">
                  <InlineMessage tone={props.planMessage.tone}>
                    {props.planMessage.text}
                  </InlineMessage>
                </div>
              ) : null}

              <div className="space-y-4">
                <ProductDocumentEditor
                  title="possible_features"
                  path={
                    props.productContext?.features.path ??
                    ".scratchpad/product/features.md"
                  }
                  value={props.featuresDraft}
                  placeholder={`## Selected\n- ...\n\n## Candidate\n- ...\n\n## Deferred\n- ...`}
                  rows={10}
                  onChange={props.onFeaturesDraftChange}
                />

                <ProductDocumentEditor
                  title="decisions"
                  path={
                    props.productContext?.decisions.path ??
                    ".scratchpad/product/decisions.md"
                  }
                  value={props.decisionsDraft}
                  placeholder={`## Decisions\n- ...`}
                  rows={8}
                  onChange={props.onDecisionsDraftChange}
                />

                <ProductDocumentEditor
                  title="open_questions"
                  path={
                    props.productContext?.openQuestions.path ??
                    ".scratchpad/product/open-questions.md"
                  }
                  value={props.openQuestionsDraft}
                  placeholder={`## Open Questions\n- ...`}
                  rows={8}
                  onChange={props.onOpenQuestionsDraftChange}
                />
              </div>
            </section>
          </div>
        </section>
      </div>

      <section className={cx(PANEL_CLASS, "overflow-hidden")}>
        <header className="border-b border-white/10 px-6 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="font-display text-[20px] lowercase tracking-[0.08em] text-white md:text-[30px]">
              evolving_prd
            </div>

            <div className="flex flex-wrap gap-2">
              {props.plan ? <Badge>draft_v{props.plan.versionNumber}</Badge> : null}
              {props.approvedPlan ? (
                <Badge>code_uses_v{props.approvedPlan.versionNumber}</Badge>
              ) : (
                <Badge>not_approved</Badge>
              )}
              {props.staleOpenTasks.length > 0 ? (
                <Badge>{props.staleOpenTasks.length} open_tasks_flagged</Badge>
              ) : null}
            </div>
          </div>
        </header>

        <div className="max-h-[calc(100vh-220px)] space-y-4 overflow-y-auto px-5 py-5">
          <section className={cx(INNER_CARD_CLASS, "p-5")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.22em] text-white/45">
                  repo_prd_file
                </div>
                <div className="mt-2 font-display text-lg lowercase tracking-[0.08em] text-white">
                  {props.productContext?.prd.path ?? ".scratchpad/product/prd.md"}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <ActionButton
                  onClick={props.onSaveProductFiles}
                  disabled={
                    props.productActionsDisabled ||
                    props.busyAction === "save-product-context"
                  }
                >
                  {props.busyAction === "save-product-context"
                    ? "saving..."
                    : "save_repo_prd"}
                </ActionButton>
                <ActionButton
                  onClick={props.onGeneratePrd}
                  disabled={
                    !canDraftPrd || props.busyAction === "generate-prd"
                  }
                >
                  {props.busyAction === "generate-prd"
                    ? "drafting..."
                    : props.plan
                      ? "update_prd"
                      : "draft_prd"}
                </ActionButton>
              </div>
            </div>

            <p className="mt-4 font-body text-sm leading-7 text-white/65">
              The repo file is canonical. Notes and product files shape this PRD, then Code mode derives work only from the approved version.
            </p>

            <textarea
              className={cx(FIELD_CLASS, "mt-4 min-h-[320px] font-mono text-[13px] leading-7")}
              value={props.prdDraft}
              onChange={(event) => props.onPrdDraftChange(event.target.value)}
              placeholder={`# Product Requirements Document\n\n## Summary\n...\n\n## Scope\n- ...\n\n## Acceptance\n- ...\n\n## Non-goals\n- ...`}
            />

            <form className="mt-4 space-y-3" onSubmit={props.onRevisePrd}>
              <textarea
                className={FIELD_CLASS}
                rows={4}
                placeholder="refresh the PRD with a narrower scope, updated acceptance, or a clarified decision..."
                value={props.revisionInstruction}
                onChange={(event) =>
                  props.onRevisionInstructionChange(event.target.value)
                }
              />

              <div className="flex flex-wrap gap-3">
                <ActionButton
                  type="submit"
                  disabled={
                    props.productActionsDisabled ||
                    props.busyAction === "revise-prd" ||
                    props.revisionInstruction.trim().length === 0
                  }
                >
                  {props.busyAction === "revise-prd"
                    ? "refreshing..."
                    : "refresh_prd"}
                </ActionButton>

                <GhostButton
                  onClick={props.onApprovePrd}
                  disabled={
                    props.productActionsDisabled ||
                    props.busyAction === "approve-prd" ||
                    !props.plan
                  }
                >
                  {props.busyAction === "approve-prd"
                    ? "approving..."
                    : props.approvedPlan &&
                        props.plan &&
                        props.approvedPlan.id === props.plan.id
                      ? "approved"
                      : "approve_prd"}
                </GhostButton>
              </div>
            </form>
          </section>

          {props.plan ? (
            <>
              <section className={cx(INNER_CARD_CLASS, "p-5")}>
                <div className="text-xs uppercase tracking-[0.2em] text-white/38">
                  current_prd_summary
                </div>
                <p className="mt-3 font-body text-sm leading-7 text-white/74">
                  {props.plan.summary}
                </p>
              </section>

              <div className="grid gap-4 lg:grid-cols-3">
                <PlanCluster title="scope" items={props.plan.scope} />
                <PlanCluster title="acceptance" items={props.plan.acceptance} />
                <PlanCluster title="non_goals" items={props.plan.nonGoals} />
              </div>
            </>
          ) : (
            <EmptyGlassState>
              Keep shaping the product files, then draft the first repo-local PRD from them.
            </EmptyGlassState>
          )}
        </div>
      </section>
    </div>
  );
}

function CodeModePanel(props: {
  project: ProjectWorkspace["project"];
  plan: ProjectWorkspace["plan"];
  approvedPlan: ProjectWorkspace["approvedPlan"];
  queuedTasks: Task[];
  blockedTasks: Task[];
  staleOpenTasks: Task[];
  reviewTasks: Task[];
  reviewBlockedTaskRuns: Array<{ task: Task; run: Run | null }>;
  highRiskQueuedTasks: Task[];
  nextTask: Task | null;
  featuredRun: Run | null;
  recentHistoryRuns: Run[];
  runButtonDisabled: boolean;
  taskGenerationDisabled: boolean;
  featuredRunPrepareAction: (() => void) | null;
  busyAction: string | null;
  queueMessage: ActionMessage | null;
  runMessage: ActionMessage | null;
  onGenerateTasks: () => void;
  onRunNextTask: () => void;
  onPrepareReview: (runId: string) => void;
  onRerunTask: (taskId: string) => void;
  onCopyToClipboard: (value: string, label: string) => void;
}) {
  return (
    <div className="grid flex-1 gap-6 xl:grid-cols-[1.02fr_0.98fr]">
      <section className={cx(PANEL_CLASS, "overflow-hidden")}>
        <header className="border-b border-white/10 px-6 py-5">
          <div className="font-display text-[20px] lowercase tracking-[0.08em] text-white md:text-[30px]">
            runs_review_handoff
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
              disabled={props.runButtonDisabled}
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

          {props.featuredRun ? (
            <RunFeedCard
              run={props.featuredRun}
              isPreparing={
                props.busyAction === `prepare-review-${props.featuredRun.id}`
              }
              isRerunning={
                props.busyAction === `rerun-task-${props.featuredRun.taskId}`
              }
              {...(props.featuredRunPrepareAction
                ? {
                    onPrepareReview: props.featuredRunPrepareAction,
                  }
                : {})}
              {...(props.featuredRun.reviewStatus === "blocked" ||
              props.featuredRun.reviewStatus === "failed"
                ? {
                    onRerunTask: () =>
                      props.onRerunTask(props.featuredRun!.taskId),
                  }
                : {})}
              onCopyToClipboard={props.onCopyToClipboard}
            />
          ) : (
            <EmptyGlassState>
              No run has started yet. Derive code tasks from the approved PRD, then launch the first one here.
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
                  isPreparing={props.busyAction === `prepare-review-${run.id}`}
                  isRerunning={
                    props.busyAction === `rerun-task-${run.taskId}`
                  }
                  {...(run.status === "completed" &&
                  run.reviewStatus !== "prepared"
                    ? {
                        onPrepareReview: () => props.onPrepareReview(run.id),
                      }
                    : {})}
                  {...(run.reviewStatus === "blocked" ||
                  run.reviewStatus === "failed"
                    ? {
                        onRerunTask: () => props.onRerunTask(run.taskId),
                      }
                    : {})}
                  onCopyToClipboard={props.onCopyToClipboard}
                />
              ))
            )}
          </div>
        </div>
      </section>

      <section className={cx(PANEL_CLASS, "overflow-hidden")}>
        <header className="border-b border-white/10 px-6 py-5">
          <div className="font-display text-[20px] lowercase tracking-[0.08em] text-white md:text-[30px]">
            code_queue
          </div>
        </header>

        <div className="space-y-4 px-5 py-5">
          {props.queueMessage ? (
            <InlineMessage tone={props.queueMessage.tone}>
              {props.queueMessage.text}
            </InlineMessage>
          ) : null}

          {props.staleOpenTasks.length > 0 ? (
            <InlineMessage tone="error">
              The approved PRD changed after some open tasks were derived. Refresh open tasks to reconcile the queue without rewriting completed or review work.
            </InlineMessage>
          ) : null}

          <div className={cx(INNER_CARD_CLASS, "p-5")}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-white/42">
                  queue_source
                </div>
                <div className="mt-2 font-display text-lg lowercase tracking-[0.08em] text-white">
                  {props.approvedPlan
                    ? `approved_prd_v${props.approvedPlan.versionNumber}`
                    : props.plan
                      ? "waiting_for_prd_approval"
                      : "waiting_for_prd"}
                </div>
              </div>

              <ActionButton
                onClick={props.onGenerateTasks}
                disabled={props.taskGenerationDisabled}
              >
                {props.busyAction === "generate-tasks"
                  ? "deriving..."
                  : props.staleOpenTasks.length > 0
                    ? "refresh_open_tasks"
                    : props.queuedTasks.length > 0 ||
                        props.blockedTasks.length > 0 ||
                        props.reviewTasks.length > 0
                      ? "derive_tasks_again"
                      : "derive_tasks"}
              </ActionButton>
            </div>

            <p className="mt-4 font-body text-sm leading-7 text-white/65">
              Code mode only derives work from the approved repo-local PRD. Open work can drift; completed or review work stays preserved.
            </p>
          </div>

          <div className={cx(INNER_CARD_CLASS, "p-5")}>
            <div className="text-xs uppercase tracking-[0.2em] text-white/42">
              next_runnable_task
            </div>
            <div className="mt-3 font-display text-lg lowercase tracking-[0.08em] text-white">
              {props.nextTask ? props.nextTask.title : "nothing_runnable_right_now"}
            </div>
            <p className="mt-3 font-body text-sm leading-7 text-white/68">
              {props.nextTask
                ? props.nextTask.description
                : props.staleOpenTasks.length > 0
                  ? "Some open tasks are flagged from an older PRD version, so Scratch Pad is waiting for you to refresh affected work before the next run."
                  : props.highRiskQueuedTasks.length > 0
                    ? "The remaining aligned queued work is high risk, so it stays visible until you explicitly review it."
                    : "Derive tasks or unblock existing work to see the next action item here."}
            </p>
          </div>

          <div className={cx(INNER_CARD_CLASS, "p-5")}>
            <div className="grid gap-3 sm:grid-cols-5">
              <QueueCount label="queued" value={props.queuedTasks.length} />
              <QueueCount label="maybe_stale" value={props.staleOpenTasks.length} />
              <QueueCount label="review" value={props.reviewTasks.length} />
              <QueueCount
                label="review_blocked"
                value={props.reviewBlockedTaskRuns.length}
              />
              <QueueCount label="blocked" value={props.blockedTasks.length} />
            </div>

            <div className="mt-5 space-y-3">
              {props.queuedTasks.slice(0, 4).map((task) => (
                <TaskPreviewCard key={task.id} task={task} />
              ))}

              {props.queuedTasks.length === 0 &&
              props.reviewTasks.length === 0 &&
              props.reviewBlockedTaskRuns.length === 0 &&
              props.blockedTasks.length === 0 ? (
                <EmptyGlassState>
                  The queue will appear here once tasks are derived from the approved PRD.
                </EmptyGlassState>
              ) : null}

              {props.reviewTasks.slice(0, 1).map((task) => (
                <TaskPreviewCard key={task.id} task={task} />
              ))}

              {props.reviewBlockedTaskRuns.slice(0, 2).map((entry) => {
                const blockedRun = entry.run;

                return (
                  <ReviewBlockedTaskCard
                    key={entry.task.id}
                    task={entry.task}
                    run={blockedRun}
                    isPreparing={
                      blockedRun
                        ? props.busyAction === `prepare-review-${blockedRun.id}`
                        : false
                    }
                    isRerunning={
                      props.busyAction === `rerun-task-${entry.task.id}`
                    }
                    onRerunTask={() => props.onRerunTask(entry.task.id)}
                    {...(blockedRun
                      ? {
                          onPrepareReview: () =>
                            props.onPrepareReview(blockedRun.id),
                        }
                      : {})}
                  />
                );
              })}

              {props.blockedTasks.slice(0, 2).map((task) => (
                <TaskPreviewCard key={task.id} task={task} />
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function ProductDocumentEditor(props: {
  title: string;
  path: string;
  value: string;
  placeholder: string;
  rows: number;
  onChange: (value: string) => void;
}) {
  return (
    <section className="rounded-[18px] border border-white/10 bg-white/[0.04] p-4">
      <div className="font-display text-base lowercase tracking-[0.08em] text-white">
        {props.title}
      </div>
      <div className="mt-2 break-all font-body text-xs leading-6 text-white/48">
        {props.path}
      </div>

      <textarea
        className={cx(FIELD_CLASS, "mt-4 font-mono text-[13px] leading-7")}
        rows={props.rows}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </section>
  );
}

function RepoFileBadge(props: { label: string; path: string }) {
  return (
    <div className="rounded-[16px] border border-white/10 bg-black/20 px-4 py-3">
      <div className="text-xs uppercase tracking-[0.2em] text-white/42">
        {props.label}
      </div>
      <div className="mt-2 break-all font-body text-sm leading-7 text-white/76">
        {props.path}
      </div>
    </div>
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
        <div className="flex flex-wrap gap-2">
          <Badge>{props.task.status}</Badge>
          {props.task.driftStatus !== "aligned" ? (
            <Badge>{props.task.driftStatus}</Badge>
          ) : null}
        </div>
      </div>
      <p className="mt-3 font-body text-sm leading-7 text-white/64">
        {truncateText(props.task.description, 180)}
      </p>
    </article>
  );
}

function ReviewBlockedTaskCard(props: {
  task: Task;
  run: Run | null;
  onPrepareReview?: (() => void) | undefined;
  onRerunTask: () => void;
  isPreparing?: boolean;
  isRerunning?: boolean;
}) {
  return (
    <article className="rounded-[18px] border border-amber-300/25 bg-amber-500/10 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-display text-base lowercase tracking-[0.08em] text-amber-100">
          {props.task.orderIndex + 1}. {props.task.title}
        </div>
        <Badge>review_blocked</Badge>
      </div>

      <p className="mt-3 font-body text-sm leading-7 text-amber-50/90">
        {props.run?.reviewFailureReason ??
          "Review handoff is blocked for this completed task. Retry review prep or re-run the task to keep moving."}
      </p>

      {props.run?.finishedAt ? (
        <p className="mt-2 font-body text-sm leading-7 text-amber-50/75">
          latest_run / completed {formatTimestamp(props.run.finishedAt)}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {props.onPrepareReview ? (
          <GhostButton
            onClick={props.onPrepareReview}
            disabled={Boolean(props.isPreparing || props.isRerunning)}
          >
            {props.isPreparing ? "retrying_review..." : "retry_review_prep"}
          </GhostButton>
        ) : null}

        <GhostButton
          onClick={props.onRerunTask}
          disabled={Boolean(props.isPreparing || props.isRerunning)}
        >
          {props.isRerunning ? "starting_rerun..." : "re_run_task"}
        </GhostButton>
      </div>
    </article>
  );
}

function RunFeedCard(props: {
  run: Run;
  compact?: boolean;
  onPrepareReview?: (() => void) | undefined;
  onRerunTask?: (() => void) | undefined;
  onCopyToClipboard?: ((value: string, label: string) => void) | undefined;
  isPreparing?: boolean;
  isRerunning?: boolean;
}) {
  const changedFilesCount = getReviewChangedFileCount(props.run);
  const branchName = props.run.reviewBranchName;
  const copyToClipboard = props.onCopyToClipboard;
  const checkoutCommand = branchName ? buildCheckoutCommand(branchName) : null;
  const copyBranchHandler =
    branchName && copyToClipboard
      ? () => copyToClipboard(branchName, "Branch name")
      : null;
  const copyCheckoutHandler =
    checkoutCommand && copyToClipboard
      ? () => copyToClipboard(checkoutCommand, "Checkout command")
      : null;
  const cardToneClass =
    props.run.reviewStatus === "prepared"
      ? "border-emerald-300/25 bg-emerald-500/10"
      : props.run.reviewStatus === "blocked" ||
          props.run.reviewStatus === "failed"
        ? "border-amber-300/25 bg-amber-500/10"
        : "border-white/10 bg-white/[0.05]";

  return (
    <article className={cx("rounded-[18px] border px-4 py-4", cardToneClass)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-display text-base lowercase tracking-[0.08em] text-white">
          {props.run.taskTitle}
        </div>
        <Badge>{formatRunDisplayState(props.run)}</Badge>
      </div>

      <div className="mt-3 space-y-2 font-body text-sm leading-7 text-white/64">
        <p>run_status / {props.run.status}</p>
        <p>review_handoff / {formatReviewHandoffStatus(props.run.reviewStatus)}</p>
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

      {props.run.reviewStatus === "prepared" ? (
        <div className="mt-4 rounded-[18px] border border-emerald-300/20 bg-emerald-500/10 px-4 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-emerald-100/75">
                review_prepared
              </div>
              <div className="mt-2 font-display text-base lowercase tracking-[0.08em] text-emerald-50">
                local_review_handoff_ready
              </div>
            </div>
            <Badge>local_only</Badge>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <ReviewMeta label="branch" value={props.run.reviewBranchName ?? "not_saved"} />
            <ReviewMeta
              label="changed_files"
              value={String(changedFilesCount)}
            />
            <ReviewMeta
              label="diff_stats"
              value={formatDiffStatsLabel(props.run)}
            />
            <ReviewMeta
              label="handoff_status"
              value={formatReviewHandoffStatus(props.run.reviewStatus)}
            />
          </div>

          {props.run.reviewSummary ? (
            <div className="mt-4 rounded-[16px] border border-white/10 bg-black/20 px-4 py-3">
              <div className="text-xs uppercase tracking-[0.2em] text-white/42">
                review_summary
              </div>
              <p className="mt-3 whitespace-pre-wrap font-body text-sm leading-7 text-white/74">
                {props.compact
                  ? truncateText(props.run.reviewSummary, 220)
                  : props.run.reviewSummary}
              </p>
            </div>
          ) : null}

          <p className="mt-4 font-body text-sm leading-7 text-emerald-50/80">
            Local-only handoff. Scratch Pad did not push anything and did not open a pull request.
          </p>

          {!props.compact ? (
            <div className="mt-4 flex flex-wrap gap-2">
              <GhostButton
                {...(copyBranchHandler ? { onClick: copyBranchHandler } : {})}
                disabled={!copyBranchHandler}
              >
                copy_branch
              </GhostButton>
              <GhostButton
                {...(copyCheckoutHandler
                  ? { onClick: copyCheckoutHandler }
                  : {})}
                disabled={!copyCheckoutHandler}
              >
                copy_git_checkout
              </GhostButton>
            </div>
          ) : null}
        </div>
      ) : null}

      {props.run.reviewStatus === "blocked" || props.run.reviewStatus === "failed" ? (
        <div className="mt-4 rounded-[18px] border border-amber-300/20 bg-amber-500/10 px-4 py-4">
          <div className="text-xs uppercase tracking-[0.2em] text-amber-100/75">
            review_handoff_needs_attention
          </div>
          <p className="mt-3 font-body text-sm leading-7 text-amber-50/90">
            {props.run.reviewFailureReason ??
              "Review handoff did not complete for this run."}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            {props.onPrepareReview ? (
              <GhostButton
                onClick={props.onPrepareReview}
                disabled={Boolean(props.isPreparing || props.isRerunning)}
              >
                {props.isPreparing ? "retrying_review..." : "retry_review_prep"}
              </GhostButton>
            ) : null}
            {props.onRerunTask ? (
              <GhostButton
                onClick={props.onRerunTask}
                disabled={Boolean(props.isPreparing || props.isRerunning)}
              >
                {props.isRerunning ? "starting_rerun..." : "re_run_task"}
              </GhostButton>
            ) : null}
          </div>
        </div>
      ) : null}

      {props.onPrepareReview && props.run.reviewStatus === "not_started" ? (
        <div className="mt-4">
          <GhostButton
            onClick={props.onPrepareReview}
            disabled={Boolean(props.isPreparing || props.isRerunning)}
          >
            {props.isPreparing ? "preparing_review..." : "prepare_review"}
          </GhostButton>
        </div>
      ) : null}
    </article>
  );
}

function ReviewMeta(props: { label: string; value: string }) {
  return (
    <div className="rounded-[16px] border border-white/10 bg-black/20 px-4 py-3">
      <div className="text-xs uppercase tracking-[0.2em] text-white/42">
        {props.label}
      </div>
      <div className="mt-2 break-all font-body text-sm leading-7 text-white/78">
        {props.value}
      </div>
    </div>
  );
}

function ActionButton(props: {
  children: ReactNode;
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: (() => void) | undefined;
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
  onClick?: (() => void) | undefined;
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

function buildOptimisticWorkspace(
  project: ProjectWorkspace["project"],
): ProjectWorkspace {
  const currentStage: ProjectWorkspace["currentStage"] =
    project.repoPath && project.preferredAdapter ? "scratch" : "project";

  return {
    project,
    currentStage,
    notes: [],
    productContext: null,
    plan: null,
    approvedPlan: null,
    tasks: [],
    runs: [],
  };
}

function buildProjectSynopsis(
  projectName: string | null,
  notes: ProjectWorkspace["notes"],
  plan: ProjectWorkspace["plan"],
  productContext: ProjectWorkspace["productContext"],
) {
  const source =
    plan?.summary ??
    getProductContextSynopsis(productContext) ??
    notes[0]?.content ??
    FALLBACK_PROJECT_SUMMARY;

  return truncateText(
    source.trim().length > 0
      ? source
      : `${projectName ?? "scratch_pad"} is ready for its first note.`,
    290,
  );
}

function getProductContextSynopsis(
  productContext: ProjectWorkspace["productContext"],
) {
  if (!productContext) {
    return null;
  }

  const candidate = productContext.prd.content
    .split("\n")
    .map((line) => line.trim())
    .find(
      (line) =>
        line.length > 0 &&
        !line.startsWith("#") &&
        !line.startsWith("-") &&
        !line.startsWith("##"),
    );

  return candidate ?? null;
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
  if (run.reviewStatus === "prepared") {
    return "review_prepared";
  }

  if (run.reviewStatus === "blocked") {
    return "review_blocked";
  }

  if (run.reviewStatus === "failed") {
    return "review_failed";
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
  productContext: ProjectWorkspace["productContext"];
  plan: ProjectWorkspace["plan"];
  approvedPlan: ProjectWorkspace["approvedPlan"];
  queuedTasks: Task[];
  blockedTasks: Task[];
  staleOpenTaskCount: number;
  reviewTasks: Task[];
  reviewBlockedCount: number;
  nextTask: Task | null;
  featuredRun: Run | null;
}) {
  const completedReviewRun =
    input.featuredRun?.reviewStatus === "prepared" ? input.featuredRun : null;

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

  if (
    input.featuredRun &&
    (input.featuredRun.reviewStatus === "blocked" ||
      input.featuredRun.reviewStatus === "failed")
  ) {
    return {
      statusLabel: "review_blocked",
      title: input.featuredRun.taskTitle,
      detail:
        input.featuredRun.reviewFailureReason ??
        "The latest run completed, but review handoff is still blocked. Retry review prep or re-run the task from the review area.",
    };
  }

  if (input.reviewBlockedCount > 0) {
    return {
      statusLabel: "review_blocked",
      title: "review_handoff_blocked",
      detail:
        "A completed task is still waiting because review handoff is blocked. Retry review prep or re-run the task from the main workflow.",
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

  if (input.staleOpenTaskCount > 0) {
    return {
      statusLabel: "open_tasks_need_refresh",
      title: "approved_prd_changed",
      detail:
        "The approved repo-local PRD changed after some open tasks were derived. Refresh affected open tasks in Code mode before starting another run.",
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

  if (input.approvedPlan) {
    return {
      statusLabel: "ready_for_code_mode",
      title: "approved_repo_prd_locked_in",
      detail:
        "The approved repo-local PRD is in place. Code mode can derive or refresh open tasks from that approved scope whenever you are ready.",
    };
  }

  if (input.plan) {
    return {
      statusLabel: "plan_needs_approval",
      title: "review_the_current_repo_prd",
      detail:
        "Your draft PRD is ready in the repo-local product context. Refresh or edit it until the scope is right, then approve it to unlock Code mode task derivation.",
      };
  }

  if (
    input.notes.length > 0 ||
    input.productContext?.features.content.trim().length ||
    input.productContext?.decisions.content.trim().length ||
    input.productContext?.openQuestions.content.trim().length
  ) {
    return {
      statusLabel: "ready_to_draft_prd",
      title: "product_context_is_forming",
      detail:
        "Product mode has enough context to draft or update the repo-local PRD. Shape the files, then approve the version that Code mode should execute.",
    };
  }

  if (input.project.repoPath && input.project.preferredAdapter) {
    return {
      statusLabel: "ready_for_product_shaping",
      title: "project_setup_saved",
      detail:
        "Project setup is complete. Start Product mode with notes, candidate features, decisions, and open questions to build the repo-local PRD.",
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

function formatReviewHandoffStatus(value: ReviewHandoffStatus) {
  return value;
}

function getReviewChangedFileCount(run: Run) {
  return run.reviewChangedFiles?.length ?? run.reviewDiffStats?.filesChanged ?? 0;
}

function formatDiffStatsLabel(run: Run) {
  const stats = run.reviewDiffStats;

  if (!stats) {
    return "not_saved";
  }

  return `+${stats.insertions} / -${stats.deletions}`;
}

function buildCheckoutCommand(branchName: string) {
  return `git checkout ${branchName}`;
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
