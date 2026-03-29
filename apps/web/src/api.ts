import {
  AdapterStatusListSchema,
  ApprovePrdInputSchema,
  CreateDirectoryInputSchema,
  CreateDirectoryResultSchema,
  CreateProjectInputSchema,
  CreateScratchNoteInputSchema,
  DirectoryBrowserResultSchema,
  DraftPrdInputSchema,
  HealthResponseSchema,
  OpenCodexAppResultSchema,
  OpenProjectRepoInputSchema,
  PlanMutationResultSchema,
  PrepareReviewResultSchema,
  ProductContextMutationResultSchema,
  ProductContextUpdateInputSchema,
  ProjectListSchema,
  ProjectSchema,
  ProjectWorkspaceSchema,
  RevisePrdInputSchema,
  RunNextTaskResultSchema,
  ScratchNoteSchema,
  TaskGenerationResultSchema,
  UpdateScratchNoteInputSchema,
  type AdapterStatus,
  type CreateDirectoryResult,
  type DirectoryBrowserResult,
  type PlanMutationResult,
  type PlanVersion,
  type PrepareReviewResult,
  type PreferredAdapter,
  type OpenCodexAppResult,
  type ProductContext,
  type ProductContextMutationResult,
  type Project,
  type ProjectWorkspace,
  type Run,
  type RunNextTaskResult,
  type ScratchNote,
  type Task,
} from "@scratch-pad/shared";

const jsonHeaders = {
  "Content-Type": "application/json",
};

export class ApiError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = "ApiError";
    this.statusCode = statusCode;
  }
}

export async function fetchHealth() {
  return request("/api/health", {
    schema: HealthResponseSchema,
  });
}

export async function fetchAdapterStatuses() {
  return request("/api/adapters/status", {
    schema: AdapterStatusListSchema,
  });
}

export async function fetchProjectWorkspace(projectId: string) {
  return request(`/api/projects/${projectId}/workspace`, {
    schema: ProjectWorkspaceSchema,
  });
}

export async function fetchProjects() {
  return request("/api/projects", {
    schema: ProjectListSchema,
  });
}

export async function createProject(input: {
  name: string;
  preferredAdapter: PreferredAdapter;
}) {
  const payload = CreateProjectInputSchema.parse(input);

  return request("/api/projects", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: jsonHeaders,
    schema: ProjectSchema,
  });
}

export async function deleteProject(projectId: string) {
  await request(`/api/projects/${projectId}`, {
    method: "DELETE",
  });
}

export async function saveProjectSetup(
  projectId: string,
  input: {
    repoPath: string;
    preferredAdapter?: PreferredAdapter;
  },
) {
  const payload = OpenProjectRepoInputSchema.parse(input);

  return request(`/api/projects/${projectId}/open-repo`, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: jsonHeaders,
    schema: ProjectSchema,
  });
}

export async function openCodexApp(projectId: string) {
  return request(`/api/projects/${projectId}/open-codex-app`, {
    method: "POST",
    schema: OpenCodexAppResultSchema,
  });
}

export async function browseDirectories(path?: string) {
  const searchParams = new URLSearchParams();

  if (path?.trim()) {
    searchParams.set("path", path.trim());
  }

  const query = searchParams.toString();

  return request(
    `/api/filesystem/directories${query ? `?${query}` : ""}`,
    {
      schema: DirectoryBrowserResultSchema,
    },
  );
}

export async function createDirectory(input: {
  parentPath: string;
  name: string;
}) {
  const payload = CreateDirectoryInputSchema.parse(input);

  return request("/api/filesystem/directories", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: jsonHeaders,
    schema: CreateDirectoryResultSchema,
  });
}

export async function createScratchNote(
  projectId: string,
  input: { content: string },
) {
  const payload = CreateScratchNoteInputSchema.parse(input);

  return request(`/api/projects/${projectId}/notes`, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: jsonHeaders,
    schema: ScratchNoteSchema,
  });
}

