import type {
  PlanVersion,
  PreferredAdapter,
  Project,
  ScratchNote,
} from "@scratch-pad/shared";
import { getAdapterStatuses } from "./adapters.js";

export type PlanDraft = Omit<
  PlanVersion,
  "id" | "projectId" | "approved" | "createdAt"
>;

export async function buildGeneratedPlan(
  project: Project,
  notes: ScratchNote[],
): Promise<{ draft: PlanDraft; message: string }> {
  const draft = buildPlanDraft({
    project,
    notes,
  });

  return {
    draft,
    message: await buildPlanningMessage(
      "generated",
      project.preferredAdapter,
    ),
  };
}

export async function buildRevisedPlan(
  project: Project,
  notes: ScratchNote[],
  currentPlan: PlanVersion,
  instruction: string,
): Promise<{ draft: PlanDraft; message: string }> {
  const draft = buildPlanDraft({
    project,
    notes,
    currentPlan,
    revisionInstruction: instruction,
  });

  return {
    draft,
    message: await buildPlanningMessage(
      "revised",
      project.preferredAdapter,
    ),
  };
}

function buildPlanDraft(input: {
  project: Project;
  notes: ScratchNote[];
  currentPlan?: PlanVersion;
  revisionInstruction?: string;
}): Omit<PlanVersion, "id" | "projectId" | "approved" | "createdAt"> {
  const orderedNotes = [...input.notes].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );

  const noteFragments = orderedNotes.flatMap((note) =>
    splitIntoFragments(note.content),
  );
  const currentPlanFragments = input.currentPlan
    ? [
        input.currentPlan.summary,
        ...input.currentPlan.scope,
        ...input.currentPlan.acceptance,
        ...input.currentPlan.nonGoals,
      ]
    : [];
  const revisionFragments = input.revisionInstruction
    ? splitIntoFragments(input.revisionInstruction)
    : [];

  const allFragments = dedupe([
    ...revisionFragments,
    ...noteFragments,
    ...currentPlanFragments,
  ]);

  const maxScopeItems = isSmallerRevision(input.revisionInstruction) ? 3 : 4;
  const explicitScopeItems = dedupe(
    allFragments
      .filter((fragment) => !isAdapterInstruction(fragment))
      .map((fragment) => toScopeItem(fragment))
      .filter((value): value is string => Boolean(value)),
  );
  const fallbackScopeItems = buildFallbackScopeItems();
  const scope =
    explicitScopeItems.length > 0
      ? explicitScopeItems.slice(0, maxScopeItems)
      : fallbackScopeItems.slice(0, maxScopeItems);

  const explicitNonGoals = dedupe(
    allFragments
      .map((fragment) => toNonGoalItem(fragment))
      .filter((value): value is string => Boolean(value)),
  );
  const fallbackNonGoals = buildFallbackNonGoals(input.revisionInstruction);
  const nonGoals = dedupe([
    ...explicitNonGoals,
    ...fallbackNonGoals,
  ]).slice(0, 4);

  const acceptance = dedupe(
    scope.map((scopeItem) => scopeItemToAcceptance(scopeItem)),
  ).slice(0, Math.max(3, Math.min(scope.length, 4)));

  const summary = buildSummary({
    projectName: input.project.name,
    scope,
    fragments: allFragments,
  });

  return {
    summary,
    scope,
    acceptance,
    nonGoals,
  };
}

async function buildPlanningMessage(
  action: "generated" | "revised",
  preferredAdapter: PreferredAdapter,
) {
  if (!preferredAdapter) {
    return `PRD ${action} using the default local planning path.`;
  }

  const adapterStatuses = await getAdapterStatuses();
  const selectedAdapter = adapterStatuses.find(
    (adapterStatus) => adapterStatus.id === preferredAdapter,
  );
  const adapterName =
    preferredAdapter === "claude-code" ? "Claude Code" : "Codex";

  if (!selectedAdapter) {
    return `PRD ${action} using the ${adapterName} planning path hint with local drafting heuristics.`;
  }

  if (selectedAdapter.ready) {
    return `PRD ${action} using the ${adapterName} planning path. Phase 4 still keeps planning local and lightweight.`;
  }

  return `PRD ${action} using a local fallback draft because ${adapterName} is not fully ready on this machine.`;
}

