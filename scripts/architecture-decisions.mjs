import { deepStrictEqual } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const decisionsDirectory = join(root, "docs", "architecture", "decisions");
const logPath = join(decisionsDirectory, "README.md");
const fixturePath = join(
  decisionsDirectory,
  "fixtures",
  "adr-016-policy-cases.json",
);
const decisionFiles = [
  "ADR-004-CANONICAL-TERMINOLOGY.md",
  "ADR-005-MEMBERSHIP-AND-PARTICIPATION.md",
  "ADR-016-ACCESS-POLICY-ALGEBRA.md",
];
const canonicalPolicyFiles = [
  "docs/architecture/AGENCY_ACCESS_MODEL.md",
  "docs/architecture/AGENTIC_CORE.md",
  "docs/architecture/DOMAIN_MODEL.md",
  "docs/architecture/IMPLEMENTATION_ARCHITECTURE.md",
];
const expectedAudiences = [
  "agency_internal",
  "journey_shared",
  "party_shared",
  "traveler_private",
];
const requiredCaseIds = [
  "organizer-not-traveling-can-read-journey",
  "agency-staff-can-read-internal-resource",
  "placeholder-traveler-has-no-access",
  "revoked-membership-has-no-access",
  "exact-party-relationship-allows",
  "revoked-party-relationship-does-not-authorize",
  "shared-traveler-does-not-bridge-parties",
  "guardian-private-read-is-explicit-and-audited",
  "bounded-grant-bridges-missing-party-relationship",
  "explicit-deny-overrides-active-grant",
  "expired-grant-does-not-authorize",
  "revoked-grant-as-only-path-does-not-authorize",
  "grant-without-required-purpose-does-not-authorize",
  "grant-with-mismatched-purpose-does-not-authorize",
  "grant-with-invalid-delegation-does-not-authorize",
  "grant-with-wrong-grantee-does-not-authorize",
  "grant-with-wrong-resource-does-not-authorize",
  "grant-with-wrong-scope-does-not-authorize",
  "resource-policy-can-reject-granted-operation",
  "resource-policy-fields-narrow-granted-write",
  "oauth-can-reduce-operation",
  "origin-tool-allowlist-can-reduce-operation",
  "read-projects-authorized-field-intersection",
  "origin-fields-narrow-read-projection",
  "write-rejects-unauthorized-field",
  "high-risk-write-requires-confirmation",
  "validated-support-session-is-explicit-basis",
  "support-session-without-reason-is-invalid",
  "allowlisted-system-execution-is-explicit-basis",
  "unauthenticated-system-execution-is-invalid",
  "support-session-cannot-borrow-user-role-fields",
  "system-execution-cannot-borrow-user-role-operation",
  "revoked-grant-preserves-independent-base-path",
  "invalid-owner-audience-combination-fails",
  "wrong-workspace-fails-before-grant",
  "wrong-owner-workspace-fails-before-grant",
  "wrong-owner-journey-fails-before-grant",
  "wrong-party-journey-fails-before-role",
  "wrong-traveler-journey-fails-before-role",
];
const machineIdentifierPatterns = [
  /\btraveller_[a-z0-9_]+\b/gi,
  /(?<![A-Za-z0-9])\/travellers?(?:\/|\b)/gi,
  /\b[a-z0-9_]+_travellers?\b/gi,
  /\b[A-Za-z0-9]*travellers?[A-Z][A-Za-z0-9]*\b/g,
  /\b[A-Za-z0-9]*Traveller[A-Z0-9][A-Za-z0-9]*\b/g,
  /\btravellers?\.[a-z0-9_.-]+\b/gi,
  /\b[a-z0-9]+-travellers?(?:-[a-z0-9]+)*\b/gi,
  /\b(?:class|interface|type|enum)\s+Traveller\b/g,
];

const errors = [];

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function fail(message) {
  errors.push(message);
}

function deepMerge(base, override) {
  if (Array.isArray(override)) return [...override];
  if (override === null || typeof override !== "object") return override;

  const result = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(override)) {
    result[key] = deepMerge(result[key], value);
  }
  return result;
}