export async function updateScratchNote(
  noteId: string,
  input: { content: string },
) {
  const payload = UpdateScratchNoteInputSchema.parse(input);

  return request(`/api/notes/${noteId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
    headers: jsonHeaders,
    schema: ScratchNoteSchema,
  });
}

export async function deleteScratchNote(noteId: string) {
  await request(`/api/notes/${noteId}`, {
    method: "DELETE",
  });
}

export async function saveProductContext(
  projectId: string,
  input: {
    prd?: string;
    features?: string;
    decisions?: string;
    openQuestions?: string;
  },
) {
  const payload = ProductContextUpdateInputSchema.parse(input);

  return request(`/api/projects/${projectId}/save-product-context`, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: jsonHeaders,
    schema: ProductContextMutationResultSchema,
  });
}

export async function shapeProduct(
  projectId: string,
  input: {
    prd?: string;
    features?: string;
    decisions?: string;
    openQuestions?: string;
  },
) {
  const payload = ProductContextUpdateInputSchema.parse(input);

  return request(`/api/projects/${projectId}/shape-product`, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: jsonHeaders,
    schema: ProductContextMutationResultSchema,
  });
}

export async function generatePrd(
  projectId: string,
  input: {
    prd?: string;
    features?: string;
    decisions?: string;
    openQuestions?: string;
  } = {},
) {
  const payload = DraftPrdInputSchema.parse(input);

  return request(`/api/projects/${projectId}/generate-prd`, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: jsonHeaders,
    schema: PlanMutationResultSchema,
  });
}

export async function revisePrd(
  projectId: string,
  input: {
    instruction: string;
    prd?: string;
    features?: string;
    decisions?: string;
    openQuestions?: string;
  },
) {
  const payload = RevisePrdInputSchema.parse(input);

  return request(`/api/projects/${projectId}/revise-prd`, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: jsonHeaders,
    schema: PlanMutationResultSchema,
  });
}

export async function approvePrd(
  projectId: string,
  input: { planVersionId: string },
) {
  const payload = ApprovePrdInputSchema.parse(input);

  return request(`/api/projects/${projectId}/approve-prd`, {
    method: "POST",
    body: JSON.stringify(payload),
    headers: jsonHeaders,
    schema: PlanMutationResultSchema,
  });
}

export async function generateTasks(projectId: string) {
  return request(`/api/projects/${projectId}/generate-tasks`, {
    method: "POST",
    schema: TaskGenerationResultSchema,
  });
}

export async function runNextTask(projectId: string) {
  return request(`/api/projects/${projectId}/run-next-task`, {
    method: "POST",
    schema: RunNextTaskResultSchema,
  });
}

export async function prepareReview(runId: string) {
  return request(`/api/runs/${runId}/prepare-review`, {
    method: "POST",
    schema: PrepareReviewResultSchema,
  });
}

export async function rerunTask(taskId: string) {
  return request(`/api/tasks/${taskId}/re-run`, {
    method: "POST",
    schema: RunNextTaskResultSchema,
  });
}

async function request<T>(
  url: string,
  options: RequestInit & { schema?: { parse(input: unknown): T } } = {},
): Promise<T> {
  const response = await fetch(url, options);

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const payload = text ? safeParseJson(text) : null;

  if (!response.ok) {
    const message =
      isRecord(payload) && typeof payload.message === "string"
        ? payload.message
        : `Request failed with status ${response.status}`;

    throw new ApiError(message, response.status);
  }

  if (!options.schema) {
    return payload as T;
  }

  return options.schema.parse(payload);
}

function safeParseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export type {
  AdapterStatus,
  CreateDirectoryResult,
  DirectoryBrowserResult,
  OpenCodexAppResult,
  PlanMutationResult,
  PlanVersion,
  PrepareReviewResult,
  ProductContext,
  ProductContextMutationResult,
  Project,
  ProjectWorkspace,
  Run,
  RunNextTaskResult,
  ScratchNote,
  Task,
};
