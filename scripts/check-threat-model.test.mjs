import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";

import {
  loadModel,
  repositoryRoot,
  validateModel,
  validateRepositoryReference,
} from "./check-threat-model.mjs";

const registerPath = join(repositoryRoot, "docs/security/phase-0-threat-model.json");
const overviewPath = join(repositoryRoot, "docs/security/PHASE_0_THREAT_MODEL.md");
const base = loadModel(registerPath);
const baseOverview = readFileSync(overviewPath, "utf8");
const clone = () => structuredClone(base);
const diagnostics = (model, options = {}) => validateModel(model, { root: repositoryRoot, ...options });
const codes = (model, options = {}) => new Set(diagnostics(model, options).map((error) => error.code));

function assertCode(model, code, options = {}) {
  const actual = diagnostics(model, options);
  assert.ok(actual.some((entry) => entry.code === code), `expected ${code}; got ${actual.map((entry) => entry.code).join(", ")}`);
}

function validExecution(result = "passed") {
  return {
    commit: base.architectureBaseline.commit,
    executedAt: "2026-08-03",
    environment: "node:test synthetic fixture",
    result,
    immutableReference: "https://github.com/aXeTech-NL/Trax-OS/actions/runs/999",
  };
}

function git(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function collectRepositoryPaths(value, paths = new Set()) {
  if (Array.isArray(value)) value.forEach((entry) => collectRepositoryPaths(entry, paths));
  else if (value && typeof value === "object") {
    if (value.kind === "repository" && typeof value.path === "string") paths.add(value.path);
    Object.values(value).forEach((entry) => collectRepositoryPaths(entry, paths));
  }
  return paths;
}

function createReviewedRepository() {
  const root = mkdtempSync(join(tmpdir(), "trax-reviewed-model-"));
  git(root, ["init", "-q"]);
  git(root, ["config", "user.name", "Threat Model Test"]);
  git(root, ["config", "user.email", "threat-model-test@example.invalid"]);
  const snapshot = clone();
  const paths = collectRepositoryPaths(snapshot);
  paths.add(snapshot.overviewPath);
  paths.add(snapshot.reviews[0].artifactPath);
  paths.add(".github/CODEOWNERS");
  for (const relativePath of paths) {
    const source = join(repositoryRoot, relativePath);
    const destination = join(root, relativePath);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(source, destination);
  }
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "fixture reference files"]);
  const baselineCommit = git(root, ["rev-parse", "HEAD"]);
  snapshot.architectureBaseline.commit = baselineCommit;
  const modelPath = join(root, "docs/security/phase-0-threat-model.json");
  mkdirSync(dirname(modelPath), { recursive: true });
  writeFileSync(modelPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  git(root, ["add", "docs/security/phase-0-threat-model.json"]);
  git(root, ["commit", "-q", "-m", "reviewed threat model"]);
  const reviewedCommit = git(root, ["rev-parse", "HEAD"]);

  const model = structuredClone(snapshot);
  const reviewer = "@Maurice-aXeTech";
  const reference = "https://github.com/aXeTech-NL/Trax-OS/pull/999#pullrequestreview-1";
  model.modelStatus = "validated";
  for (const owner of model.owners) {
    if (owner.id === "OWN-REPOSITORY-REVIEW") continue;
    owner.status = "confirmed";
    owner.handle = reviewer;
    owner.riskAuthority = true;
    owner.confirmationReference = { kind: "repository", path: ".github/CODEOWNERS" };
  }
  Object.assign(model.reviews[0], {
    status: "approved",
    reviewer,
    reviewedModelVersion: model.modelVersion,
    reviewedCommit,
    reviewedAt: "2026-08-03",
    immutableReference: reference,
    coveredResidualRiskIds: model.residualRisks.map((risk) => risk.id),
    riskAuthorityConfirmed: true,
  });
  for (const risk of model.residualRisks) {
    risk.disposition = "accepted";
    risk.acceptance = {
      scope: risk.acceptanceScope,
      statement: "Synthetic node:test acceptance only; never repository review evidence.",
      acceptedBy: reviewer,
      acceptedAt: "2026-08-03",
      reviewId: model.reviews[0].id,
      reference,
    };
  }
  const manual = model.evidence.find((item) => item.id === "EV-PHASE0-REVIEW");
  manual.status = "passed";
  manual.execution = {
    commit: reviewedCommit,
    executedAt: "2026-08-03",
    environment: "synthetic temporary git fixture",
    result: "passed",
    immutableReference: reference,
  };
  writeFileSync(
    join(root, model.reviews[0].artifactPath),
    [
      "# Phase 0 Threat Model Review",
      "",
      "**Status:** Approved",
      `**Reviewer:** ${reviewer}`,
      `**Model version:** ${model.modelVersion}`,
      `**Reviewed commit:** ${reviewedCommit}`,
      `**Immutable review reference:** ${reference}`,
      "**Risk authority:** Confirmed",
      "I explicitly confirm that the reviewer is authorized to accept the listed Phase 0 residual risks.",
      "",
      "## Review result",
      "",
      "Approved after architecture-security, privacy and residual-risk review.",
      "",
    ].join("\n"),
  );
  return { root, model, reviewedCommit };
}