function materializeCase(defaults, testCase) {
  const input = deepMerge(defaults, testCase);
  if (
    testCase.access_basis?.kind &&
    testCase.access_basis.kind !== defaults.access_basis.kind
  ) {
    input.access_basis = { ...testCase.access_basis };
  }
  return input;
}

function permits(values, value) {
  return values.includes("*") || values.includes(value);
}

function allowedFields(requested, ...fieldSets) {
  return requested.filter((field) =>
    fieldSets.every((fields) => permits(fields, field)),
  );
}

function unionFields(...fieldSets) {
  if (fieldSets.some((fields) => fields.includes("*"))) return ["*"];
  return [...new Set(fieldSets.flat())];
}

function validOwnerAudience(input) {
  const { audience, owner } = input;
  const noParty = owner.party_id === null;
  const noTraveler = owner.traveler_id === null;

  if (audience === "agency_internal") {
    const permittedOwner = ["agency", "workspace", "journey"].includes(owner.type);
    const journeyOwnerIsScoped = owner.type !== "journey" || owner.journey_id !== null;
    return permittedOwner && journeyOwnerIsScoped && noParty && noTraveler;
  }
  if (audience === "journey_shared") {
    return (
      owner.type === "journey" &&
      owner.journey_id !== null &&
      noParty &&
      noTraveler
    );
  }
  if (audience === "party_shared") {
    return (
      owner.type === "party" &&
      owner.journey_id !== null &&
      owner.party_id !== null &&
      noTraveler
    );
  }
  if (audience === "traveler_private") {
    return (
      owner.type === "traveler" &&
      owner.journey_id !== null &&
      noParty &&
      owner.traveler_id !== null
    );
  }
  return false;
}

function validAccessBasis(input) {
  const basis = input.access_basis;
  if (
    basis.state !== "active" ||
    !basis.active ||
    !basis.authenticated ||
    !basis.selected_scope
  ) {
    return false;
  }
  if (basis.kind === "user_membership") return basis.represented_user_match;
  if (basis.kind === "support_session") {
    return basis.strong_auth && basis.reason_present;
  }
  return basis.kind === "system_execution";
}

function audienceAllows(input) {
  const relationships = {
    agency_internal: ["agency_staff"],
    journey_shared: ["journey_member"],
    party_shared: ["exact_party_member"],
    traveler_private: ["self_traveler", "guardian"],
  };
  return relationships[input.audience].includes(input.relationship);
}

function validGrant(input) {
  const grant = input.grant;
  return (
    input.access_basis.kind === "user_membership" &&
    grant.state === "active" &&
    grant.grantee_match &&
    grant.resource_match &&
    grant.scope_match &&
    permits(grant.operations, input.request.operation) &&
    (!grant.purpose_required ||
      (grant.purpose_present && grant.purpose_match)) &&
    grant.delegation_valid
  );
}

function decision(allowed, allowedFieldsResult, reason, input) {
  return {
    allowed,
    allowed_fields: allowedFieldsResult,
    reason,
    confirmation_required: allowed && input.effects.confirmation_required,
    sensitive_read_audit:
      allowed && input.request.operation === "read" && input.effects.sensitive_read,
  };
}

