import type { DatabaseSync } from "node:sqlite";
import type {
  DraftPrdInput,
  PlanVersion,
  ProductContext,
  ProductContextUpdateInput,
  Project,
  ScratchNote,
} from "@scratch-pad/shared";
import {
  approvePlanVersion,
  createPlanVersion,
  getLatestApprovedPlanVersionByProjectId,
  getLatestPlanVersionByProjectId,
} from "./plans.js";
import {
  buildGeneratedPlan,
  buildRevisedPlan,
  buildShapedProductContext,
} from "./planning.js";
import {
  buildFeaturesMarkdown,
  buildPrdMarkdown,
  buildSimpleListMarkdown,
  hashMarkdown,
  parseProductContext,
  parsePrdMarkdown,
  PRODUCT_PRD_RELATIVE_PATH,
  readProductContext,
  writeProductContext,
} from "./product-files.js";

export function getProjectProductState(
  database: DatabaseSync,
  project: Project,
): {
  productContext: ProductContext | null;
  plan: PlanVersion | null;
  approvedPlan: PlanVersion | null;
} {
  const plan = getLatestPlanVersionByProjectId(database, project.id);
  const approvedPlan = getLatestApprovedPlanVersionByProjectId(
    database,
    project.id,
  );
  const productContext = project.repoPath
    ? readProductContext(project.repoPath, {
        seedPlan: plan ?? approvedPlan ?? null,
      })
    : null;

  return {
    productContext,
    plan,
    approvedPlan,
  };
}

export function saveProjectProductContext(
  database: DatabaseSync,
  project: Project,
  input: ProductContextUpdateInput,
) {
  const repoPath = requireRepoPath(project);
  const existingState = getProjectProductState(database, project);
  const existingContext = existingState.productContext;

  if (!existingContext) {
    throw new Error("Could not load the repo-local product context.");
  }

  const currentPrdHash = hashMarkdown(existingContext.prd.content);
  const productContext = writeProductContext(repoPath, input, {
    seedPlan: existingState.plan ?? existingState.approvedPlan ?? null,
  });
  const nextPrdHash = hashMarkdown(productContext.prd.content);

  let plan = existingState.plan;

  if (input.prd !== undefined && currentPrdHash !== nextPrdHash) {
    plan = snapshotPlanFromProductContext(database, project, productContext, {
      approved: false,
    });
  }

  return {
    productContext,
    plan,
    approvedPlan: getLatestApprovedPlanVersionByProjectId(database, project.id),
    message:
      input.prd !== undefined && currentPrdHash !== nextPrdHash
        ? "Saved repo-local product context and captured a new PRD draft version."
        : "Saved the repo-local product context files.",
  };
}

export async function shapeProjectProductContext(
  database: DatabaseSync,
  project: Project,
  notes: ScratchNote[],
  input: ProductContextUpdateInput,
) {
  const repoPath = requireRepoPath(project);
  const baseState = getProjectProductState(database, project);
  const currentContext = writeProductContext(repoPath, input, {
    seedPlan: baseState.plan ?? baseState.approvedPlan ?? null,
  });
  const parsedProductContext = parseProductContext(currentContext);
  const shapedProductContext = await buildShapedProductContext(
    project,
    notes,
    parsedProductContext,
  );
  const productContext = writeProductContext(
    repoPath,
    {
      features: buildFeaturesMarkdown(shapedProductContext.draft.features),
      decisions: buildSimpleListMarkdown(
        "Decisions",
        shapedProductContext.draft.decisions,
      ),
      openQuestions: buildSimpleListMarkdown(
        "Open Questions",
        shapedProductContext.draft.openQuestions,
      ),
    },
    {
      seedPlan: baseState.plan ?? baseState.approvedPlan ?? null,
    },
  );

  return {
    productContext,
    plan: baseState.plan,
    approvedPlan: baseState.approvedPlan,
    message: shapedProductContext.message,
  };
}