const reviewedRepository = createReviewedRepository();
after(() => rmSync(reviewedRepository.root, { recursive: true, force: true }));

function closureFixture() {
  return structuredClone(reviewedRepository.model);
}

function closureOptions() {
  return { root: reviewedRepository.root, closure: true, overviewContent: acceptedOverview() };
}

function acceptedOverview() {
  return baseOverview.replaceAll(
    "; pending explicit Phase 0 acceptance",
    "; accepted explicit Phase 0 acceptance",
  );
}

test("production register passes normal validation", () => {
  assert.deepEqual(diagnostics(clone()), []);
});

test("production register has the expanded complete inventory", () => {
  assert.equal(base.domains.length, 7);
  assert.equal(base.boundaries.length, 43);
  assert.equal(base.threats.length, 48);
  assert.equal(base.mitigations.length, 49);
  assert.equal(base.residualRisks.length, 48);
  assert.deepEqual(
    new Set(base.threats.map((threat) => threat.category)),
    new Set(base.methodology.categories),
  );
});

test("missing required domains and granular boundaries fail", () => {
  const domain = clone();
  domain.domains = domain.domains.filter((entry) => entry.id !== "DOM-SYNC");
  assertCode(domain, "REQUIRED_DOMAIN");

  const boundary = clone();
  boundary.boundaries = boundary.boundaries.filter((entry) => entry.id !== "TB-IDENTITY-005");
  assertCode(boundary, "REQUIRED_BOUNDARY");
});

test("null entity arrays and nested null objects diagnose without throwing", () => {
  for (const [field, value, code] of [
    ["domains", null, "REQUIRED_ARRAY"],
    ["threats", [null], "ARRAY_OBJECT"],
    ["methodology", null, "REQUIRED_OBJECT"],
    ["architectureBaseline", null, "REQUIRED_OBJECT"],
  ]) {
    const model = clone();
    model[field] = value;
    assert.doesNotThrow(() => diagnostics(model));
    assertCode(model, code);
  }

  const flow = clone();
  flow.boundaries[0].dataFlows = [null];
  assert.doesNotThrow(() => diagnostics(flow));
  assertCode(flow, "ARRAY_OBJECT");

  const reference = clone();
  reference.boundaries[0].references = [null];
  assert.doesNotThrow(() => diagnostics(reference));
  assertCode(reference, "ARRAY_OBJECT");
});

test("malformed threat, risk, boundary and design-evidence values never throw", () => {
  const cases = [
    (model) => { model.threats[0].mitigationIds = null; },
    (model) => { model.threats[0].evidenceIds = null; },
    (model) => { model.residualRisks[0].postControlRisk = null; },
    (model) => { model.boundaries[0].title = null; },
    (model) => { model.designEvidenceIds = null; },
  ];
  for (const mutate of cases) {
    const model = clone();
    mutate(model);
    assert.doesNotThrow(() => diagnostics(model));
    assert.ok(diagnostics(model).length > 0);
  }
});

test("numeric and object entity-array values always diagnose without throwing", () => {
  for (const field of [
    "domains",
    "owners",
    "boundaries",
    "threats",
    "mitigations",
    "evidence",
    "residualRisks",
    "compatibility",
    "reviews",
  ]) {
    for (const value of [0, {}]) {
      const model = clone();
      model[field] = value;
      assert.doesNotThrow(() => diagnostics(model), `${field}=${JSON.stringify(value)}`);
      assert.ok(diagnostics(model).length > 0, `${field} must diagnose`);
    }
  }
});

