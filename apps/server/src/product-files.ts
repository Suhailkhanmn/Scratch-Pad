import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  PlanVersion,
  ProductContext,
  ProductContextUpdateInput,
} from "@scratch-pad/shared";

export const PRODUCT_RELATIVE_ROOT = ".scratchpad/product";
export const PRODUCT_PRD_RELATIVE_PATH = `${PRODUCT_RELATIVE_ROOT}/prd.md`;

type ProductFileKey = "prd" | "features" | "decisions" | "openQuestions";

export type ParsedPrdDocument = {
  summary: string;
  scope: string[];
  acceptance: string[];
  nonGoals: string[];
};

export type ParsedFeaturesDocument = {
  selected: string[];
  candidate: string[];
  deferred: string[];
};

export type ParsedProductContext = {
  prd: ParsedPrdDocument;
  features: ParsedFeaturesDocument;
  decisions: string[];
  openQuestions: string[];
};

const PRODUCT_FILE_NAMES: Record<ProductFileKey, string> = {
  prd: "prd.md",
  features: "features.md",
  decisions: "decisions.md",
  openQuestions: "open-questions.md",
};

export function readProductContext(
  repoPath: string,
  options?: { seedPlan?: PlanVersion | null },
): ProductContext {
  ensureProductContextScaffold(repoPath, options?.seedPlan ?? null);

  const rootPath = resolve(repoPath, PRODUCT_RELATIVE_ROOT);

  return {
    rootPath,
    prd: readDocument(repoPath, "prd"),
    features: readDocument(repoPath, "features"),
    decisions: readDocument(repoPath, "decisions"),
    openQuestions: readDocument(repoPath, "openQuestions"),
  };
}

export function writeProductContext(
  repoPath: string,
  input: ProductContextUpdateInput,
  options?: { seedPlan?: PlanVersion | null },
): ProductContext {
  const currentContext = readProductContext(repoPath, options);

  for (const key of Object.keys(PRODUCT_FILE_NAMES) as ProductFileKey[]) {
    const nextContent = input[key];

    if (nextContent === undefined) {
      continue;
    }

    writeFileSync(
      currentContext[key].path,
      normalizeMarkdownDocument(nextContent),
      "utf8",
    );
  }

  return readProductContext(repoPath, options);
}

export function parseProductContext(
  context: ProductContext,
): ParsedProductContext {
  return {
    prd: parsePrdMarkdown(context.prd.content),
    features: parseFeaturesMarkdown(context.features.content),
    decisions: parseSimpleListMarkdown(context.decisions.content),
    openQuestions: parseSimpleListMarkdown(context.openQuestions.content),
  };
}

export function buildPrdMarkdown(draft: ParsedPrdDocument) {
  return normalizeMarkdownDocument(
    [
      "# PRD",
      "",
      "## Summary",
      draft.summary.trim() || "Add a short evolving product summary here.",
      "",
      "## Scope",
      ...toMarkdownBulletSection(
        draft.scope,
        "Add selected scope items as bullet points.",
      ),
      "",
      "## Acceptance",
      ...toMarkdownBulletSection(
        draft.acceptance,
        "Add acceptance bullets for the current scope.",
      ),
      "",
      "## Non-goals",
      ...toMarkdownBulletSection(
        draft.nonGoals,
        "Add explicit non-goals or constraints here.",
      ),
    ].join("\n"),
  );
}

export function buildFeaturesMarkdown(draft: ParsedFeaturesDocument) {
  return normalizeMarkdownDocument(
    [
      "# Possible Features",
      "",
      "## Selected",
      ...toMarkdownBulletSection(
        draft.selected,
        "Add the features that belong in the approved scope.",
      ),
      "",
      "## Candidate",
      ...toMarkdownBulletSection(
        draft.candidate,
        "Add candidate features that still need shaping.",
      ),
      "",
      "## Deferred",
      ...toMarkdownBulletSection(
        draft.deferred,
        "Add ideas that are intentionally out of scope for now.",
      ),
    ].join("\n"),
  );
}

export function buildSimpleListMarkdown(title: string, items: string[]) {
  return normalizeMarkdownDocument(
    [
      `# ${title}`,
      "",
      ...toMarkdownBulletSection(
        items,
        `Add ${title.toLowerCase()} as bullet points.`,
      ),
    ].join("\n"),
  );
}