function evaluate(input) {
  if (
    !input.scope.workspace_match ||
    !input.scope.journey_match ||
    !input.scope.resource_active ||
    !input.scope.owner_workspace_match ||
    !input.scope.owner_journey_match ||
    !input.scope.party_journey_match ||
    !input.scope.traveler_journey_match ||
    !validOwnerAudience(input)
  ) {
    return decision(false, [], "invariant_failed", input);
  }

  if (!validAccessBasis(input)) {
    return decision(false, [], "access_basis_inactive", input);
  }

  if (input.explicit_deny) {
    return decision(false, [], "explicit_deny", input);
  }

  const operation = input.request.operation;
  const resourceAllowsOperation = permits(input.resource_policy.operations, operation);
  const basePath =
    input.access_basis.kind === "user_membership" &&
    resourceAllowsOperation &&
    permits(input.role.operations, operation) &&
    audienceAllows(input);
  const grantPath = resourceAllowsOperation && validGrant(input);
  const privilegedBasis = ["support_session", "system_execution"].includes(
    input.access_basis.kind,
  );
  const privilegedPath =
    resourceAllowsOperation &&
    privilegedBasis &&
    permits(input.access_basis.operation_allowlist, operation);

  if (!basePath && !grantPath && !privilegedPath) {
    return decision(false, [], "no_authorization_path", input);
  }

  if (input.oauth.applicable && !permits(input.oauth.operations, operation)) {
    return decision(false, [], "oauth_scope_reduced", input);
  }

  if (!permits(input.origin.operations, operation)) {
    return decision(false, [], "origin_not_allowed", input);
  }

  const pathFields = unionFields(
    ...(basePath ? [input.role.fields] : []),
    ...(grantPath ? [input.grant.fields] : []),
    ...(privilegedPath ? [input.access_basis.fields] : []),
  );
  const oauthFields = input.oauth.applicable ? input.oauth.fields : ["*"];
  const projected = allowedFields(
    input.request.fields,
    pathFields,
    input.resource_policy.fields,
    oauthFields,
    input.origin.fields,
  );

  if (operation !== "read" && projected.length !== input.request.fields.length) {
    return decision(false, [], "field_forbidden", input);
  }
  if (input.request.fields.length > 0 && projected.length === 0) {
    return decision(false, [], "field_forbidden", input);
  }

  return decision(true, projected, "allowed", input);
}

function validateRelativeLinks(markdownPath) {
  const content = readFileSync(markdownPath, "utf8");
  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  for (const match of content.matchAll(linkPattern)) {
    const target = match[1].trim();
    if (/^(?:https?:|mailto:|#)/.test(target)) continue;
    const pathWithoutFragment = decodeURIComponent(target.split("#", 1)[0]);
    if (!pathWithoutFragment) continue;
    const linkedPath = resolve(dirname(markdownPath), pathWithoutFragment);
    if (!existsSync(linkedPath)) {
      fail(
        `${markdownPath.slice(root.length + 1)} links to missing path ${target}`,
      );
    }
  }
}

function repositoryFiles() {
  const result = spawnSync(
    "git",
    [
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
    ],
    { cwd: root, encoding: "utf8" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "git ls-files failed");
  }
  return result.stdout.trim().split("\n").filter(Boolean).sort();
}

function machineContractText(path, content) {
  if (extname(path) !== ".md") return content;
  const fencePattern = /(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1/g;
  const fences = [...content.matchAll(fencePattern)].map(([block]) => block);
  const withoutFences = content.replace(fencePattern, "");
  const inlineCode = [
    ...withoutFences.matchAll(/(`+)([^`\n]+?)\1/g),
  ].map(([, , inline]) => inline);
  const routeLinks = [
    ...withoutFences.matchAll(/\[[^\]]+\]\(([^)\s]+)[^)]*\)/g),
  ]
    .map(([, target]) => target)
    .filter((target) => target.startsWith("/") || target.startsWith("trax:"));
  return [...fences, ...inlineCode, ...routeLinks].join("\n");
}

function findMachineIdentifiers(content) {
  return [
    ...new Set(
      machineIdentifierPatterns.flatMap((pattern) =>
        [...content.matchAll(pattern)].map(([match]) => match),
      ),
    ),
  ];
}

function validateArray(value, path) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    fail(`${path} must be an array of strings`);
  }
}

