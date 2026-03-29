import { z } from "zod";

export const HealthResponseSchema = z.object({
  name: z.literal("scratch-pad-server"),
  status: z.literal("ok"),
  timestamp: z.string().datetime(),
  database: z.object({
    path: z.string().min(1),
    sqliteVersion: z.string().min(1),
  }),
});

export type HealthResponse = z.infer<typeof HealthResponseSchema>;

export const ProjectIdSchema = z.string().uuid();
export const ScratchNoteIdSchema = z.string().uuid();
export const IsoTimestampSchema = z.string().datetime();

export const AdapterIdSchema = z.enum(["claude-code", "codex"]);

export type AdapterId = z.infer<typeof AdapterIdSchema>;

export const PreferredAdapterSchema = AdapterIdSchema.nullable();

export type PreferredAdapter = z.infer<typeof PreferredAdapterSchema>;

export const AdapterAuthenticationStateSchema = z.union([
  z.boolean(),
  z.literal("unknown"),
]);

export type AdapterAuthenticationState = z.infer<
  typeof AdapterAuthenticationStateSchema
>;

export const AdapterReadinessStateSchema = z.enum([
  "ready",
  "not-ready",
  "unknown",
]);

export type AdapterReadinessState = z.infer<
  typeof AdapterReadinessStateSchema
>;

export const AdapterInstallationCheckSchema = z.object({
  installed: z.boolean(),
  version: z.string().min(1).nullable(),
  message: z.string().min(1),
});

export type AdapterInstallationCheck = z.infer<
  typeof AdapterInstallationCheckSchema
>;

export const AdapterAuthenticationCheckSchema = z.object({
  authenticated: AdapterAuthenticationStateSchema,
  message: z.string().min(1),
});

export type AdapterAuthenticationCheck = z.infer<
  typeof AdapterAuthenticationCheckSchema
>;

export const AdapterStatusSchema = z.object({
  id: AdapterIdSchema,
  name: z.string().min(1),
  installed: z.boolean(),
  authenticated: AdapterAuthenticationStateSchema,
  ready: z.boolean(),
  readiness: AdapterReadinessStateSchema,
  message: z.string().min(1),
  version: z.string().min(1).nullable(),
  appInstalled: z.boolean().nullable(),
  appLaunchSupported: z.boolean(),
  appServerSupported: z.boolean(),
  appMessage: z.string().min(1).nullable(),
});

export type AdapterStatus = z.infer<typeof AdapterStatusSchema>;

export const AdapterStatusListSchema = z.array(AdapterStatusSchema);

export interface LocalAdapterContract {
  id: AdapterId;
  name: string;
  checkInstalled(): Promise<AdapterInstallationCheck>;
  checkAuthenticated(): Promise<AdapterAuthenticationCheck>;
}

export const ProjectStatusSchema = z.literal("idle");

export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectSchema = z.object({
  id: ProjectIdSchema,
  name: z.string().min(1).max(120),
  repoPath: z.string().min(1).nullable(),
  preferredAdapter: PreferredAdapterSchema,
  status: ProjectStatusSchema,
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});

export type Project = z.infer<typeof ProjectSchema>;

export const ProjectListSchema = z.array(ProjectSchema);

export const CreateProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  preferredAdapter: PreferredAdapterSchema.optional().default(null),
});

export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

export const OpenProjectRepoInputSchema = z.object({
  repoPath: z.string().trim().min(1),
  preferredAdapter: PreferredAdapterSchema.optional(),
});

export type OpenProjectRepoInput = z.infer<
  typeof OpenProjectRepoInputSchema
>;

export const ProjectParamsSchema = z.object({
  id: ProjectIdSchema,
});

export const ScratchNoteSchema = z.object({
  id: ScratchNoteIdSchema,
  projectId: ProjectIdSchema,
  content: z.string().min(1),
  createdAt: IsoTimestampSchema,
  updatedAt: IsoTimestampSchema,
});

export type ScratchNote = z.infer<typeof ScratchNoteSchema>;

export const ScratchNoteListSchema = z.array(ScratchNoteSchema);

export const CreateScratchNoteInputSchema = z.object({
  content: z.string().trim().min(1).max(5000),
});

export type CreateScratchNoteInput = z.infer<
  typeof CreateScratchNoteInputSchema
>;

export const UpdateScratchNoteInputSchema = z.object({
  content: z.string().trim().min(1).max(5000),
});

export type UpdateScratchNoteInput = z.infer<
  typeof UpdateScratchNoteInputSchema
>;

export const ScratchNoteParamsSchema = z.object({
  id: ScratchNoteIdSchema,
});

export const PlanVersionIdSchema = z.string().uuid();

export const PlanItemListSchema = z.array(z.string().trim().min(1)).min(1);