export function parsePrdMarkdown(content: string): ParsedPrdDocument {
  const summary = extractSummarySection(content);
  const scope = parseSimpleListSection(content, ["Scope"]);
  const acceptance = parseSimpleListSection(content, ["Acceptance"]);
  const nonGoals = parseSimpleListSection(content, ["Non-goals", "Non Goals"]);

  return {
    summary:
      summary ||
      "Add a short evolving product summary here.",
    scope,
    acceptance,
    nonGoals,
  };
}

export function parseFeaturesMarkdown(content: string): ParsedFeaturesDocument {
  const selected = parseSimpleListSection(content, ["Selected"]);
  const candidate = parseSimpleListSection(content, ["Candidate"]);
  const deferred = parseSimpleListSection(content, ["Deferred"]);

  if (
    selected.length === 0 &&
    candidate.length === 0 &&
    deferred.length === 0
  ) {
    return {
      selected: [],
      candidate: parseSimpleListMarkdown(content),
      deferred: [],
    };
  }

  return {
    selected,
    candidate,
    deferred,
  };
}

export function parseSimpleListMarkdown(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim())
    .filter(Boolean);
}

export function hashMarkdown(content: string) {
  return createHash("sha1")
    .update(content.replace(/\r\n/g, "\n"))
    .digest("hex");
}

function ensureProductContextScaffold(
  repoPath: string,
  seedPlan: PlanVersion | null,
) {
  const rootPath = resolve(repoPath, PRODUCT_RELATIVE_ROOT);
  mkdirSync(rootPath, { recursive: true });

  const defaultFiles: Record<ProductFileKey, string> = {
    prd: seedPlan
      ? seedPlan.bodyMarkdown
      : buildPrdMarkdown({
          summary: "Add a short evolving product summary here.",
          scope: [],
          acceptance: [],
          nonGoals: [],
        }),
    features: buildFeaturesMarkdown({
      selected: [],
      candidate: [],
      deferred: [],
    }),
    decisions: buildSimpleListMarkdown("Decisions", []),
    openQuestions: buildSimpleListMarkdown("Open Questions", []),
  };

  for (const key of Object.keys(PRODUCT_FILE_NAMES) as ProductFileKey[]) {
    const path = join(rootPath, PRODUCT_FILE_NAMES[key]);

    if (existsSync(path)) {
      continue;
    }

    writeFileSync(path, defaultFiles[key], "utf8");
  }
}

function readDocument(repoPath: string, key: ProductFileKey) {
  const path = resolve(repoPath, PRODUCT_RELATIVE_ROOT, PRODUCT_FILE_NAMES[key]);

  return {
    path,
    content: readFileSync(path, "utf8"),
  };
}

function normalizeMarkdownDocument(value: string) {
  const normalized = value.replace(/\r\n/g, "\n").trim();

  return normalized.length > 0 ? `${normalized}\n` : "\n";
}

function toMarkdownBulletSection(items: string[], emptyMessage: string) {
  if (items.length === 0) {
    return [emptyMessage];
  }

  return items.map((item) => `- ${item}`);
}

function extractSummarySection(content: string) {
  const explicitSummary = extractSectionContent(content, ["Summary"]);

  if (explicitSummary) {
    return explicitSummary
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .join(" ");
  }

  const withoutTitle = content.replace(/^#.*$/m, "").trim();
  const firstParagraph = withoutTitle.split(/\n\s*\n/)[0] ?? "";

  return firstParagraph.trim();
}

function parseSimpleListSection(content: string, sectionNames: string[]) {
  const sectionContent = extractSectionContent(content, sectionNames);

  if (!sectionContent) {
    return [];
  }

  return parseSimpleListMarkdown(sectionContent);
}

function extractSectionContent(content: string, sectionNames: string[]) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const normalizedSectionNames = new Set(
    sectionNames.map((sectionName) => sectionName.trim().toLowerCase()),
  );
  let collecting = false;
  const collectedLines: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^##\s+(.+)$/);

    if (headingMatch) {
      const headingName = (headingMatch[1] ?? "").trim().toLowerCase();

      if (collecting) {
        break;
      }

      if (normalizedSectionNames.has(headingName)) {
        collecting = true;
      }

      continue;
    }

    if (collecting) {
      collectedLines.push(line);
    }
  }

  return collectedLines.join("\n").trim();
}
