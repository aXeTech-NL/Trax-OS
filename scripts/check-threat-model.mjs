import { spawnSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = resolve(scriptDirectory, "..");

const DOMAIN_SUFFIXES = [
  "IDENTITY",
  "ACCESS",
  "NATIVE",
  "SYNC",
  "DOCUMENTS",
  "ATLAS-MCP",
  "SELF-HOSTING",
];
const REQUIRED_DOMAINS = new Set(DOMAIN_SUFFIXES.map((suffix) => `DOM-${suffix}`));
const REQUIRED_BOUNDARIES = new Set([
  ...ids("IDENTITY", 5),
  ...ids("ACCESS", 5),
  ...ids("NATIVE", 5),
  ...ids("SYNC", 5),
  ...ids("DOCUMENTS", 6),
  ...ids("ATLAS-MCP", 8),
  ...ids("SELF-HOSTING", 9),
]);
const REQUIRED_COMPATIBILITY = new Set([
  "authenticated-web",
  "android",
  "macos-arm64",
  "api-contract",
  "command-contract",
  "mcp-contract",
  "sync-contract",
  "self-hosted",
  "managed-cloud",
]);
const METHODOLOGY_CATEGORIES = [
  "spoofing",
  "tampering",
  "repudiation",
  "information-disclosure",
  "denial-of-service",
  "elevation-of-privilege",
  "privacy",
  "abuse",
  "supply-chain",
];
const CAPABILITY = ["implemented", "partial", "not-implemented"];
const DELIVERY_STATUS = ["designed", "implemented", "integrated", "validated"];
const RISK_VALUES = {
  likelihood: { unlikely: 1, possible: 2, likely: 3 },
  impact: { limited: 1, serious: 2, severe: 3, critical: 4 },
};
const ENTITY_ARRAYS = [
  "domains",
  "owners",
  "boundaries",
  "threats",
  "mitigations",
  "evidence",
  "residualRisks",
  "compatibility",
  "reviews",
];
const ID_PATTERNS = {
  domains: /^DOM-(?:IDENTITY|ACCESS|NATIVE|SYNC|DOCUMENTS|ATLAS-MCP|SELF-HOSTING)$/,
  owners: /^OWN-[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
  boundaries: /^TB-(?:IDENTITY|ACCESS|NATIVE|SYNC|DOCUMENTS|ATLAS-MCP|SELF-HOSTING)-\d{3}$/,
  threats: /^TH-(?:IDENTITY|ACCESS|NATIVE|SYNC|DOCUMENTS|ATLAS-MCP|SELF-HOSTING)-\d{3}$/,
  mitigations: /^MIT-(?:IDENTITY|ACCESS|NATIVE|SYNC|DOCUMENTS|ATLAS-MCP|SELF-HOSTING)-\d{3}$/,
  evidence: /^EV-[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
  residualRisks: /^RR-(?:IDENTITY|ACCESS|NATIVE|SYNC|DOCUMENTS|ATLAS-MCP|SELF-HOSTING)-\d{3}$/,
  compatibility: /^COMPAT-[A-Z0-9]+(?:-[A-Z0-9]+)*$/,
  reviews: /^REV-PHASE0-\d{3}$/,
};
const CURRENT_INTEGRATED_CONTROLS = new Set([
  "MIT-IDENTITY-001",
  "MIT-IDENTITY-002",
  "MIT-ACCESS-001",
  "MIT-ACCESS-002",
]);
const SECURITY_PROPERTIES = [
  "confidentiality",
  "integrity",
  "availability",
  "authenticity",
  "authorization",
  "accountability",
  "privacy",
  "safety",
  "recoverability",
];
const PLACEHOLDER = /\b(?:TODO|TBD|FIXME)\b|example\.com/i;
const HANDLE = /^@[A-Za-z0-9-]+(?:\/[A-Za-z0-9_.-]+)?$/;
const REPOSITORY_URL = /^https:\/\/github\.com\/aXeTech-NL\/Trax-OS\/(?:issues|pull|actions|commit|tree|blob)\/[^\s]+$/;
const EVIDENCE_REFERENCE = /^https:\/\/github\.com\/aXeTech-NL\/Trax-OS\/(?:actions\/runs\/\d+(?:\/job\/\d+)?|pull\/\d+(?:#pullrequestreview-\d+)?|commit\/[0-9a-f]{40})$/;
const REVIEW_REFERENCE = /^https:\/\/github\.com\/aXeTech-NL\/Trax-OS\/pull\/\d+#pullrequestreview-\d+$/;
const ISSUE_URL = /^https:\/\/github\.com\/aXeTech-NL\/Trax-OS\/issues\/\d+$/;

function ids(domain, count) {
  return Array.from({ length: count }, (_, index) =>
    `TB-${domain}-${String(index + 1).padStart(3, "0")}`,
  );
}

function diagnostic(code, path, message) {
  return { code, path, message };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function requireObject(errors, value, path) {
  if (!isObject(value)) {
    errors.push(diagnostic("REQUIRED_OBJECT", path, "must be an object"));
    return null;
  }
  return value;
}

function requireString(errors, value, path) {
  if (!isNonEmptyString(value)) {
    errors.push(diagnostic("REQUIRED_STRING", path, "must be a non-empty string"));
    return false;
  }
  return true;
}

function requireNullableString(errors, value, path) {
  if (value !== null && !isNonEmptyString(value)) {
    errors.push(diagnostic("NULLABLE_STRING", path, "must be null or a non-empty string"));
  }
}

function requireBoolean(errors, value, path) {
  if (typeof value !== "boolean") {
    errors.push(diagnostic("STRICT_BOOLEAN", path, "must be a boolean"));
  }
}

function requireArray(errors, value, path, { nonEmpty = true } = {}) {
  if (!Array.isArray(value)) {
    errors.push(diagnostic("REQUIRED_ARRAY", path, "must be an array"));
    return [];
  }
  if (nonEmpty && value.length === 0) {
    errors.push(diagnostic("REQUIRED_ARRAY", path, "must be non-empty"));
  }
  return value;
}

function requireStringArray(errors, value, path, { nonEmpty = true, allowed = null } = {}) {
  const array = requireArray(errors, value, path, { nonEmpty });
  const seen = new Set();
  for (const [index, entry] of array.entries()) {
    if (!isNonEmptyString(entry)) {
      errors.push(diagnostic("ARRAY_STRING", `${path}[${index}]`, "must be a non-empty string"));
    } else {
      if (seen.has(entry)) errors.push(diagnostic("DUPLICATE_ARRAY_VALUE", `${path}[${index}]`, `duplicates ${entry}`));
      seen.add(entry);
      if (allowed && !allowed.includes(entry)) {
        errors.push(diagnostic("INVALID_ENUM", `${path}[${index}]`, `must be one of: ${allowed.join(", ")}`));
      }
    }
  }
  return array.filter(isNonEmptyString);
}

function requireObjectArray(errors, value, path, { nonEmpty = true } = {}) {
  const array = requireArray(errors, value, path, { nonEmpty });
  return array.map((entry, index) => {
    if (!isObject(entry)) {
      errors.push(diagnostic("ARRAY_OBJECT", `${path}[${index}]`, "must be an object"));
      return null;
    }
    return entry;
  });
}

function requireEnum(errors, value, allowed, path, code = "INVALID_ENUM") {
  if (!allowed.includes(value)) {
    errors.push(diagnostic(code, path, `must be one of: ${allowed.join(", ")}`));
  }
}

function isIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? "")) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function requireIsoDate(errors, value, path) {
  if (!isIsoDate(value)) errors.push(diagnostic("ISO_DATE", path, "must be a valid YYYY-MM-DD date"));
}

function repositoryCommitExists(root, commit) {
  if (!/^[0-9a-f]{40}$/.test(commit ?? "")) return false;
  const result = spawnSync("git", ["cat-file", "-e", `${commit}^{commit}`], {
    cwd: root,
    stdio: "ignore",
  });
  return result.status === 0;
}

function loadModelAtCommit(root, commit, modelPath) {
  const result = spawnSync("git", ["show", `${commit}:${modelPath}`], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) return { error: "reviewed commit does not contain the threat-model register" };
  try {
    return { model: JSON.parse(result.stdout) };
  } catch {
    return { error: "reviewed commit contains an invalid threat-model JSON document" };
  }
}

function immutableDesignSubject(model) {
  const subject = structuredClone(model);
  delete subject.modelStatus;
  delete subject.reviews;
  for (const owner of arrayOrEmpty(subject.owners)) {
    if (!isObject(owner)) continue;
    delete owner.status;
    delete owner.handle;
    delete owner.confirmationReference;
    delete owner.riskAuthority;
  }
  for (const evidence of arrayOrEmpty(subject.evidence)) {
    if (evidence?.id === "EV-PHASE0-REVIEW") {
      delete evidence.status;
      delete evidence.execution;
    }
  }
  for (const risk of arrayOrEmpty(subject.residualRisks)) {
    if (!isObject(risk)) continue;
    delete risk.disposition;
    delete risk.acceptance;
  }
  return subject;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function expectedRisk(likelihood, impact) {
  const likelihoodValue = RISK_VALUES.likelihood[likelihood];
  const impactValue = RISK_VALUES.impact[impact];
  if (!likelihoodValue || !impactValue) return null;
  const score = likelihoodValue * impactValue;
  const rating = score <= 2 ? "low" : score <= 4 ? "medium" : score <= 8 ? "high" : "critical";
  return { score, rating };
}

function validateRisk(errors, risk, path) {
  if (!requireObject(errors, risk, path)) return;
  const expected = expectedRisk(risk.likelihood, risk.impact);
  if (!expected) {
    errors.push(diagnostic("RISK_ENUM", path, "has an invalid likelihood or impact"));
  } else if (risk.score !== expected.score || risk.rating !== expected.rating) {
    errors.push(
      diagnostic(
        "RISK_CALCULATION",
        path,
        `must have score ${expected.score} and rating ${expected.rating}`,
      ),
    );
  }
}

function validateRationaleAlignment(errors, rationale, risk, path) {
  if (!isNonEmptyString(rationale) || !isObject(risk)) return;
  const likelihood = /Likelihood (?:remains (unlikely|possible|likely)|falls from (?:unlikely|possible|likely) to (unlikely|possible|likely))/.exec(rationale);
  const impact = /Impact (?:remains (limited|serious|severe|critical)|falls from (?:limited|serious|severe|critical) to (limited|serious|severe|critical))/.exec(rationale);
  const statedLikelihood = likelihood?.[1] ?? likelihood?.[2];
  const statedImpact = impact?.[1] ?? impact?.[2];
  if (statedLikelihood !== risk.likelihood) errors.push(diagnostic("RATIONALE_RISK_CONTRADICTION", path, `states ${String(statedLikelihood)} likelihood but typed value is ${String(risk.likelihood)}`));
  if (statedImpact !== risk.impact) errors.push(diagnostic("RATIONALE_RISK_CONTRADICTION", path, `states ${String(statedImpact)} impact but typed value is ${String(risk.impact)}`));
  const residualRating = /residual (?:risk )?(?:is|remains) (low|medium|high|critical)/i.exec(rationale)?.[1]?.toLowerCase();
  if (residualRating && residualRating !== risk.rating) errors.push(diagnostic("RATIONALE_RISK_CONTRADICTION", path, `states ${residualRating} residual rating but typed value is ${String(risk.rating)}`));
}

function githubSlug(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function markdownAnchors(content) {
  const seen = new Map();
  const anchors = new Set();
  for (const line of content.split(/\r?\n/)) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) continue;
    const base = githubSlug(match[2]);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    anchors.add(count === 0 ? base : `${base}-${count}`);
  }
  return anchors;
}

function resolveRegularFile(errors, root, relativePath, path) {
  if (!isNonEmptyString(relativePath)) {
    errors.push(diagnostic("REFERENCE_PATH", path, "must be a repository-relative path"));
    return null;
  }
  if (isAbsolute(relativePath) || relativePath.split(/[\\/]/).includes("..")) {
    errors.push(diagnostic("REFERENCE_TRAVERSAL", path, "must not be absolute or traverse outside the repository"));
    return null;
  }
  const candidate = resolve(root, relativePath);
  const relativeCandidate = relative(root, candidate);
  if (relativeCandidate.startsWith(`..${sep}`) || relativeCandidate === "..") {
    errors.push(diagnostic("REFERENCE_TRAVERSAL", path, "escapes the repository"));
    return null;
  }
  let realRoot;
  let realCandidate;
  try {
    realRoot = realpathSync(root);
    realCandidate = realpathSync(candidate);
  } catch {
    errors.push(diagnostic("REFERENCE_MISSING", path, `does not exist: ${relativePath}`));
    return null;
  }
  const realRelative = relative(realRoot, realCandidate);
  if (realRelative.startsWith(`..${sep}`) || realRelative === "..") {
    errors.push(diagnostic("REFERENCE_SYMLINK_ESCAPE", path, "resolves outside the repository"));
    return null;
  }
  if (!statSync(realCandidate).isFile()) {
    errors.push(diagnostic("REFERENCE_NOT_FILE", path, "must resolve to a regular file"));
    return null;
  }
  return realCandidate;
}

export function validateRepositoryReference(reference, root = repositoryRoot, path = "reference", { artifact = false } = {}) {
  const errors = [];
  if (!requireObject(errors, reference, path)) return errors;
  if (reference.kind !== "repository") {
    errors.push(diagnostic("REFERENCE_KIND", `${path}.kind`, artifact ? "artifact kind must be repository" : "must be repository or issue-or-review"));
    return errors;
  }
  const file = resolveRegularFile(errors, root, reference.path, `${path}.path`);
  if (reference.anchor !== undefined && !isNonEmptyString(reference.anchor)) {
    errors.push(diagnostic("REFERENCE_ANCHOR_TYPE", `${path}.anchor`, "must be a non-empty string"));
  }
  if (reference.selector !== undefined && !isNonEmptyString(reference.selector)) {
    errors.push(diagnostic("REFERENCE_SELECTOR_TYPE", `${path}.selector`, "must be a non-empty string"));
  }
  if (artifact && !isNonEmptyString(reference.selector)) {
    errors.push(diagnostic("ARTIFACT_SELECTOR", `${path}.selector`, "artifact requires an exact selector"));
  }
  if (file) {
    const content = readFileSync(file, "utf8");
    if (isNonEmptyString(reference.anchor) && !markdownAnchors(content).has(reference.anchor)) {
      errors.push(diagnostic("REFERENCE_ANCHOR", `${path}.anchor`, `missing Markdown anchor #${reference.anchor}`));
    }
    if (isNonEmptyString(reference.selector) && !content.includes(reference.selector)) {
      errors.push(diagnostic("REFERENCE_SELECTOR", `${path}.selector`, `missing selector ${reference.selector}`));
    }
  }
  return errors;
}

function validateReference(errors, reference, root, path) {
  if (!isObject(reference)) {
    errors.push(diagnostic("REFERENCE_REQUIRED", path, "must be an object"));
    return;
  }
  if (reference.kind === "repository") {
    errors.push(...validateRepositoryReference(reference, root, path));
  } else if (reference.kind === "issue-or-review") {
    if (!REPOSITORY_URL.test(reference.url ?? "")) {
      errors.push(diagnostic("REFERENCE_URL", `${path}.url`, "must be an immutable or tracked Trax OS GitHub URL"));
    }
  } else {
    errors.push(diagnostic("REFERENCE_KIND", `${path}.kind`, "must be repository or issue-or-review"));
  }
}

function validateReferences(errors, references, root, path, { nonEmpty = true } = {}) {
  const array = requireObjectArray(errors, references, path, { nonEmpty });
  array.forEach((reference, index) => {
    if (reference) validateReference(errors, reference, root, `${path}[${index}]`);
  });
}

function collectStrings(value, path = "$") {
  const strings = [];
  if (typeof value === "string") strings.push({ value, path });
  else if (Array.isArray(value)) {
    value.forEach((entry, index) => strings.push(...collectStrings(entry, `${path}[${index}]`)));
  } else if (isObject(value)) {
    for (const [key, entry] of Object.entries(value)) strings.push(...collectStrings(entry, `${path}.${key}`));
  }
  return strings;
}

function entityMap(errors, model) {
  const byId = new Map();
  if (isNonEmptyString(model.modelId)) byId.set(model.modelId, { type: "model", value: model });
  for (const arrayName of ENTITY_ARRAYS) {
    const array = requireObjectArray(errors, model[arrayName], `$.${arrayName}`, { nonEmpty: true });
    array.forEach((entry, index) => {
      if (!entry) return;
      const path = `$.${arrayName}[${index}].id`;
      if (!isNonEmptyString(entry.id)) {
        errors.push(diagnostic("ENTITY_ID", path, "must be a non-empty ID"));
      } else if (!ID_PATTERNS[arrayName].test(entry.id)) {
        errors.push(diagnostic("ENTITY_ID_PATTERN", path, `has invalid ${arrayName} ID syntax`));
      } else if (byId.has(entry.id)) {
        errors.push(diagnostic("DUPLICATE_ID", path, `duplicates ${entry.id}`));
      } else {
        byId.set(entry.id, { type: arrayName, value: entry });
      }
    });
  }
  return byId;
}

function requireReference(errors, byId, id, expectedType, path) {
  if (!isNonEmptyString(id) || !byId.has(id)) {
    errors.push(diagnostic("DANGLING_ID", path, `references unknown ID ${String(id)}`));
  } else if (expectedType && byId.get(id).type !== expectedType) {
    errors.push(diagnostic("WRONG_ID_TYPE", path, `${id} is not a ${expectedType} ID`));
  }
}

function requireIdArray(errors, byId, value, expectedType, path, { nonEmpty = true } = {}) {
  const idsValue = requireStringArray(errors, value, path, { nonEmpty });
  idsValue.forEach((id, index) => requireReference(errors, byId, id, expectedType, `${path}[${index}]`));
  return idsValue;
}

function validateArtifact(errors, artifact, root, path, { required = false } = {}) {
  if (artifact === null || artifact === undefined) {
    if (required) errors.push(diagnostic("ARTIFACT_REQUIRED", path, "requires a repository artifact"));
    return;
  }
  errors.push(...validateRepositoryReference(artifact, root, path, { artifact: true }));
}

function validateExecution(errors, execution, root, path, expectedResult) {
  if (!requireObject(errors, execution, path)) return;
  if (!/^[0-9a-f]{40}$/.test(execution.commit ?? "")) {
    errors.push(diagnostic("EXECUTION_COMMIT", `${path}.commit`, "must be a 40-character lowercase commit"));
  } else if (!repositoryCommitExists(root, execution.commit)) {
    errors.push(diagnostic("EXECUTION_COMMIT_MISSING", `${path}.commit`, "must exist in this repository"));
  }
  requireIsoDate(errors, execution.executedAt, `${path}.executedAt`);
  requireString(errors, execution.environment, `${path}.environment`);
  requireEnum(errors, execution.result, ["passed", "failed"], `${path}.result`);
  if (expectedResult && execution.result !== expectedResult) {
    errors.push(diagnostic("EXECUTION_RESULT", `${path}.result`, `must match evidence status ${expectedResult}`));
  }
  if (!EVIDENCE_REFERENCE.test(execution.immutableReference ?? "")) {
    errors.push(diagnostic("EXECUTION_REFERENCE", `${path}.immutableReference`, "must be a Trax OS Actions run/job, PR/review or commit reference"));
  }
}

function validateEvidence(errors, evidence, root, path, byId) {
  requireEnum(errors, evidence.kind, ["automated", "manual"], `${path}.kind`, "EVIDENCE_KIND");
  requireEnum(errors, evidence.scope, ["design", "control", "compatibility"], `${path}.scope`, "EVIDENCE_SCOPE");
  requireEnum(errors, evidence.status, ["planned", "available", "passed", "failed"], `${path}.status`, "EVIDENCE_STATUS");
  requireString(errors, evidence.claim, `${path}.claim`);
  requireString(errors, evidence.procedure, `${path}.procedure`);
  requireIdArray(errors, byId, evidence.coverageIds, null, `${path}.coverageIds`);
  requireReference(errors, byId, evidence.ownerId, "owners", `${path}.ownerId`);
  requireStringArray(errors, evidence.limitations, `${path}.limitations`);
  if (evidence.reopeningTriggers !== undefined) requireStringArray(errors, evidence.reopeningTriggers, `${path}.reopeningTriggers`);
  requireNullableString(errors, evidence.trackingIssue, `${path}.trackingIssue`);
  const related = requireStringArray(errors, evidence.relatedTrackingIssues ?? [], `${path}.relatedTrackingIssues`, { nonEmpty: false });
  const tracking = [evidence.trackingIssue, ...related].filter(Boolean);
  if (evidence.status === "planned" && tracking.length === 0) {
    errors.push(diagnostic("PLANNED_TRACKING", path, "planned evidence requires a tracking issue"));
  }
  tracking.forEach((url, index) => {
    if (!ISSUE_URL.test(url)) errors.push(diagnostic("TRACKING_URL", `${path}.tracking[${index}]`, "must be a Trax OS issue URL"));
  });
  validateArtifact(errors, evidence.artifact, root, `${path}.artifact`, {
    required: ["available", "passed", "failed"].includes(evidence.status),
  });
  if (["passed", "failed"].includes(evidence.status)) {
    validateExecution(errors, evidence.execution, root, `${path}.execution`, evidence.status);
  } else if (evidence.execution !== null) {
    errors.push(diagnostic("FALSE_ATTESTATION", `${path}.execution`, "planned/available evidence execution must be null"));
  }
}

function currentCodeowners(root) {
  const content = readFileSync(resolve(root, ".github/CODEOWNERS"), "utf8");
  const handles = new Set();
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    for (const token of trimmed.split(/\s+/).slice(1)) if (HANDLE.test(token)) handles.add(token);
  }
  return handles;
}

function validateApprovedReviewArtifact(errors, root, review, path) {
  const file = resolveRegularFile(errors, root, review.artifactPath, `${path}.artifactPath`);
  if (!file) return;
  const content = readFileSync(file, "utf8");
  if (/\bPending\b|not review evidence|must not be marked passed/i.test(content)) {
    errors.push(diagnostic("CLOSURE_ARTIFACT_PENDING", `${path}.artifactPath`, "approved artifact still contains pending/not-evidence language"));
  }
  const required = [
    "**Status:** Approved",
    `**Reviewer:** ${review.reviewer}`,
    `**Model version:** ${review.reviewedModelVersion}`,
    `**Reviewed commit:** ${review.reviewedCommit}`,
    `**Immutable review reference:** ${review.immutableReference}`,
    "**Risk authority:** Confirmed",
    "I explicitly confirm that the reviewer is authorized to accept the listed Phase 0 residual risks.",
    "## Review result",
  ];
  for (const token of required) {
    if (!content.includes(token)) errors.push(diagnostic("CLOSURE_ARTIFACT_BINDING", `${path}.artifactPath`, `approved artifact is missing ${token}`));
  }
  const resultSection = content.split("## Review result", 2)[1] ?? "";
  if (!/^\s*Approved\b/m.test(resultSection)) errors.push(diagnostic("CLOSURE_ARTIFACT_RESULT", `${path}.artifactPath`, "review result must explicitly be Approved"));
}

function expectedOverviewLine(boundary, threat, risk, byId) {
  return {
    title: boundary.title,
    capability: `\`${boundary.currentCapability}\``,
    threatId: `\`${threat.id}\``,
    scenario: threat.scenario,
    controls: arrayOrEmpty(threat.mitigationIds).flatMap((id) => [`\`${id}\``, byId.get(id)?.value.control]),
    evidence: arrayOrEmpty(threat.evidenceIds).flatMap((id) => [`\`${id}\``, `(${byId.get(id)?.value.status})`]),
    riskId: `\`${risk.id}\``,
    riskRating: risk.postControlRisk?.rating,
    riskDisposition: risk.disposition,
  };
}

function validateOverviewParity(errors, model, byId, root, overviewContent) {
  const path = resolveRegularFile(errors, root, model.overviewPath, "$.overviewPath");
  if (!path && overviewContent === undefined) return;
  const content = overviewContent ?? readFileSync(path, "utf8");
  const count = (name) => (Array.isArray(model[name]) ? model[name].length : 0);
  const summary = `${count("boundaries")} trust boundaries, ${count("threats")} threats, ${count("mitigations")} controls and ${count("residualRisks")} residual-risk records`;
  if (!content.includes(summary)) errors.push(diagnostic("OVERVIEW_COUNT_DRIFT", "$.overviewPath", `must contain ${summary}`));
  const lines = content.split(/\r?\n/);
  for (const domain of Array.isArray(model.domains) ? model.domains : []) {
    if (!isObject(domain)) continue;
    if (!content.includes(`### ${domain.title} (\`${domain.id}\`)`)) {
      errors.push(diagnostic("OVERVIEW_DOMAIN_DRIFT", `$.domains[${domain.id}]`, "heading/title is missing or stale"));
    }
    if (!content.includes(`Current capability: **${domain.currentCapability}**. Accountable role: \`${domain.ownerId}\`.`)) {
      errors.push(diagnostic("OVERVIEW_CAPABILITY_DRIFT", `$.domains[${domain.id}]`, "capability/owner is missing or stale"));
    }
  }
  for (const boundary of Array.isArray(model.boundaries) ? model.boundaries : []) {
    if (!isObject(boundary)) continue;
    const threatIds = arrayOrEmpty(boundary.threatIds);
    for (const [index, threatId] of threatIds.entries()) {
      const threat = byId.get(threatId)?.value;
      const risk = byId.get(threat?.residualRiskId)?.value;
      if (!isObject(threat) || !isObject(risk)) continue;
      const row = index === 0
        ? lines.find((line) => line.startsWith(`| \`${boundary.id}\` `))
        : lines.find((line) => line.startsWith(`| \`${threat.id}\` |`));
      if (!row) {
        errors.push(diagnostic("OVERVIEW_BOUNDARY_DRIFT", `$.boundaries[${boundary.id}].threatIds[${index}]`, `${index === 0 ? "primary boundary" : "additional threat"} row is missing`));
        continue;
      }
      if (index > 0 && !row.includes(`\`${boundary.id}\``)) {
        errors.push(diagnostic("OVERVIEW_BOUNDARY_DRIFT", `$.boundaries[${boundary.id}].threatIds[${index}]`, "additional threat row is not attached to this boundary"));
      }
      const expected = expectedOverviewLine(boundary, threat, risk, byId);
      for (const [field, value] of Object.entries(expected)) {
        if (index > 0 && ["title", "capability"].includes(field)) continue;
        const values = Array.isArray(value) ? value : [value];
        for (const token of values) {
          if (!isNonEmptyString(token) || !row.includes(token.replaceAll("|", "\\|"))) {
            errors.push(diagnostic("OVERVIEW_BOUNDARY_DRIFT", `$.boundaries[${boundary.id}].${field}`, `row is missing ${String(token)}`));
          }
        }
      }
    }
  }
}

function setEquals(values, expected) {
  return Array.isArray(values) && values.length === expected.size && new Set(values).size === values.length && values.every((value) => expected.has(value));
}

export function validateModel(model, { root = repositoryRoot, closure = false, overviewContent } = {}) {
  const errors = [];
  if (!requireObject(errors, model, "$")) return errors;
  for (const field of ["schemaVersion", "modelId", "modelVersion", "modelStatus", "title", "issue", "overviewPath"]) {
    requireString(errors, model[field], `$.${field}`);
  }
  if (!/^\d+\.\d+\.\d+$/.test(model.schemaVersion ?? "")) errors.push(diagnostic("SCHEMA_VERSION", "$.schemaVersion", "must be semantic version syntax"));
  if (!/^\d+\.\d+\.\d+$/.test(model.modelVersion ?? "")) errors.push(diagnostic("MODEL_VERSION", "$.modelVersion", "must be semantic version syntax"));
  if (model.modelId !== "TM-PHASE0-001") errors.push(diagnostic("MODEL_ID", "$.modelId", "must be TM-PHASE0-001"));
  requireEnum(errors, model.modelStatus, DELIVERY_STATUS, "$.modelStatus", "MODEL_STATUS");
  if (!ISSUE_URL.test(model.issue ?? "")) errors.push(diagnostic("MODEL_ISSUE", "$.issue", "must be a Trax OS issue URL"));

  const baseline = requireObject(errors, model.architectureBaseline, "$.architectureBaseline");
  if (baseline) {
    if (!/^[0-9a-f]{40}$/.test(baseline.commit ?? "")) errors.push(diagnostic("BASELINE_COMMIT", "$.architectureBaseline.commit", "must be a 40-character lowercase commit"));
    else if (!repositoryCommitExists(root, baseline.commit)) errors.push(diagnostic("BASELINE_COMMIT_MISSING", "$.architectureBaseline.commit", "must exist in this repository"));
    requireIsoDate(errors, baseline.reviewedAt, "$.architectureBaseline.reviewedAt");
    validateReferences(errors, baseline.references, root, "$.architectureBaseline.references");
  }

  const methodology = requireObject(errors, model.methodology, "$.methodology");
  if (methodology) {
    const categories = requireStringArray(errors, methodology.categories, "$.methodology.categories");
    if (!setEquals(categories, new Set(METHODOLOGY_CATEGORIES))) errors.push(diagnostic("METHODOLOGY_CATEGORIES", "$.methodology.categories", "must declare the complete supported category set exactly once"));
    for (const [name, expected] of Object.entries(RISK_VALUES)) {
      const actual = requireObject(errors, methodology[name], `$.methodology.${name}`);
      if (actual && JSON.stringify(actual) !== JSON.stringify(expected)) errors.push(diagnostic("METHODOLOGY_RUBRIC", `$.methodology.${name}`, "does not match the enforced rubric"));
    }
    const bands = requireObject(errors, methodology.ratingBands, "$.methodology.ratingBands");
    if (bands && JSON.stringify(bands) !== JSON.stringify({ low: "1-2", medium: "3-4", high: "6-8", critical: "9-12" })) errors.push(diagnostic("METHODOLOGY_RUBRIC", "$.methodology.ratingBands", "does not match the enforced rating bands"));
    requireString(errors, methodology.note, "$.methodology.note");
  }

  const authors = requireObjectArray(errors, model.authors, "$.authors");
  const authorIds = new Set();
  authors.forEach((author, index) => {
    if (!author) return;
    const path = `$.authors[${index}]`;
    if (!/^AUTH-[A-Z0-9]+(?:-[A-Z0-9]+)*$/.test(author.id ?? "")) errors.push(diagnostic("AUTHOR_ID", `${path}.id`, "must be a stable AUTH-* ID"));
    else if (authorIds.has(author.id)) errors.push(diagnostic("DUPLICATE_ID", `${path}.id`, `duplicates ${author.id}`));
    else authorIds.add(author.id);
    requireEnum(errors, author.kind, ["automation", "human"], `${path}.kind`, "AUTHOR_KIND");
    requireString(errors, author.role, `${path}.role`);
    if (author.kind === "human") {
      if (!HANDLE.test(author.handle ?? "")) errors.push(diagnostic("AUTHOR_HANDLE", `${path}.handle`, "human author requires a GitHub handle"));
    } else if (author.handle !== null) {
      errors.push(diagnostic("AUTHOR_HANDLE", `${path}.handle`, "automation author handle must be null"));
    }
  });

  const closurePolicy = requireObject(errors, model.closurePolicy, "$.closurePolicy");
  if (closurePolicy) {
    for (const field of ["requiredCodeownerReview", "reviewerMustNotBeAuthor", "explicitRiskAuthorityRequired", "futureImplementationEvidenceMayRemainPlanned"]) requireBoolean(errors, closurePolicy[field], `$.closurePolicy.${field}`);
    requireString(errors, closurePolicy.note, "$.closurePolicy.note");
  }

  const byId = entityMap(errors, model);
  const entities = Object.fromEntries(
    ENTITY_ARRAYS.map((name) => [name, Array.isArray(model[name]) ? model[name].filter(isObject) : []]),
  );
  const domainIds = new Set(entities.domains.map((entry) => entry.id));
  for (const required of REQUIRED_DOMAINS) if (!domainIds.has(required)) errors.push(diagnostic("REQUIRED_DOMAIN", "$.domains", `missing ${required}`));
  const boundaryIds = new Set(entities.boundaries.map((entry) => entry.id));
  for (const required of REQUIRED_BOUNDARIES) if (!boundaryIds.has(required)) errors.push(diagnostic("REQUIRED_BOUNDARY", "$.boundaries", `missing ${required}`));

  for (const domain of entities.domains) {
    const path = `$.domains[${domain.id}]`;
    requireString(errors, domain.title, `${path}.title`);
    requireString(errors, domain.description, `${path}.description`);
    requireEnum(errors, domain.currentCapability, CAPABILITY, `${path}.currentCapability`);
    requireReference(errors, byId, domain.ownerId, "owners", `${path}.ownerId`);
    requireIdArray(errors, byId, domain.boundaryIds, "boundaries", `${path}.boundaryIds`);
    requireStringArray(errors, domain.assumptions, `${path}.assumptions`);
    validateReferences(errors, domain.references, root, `${path}.references`);
  }

  for (const owner of entities.owners) {
    const path = `$.owners[${owner.id}]`;
    requireString(errors, owner.role, `${path}.role`);
    requireStringArray(errors, owner.accountabilities, `${path}.accountabilities`);
    requireEnum(errors, owner.status, ["proposed", "confirmed"], `${path}.status`);
    requireNullableString(errors, owner.handle, `${path}.handle`);
    if (owner.handle !== null && !HANDLE.test(owner.handle ?? "")) errors.push(diagnostic("OWNER_HANDLE", `${path}.handle`, "must be null or a GitHub handle"));
    requireBoolean(errors, owner.riskAuthority, `${path}.riskAuthority`);
    if (owner.confirmationReference !== null) validateReference(errors, owner.confirmationReference, root, `${path}.confirmationReference`);
    else if (owner.status === "confirmed") errors.push(diagnostic("OWNER_CONFIRMATION", `${path}.confirmationReference`, "confirmed owner requires a reference"));
  }

  const expectedPartial = new Set(["TB-IDENTITY-001", "TB-IDENTITY-002", "TB-ACCESS-001", "TB-ACCESS-002"]);
  for (const boundary of entities.boundaries) {
    const path = `$.boundaries[${boundary.id}]`;
    requireReference(errors, byId, boundary.domainId, "domains", `${path}.domainId`);
    requireString(errors, boundary.title, `${path}.title`);
    requireString(errors, boundary.description, `${path}.description`);
    requireEnum(errors, boundary.currentCapability, CAPABILITY, `${path}.currentCapability`);
    const expected = expectedPartial.has(boundary.id) ? "partial" : "not-implemented";
    if (boundary.currentCapability !== expected) errors.push(diagnostic("CAPABILITY_OVERCLAIM", `${path}.currentCapability`, `must be ${expected} for the current repository baseline`));
    const zones = requireStringArray(errors, boundary.trustZones, `${path}.trustZones`);
    if (zones.length < 2) errors.push(diagnostic("BOUNDARY_ZONES", `${path}.trustZones`, "requires at least two trust zones"));
    requireStringArray(errors, boundary.components, `${path}.components`);
    const flows = requireObjectArray(errors, boundary.dataFlows, `${path}.dataFlows`);
    flows.forEach((flow, index) => {
      if (!flow) return;
      for (const field of ["direction", "data", "channel", "authority"]) requireString(errors, flow[field], `${path}.dataFlows[${index}].${field}`);
    });
    requireStringArray(errors, boundary.assets, `${path}.assets`);
    requireStringArray(errors, boundary.assumptions, `${path}.assumptions`, { nonEmpty: false });
    requireIdArray(errors, byId, boundary.threatIds, "threats", `${path}.threatIds`);
    requireIdArray(errors, byId, boundary.compatibilityIds, "compatibility", `${path}.compatibilityIds`);
    validateReferences(errors, boundary.references, root, `${path}.references`);
  }

  const preconditions = new Set();
  for (const threat of entities.threats) {
    const path = `$.threats[${threat.id}]`;
    const linkedBoundaries = requireIdArray(errors, byId, threat.boundaryIds, "boundaries", `${path}.boundaryIds`);
    for (const boundaryId of linkedBoundaries) {
      if (!arrayOrEmpty(byId.get(boundaryId)?.value.threatIds).includes(threat.id)) errors.push(diagnostic("THREAT_BOUNDARY_MISMATCH", `${path}.boundaryIds`, `${boundaryId} does not link back`));
    }
    requireString(errors, threat.scenario, `${path}.scenario`);
    requireEnum(errors, threat.category, METHODOLOGY_CATEGORIES, `${path}.category`, "THREAT_CATEGORY");
    const conditions = requireStringArray(errors, threat.preconditions, `${path}.preconditions`);
    for (const condition of conditions) {
      if (preconditions.has(condition)) errors.push(diagnostic("BOILERPLATE_PRECONDITION", `${path}.preconditions`, "duplicates another threat precondition"));
      preconditions.add(condition);
    }
    requireStringArray(errors, threat.affectedAssets, `${path}.affectedAssets`);
    requireStringArray(errors, threat.securityProperties, `${path}.securityProperties`, { allowed: SECURITY_PROPERTIES });
    validateRisk(errors, threat.inherentRisk, `${path}.inherentRisk`);
    requireIdArray(errors, byId, threat.mitigationIds, "mitigations", `${path}.mitigationIds`);
    requireReference(errors, byId, threat.ownerId, "owners", `${path}.ownerId`);
    const evidenceIds = requireIdArray(errors, byId, threat.evidenceIds, "evidence", `${path}.evidenceIds`);
    for (const evidenceId of evidenceIds) {
      const coverage = arrayOrEmpty(byId.get(evidenceId)?.value.coverageIds);
      if (!coverage.includes(threat.id)) errors.push(diagnostic("EVIDENCE_COVERAGE", `${path}.evidenceIds`, `${evidenceId} does not cover ${threat.id}`));
    }
    requireReference(errors, byId, threat.residualRiskId, "residualRisks", `${path}.residualRiskId`);
    validateReferences(errors, threat.references, root, `${path}.references`);
  }

  for (const mitigation of entities.mitigations) {
    const path = `$.mitigations[${mitigation.id}]`;
    requireString(errors, mitigation.title, `${path}.title`);
    requireString(errors, mitigation.control, `${path}.control`);
    requireEnum(errors, mitigation.controlType, ["preventive", "detective", "corrective", "recovery"], `${path}.controlType`);
    requireEnum(errors, mitigation.implementationStatus, DELIVERY_STATUS, `${path}.implementationStatus`);
    requireReference(errors, byId, mitigation.ownerId, "owners", `${path}.ownerId`);
    const evidenceIds = requireIdArray(errors, byId, mitigation.evidenceIds, "evidence", `${path}.evidenceIds`);
    for (const evidenceId of evidenceIds) {
      const coverage = arrayOrEmpty(byId.get(evidenceId)?.value.coverageIds);
      if (!coverage.includes(mitigation.id)) errors.push(diagnostic("EVIDENCE_COVERAGE", `${path}.evidenceIds`, `${evidenceId} does not cover ${mitigation.id}`));
    }
    validateReferences(errors, mitigation.references, root, `${path}.references`);
    requireStringArray(errors, mitigation.limitations, `${path}.limitations`);
    requireStringArray(errors, mitigation.reopeningTriggers, `${path}.reopeningTriggers`);
    if (mitigation.implementationStatus === "validated") {
      const relatedThreats = entities.threats.filter((threat) => arrayOrEmpty(threat.mitigationIds).includes(mitigation.id));
      const relatedDomains = new Set(relatedThreats.flatMap((threat) => arrayOrEmpty(threat.boundaryIds)).map((id) => byId.get(id)?.value.domainId));
      const applicablePassed = evidenceIds.some((id) => {
        const evidence = byId.get(id)?.value;
        const coverage = new Set(arrayOrEmpty(evidence?.coverageIds));
        return evidence?.status === "passed" && evidence.scope === "control" && coverage.has(mitigation.id) && (relatedThreats.some((threat) => coverage.has(threat.id)) || [...relatedDomains].some((domain) => coverage.has(domain)));
      });
      if (!applicablePassed) errors.push(diagnostic("VALIDATED_WITHOUT_EVIDENCE", path, "validated control requires applicable passed control evidence"));
    }
    if (mitigation.implementationStatus === "integrated") {
      const related = entities.threats.filter((threat) => arrayOrEmpty(threat.mitigationIds).includes(mitigation.id));
      if (!CURRENT_INTEGRATED_CONTROLS.has(mitigation.id) || related.some((threat) => arrayOrEmpty(threat.boundaryIds).some((id) => !expectedPartial.has(id)))) {
        errors.push(diagnostic("CONTROL_OVERCLAIM", `${path}.implementationStatus`, "only the four current Personal auth/access controls may be integrated"));
      }
    }
  }

  entities.evidence.forEach((evidence, index) => validateEvidence(errors, evidence, root, `$.evidence[${index}]`, byId));

  const rationales = new Set();
  for (const risk of entities.residualRisks) {
    const path = `$.residualRisks[${risk.id}]`;
    requireReference(errors, byId, risk.threatId, "threats", `${path}.threatId`);
    requireReference(errors, byId, risk.ownerId, "owners", `${path}.ownerId`);
    validateRisk(errors, risk.postControlRisk, `${path}.postControlRisk`);
    if (requireString(errors, risk.rationale, `${path}.rationale`)) {
      if (risk.rationale.length < 180 || !risk.rationale.includes("Likelihood") || !risk.rationale.includes("Impact")) errors.push(diagnostic("RESIDUAL_RATIONALE", `${path}.rationale`, "must state remaining exposure and explain likelihood and impact"));
      if (rationales.has(risk.rationale)) errors.push(diagnostic("BOILERPLATE_RATIONALE", `${path}.rationale`, "duplicates another residual rationale"));
      rationales.add(risk.rationale);
      validateRationaleAlignment(errors, risk.rationale, risk.postControlRisk, `${path}.rationale`);
    }
    requireStringArray(errors, risk.affectedAssumptions, `${path}.affectedAssumptions`, { nonEmpty: false });
    requireEnum(errors, risk.disposition, ["pending", "accepted", "rejected", "mitigate-before-closure"], `${path}.disposition`);
    requireEnum(errors, risk.acceptanceScope, ["phase-0-design", "implemented-control"], `${path}.acceptanceScope`);
    requireStringArray(errors, risk.reopeningTriggers, `${path}.reopeningTriggers`);
    if (risk.disposition === "accepted") {
      const acceptance = requireObject(errors, risk.acceptance, `${path}.acceptance`);
      if (acceptance) for (const field of ["scope", "statement", "acceptedBy", "acceptedAt", "reviewId", "reference"]) requireString(errors, acceptance[field], `${path}.acceptance.${field}`);
    } else if (risk.acceptance !== null) errors.push(diagnostic("FALSE_RISK_ACCEPTANCE", `${path}.acceptance`, "non-accepted risk must have null acceptance"));
  }

  const compatibilityTargets = new Set(entities.compatibility.map((entry) => entry.target));
  for (const target of REQUIRED_COMPATIBILITY) if (!compatibilityTargets.has(target)) errors.push(diagnostic("REQUIRED_COMPATIBILITY", "$.compatibility", `missing ${target}`));
  for (const entry of entities.compatibility) {
    const path = `$.compatibility[${entry.id}]`;
    requireEnum(errors, entry.target, [...REQUIRED_COMPATIBILITY], `${path}.target`);
    requireString(errors, entry.currentState, `${path}.currentState`);
    requireString(errors, entry.impact, `${path}.impact`);
    requireString(errors, entry.migrationImpact, `${path}.migrationImpact`);
    requireEnum(errors, entry.status, DELIVERY_STATUS, `${path}.status`);
    requireIdArray(errors, byId, entry.affectedBoundaryIds, "boundaries", `${path}.affectedBoundaryIds`);
    validateReferences(errors, entry.references, root, `${path}.references`);
  }

  for (const review of entities.reviews) {
    const path = `$.reviews[${review.id}]`;
    requireStringArray(errors, review.reviewTypes, `${path}.reviewTypes`, { allowed: ["architecture-security", "privacy", "residual-risk"] });
    requireEnum(errors, review.status, ["pending", "approved", "changes-requested"], `${path}.status`);
    requireNullableString(errors, review.reviewer, `${path}.reviewer`);
    if (review.reviewer !== null && !HANDLE.test(review.reviewer ?? "")) errors.push(diagnostic("REVIEWER_HANDLE", `${path}.reviewer`, "must be null or a GitHub handle"));
    for (const field of ["reviewedModelVersion", "reviewedCommit", "reviewedAt", "immutableReference"]) requireNullableString(errors, review[field], `${path}.${field}`);
    if (review.reviewedModelVersion !== null && !/^\d+\.\d+\.\d+$/.test(review.reviewedModelVersion ?? "")) errors.push(diagnostic("REVIEW_VERSION", `${path}.reviewedModelVersion`, "must be null or semantic version syntax"));
    if (review.reviewedCommit !== null) {
      if (!/^[0-9a-f]{40}$/.test(review.reviewedCommit ?? "")) errors.push(diagnostic("REVIEW_COMMIT", `${path}.reviewedCommit`, "must be null or 40 lowercase hex characters"));
      else if (!repositoryCommitExists(root, review.reviewedCommit)) errors.push(diagnostic("REVIEW_COMMIT_MISSING", `${path}.reviewedCommit`, "must exist in this repository"));
    }
    if (review.reviewedAt !== null) requireIsoDate(errors, review.reviewedAt, `${path}.reviewedAt`);
    if (review.immutableReference !== null && !REVIEW_REFERENCE.test(review.immutableReference ?? "")) errors.push(diagnostic("REVIEW_REFERENCE", `${path}.immutableReference`, "must be null or an immutable Trax OS pull-request review reference"));
    requireString(errors, review.artifactPath, `${path}.artifactPath`);
    resolveRegularFile(errors, root, review.artifactPath, `${path}.artifactPath`);
    requireStringArray(errors, review.coveredResidualRiskIds, `${path}.coveredResidualRiskIds`, { nonEmpty: false }).forEach((id, index) => requireReference(errors, byId, id, "residualRisks", `${path}.coveredResidualRiskIds[${index}]`));
    requireBoolean(errors, review.riskAuthorityConfirmed, `${path}.riskAuthorityConfirmed`);
  }

  requireIdArray(errors, byId, model.designEvidenceIds, "evidence", "$.designEvidenceIds");

  const used = {
    owners: new Set(), boundaries: new Set(), threats: new Set(), mitigations: new Set(),
    evidence: new Set(arrayOrEmpty(model.designEvidenceIds)), residualRisks: new Set(), compatibility: new Set(),
  };
  for (const domain of entities.domains) {
    used.owners.add(domain.ownerId);
    for (const id of arrayOrEmpty(domain.boundaryIds)) {
      used.boundaries.add(id);
      if (byId.get(id)?.value.domainId !== domain.id) errors.push(diagnostic("DOMAIN_BOUNDARY_MISMATCH", `$.domains[${domain.id}]`, `${id} belongs to ${byId.get(id)?.value.domainId}`));
    }
  }
  for (const boundary of entities.boundaries) {
    for (const id of arrayOrEmpty(boundary.threatIds)) {
      used.threats.add(id);
      if (!arrayOrEmpty(byId.get(id)?.value.boundaryIds).includes(boundary.id)) errors.push(diagnostic("BOUNDARY_THREAT_MISMATCH", `$.boundaries[${boundary.id}]`, `${id} does not link back`));
    }
    for (const id of arrayOrEmpty(boundary.compatibilityIds)) used.compatibility.add(id);
  }
  for (const threat of entities.threats) {
    used.owners.add(threat.ownerId);
    for (const id of arrayOrEmpty(threat.mitigationIds)) used.mitigations.add(id);
    for (const id of arrayOrEmpty(threat.evidenceIds)) used.evidence.add(id);
    used.residualRisks.add(threat.residualRiskId);
    if (byId.get(threat.residualRiskId)?.value.threatId !== threat.id) errors.push(diagnostic("THREAT_RISK_MISMATCH", `$.threats[${threat.id}]`, `${threat.residualRiskId} does not link back`));
  }
  for (const mitigation of entities.mitigations) {
    used.owners.add(mitigation.ownerId);
    for (const id of arrayOrEmpty(mitigation.evidenceIds)) used.evidence.add(id);
  }
  for (const evidence of entities.evidence) used.owners.add(evidence.ownerId);
  for (const risk of entities.residualRisks) used.owners.add(risk.ownerId);
  for (const [type, referenced] of Object.entries(used)) for (const item of entities[type]) if (!referenced.has(item.id)) errors.push(diagnostic("ORPHAN_ID", `$.${type}[${item.id}]`, "is not referenced by the model"));

  const usedCategories = new Set(entities.threats.map((threat) => threat.category));
  for (const category of METHODOLOGY_CATEGORIES) if (!usedCategories.has(category)) errors.push(diagnostic("METHODOLOGY_COVERAGE", "$.threats", `no threat covers ${category}`));
  for (const { value, path } of collectStrings(model)) if (PLACEHOLDER.test(value)) errors.push(diagnostic("PLACEHOLDER", path, "contains a placeholder"));

  validateOverviewParity(errors, model, byId, root, overviewContent);

  if (closure) {
    if (model.modelStatus !== "validated") errors.push(diagnostic("CLOSURE_STATUS", "$.modelStatus", "closure requires validated status"));
    if (entities.reviews.some((review) => review.status === "changes-requested")) errors.push(diagnostic("CLOSURE_OPEN_FINDINGS", "$.reviews", "changes-requested review remains open"));
    if (entities.evidence.some((evidence) => evidence.status === "failed")) errors.push(diagnostic("CLOSURE_FAILED_EVIDENCE", "$.evidence", "failed evidence remains open"));
    for (const owner of entities.owners) {
      if (owner.id === "OWN-REPOSITORY-REVIEW") continue;
      if (owner.status !== "confirmed" || !HANDLE.test(owner.handle ?? "") || owner.riskAuthority !== true) errors.push(diagnostic("CLOSURE_OWNER", `$.owners[${owner.id}]`, "requires confirmed named owner with riskAuthority === true"));
    }
    for (const risk of entities.residualRisks) {
      if (risk.disposition !== "accepted" || !isObject(risk.acceptance)) {
        errors.push(diagnostic("CLOSURE_RISK", `$.residualRisks[${risk.id}]`, "must be explicitly accepted"));
      }
    }
    const approved = entities.reviews.filter((review) => review.status === "approved");
    if (approved.length !== 1) {
      errors.push(diagnostic("CLOSURE_REVIEW", "$.reviews", "closure requires exactly one approved review"));
    } else {
      const review = approved[0];
      const path = `$.reviews[${review.id}]`;
      const allRiskIds = new Set(entities.residualRisks.map((risk) => risk.id));
      const codeowners = currentCodeowners(root);
      const humanAuthors = new Set(authors.filter((author) => author?.kind === "human" && author.handle !== null).map((author) => author.handle));
      if (!codeowners.has(review.reviewer)) errors.push(diagnostic("CLOSURE_CODEOWNER", `${path}.reviewer`, "must be a current CODEOWNER"));
      if (humanAuthors.has(review.reviewer)) errors.push(diagnostic("CLOSURE_SELF_REVIEW", `${path}.reviewer`, "reviewer cannot be a named human author"));
      if (review.riskAuthorityConfirmed !== true) errors.push(diagnostic("CLOSURE_AUTHORITY", `${path}.riskAuthorityConfirmed`, "must be exactly true"));
      if (review.reviewedModelVersion !== model.modelVersion) errors.push(diagnostic("CLOSURE_VERSION_BINDING", `${path}.reviewedModelVersion`, "must equal modelVersion"));
      let reviewedSnapshot = null;
      if (!/^[0-9a-f]{40}$/.test(review.reviewedCommit ?? "")) {
        errors.push(diagnostic("CLOSURE_COMMIT", `${path}.reviewedCommit`, "must be 40 lowercase hex characters"));
      } else if (!repositoryCommitExists(root, review.reviewedCommit)) {
        errors.push(diagnostic("CLOSURE_COMMIT_MISSING", `${path}.reviewedCommit`, "must exist in this repository"));
      } else {
        const loaded = loadModelAtCommit(root, review.reviewedCommit, "docs/security/phase-0-threat-model.json");
        if (loaded.error) {
          errors.push(diagnostic("CLOSURE_SNAPSHOT_MISSING", `${path}.reviewedCommit`, loaded.error));
        } else {
          reviewedSnapshot = loaded.model;
          if (reviewedSnapshot.modelVersion !== review.reviewedModelVersion) errors.push(diagnostic("CLOSURE_SNAPSHOT_VERSION", `${path}.reviewedCommit`, "snapshot modelVersion does not match approved review"));
          if (stableJson(immutableDesignSubject(reviewedSnapshot)) !== stableJson(immutableDesignSubject(model))) errors.push(diagnostic("CLOSURE_SNAPSHOT_DRIFT", `${path}.reviewedCommit`, "current immutable design subject differs from the reviewed snapshot"));
        }
      }
      requireIsoDate(errors, review.reviewedAt, `${path}.reviewedAt`);
      if (!REVIEW_REFERENCE.test(review.immutableReference ?? "")) errors.push(diagnostic("CLOSURE_REFERENCE", `${path}.immutableReference`, "must be an immutable Trax OS pull-request review reference"));
      if (!setEquals(review.reviewTypes ?? [], new Set(["architecture-security", "privacy", "residual-risk"]))) errors.push(diagnostic("CLOSURE_REVIEW_TYPES", `${path}.reviewTypes`, "must exactly cover architecture-security, privacy and residual-risk"));
      if (!setEquals(review.coveredResidualRiskIds ?? [], allRiskIds)) errors.push(diagnostic("CLOSURE_RISK_COVERAGE", `${path}.coveredResidualRiskIds`, "must exactly cover every residual risk once"));
      validateApprovedReviewArtifact(errors, root, review, path);
      for (const risk of entities.residualRisks) {
        const riskPath = `$.residualRisks[${risk.id}]`;
        if (risk.disposition !== "accepted" || !isObject(risk.acceptance)) continue;
        const expected = {
          scope: risk.acceptanceScope,
          acceptedBy: review.reviewer,
          acceptedAt: review.reviewedAt,
          reviewId: review.id,
          reference: review.immutableReference,
        };
        for (const [field, value] of Object.entries(expected)) if (risk.acceptance[field] !== value) errors.push(diagnostic("CLOSURE_RISK_BINDING", `${riskPath}.acceptance.${field}`, `must equal approved review value ${String(value)}`));
        requireString(errors, risk.acceptance.statement, `${riskPath}.acceptance.statement`);
      }
      const manual = entities.evidence.find((evidence) => evidence.id === "EV-PHASE0-REVIEW");
      const manualCoverage = new Set([
        model.modelId,
        ...entities.domains.map((entry) => entry.id),
        ...entities.owners.map((entry) => entry.id),
        ...entities.boundaries.map((entry) => entry.id),
        ...entities.threats.map((entry) => entry.id),
        ...entities.mitigations.map((entry) => entry.id),
        ...entities.evidence.map((entry) => entry.id),
        ...entities.residualRisks.map((entry) => entry.id),
        ...entities.compatibility.map((entry) => entry.id),
      ]);
      if (manual?.kind !== "manual" || manual?.status !== "passed") {
        errors.push(diagnostic("CLOSURE_EVIDENCE", "$.evidence[EV-PHASE0-REVIEW]", "must be passed manual evidence"));
      } else {
        if (!setEquals(manual.coverageIds, manualCoverage)) errors.push(diagnostic("CLOSURE_EVIDENCE_COVERAGE", "$.evidence[EV-PHASE0-REVIEW].coverageIds", "must exactly cover model, domains, owners, boundaries, threats, controls, evidence, residual risks and compatibility"));
        if (manual.artifact?.path !== review.artifactPath) errors.push(diagnostic("CLOSURE_EVIDENCE_BINDING", "$.evidence[EV-PHASE0-REVIEW].artifact.path", "must equal review artifactPath"));
        const binding = { commit: review.reviewedCommit, executedAt: review.reviewedAt, immutableReference: review.immutableReference, result: "passed" };
        for (const [field, value] of Object.entries(binding)) if (manual.execution?.[field] !== value) errors.push(diagnostic("CLOSURE_EVIDENCE_BINDING", `$.evidence[EV-PHASE0-REVIEW].execution.${field}`, `must equal approved review value ${String(value)}`));
      }
    }
  }

  return errors.sort((left, right) =>
    `${left.path}:${left.code}:${left.message}`.localeCompare(`${right.path}:${right.code}:${right.message}`),
  );
}

export function formatDiagnostics(errors, source = "phase-0-threat-model.json") {
  return errors.map((error) => `${source}: ${error.code}: ${error.path}: ${error.message}`).join("\n");
}

export function loadModel(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function runCli() {
  const args = process.argv.slice(2);
  const closure = args.includes("--closure");
  const positional = args.filter((arg) => arg !== "--closure");
  if (positional.length !== 1) {
    console.error("Usage: node scripts/check-threat-model.mjs <register.json> [--closure]");
    process.exitCode = 2;
    return;
  }
  const input = resolve(process.cwd(), positional[0]);
  let model;
  try {
    model = loadModel(input);
  } catch (error) {
    console.error(`Unable to read threat model: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  const errors = validateModel(model, { closure });
  if (errors.length > 0) {
    console.error(formatDiagnostics(errors, positional[0]));
    process.exitCode = 1;
    return;
  }
  console.log(`Threat model ${model.modelId} ${model.modelVersion} is structurally complete${closure ? " and closure-ready" : ""}.`);
}

if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) runCli();