export const PlanVersionSchema = z.object({
  id: PlanVersionIdSchema,
  projectId: ProjectIdSchema,
  summary: z.string().min(1),
  scope: PlanItemListSchema,
  acceptance: PlanItemListSchema,
  nonGoals: PlanItemListSchema,
  approved: z.boolean(),
  createdAt: IsoTimestampSchema,
});

export type PlanVersion = z.infer<typeof PlanVersionSchema>;

export const ProjectPlanSchema = PlanVersionSchema.nullable();

export const RevisePrdInputSchema = z.object({
  instruction: z.string().trim().min(1).max(4000),
});

export type RevisePrdInput = z.infer<typeof RevisePrdInputSchema>;

export const ApprovePrdInputSchema = z.object({
  planVersionId: PlanVersionIdSchema,
});

export type ApprovePrdInput = z.infer<typeof ApprovePrdInputSchema>;

export const PlanMutationResultSchema = z.object({
  plan: PlanVersionSchema,
  message: z.string().min(1),
});

export type PlanMutationResult = z.infer<typeof PlanMutationResultSchema>;

export const TaskIdSchema = z.string().uuid();

export const TaskStatusSchema = z.enum(["queued", "blocked", "review"]);

export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskRiskLevelSchema = z.enum(["low", "medium", "high"]);

export type TaskRiskLevel = z.infer<typeof TaskRiskLevelSchema>;

export const TaskSchema = z.object({
  id: TaskIdSchema,
  projectId: ProjectIdSchema,
  planVersionId: PlanVersionIdSchema,
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(1000),
  status: TaskStatusSchema,
  orderIndex: z.number().int().nonnegative(),
  riskLevel: TaskRiskLevelSchema,
  adapterHint: PreferredAdapterSchema,
  createdAt: IsoTimestampSchema,
});

export type Task = z.infer<typeof TaskSchema>;

export const TaskListSchema = z.array(TaskSchema);

export const TaskGenerationResultSchema = z.object({
  tasks: TaskListSchema,
  message: z.string().min(1),
});

export type TaskGenerationResult = z.infer<typeof TaskGenerationResultSchema>;

export const RunIdSchema = z.string().uuid();

export const RunStatusSchema = z.enum([
  "starting",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

export type RunStatus = z.infer<typeof RunStatusSchema>;

export const RunDiffStatsSchema = z.object({
  filesChanged: z.number().int().nonnegative(),
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
});

export type RunDiffStats = z.infer<typeof RunDiffStatsSchema>;

export const RunSchema = z.object({
  id: RunIdSchema,
  projectId: ProjectIdSchema,
  taskId: TaskIdSchema,
  taskTitle: z.string().min(1).max(160),
  adapter: AdapterIdSchema,
  status: RunStatusSchema,
  outputLogPath: z.string().min(1),
  gitBaseBranch: z.string().min(1).nullable(),
  gitBaseCommit: z.string().min(1).nullable(),
  reviewBranchName: z.string().min(1).nullable(),
  reviewChangedFiles: z.array(z.string().min(1)).nullable(),
  reviewDiffStats: RunDiffStatsSchema.nullable(),
  reviewSummary: z.string().min(1).nullable(),
  reviewPreparedAt: IsoTimestampSchema.nullable(),
  startedAt: IsoTimestampSchema,
  finishedAt: IsoTimestampSchema.nullable(),
});

export type Run = z.infer<typeof RunSchema>;

export const RunListSchema = z.array(RunSchema);

export const ProjectWorkspaceStageSchema = z.enum([
  "project",
  "scratch",
  "plan",
  "queue",
  "run",
  "review",
]);

export type ProjectWorkspaceStage = z.infer<
  typeof ProjectWorkspaceStageSchema
>;

export const ProjectWorkspaceSchema = z.object({
  project: ProjectSchema,
  currentStage: ProjectWorkspaceStageSchema,
  notes: ScratchNoteListSchema,
  plan: ProjectPlanSchema,
  tasks: TaskListSchema,
  runs: RunListSchema,
});

export type ProjectWorkspace = z.infer<typeof ProjectWorkspaceSchema>;

export const RunParamsSchema = z.object({
  id: RunIdSchema,
});

export const OpenCodexAppResultSchema = z.object({
  repoPath: z.string().min(1),
  message: z.string().min(1),
});

export type OpenCodexAppResult = z.infer<typeof OpenCodexAppResultSchema>;

export const RunNextTaskResultSchema = z.object({
  run: RunSchema,
  task: TaskSchema,
  message: z.string().min(1),
});

export type RunNextTaskResult = z.infer<typeof RunNextTaskResultSchema>;

export const PrepareReviewResultSchema = z.object({
  run: RunSchema,
  task: TaskSchema,
  message: z.string().min(1),
});

export type PrepareReviewResult = z.infer<typeof PrepareReviewResultSchema>;
