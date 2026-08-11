export const ids = {
  users: {
    alice: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    bob: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2",
    casey: "cccccccc-cccc-4ccc-8ccc-ccccccccccc3",
    eve: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4",
  },
  workspaces: {
    one: "11111111-1111-4111-8111-111111111111",
    two: "22222222-2222-4222-8222-222222222222",
  },
  journeys: {
    one: "11111111-1111-4111-8111-111111111101",
    onePrivate: "11111111-1111-4111-8111-111111111103",
    two: "22222222-2222-4222-8222-222222222102",
  },
  parties: {
    alpha: "33333333-3333-4333-8333-333333333301",
    bravo: "33333333-3333-4333-8333-333333333302",
    charlie: "44444444-4444-4444-8444-444444444303",
  },
  resources: {
    sharedOne: "55555555-5555-4555-8555-555555555501",
    alphaPrivate: "55555555-5555-4555-8555-555555555502",
    bravoPrivate: "55555555-5555-4555-8555-555555555503",
    aliceOnlySameWorkspaceJourney:
      "55555555-5555-4555-8555-555555555504",
    sharedTwo: "66666666-6666-4666-8666-666666666601",
    charliePrivate: "66666666-6666-4666-8666-666666666602",
  },
} as const;

export const resourceIncarnations: Readonly<Record<string, string>> = {
  [ids.resources.sharedOne]: "75555555-5555-4555-8555-555555555501",
  [ids.resources.alphaPrivate]: "75555555-5555-4555-8555-555555555502",
  [ids.resources.bravoPrivate]: "75555555-5555-4555-8555-555555555503",
  [ids.resources.aliceOnlySameWorkspaceJourney]:
    "75555555-5555-4555-8555-555555555504",
  [ids.resources.sharedTwo]: "76666666-6666-4666-8666-666666666601",
  [ids.resources.charliePrivate]: "76666666-6666-4666-8666-666666666602",
};

export type Principal = keyof typeof ids.users;

export const expectedResources: Record<Principal, readonly string[]> = {
  alice: [
    ids.resources.sharedOne,
    ids.resources.alphaPrivate,
    ids.resources.aliceOnlySameWorkspaceJourney,
  ],
  bob: [ids.resources.sharedOne, ids.resources.bravoPrivate],
  casey: [
    ids.resources.sharedOne,
    ids.resources.alphaPrivate,
    ids.resources.bravoPrivate,
  ],
  eve: [ids.resources.sharedTwo, ids.resources.charliePrivate],
};

export const expectedCaseyAfterAlphaRevocation = [
  ids.resources.sharedOne,
  ids.resources.bravoPrivate,
] as const;

export const payloadByResourceId: Readonly<Record<string, string>> = {
  [ids.resources.sharedOne]: "MARKER_W1_J1_SHARED",
  [ids.resources.alphaPrivate]: "MARKER_PARTY_ALPHA_PRIVATE",
  [ids.resources.bravoPrivate]: "MARKER_PARTY_BRAVO_PRIVATE",
  [ids.resources.aliceOnlySameWorkspaceJourney]:
    "MARKER_W1_SECOND_JOURNEY_ALICE_ONLY",
  [ids.resources.sharedTwo]: "MARKER_W2_FORBIDDEN_SHARED",
  [ids.resources.charliePrivate]: "MARKER_W2_FORBIDDEN_PRIVATE",
};

export const allPayloadMarkers = Object.values(payloadByResourceId);