function validateKeys(value, allowed, path) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${path} must be an object`);
    return;
  }
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) fail(`${path} has unknown field(s): ${unknown.join(", ")}`);
}

function validateNullableString(value, path) {
  if (value !== null && (typeof value !== "string" || value.length === 0)) {
    fail(`${path} must be null or a non-empty string`);
  }
}

function validateFixtureInput(input, testCase) {
  const id = testCase.id;
  validateKeys(
    testCase,
    [
      "id",
      "description",
      "participant_exists",
      "owner",
      "scope",
      "audience",
      "relationship",
      "access_basis",
      "explicit_deny",
      "resource_policy",
      "role",
      "grant",
      "oauth",
      "origin",
      "request",
      "effects",
      "expected",
    ],
    id,
  );
  if (typeof id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    fail("Fixture case ID must be a non-empty kebab-case string");
  }
  if (typeof testCase.description !== "string" || testCase.description.length === 0) {
    fail(`${id}.description must be a non-empty string`);
  }
  if (
    "participant_exists" in testCase &&
    typeof testCase.participant_exists !== "boolean"
  ) {
    fail(`${id}.participant_exists must be boolean`);
  }

  validateKeys(
    input.owner,
    ["type", "journey_id", "party_id", "traveler_id"],
    `${id}.owner`,
  );
  if (!["agency", "workspace", "journey", "party", "traveler"].includes(input.owner.type)) {
    fail(`${id}.owner.type is invalid`);
  }
  for (const key of ["journey_id", "party_id", "traveler_id"]) {
    validateNullableString(input.owner[key], `${id}.owner.${key}`);
  }

  validateKeys(
    input.scope,
    [
      "workspace_match",
      "journey_match",
      "resource_active",
      "owner_workspace_match",
      "owner_journey_match",
      "party_journey_match",
      "traveler_journey_match",
    ],
    `${id}.scope`,
  );
  validateKeys(
    input.resource_policy,
    ["operations", "fields"],
    `${id}.resource_policy`,
  );
  validateKeys(input.role, ["operations", "fields"], `${id}.role`);
  validateKeys(
    input.grant,
    [
      "state",
      "grantee_match",
      "resource_match",
      "scope_match",
      "operations",
      "fields",
      "purpose_required",
      "purpose_present",
      "purpose_match",
      "delegation_valid",
    ],
    `${id}.grant`,
  );
  validateKeys(input.oauth, ["applicable", "operations", "fields"], `${id}.oauth`);
  validateKeys(input.origin, ["name", "operations", "fields"], `${id}.origin`);
  validateKeys(input.request, ["operation", "fields"], `${id}.request`);
  validateKeys(
    input.effects,
    ["confirmation_required", "sensitive_read"],
    `${id}.effects`,
  );
  validateKeys(
    testCase.expected,
    [
      "allowed",
      "allowed_fields",
      "reason",
      "confirmation_required",
      "sensitive_read_audit",
    ],
    `${id}.expected`,
  );

  const booleanPaths = [
    [input.scope.workspace_match, "scope.workspace_match"],
    [input.scope.journey_match, "scope.journey_match"],
    [input.scope.resource_active, "scope.resource_active"],
    [input.scope.owner_workspace_match, "scope.owner_workspace_match"],
    [input.scope.owner_journey_match, "scope.owner_journey_match"],
    [input.scope.party_journey_match, "scope.party_journey_match"],
    [input.scope.traveler_journey_match, "scope.traveler_journey_match"],
    [input.access_basis.active, "access_basis.active"],
    [input.access_basis.authenticated, "access_basis.authenticated"],
    [input.access_basis.selected_scope, "access_basis.selected_scope"],
    [input.explicit_deny, "explicit_deny"],
    [input.grant.grantee_match, "grant.grantee_match"],
    [input.grant.resource_match, "grant.resource_match"],
    [input.grant.scope_match, "grant.scope_match"],
    [input.grant.purpose_required, "grant.purpose_required"],
    [input.grant.purpose_present, "grant.purpose_present"],
    [input.grant.purpose_match, "grant.purpose_match"],
    [input.grant.delegation_valid, "grant.delegation_valid"],
    [input.oauth.applicable, "oauth.applicable"],
    [input.effects.confirmation_required, "effects.confirmation_required"],
    [input.effects.sensitive_read, "effects.sensitive_read"],
    [testCase.expected.allowed, "expected.allowed"],
    [testCase.expected.confirmation_required, "expected.confirmation_required"],
    [testCase.expected.sensitive_read_audit, "expected.sensitive_read_audit"],
  ];
  for (const [value, path] of booleanPaths) {
    if (typeof value !== "boolean") fail(`${id}.${path} must be boolean`);
  }

  if (!expectedAudiences.includes(input.audience)) {
    fail(`${id}.audience is not accepted`);
  }
  const relationships = [
    "agency_staff",
    "journey_member",
    "exact_party_member",
    "self_traveler",
    "guardian",
    "none",
    "shared_traveler_only",
    "revoked_exact_party_member",
  ];
  if (!relationships.includes(input.relationship)) {
    fail(`${id}.relationship is invalid`);
  }
  if (typeof input.origin.name !== "string" || input.origin.name.length === 0) {
    fail(`${id}.origin.name must be a non-empty string`);
  }
  if (!["active", "revoked"].includes(input.access_basis.state)) {
    fail(`${id}.access_basis.state is invalid`);
  }
  if (!["none", "active", "expired", "revoked"].includes(input.grant.state)) {
    fail(`${id}.grant.state is invalid`);
  }
  if (typeof input.request.operation !== "string" || input.request.operation.length === 0) {
    fail(`${id}.request.operation must be a non-empty string`);
  }
  if (typeof testCase.expected.reason !== "string") {
    fail(`${id}.expected.reason must be a string`);
  }
  validateArray(testCase.expected.allowed_fields, `${id}.expected.allowed_fields`);

  const basisFields = {
    user_membership: [
      "kind",
      "state",
      "active",
      "authenticated",
      "represented_user_match",
      "selected_scope",
    ],
    support_session: [
      "kind",
      "state",
      "active",
      "authenticated",
      "selected_scope",
      "strong_auth",
      "reason_present",
      "operation_allowlist",
      "fields",
    ],
    system_execution: [
      "kind",
      "state",
      "active",
      "authenticated",
      "selected_scope",
      "operation_allowlist",
      "fields",
    ],
  };
  if (!(input.access_basis.kind in basisFields)) {
    fail(`${id}.access_basis.kind is invalid`);
  } else {
    validateKeys(
      input.access_basis,
      basisFields[input.access_basis.kind],
      `${id}.access_basis`,
    );
  }
  if (input.access_basis.kind === "user_membership") {
    if (typeof input.access_basis.represented_user_match !== "boolean") {
      fail(`${id}.access_basis.represented_user_match must be boolean`);
    }
  } else {
    validateArray(
      input.access_basis.operation_allowlist,
      `${id}.access_basis.operation_allowlist`,
    );
    validateArray(input.access_basis.fields, `${id}.access_basis.fields`);
  }
  if (input.access_basis.kind === "support_session") {
    if (
      typeof input.access_basis.strong_auth !== "boolean" ||
      typeof input.access_basis.reason_present !== "boolean"
    ) {
      fail(`${id} support session requires strong_auth and reason_present`);
    }
  }

  for (const [value, path] of [
    [input.resource_policy.operations, "resource_policy.operations"],
    [input.resource_policy.fields, "resource_policy.fields"],
    [input.role.operations, "role.operations"],
    [input.role.fields, "role.fields"],
    [input.grant.operations, "grant.operations"],
    [input.grant.fields, "grant.fields"],
    [input.oauth.operations, "oauth.operations"],
    [input.oauth.fields, "oauth.fields"],
    [input.origin.operations, "origin.operations"],
    [input.origin.fields, "origin.fields"],
    [input.request.fields, "request.fields"],
  ]) {
    validateArray(value, `${id}.${path}`);
  }
}

const decisionLog = readFileSync(logPath, "utf8");
for (const file of decisionFiles) {
  const relativePath = `docs/architecture/decisions/${file}`;
  const content = read(relativePath);
  const id = file.slice(0, 7);

  for (const required of [
    "**Status:** Accepted",
    "**Decision owner:** `@Maurice-aXeTech`",
    "**Approver:** `@Maurice-aXeTech`",
    "## Decision",
    "## Compatibility and migration impact",
    "## Validation evidence",
    "https://github.com/aXeTech-NL/Trax-OS/issues/6",
  ]) {
    if (!content.includes(required)) fail(`${relativePath} is missing ${required}`);
  }

  const logRow = decisionLog
    .split("\n")
    .find((line) => line.startsWith(`| [${id}]`));
  if (!logRow || !logRow.includes("| Accepted |")) {
    fail(`Decision log does not record ${id} as Accepted`);
  }

  validateRelativeLinks(join(root, relativePath));
}
validateRelativeLinks(logPath);
validateRelativeLinks(join(root, "docs", "architecture", "GLOSSARY.md"));

for (const relativePath of canonicalPolicyFiles) {
  if (/\bexplicit_grants\b/.test(read(relativePath))) {
    fail(`${relativePath} still treats explicit_grants as canonical vocabulary`);
  }
}

const agencyAccessModel = read("docs/architecture/AGENCY_ACCESS_MODEL.md");
const membershipBlock = agencyAccessModel.match(
  /journey_memberships\n(?<body>[\s\S]*?)\n\njourney_participants\n/,
);
const participantBlock = agencyAccessModel.match(
  /journey_participants\n(?<body>[\s\S]*?)\n\ntravel_parties\n/,
);
const partyMembershipBlock = agencyAccessModel.match(
  /party_memberships\n(?<body>[\s\S]*?)\n\nresource_grants\n/,
);
if (!membershipBlock) {
  fail("Agency access model has no separate journey_memberships illustration");
} else if (
  membershipBlock.groups.body.includes("traveler_id") ||
  !membershipBlock.groups.body.includes("user_id")
) {
  fail("journey_memberships must contain user_id and no traveler_id");
}
if (!participantBlock) {
  fail("Agency access model has no separate journey_participants illustration");
} else if (
  participantBlock.groups.body.includes("user_id") ||
  !participantBlock.groups.body.includes("traveler_id")
) {
  fail("journey_participants must contain traveler_id and no user_id");
}
if (
  !partyMembershipBlock ||
  !partyMembershipBlock.groups.body.includes("journey_participant_id")
) {
  fail("party_memberships must reference journey_participant_id");
}

for (const example of [
  "traveller_id",
  "/travellers",
  "journeys_and_travellers",
  "travellerId",
  "TravellerProfile",
  "primaryTravellerId",
  "travellersById",
  "traveller.read",
  "trax-travellers-ui",
  "class Traveller",
]) {
  if (findMachineIdentifiers(example).length === 0) {
    fail(`Machine-identifier validator does not detect ${example}`);
  }
}

for (const [name, markdown] of [
  ["tilde fence", "~~~ts\nconst travellerId = 1;\n~~~"],
  ["multi-backtick inline code", "Use ``travellerId`` here."],
  ["route link", "[endpoint](/travellers)"],
]) {
  const technicalText = machineContractText("example.md", markdown);
  if (findMachineIdentifiers(technicalText).length === 0) {
    fail(`Machine-identifier validator misses Markdown ${name}`);
  }
}

const sourceExtensions = new Set([
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".py",
  ".toml",
  ".ts",
  ".tsx",
  ".yaml",
  ".yml",
]);
for (const relativePath of repositoryFiles()) {
  if (relativePath === "scripts/architecture-decisions.mjs") continue;
  if (!sourceExtensions.has(extname(relativePath))) continue;
  const content = machineContractText(relativePath, read(relativePath));
  const matches = findMachineIdentifiers(content);
  if (matches.length > 0) {
    fail(
      `${relativePath} uses non-canonical machine identifier(s): ${matches.join(", ")}`,
    );
  }
}

let fixture;
try {
  fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
} catch (error) {
  fail(`Policy fixture is not valid JSON: ${error.message}`);
}

if (fixture) {
  if (fixture.fixture_version !== 1 || fixture.decision !== "ADR-016") {
    fail("Policy fixture metadata must identify ADR-016 fixture version 1");
  }
  try {
    deepStrictEqual(fixture.audiences, expectedAudiences);
  } catch {
    fail("Policy fixture must define exactly the four accepted audiences");
  }
  if (fixture.grant_only_mode !== false) {
    fail("ADR-016 fixture must keep grant-only mode disabled");
  }

  const ids = fixture.cases.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) fail("Policy fixture case IDs must be unique");
  for (const id of requiredCaseIds) {
    if (!ids.includes(id)) fail(`Policy fixture is missing required case ${id}`);
  }

  for (const testCase of fixture.cases) {
    const input = materializeCase(fixture.defaults, testCase);
    const validationErrorCount = errors.length;
    validateFixtureInput(input, testCase);
    if (errors.length > validationErrorCount) continue;
    const actual = evaluate(input);
    try {
      deepStrictEqual(actual, testCase.expected);
    } catch {
      fail(
        `${testCase.id} expected ${JSON.stringify(testCase.expected)} but evaluated ${JSON.stringify(actual)}`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error("Architecture decision validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Accepted architecture decisions and ${fixture.cases.length} shared policy cases are consistent.`,
);