export async function draftProjectPrd(
  database: DatabaseSync,
  project: Project,
  notes: ScratchNote[],
  input: DraftPrdInput,
) {
  const repoPath = requireRepoPath(project);
  const baseState = getProjectProductState(database, project);
  const currentContext = writeProductContext(repoPath, input, {
    seedPlan: baseState.plan ?? baseState.approvedPlan ?? null,
  });
  const parsedProductContext = parseProductContext(currentContext);
  const generatedPlan = await buildGeneratedPlan(project, {
    notes,
    productContext: parsedProductContext,
  });
  const prdMarkdown = buildPrdMarkdown(generatedPlan.draft);
  const productContext = writeProductContext(
    repoPath,
    { prd: prdMarkdown },
    { seedPlan: baseState.plan ?? baseState.approvedPlan ?? null },
  );
  const plan = snapshotPlanFromProductContext(database, project, productContext, {
    approved: false,
  });

  return {
    productContext,
    plan,
    approvedPlan: baseState.approvedPlan,
    message: generatedPlan.message,
  };
}

export async function refreshProjectPrd(
  database: DatabaseSync,
  project: Project,
  notes: ScratchNote[],
  input: ProductContextUpdateInput & { instruction: string },
) {
  const repoPath = requireRepoPath(project);
  const baseState = getProjectProductState(database, project);
  const currentContext = writeProductContext(repoPath, input, {
    seedPlan: baseState.plan ?? baseState.approvedPlan ?? null,
  });
  const parsedProductContext = parseProductContext(currentContext);
  const currentPlan =
    baseState.plan ?? buildPlanSnapshotLike(project.id, currentContext.prd.content);
  const revisedPlan = await buildRevisedPlan(project, {
    notes,
    productContext: parsedProductContext,
    currentPlan,
    instruction: input.instruction,
  });
  const prdMarkdown = buildPrdMarkdown(revisedPlan.draft);
  const productContext = writeProductContext(
    repoPath,
    { prd: prdMarkdown },
    { seedPlan: baseState.plan ?? baseState.approvedPlan ?? null },
  );
  const plan = snapshotPlanFromProductContext(database, project, productContext, {
    approved: false,
  });

  return {
    productContext,
    plan,
    approvedPlan: baseState.approvedPlan,
    message: revisedPlan.message,
  };
}

export function approveProjectPrd(
  database: DatabaseSync,
  project: Project,
) {
  const repoPath = requireRepoPath(project);
  const baseState = getProjectProductState(database, project);
  const productContext = readProductContext(repoPath, {
    seedPlan: baseState.plan ?? baseState.approvedPlan ?? null,
  });
  const currentPrdHash = hashMarkdown(productContext.prd.content);
  const currentPlan =
    baseState.plan && baseState.plan.contentHash === currentPrdHash
      ? baseState.plan
      : snapshotPlanFromProductContext(database, project, productContext, {
          approved: false,
        });
  const approvedPlan = approvePlanVersion(
    database,
    project.id,
    currentPlan.id,
  );

  if (!approvedPlan) {
    throw new Error("Could not approve the current repo-local PRD.");
  }

  return {
    productContext,
    plan: currentPlan,
    approvedPlan,
    message: `Approved PRD v${approvedPlan.versionNumber} from the repo-local product context.`,
  };
}

function snapshotPlanFromProductContext(
  database: DatabaseSync,
  project: Project,
  productContext: ProductContext,
  options?: { approved?: boolean },
) {
  const parsedPrd = parsePrdMarkdown(productContext.prd.content);

  return createPlanVersion(database, {
    projectId: project.id,
    summary: parsedPrd.summary,
    scope: parsedPrd.scope,
    acceptance: parsedPrd.acceptance,
    nonGoals: parsedPrd.nonGoals,
    sourcePath: PRODUCT_PRD_RELATIVE_PATH,
    bodyMarkdown: productContext.prd.content,
    contentHash: hashMarkdown(productContext.prd.content),
    approved: options?.approved ?? false,
  });
}

function buildPlanSnapshotLike(projectId: string, prdMarkdown: string): PlanVersion {
  const parsedPrd = parsePrdMarkdown(prdMarkdown);

  return {
    id: "repo-current-prd",
    projectId,
    versionNumber: 0,
    summary: parsedPrd.summary,
    scope: parsedPrd.scope,
    acceptance: parsedPrd.acceptance,
    nonGoals: parsedPrd.nonGoals,
    sourcePath: PRODUCT_PRD_RELATIVE_PATH,
    bodyMarkdown: prdMarkdown,
    contentHash: hashMarkdown(prdMarkdown),
    approved: false,
    createdAt: new Date(0).toISOString(),
  };
}

function requireRepoPath(project: Project) {
  if (!project.repoPath) {
    throw new Error("Save a local repo path before using Product mode.");
  }

  return project.repoPath;
}