test("numeric and object nested ID arrays always diagnose without throwing", () => {
  const mutations = [
    (model, value) => { model.domains[0].boundaryIds = value; },
    (model, value) => { model.boundaries[0].threatIds = value; },
    (model, value) => { model.boundaries[0].compatibilityIds = value; },
    (model, value) => { model.threats[0].boundaryIds = value; },
    (model, value) => { model.threats[0].mitigationIds = value; },
    (model, value) => { model.threats[0].evidenceIds = value; },
    (model, value) => { model.mitigations[0].evidenceIds = value; },
    (model, value) => { model.evidence[0].coverageIds = value; },
    (model, value) => { model.compatibility[0].affectedBoundaryIds = value; },
    (model, value) => { model.reviews[0].coveredResidualRiskIds = value; },
    (model, value) => { model.designEvidenceIds = value; },
  ];
  for (const [index, mutate] of mutations.entries()) {
    for (const value of [0, {}]) {
      const model = clone();
      mutate(model, value);
      assert.doesNotThrow(() => diagnostics(model), `mutation ${index} value ${JSON.stringify(value)}`);
      assert.ok(diagnostics(model).length > 0, `mutation ${index} must diagnose`);
    }
  }
});

test("top-level version, status, baseline date/references and methodology are typed", () => {
  const version = clone();
  version.modelVersion = null;
  assertCode(version, "MODEL_VERSION");

  const status = clone();
  status.modelStatus = "complete";
  assertCode(status, "MODEL_STATUS");

  const date = clone();
  date.architectureBaseline.reviewedAt = "2026-02-31";
  assertCode(date, "ISO_DATE");

  const references = clone();
  references.architectureBaseline.references = [];
  assertCode(references, "REQUIRED_ARRAY");

  const rubric = clone();
  rubric.methodology.likelihood.possible = 7;
  assertCode(rubric, "METHODOLOGY_RUBRIC");
});

test("author list is non-empty and typed", () => {
  const empty = clone();
  empty.authors = [];
  assertCode(empty, "REQUIRED_ARRAY");

  const nullAuthor = clone();
  nullAuthor.authors = [null];
  assertCode(nullAuthor, "ARRAY_OBJECT");

  const automation = clone();
  automation.authors[0].handle = "@bot";
  assertCode(automation, "AUTHOR_HANDLE");

  const human = clone();
  human.authors = [{ id: "AUTH-HUMAN-001", kind: "human", handle: null, role: "author" }];
  assertCode(human, "AUTHOR_HANDLE");
});

test("stable per-entity ID patterns and duplicate IDs are enforced", () => {
  const pattern = clone();
  pattern.threats[0].id = "threat one";
  assertCode(pattern, "ENTITY_ID_PATTERN");

  const duplicate = clone();
  duplicate.boundaries[1].id = duplicate.boundaries[0].id;
  assertCode(duplicate, "DUPLICATE_ID");
});

test("boundary data-flow, assets, compatibility and reference fields are typed", () => {
  const model = clone();
  model.boundaries[0].dataFlows[0].authority = null;
  model.boundaries[0].assets = [null];
  model.boundaries[0].compatibilityIds = [null];
  assertCode(model, "REQUIRED_STRING");
  assertCode(model, "ARRAY_STRING");
});

test("unknown reference kinds, malformed artifacts, directories and selectors fail", () => {
  const kind = clone();
  kind.architectureBaseline.references[0].kind = "web";
  assertCode(kind, "REFERENCE_KIND");

  const artifact = clone();
  const current = artifact.evidence.find((entry) => entry.id === "EV-IDENTITY-CURRENT");
  current.artifact.kind = "issue-or-review";
  assertCode(artifact, "REFERENCE_KIND");

  const directory = clone();
  directory.evidence.find((entry) => entry.id === "EV-IDENTITY-CURRENT").artifact.path = ".github";
  assertCode(directory, "REFERENCE_NOT_FILE");

  const selector = clone();
  selector.evidence.find((entry) => entry.id === "EV-IDENTITY-CURRENT").artifact.selector = "";
  assertCode(selector, "ARTIFACT_SELECTOR");
});