function buildSummary(input: {
  projectName: string;
  scope: string[];
  fragments: string[];
}) {
  const rankedScopeItems = input.scope
    .map((scopeItem, index) => ({
      scopeItem,
      index,
      score: scoreScopeItemForSummary(scopeItem),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.scopeItem);

  const summaryClauses = dedupe(
    rankedScopeItems
      .map((scopeItem) => scopeItemToSummaryClause(scopeItem))
      .filter((value): value is string => Boolean(value)),
  ).slice(0, 2);

  const shouldMentionLocal =
    input.fragments.some((fragment) => /\blocal[- ]first\b/i.test(fragment)) &&
    !summaryClauses.some((clause) => /\blocal\b/i.test(clause));

  if (shouldMentionLocal) {
    summaryClauses.push("keeps project data local");
  }

  if (summaryClauses.length === 0) {
    summaryClauses.push("captures the main input, shows the primary result, and keeps project data local");
  }

  return `${input.projectName} ${joinWithAnd(summaryClauses)}`.replace(
    /\s+/g,
    " ",
  ) + ".";
}

function buildFallbackScopeItems() {
  return [
    "Capture the main user input on one screen",
    "Show the primary result on one screen",
    "Save project data locally",
  ];
}

function buildFallbackNonGoals(revisionInstruction?: string) {
  const base = [
    "No secondary workflows outside the primary use case",
    "No expansion beyond the main happy path",
  ];

  if (isSmallerRevision(revisionInstruction)) {
    return [
      "No extra use cases beyond the main happy path",
      ...base,
    ];
  }

  return base;
}

function toScopeItem(fragment: string) {
  const normalizedFragment = normalizePlanningFragment(fragment);

  if (!normalizedFragment) {
    return null;
  }

  if (isAdapterInstruction(normalizedFragment)) {
    return null;
  }

  const documentationScopeItem = toDocumentationScopeItem(normalizedFragment);

  if (documentationScopeItem) {
    return documentationScopeItem;
  }

  if (
    isMetaPlanningFragment(normalizedFragment) ||
    isPolicyPlanningFragment(normalizedFragment)
  ) {
    return null;
  }

  if (
    /\bno auth\b|\bno authentication\b|\bwithout auth\b|\bwithout authentication\b/i.test(
      normalizedFragment,
    )
  ) {
    return null;
  }

  if (/\blocal[- ]first\b|\bkeep .* local\b|\bstore .* local\b/i.test(normalizedFragment)) {
    return "Save project data locally";
  }

  if (
    /\bdesktop alerts?\b|\bdesktop notifications?\b|\bnotifications?\b/i.test(
      normalizedFragment,
    )
  ) {
    return "Send desktop notifications when a rule matches";
  }

  if (/\bthresholds?\b|\brules?\b|\balerts?\b|\bfilters?\b|\bconditions?\b/i.test(normalizedFragment)) {
    return "Create and edit rules or thresholds";
  }

  if (/\bsettings?\b|\bpreferences?\b|\blocal store\b|\bconfiguration\b|\bconfig\b/i.test(normalizedFragment)) {
    return "Save project settings locally";
  }

  if (
    /\btrack\b|\bwatch\b|\bmonitor\b|\bfetch\b|\bpoll\b|\bsync\b|\bingest\b|\bcollect\b/i.test(
      normalizedFragment,
    )
  ) {
    return "Track the primary item or signal";
  }

  if (
    /\bdashboard\b|\bscreen\b|\bpage\b|\bpanel\b|\bview\b|\btable\b|\bdetail\b|\bdetails\b|\bresults?\b|\bstatus\b/i.test(
      normalizedFragment,
    )
  ) {
    return "Show the primary status on one screen";
  }

  if (/\binput\b|\bform\b|\bsetup\b|\bconfigure\b/i.test(normalizedFragment)) {
    return "Capture the main user input on one screen";
  }

  const genericScopeItem = toGenericScopeItem(normalizedFragment);

  if (genericScopeItem) {
    return genericScopeItem;
  }

  return null;
}

function toNonGoalItem(fragment: string) {
  const normalizedFragment = normalizePlanningFragment(fragment);

  if (!normalizedFragment) {
    return null;
  }

  if (
    isMetaPlanningFragment(normalizedFragment) ||
    isPolicyPlanningFragment(normalizedFragment)
  ) {
    return null;
  }

  if (
    /\bno auth\b|\bno authentication\b|\bwithout auth\b|\bwithout authentication\b/i.test(
      normalizedFragment,
    )
  ) {
    return "No authentication or account system";
  }

  if (/\bcollaboration\b|\bteam\b/i.test(normalizedFragment)) {
    return "No collaboration or shared workspace features";
  }

  if (/\bbilling\b|\bpayments?\b|\bsubscriptions?\b/i.test(normalizedFragment)) {
    return "No billing or subscription flow";
  }

  if (
    /\bdon't overbuild\b|\bdo not overbuild\b|\bkeep it cheap\b|\bkeep it simple\b|\btiny\b|\bsmall\b|\blean\b/i.test(
      normalizedFragment,
    )
  ) {
    return "No secondary workflows beyond the main use case";
  }

  if (
    /\bavoid\b|\bexclude\b|\bskip\b|\bnot in v1\b|\bout of scope\b/i.test(
      normalizedFragment,
    )
  ) {
    return toSentenceCase(normalizeNegativePhrase(normalizedFragment));
  }

  return null;
}

function scopeItemToAcceptance(scopeItem: string) {
  if (scopeItem === "Document local runtime prerequisites in the README") {
    return "The README lists the required local setup steps and runtime prerequisites.";
  }

  if (scopeItem === "Document current product limitations in the README") {
    return "The README lists the current product limitations.";
  }

  if (scopeItem === "Create and edit rules or thresholds") {
    return "A user can create, edit, and save rules or thresholds.";
  }

  if (scopeItem === "Send desktop notifications when a rule matches") {
    return "A matching rule triggers a desktop notification.";
  }

  if (scopeItem === "Save project data locally") {
    return "Saved project data is still available after reload without any remote service.";
  }

  if (scopeItem === "Save project settings locally") {
    return "Saved settings are still available after reload.";
  }

  if (scopeItem === "Track the primary item or signal") {
    return "The app tracks the primary item or signal and shows its current state.";
  }

  if (scopeItem === "Show the primary status on one screen") {
    return "The main screen shows the current status for the primary flow.";
  }

  if (scopeItem === "Capture the main user input on one screen") {
    return "A user can enter the main input on one screen and continue the primary flow.";
  }

  if (scopeItem.startsWith("Let the user ")) {
    return `A user can ${lowerFirst(scopeItem.slice("Let the user ".length))} in the main flow.`;
  }

  if (scopeItem.startsWith("Manage ")) {
    return `A user can manage ${lowerFirst(scopeItem.slice("Manage ".length))} from the app.`;
  }

  if (scopeItem.startsWith("Show ")) {
    return `The app shows ${lowerFirst(scopeItem.slice("Show ".length))} in the main flow.`;
  }

  if (scopeItem.startsWith("Save ")) {
    return `${scopeItem} and keep it after reload.`;
  }

  if (scopeItem.startsWith("Track ")) {
    return `The app tracks ${lowerFirst(scopeItem.slice("Track ".length))} and shows the latest state.`;
  }

  if (scopeItem.startsWith("Support ")) {
    return `A user can use ${lowerFirst(scopeItem.slice("Support ".length))} in the main flow.`;
  }

  return `${scopeItem}.`;
}

function scopeItemToSummaryClause(scopeItem?: string) {
  if (!scopeItem) {
    return null;
  }

  if (scopeItem === "Document local runtime prerequisites in the README") {
    return "documents the local runtime prerequisites in the README";
  }

  if (scopeItem === "Document current product limitations in the README") {
    return "documents the current product limitations in the README";
  }

  if (scopeItem === "Create and edit rules or thresholds") {
    return "lets the user create and edit rules or thresholds";
  }

  if (scopeItem === "Send desktop notifications when a rule matches") {
    return "sends desktop notifications when a rule matches";
  }

  if (scopeItem === "Save project data locally") {
    return "keeps project data local";
  }

  if (scopeItem === "Save project settings locally") {
    return "saves project settings locally";
  }

  if (scopeItem === "Track the primary item or signal") {
    return "tracks the primary item or signal";
  }

  if (scopeItem === "Show the primary status on one screen") {
    return "shows the primary status on one screen";
  }

  if (scopeItem === "Capture the main user input on one screen") {
    return "lets the user enter the main input on one screen";
  }

  if (scopeItem.startsWith("Let the user ")) {
    return `lets the user ${lowerFirst(scopeItem.slice("Let the user ".length))}`;
  }

  if (scopeItem.startsWith("Manage ")) {
    return `lets the user manage ${lowerFirst(scopeItem.slice("Manage ".length))}`;
  }

  if (scopeItem.startsWith("Send ")) {
    return `can ${lowerFirst(scopeItem)}`;
  }

  if (scopeItem.startsWith("Show ")) {
    return `shows ${lowerFirst(scopeItem.slice("Show ".length))}`;
  }

  if (scopeItem.startsWith("Save ")) {
    return `saves ${lowerFirst(scopeItem.slice("Save ".length))}`;
  }

  if (scopeItem.startsWith("Track ")) {
    return `tracks ${lowerFirst(scopeItem.slice("Track ".length))}`;
  }

  if (scopeItem.startsWith("Support ")) {
    return `supports ${lowerFirst(scopeItem.slice("Support ".length))}`;
  }

  return lowerFirst(scopeItem);
}

function splitIntoFragments(value: string) {
  return value
    .split(/[\n\r]+|[.;]+|,\s+(?=[a-z])/i)
    .map((fragment) => normalizeFreeformPhrase(fragment))
    .filter(Boolean);
}

function normalizeNegativePhrase(value: string) {
  const cleaned = normalizeFreeformPhrase(value);

  if (/^avoid\b/i.test(cleaned)) {
    return cleaned.replace(/^avoid\b/i, "Avoid");
  }

  if (/^exclude\b/i.test(cleaned)) {
    return cleaned.replace(/^exclude\b/i, "Exclude");
  }

  if (/^skip\b/i.test(cleaned)) {
    return cleaned.replace(/^skip\b/i, "Skip");
  }

  return `Avoid ${cleaned}`;
}

function normalizeFreeformPhrase(value: string) {
  return value
    .replace(/^[\s\-*•]+/, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupe(values: string[]) {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const value of values) {
    const key = value.trim().toLowerCase();

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    results.push(value.trim());
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

function joinWithAnd(parts: string[]) {
  if (parts.length === 1) {
    return parts[0];
  }

  if (parts.length === 2) {
    return `${parts[0]} and ${parts[1]}`;
  }

  const finalPart = parts[parts.length - 1];

  return `${parts.slice(0, -1).join(", ")}, and ${finalPart}`;
}

function scoreScopeItemForSummary(scopeItem: string) {
  if (/Create and edit|Track |Send |Show /i.test(scopeItem)) {
    return 3;
  }

  if (/Save project data locally|Save project settings locally/i.test(scopeItem)) {
    return 1;
  }

  return 2;
}

function normalizePlanningFragment(value: string) {
  return normalizeFreeformPhrase(value)
    .replace(/^one thing i would explicitly mention(?: is|:)?\s*/i, "")
    .replace(/^one thing to mention(?: is|:)?\s*/i, "")
    .replace(/^say clearly(?: that)?\s+/i, "")
    .replace(/^make it clear(?: that)?\s+/i, "")
    .replace(/^mention(?: that)?\s+/i, "")
    .replace(/^explicitly mention(?: that)?\s+/i, "")
    .replace(/^call out(?: that)?\s+/i, "")
    .replace(/^note(?: that)?\s+/i, "")
    .replace(/^deliver the smallest useful version of\s+/i, "")
    .replace(/^build the smallest useful version of\s+/i, "")
    .replace(/^ship the smallest useful version of\s+/i, "")
    .replace(/^the smallest useful version of\s+/i, "")
    .replace(/^the smallest working version of\s+/i, "")
    .replace(/^focus(?: the v1)? on\s+/i, "")
    .replace(/^prioritize\s+/i, "")
    .trim();
}

function isAdapterInstruction(value: string) {
  return /\bclaude code\b|\bcodex\b|\badapter\b/i.test(value);
}

function isMetaPlanningFragment(value: string) {
  return /\breadme\b|\bdocumentation\b|\bdocs?\b|\bwording\b|\bcopy\b|\blabel\b|\bsay clearly\b|\bmention\b|\bexplicitly mention\b|\bcall out\b|\bwrite\b/i.test(
    value,
  );
}

function isPolicyPlanningFragment(value: string) {
  return /\bkeep it simple\b|\beasy to understand\b|\bsmallest useful version\b|\bsmallest working\b|\bship one clear\b|\bkeep the first release\b|\blimit the first release\b|\bnarrow and manual\b|\bstays? intentionally small\b|\bno extra complexity\b|\bavoid extra complexity\b/i.test(
    value,
  );
}

function isSmallerRevision(value?: string) {
  if (!value) {
    return false;
  }

  return /\bsmaller\b|\bsmaller v1\b|\bleaner\b|\bnarrower\b|\btrim\b|\bcut scope\b|\btighten\b/i.test(
    value,
  );
}

function toDocumentationScopeItem(fragment: string) {
  if (!/\breadme\b|\bdocumentation\b|\bdocs?\b/i.test(fragment)) {
    return null;
  }

  if (
    /\bprerequisites?\b|\bsetup\b|\binstall(?:ation)?\b|\brequirements?\b|\bruntime\b|\benv\b|\benvironment\b|\bcommands?\b|\btroubleshooting\b/i.test(
      fragment,
    )
  ) {
    return "Document local runtime prerequisites in the README";
  }

  if (/\blimitations?\b|\bknown issues?\b|\bcaveats?\b|\bconstraints?\b/i.test(fragment)) {
    return "Document current product limitations in the README";
  }

  return null;
}

function toGenericScopeItem(fragment: string) {
  const actionMatch = fragment.match(
    /^(?:let the user|allow the user to|allow users to|enable|support|show|display|provide|save|edit|manage|track|create|add|include|build)\s+(.+)$/i,
  );

  if (!actionMatch) {
    return null;
  }

  const subject = normalizeScopeSubject(actionMatch[1] ?? "");

  if (!subject || isWeakScopeSubject(subject)) {
    return null;
  }

  if (/^show|^display/i.test(fragment)) {
    return `Show ${subject}`;
  }

  if (/^save/i.test(fragment)) {
    return `Save ${subject}`;
  }

  if (/^edit|^manage/i.test(fragment)) {
    return `Manage ${subject}`;
  }

  if (/^track/i.test(fragment)) {
    return `Track ${subject}`;
  }

  if (/^(?:let the user|allow the user to|allow users to)/i.test(fragment)) {
    return `Let the user ${subject}`;
  }

  return `Support ${subject}`;
}

function normalizeScopeSubject(value: string) {
  return value
    .replace(/\bfor v0\.1\b|\bfor v1\b|\bin v0\.1\b|\bin v1\b/gi, "")
    .replace(/\bapproved\b|\bsmallest\b|\bminimal\b|\bcore\b|\bprimary\b|\bfirst\b/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(the user can|users can)\s+/i, "")
    .replace(/^to\s+/i, "")
    .replace(/^a\s+/i, "")
    .replace(/^an\s+/i, "")
    .trim();
}

function isWeakScopeSubject(value: string) {
  return /\bthing\b|\bstatement\b|\breadme\b|\bcopy\b|\bwording\b|\bscope\b|\boutcome\b|\bversion\b|\bproduct\b|\bflow only\b|\bmanual\b/i.test(
    value,
  );
}