test("missing paths, anchors, selectors, traversal and symlink escapes fail", () => {
  const missing = clone();
  missing.architectureBaseline.references[0].path = "docs/architecture/MISSING.md";
  assertCode(missing, "REFERENCE_MISSING");

  const anchor = clone();
  anchor.architectureBaseline.references[0].anchor = "missing-anchor";
  assertCode(anchor, "REFERENCE_ANCHOR");

  const selector = clone();
  selector.evidence.find((entry) => entry.id === "EV-IDENTITY-CURRENT").artifact.selector = "def test_missing";
  assertCode(selector, "REFERENCE_SELECTOR");

  for (const path of ["/etc/passwd", "../outside"] ) {
    const traversal = clone();
    traversal.architectureBaseline.references[0].path = path;
    assertCode(traversal, "REFERENCE_TRAVERSAL");
  }

  const root = mkdtempSync(join(tmpdir(), "trax-threat-model-"));
  const outside = mkdtempSync(join(tmpdir(), "trax-threat-model-outside-"));
  try {
    writeFileSync(join(outside, "secret.txt"), "not in repository");
    symlinkSync(join(outside, "secret.txt"), join(root, "escape.txt"));
    const errors = validateRepositoryReference({ kind: "repository", path: "escape.txt" }, root, "$.test");
    assert.ok(errors.some((error) => error.code === "REFERENCE_SYMLINK_ESCAPE"));
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("threat links require mitigation, owner, evidence, residual risk and reverse boundary linkage", () => {
  for (const [field, value, code] of [
    ["mitigationIds", [], "REQUIRED_ARRAY"],
    ["ownerId", "OWN-MISSING", "DANGLING_ID"],
    ["evidenceIds", [], "REQUIRED_ARRAY"],
    ["residualRiskId", "RR-MISSING", "DANGLING_ID"],
  ]) {
    const model = clone();
    model.threats[0][field] = value;
    assertCode(model, code);
  }

  const reverse = clone();
  const threat = reverse.threats[0];
  reverse.boundaries.find((boundary) => boundary.id === threat.boundaryIds[0]).threatIds = [];
  assertCode(reverse, "THREAT_BOUNDARY_MISMATCH");
});

test("evidence must cover linked threats and mitigations", () => {
  const threat = clone();
  const evidence = threat.evidence.find((entry) => entry.id === threat.threats[0].evidenceIds[0]);
  evidence.coverageIds = evidence.coverageIds.filter((id) => id !== threat.threats[0].id);
  assertCode(threat, "EVIDENCE_COVERAGE");

  const mitigation = clone();
  const item = mitigation.mitigations[0];
  const linked = mitigation.evidence.find((entry) => entry.id === item.evidenceIds[0]);
  linked.coverageIds = linked.coverageIds.filter((id) => id !== item.id);
  assertCode(mitigation, "EVIDENCE_COVERAGE");
});

test("validated mitigations require applicable passed control evidence", () => {
  const designEvidence = closureFixture();
  const mitigation = designEvidence.mitigations.find((item) => item.id === "MIT-IDENTITY-001");
  mitigation.implementationStatus = "validated";
  mitigation.evidenceIds = ["EV-PHASE0-REVIEW"];
  assertCode(designEvidence, "VALIDATED_WITHOUT_EVIDENCE", { overviewContent: acceptedOverview() });

  const planned = clone();
  planned.mitigations.find((item) => item.id === "MIT-IDENTITY-006").implementationStatus = "validated";
  assertCode(planned, "VALIDATED_WITHOUT_EVIDENCE");
});

test("current capability and integrated-control status cannot overclaim future work", () => {
  const boundary = clone();
  boundary.boundaries.find((item) => item.id === "TB-IDENTITY-003").currentCapability = "partial";
  assertCode(boundary, "CAPABILITY_OVERCLAIM");

  const control = clone();
  control.mitigations.find((item) => item.id === "MIT-IDENTITY-006").implementationStatus = "integrated";
  assertCode(control, "CONTROL_OVERCLAIM");
});

test("current identity controls remain narrow and future controls remain designed", () => {
  const control = Object.fromEntries(base.mitigations.map((item) => [item.id, item]));
  assert.equal(control["MIT-IDENTITY-001"].implementationStatus, "integrated");
  assert.doesNotMatch(control["MIT-IDENTITY-001"].control, /rate limit|rotation|device inventory|security-event audit/i);
  assert.equal(control["MIT-IDENTITY-002"].implementationStatus, "integrated");
  assert.doesNotMatch(control["MIT-IDENTITY-002"].control, /rotation|device inventory|security-event audit/i);
  assert.equal(control["MIT-IDENTITY-005"].implementationStatus, "designed");
  assert.equal(control["MIT-IDENTITY-006"].implementationStatus, "designed");
});

test("risk calculation, specific preconditions and residual rationale are enforced", () => {
  const risk = clone();
  risk.threats[0].inherentRisk.score = 1;
  assertCode(risk, "RISK_CALCULATION");

  const conditions = clone();
  conditions.threats[1].preconditions = [...conditions.threats[0].preconditions];
  assertCode(conditions, "BOILERPLATE_PRECONDITION");

  const rationale = clone();
  rationale.residualRisks[1].rationale = rationale.residualRisks[0].rationale;
  assertCode(rationale, "BOILERPLATE_RATIONALE");

  const vague = clone();
  vague.residualRisks[0].rationale = "Some risk remains.";
  assertCode(vague, "RESIDUAL_RATIONALE");

  const contradiction = clone();
  contradiction.residualRisks.find((item) => item.id === "RR-SYNC-003").rationale = contradiction.residualRisks.find((item) => item.id === "RR-SYNC-003").rationale.replace("Impact falls from critical to severe", "Impact falls from critical to serious");
  assertCode(contradiction, "RATIONALE_RISK_CONTRADICTION");
});

test("every declared methodology category requires an actual threat", () => {
  const model = clone();
  for (const threat of model.threats) if (threat.category === "repudiation") threat.category = "abuse";
  assertCode(model, "METHODOLOGY_COVERAGE");
});

test("planned evidence mapping contains the accepted owning issues and granular coverage", () => {
  const expected = {
    "EV-IDENTITY-PLANNED": [18, 19, 27, 21, 23, 59, 63],
    "EV-ACCESS-PLANNED": [20, 21, 23, 26, 27, 56, 59],
    "EV-NATIVE-PLANNED": [9, 40, 42, 49],
    "EV-SYNC-PLANNED": [8, 40, 45, 46, 49, 63],
    "EV-DOCUMENTS-PLANNED": [41, 42, 43, 44, 63, 65],
    "EV-ATLAS-MCP-PLANNED": [50, 51, 52, 53, 54, 63],
    "EV-SELF-HOSTING-PLANNED": [16, 60, 61, 62, 63, 65, 67],
    "EV-NOTIFICATION-PLANNED": [48, 18, 27],
  };
  for (const [id, issues] of Object.entries(expected)) {
    const evidence = base.evidence.find((entry) => entry.id === id);
    const urls = [evidence.trackingIssue, ...evidence.relatedTrackingIssues];
    assert.deepEqual(urls, issues.map((number) => `https://github.com/aXeTech-NL/Trax-OS/issues/${number}`));
    assert.ok(evidence.coverageIds.some((value) => value.startsWith("TB-")));
    assert.ok(evidence.coverageIds.some((value) => value.startsWith("TH-")));
    assert.ok(evidence.coverageIds.some((value) => value.startsWith("MIT-")));
    assert.equal(evidence.status, "planned");
  }
});

test("planned evidence records capacity, notification and missing implementation gates truthfully", () => {
  const documents = base.evidence.find((entry) => entry.id === "EV-DOCUMENTS-PLANNED");
  assert.match(documents.limitations.join(" "), /#41 and #44 own document metadata and lifecycle/);
  assert.match(documents.limitations.join(" "), /No standalone issue currently owns central binary/);
  assert.ok(documents.reopeningTriggers.some((entry) => entry.includes("dedicated central binary")));

  const selfHosting = base.evidence.find((entry) => entry.id === "EV-SELF-HOSTING-PLANNED");
  assert.match(selfHosting.limitations.join(" "), /no dedicated implementation issue for the complete cancellation\/export\/hold lifecycle/i);
  assert.ok(selfHosting.relatedTrackingIssues.some((url) => url.endsWith("/61")));
  assert.ok(selfHosting.relatedTrackingIssues.some((url) => url.endsWith("/65")));

  const notification = base.evidence.find((entry) => entry.id === "EV-NOTIFICATION-PLANNED");
  assert.deepEqual(
    [notification.trackingIssue, ...notification.relatedTrackingIssues].map((url) => Number(url.split("/").at(-1))),
    [48, 18, 27],
  );
  for (const id of ["EV-IDENTITY-PLANNED", "EV-SYNC-PLANNED", "EV-DOCUMENTS-PLANNED", "EV-ATLAS-MCP-PLANNED", "EV-SELF-HOSTING-PLANNED"]) {
    const evidence = base.evidence.find((entry) => entry.id === id);
    assert.ok([evidence.trackingIssue, ...evidence.relatedTrackingIssues].some((url) => url.endsWith("/63")), `${id} must link #63`);
  }
});

test("telemetry boundary requires separation, redaction and non-essential opt-out", () => {
  const boundary = base.boundaries.find((entry) => entry.id === "TB-SELF-HOSTING-008");
  const threat = base.threats.find((entry) => entry.id === "TH-SELF-HOSTING-008");
  const control = base.mitigations.find((entry) => entry.id === "MIT-SELF-HOSTING-011");
  assert.ok(boundary.assets.includes("non-essential telemetry consent and opt-out state"));
  assert.match(boundary.assumptions.join(" "), /clear user\/operator opt-out/);
  assert.match(threat.scenario, /opt-out/);
  assert.match(control.control, /non-essential telemetry opt-out/);
});

test("current evidence procedures are exact runnable no-coverage commands", () => {
  assert.equal(
    base.evidence.find((entry) => entry.id === "EV-IDENTITY-CURRENT").procedure,
    "uv run --project apps/api pytest apps/api/tests/test_server_backed.py -k authentication_session_csrf_login_and_logout --no-cov",
  );
  assert.equal(
    base.evidence.find((entry) => entry.id === "EV-ACCESS-CURRENT").procedure,
    "uv run --project apps/api pytest apps/api/tests/test_server_backed.py -k workspace_isolation_and_privacy_neutral_not_found --no-cov",
  );
});

test("passed executions require real commits, ISO dates, matching result and repository references", () => {
  const missingCommit = clone();
  const evidence = missingCommit.evidence.find((entry) => entry.id === "EV-IDENTITY-CURRENT");
  evidence.status = "passed";
  evidence.execution = { ...validExecution(), commit: "f".repeat(40) };
  assertCode(missingCommit, "EXECUTION_COMMIT_MISSING");

  const date = clone();
  const dateEvidence = date.evidence.find((entry) => entry.id === "EV-IDENTITY-CURRENT");
  dateEvidence.status = "passed";
  dateEvidence.execution = { ...validExecution(), executedAt: "2026-02-31" };
  assertCode(date, "ISO_DATE");

  const reference = clone();
  const referenceEvidence = reference.evidence.find((entry) => entry.id === "EV-IDENTITY-CURRENT");
  referenceEvidence.status = "passed";
  referenceEvidence.execution = { ...validExecution(), immutableReference: "https://attacker.invalid/run" };
  assertCode(reference, "EXECUTION_REFERENCE");

  const mismatch = clone();
  const mismatchEvidence = mismatch.evidence.find((entry) => entry.id === "EV-IDENTITY-CURRENT");
  mismatchEvidence.status = "passed";
  mismatchEvidence.execution = validExecution("failed");
  assertCode(mismatch, "EXECUTION_RESULT");
});

test("planned or available evidence cannot forge execution attestations", () => {
  const model = clone();
  model.evidence.find((entry) => entry.id === "EV-IDENTITY-CURRENT").execution = validExecution();
  assertCode(model, "FALSE_ATTESTATION");
});

test("compatibility targets, migration impacts and review fields are required", () => {
  const target = clone();
  target.compatibility = target.compatibility.filter((item) => item.target !== "sync-contract");
  assertCode(target, "REQUIRED_COMPATIBILITY");

  const migration = clone();
  migration.compatibility[0].migrationImpact = "";
  assertCode(migration, "REQUIRED_STRING");

  const references = clone();
  references.compatibility[0].references = null;
  assertCode(references, "REQUIRED_ARRAY");

  const review = clone();
  review.reviews[0].riskAuthorityConfirmed = "false";
  assertCode(review, "STRICT_BOOLEAN");
});

test("overview/register parity catches domain, boundary, capability and normalized detail drift", () => {
  const domain = clone();
  domain.domains[0].title += " changed";
  assertCode(domain, "OVERVIEW_DOMAIN_DRIFT");

  for (const mutate of [
    (model) => { model.boundaries[0].title += " changed"; },
    (model) => { model.boundaries[0].currentCapability = "not-implemented"; },
    (model) => { model.threats.find((item) => item.id === model.boundaries[0].threatIds[0]).scenario += " changed"; },
    (model) => { model.mitigations.find((item) => item.id === model.threats.find((entry) => entry.id === model.boundaries[0].threatIds[0]).mitigationIds[0]).control += " changed"; },
    (model) => { model.evidence.find((item) => item.id === model.threats.find((entry) => entry.id === model.boundaries[0].threatIds[0]).evidenceIds[0]).status = "passed"; },
    (model) => { model.threats.find((item) => item.id === model.boundaries[0].threatIds[0]).residualRiskId = "RR-IDENTITY-002"; },
  ]) {
    const model = clone();
    mutate(model);
    assertCode(model, "OVERVIEW_BOUNDARY_DRIFT");
  }
});

test("overview parity covers secondary denial-of-service threats", () => {
  const changed = clone();
  changed.threats.find((entry) => entry.id === "TH-IDENTITY-006").scenario += " changed";
  assertCode(changed, "OVERVIEW_BOUNDARY_DRIFT");

  const removed = baseOverview
    .split(/\r?\n/)
    .filter((line) => !line.startsWith("| `TH-IDENTITY-006` |"))
    .join("\n");
  assertCode(clone(), "OVERVIEW_BOUNDARY_DRIFT", { overviewContent: removed });
});

test("placeholder language fails", () => {
  const model = clone();
  model.title = "TBD threat model";
  assertCode(model, "PLACEHOLDER");
});

test("production register honestly blocks closure", () => {
  const result = codes(clone(), { closure: true });
  for (const code of ["CLOSURE_STATUS", "CLOSURE_OWNER", "CLOSURE_REVIEW", "CLOSURE_RISK"]) {
    assert.ok(result.has(code), `expected closure diagnostic ${code}`);
  }
});

test("a fully bound synthetic independent fixture passes closure", () => {
  assert.deepEqual(diagnostics(closureFixture(), closureOptions()), []);
});

test("closure rejects an existing unrelated historical commit without the reviewed model", () => {
  const model = closureFixture();
  model.reviews[0].reviewedCommit = base.architectureBaseline.commit;
  model.evidence.find((entry) => entry.id === "EV-PHASE0-REVIEW").execution.commit = base.architectureBaseline.commit;
  assertCode(model, "CLOSURE_SNAPSHOT_MISSING", {
    root: repositoryRoot,
    closure: true,
    overviewContent: acceptedOverview(),
  });
});

test("closure rejects immutable design drift after the reviewed snapshot", () => {
  const model = closureFixture();
  model.mitigations.find((entry) => entry.id === "MIT-IDENTITY-001").control += " changed after review";
  const overview = acceptedOverview().replace(
    base.mitigations.find((entry) => entry.id === "MIT-IDENTITY-001").control,
    model.mitigations.find((entry) => entry.id === "MIT-IDENTITY-001").control,
  );
  assertCode(model, "CLOSURE_SNAPSHOT_DRIFT", {
    ...closureOptions(),
    overviewContent: overview,
  });
});

test("closure requires strict true owner and review risk authority", () => {
  const owner = closureFixture();
  owner.owners.find((entry) => entry.id === "OWN-IDENTITY").riskAuthority = 1;
  assertCode(owner, "CLOSURE_OWNER", closureOptions());
  assertCode(owner, "STRICT_BOOLEAN", closureOptions());

  const review = closureFixture();
  review.reviews[0].riskAuthorityConfirmed = 1;
  assertCode(review, "CLOSURE_AUTHORITY", closureOptions());
});

test("closure binds exact model version, valid date and existing 40-hex commit", () => {
  const version = closureFixture();
  version.reviews[0].reviewedModelVersion = "9.9.9";
  assertCode(version, "CLOSURE_VERSION_BINDING", closureOptions());

  const date = closureFixture();
  date.reviews[0].reviewedAt = "2026-02-31";
  assertCode(date, "ISO_DATE", closureOptions());

  const malformed = closureFixture();
  malformed.reviews[0].reviewedCommit = "abc";
  assertCode(malformed, "CLOSURE_COMMIT", closureOptions());

  const missing = closureFixture();
  missing.reviews[0].reviewedCommit = "f".repeat(40);
  assertCode(missing, "CLOSURE_COMMIT_MISSING", closureOptions());
});

test("closure requires exact residual-risk coverage without omission, malformed values or duplicates", () => {
  const missing = closureFixture();
  missing.reviews[0].coveredResidualRiskIds.pop();
  assertCode(missing, "CLOSURE_RISK_COVERAGE", closureOptions());

  const malformed = closureFixture();
  malformed.reviews[0].coveredResidualRiskIds = null;
  assert.doesNotThrow(() => diagnostics(malformed, closureOptions()));
  assertCode(malformed, "CLOSURE_RISK_COVERAGE", closureOptions());

  const duplicate = closureFixture();
  duplicate.reviews[0].coveredResidualRiskIds[0] = duplicate.reviews[0].coveredResidualRiskIds[1];
  assertCode(duplicate, "CLOSURE_RISK_COVERAGE", closureOptions());
});

test("closure binds every acceptance field to the approved review and risk scope", () => {
  const cases = [
    ["reviewId", "REV-PHASE0-999"],
    ["acceptedBy", "@other"],
    ["acceptedAt", "2026-08-04"],
    ["reference", "https://github.com/aXeTech-NL/Trax-OS/pull/998"],
    ["scope", "implemented-control"],
  ];
  for (const [field, value] of cases) {
    const model = closureFixture();
    model.residualRisks[0].acceptance[field] = value;
    assertCode(model, "CLOSURE_RISK_BINDING", closureOptions());
  }
});

test("closure manual evidence coverage exactly binds every reviewed design record", () => {
  const missing = closureFixture();
  missing.evidence.find((entry) => entry.id === "EV-PHASE0-REVIEW").coverageIds.pop();
  assertCode(missing, "CLOSURE_EVIDENCE_COVERAGE", closureOptions());

  const duplicate = closureFixture();
  const coverage = duplicate.evidence.find((entry) => entry.id === "EV-PHASE0-REVIEW").coverageIds;
  coverage[0] = coverage[1];
  assertCode(duplicate, "CLOSURE_EVIDENCE_COVERAGE", closureOptions());
});

test("closure binds manual review execution to commit, date, reference and artifact", () => {
  for (const [field, value] of [
    ["commit", "f".repeat(40)],
    ["executedAt", "2026-08-04"],
    ["immutableReference", "https://github.com/aXeTech-NL/Trax-OS/pull/998"],
  ]) {
    const model = closureFixture();
    model.evidence.find((entry) => entry.id === "EV-PHASE0-REVIEW").execution[field] = value;
    assertCode(model, "CLOSURE_EVIDENCE_BINDING", closureOptions());
  }

  const artifact = closureFixture();
  artifact.reviews[0].artifactPath = "docs/security/README.md";
  assertCode(artifact, "CLOSURE_EVIDENCE_BINDING", closureOptions());

  const missing = closureFixture();
  missing.reviews[0].artifactPath = "docs/security/evidence/MISSING.md";
  assertCode(missing, "REFERENCE_MISSING", closureOptions());
});

test("closure rejects the production pending procedure as approved evidence", () => {
  const model = closureFixture();
  const artifact = join(reviewedRepository.root, model.reviews[0].artifactPath);
  const approved = readFileSync(artifact, "utf8");
  try {
    writeFileSync(artifact, readFileSync(join(repositoryRoot, model.reviews[0].artifactPath), "utf8"));
    assertCode(model, "CLOSURE_ARTIFACT_PENDING", closureOptions());
    assertCode(model, "CLOSURE_ARTIFACT_RESULT", closureOptions());
  } finally {
    writeFileSync(artifact, approved);
  }
});

test("closure reviewer cannot match a named human author", () => {
  const model = closureFixture();
  model.authors.push({
    id: "AUTH-HUMAN-001",
    kind: "human",
    handle: model.reviews[0].reviewer,
    role: "human model author",
  });
  assertCode(model, "CLOSURE_SELF_REVIEW", closureOptions());
});

test("closure requires a repository review reference", () => {
  const model = closureFixture();
  model.reviews[0].immutableReference = "https://attacker.invalid/review";
  assertCode(model, "CLOSURE_REFERENCE", closureOptions());
});
