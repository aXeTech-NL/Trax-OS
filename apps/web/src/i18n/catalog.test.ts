import { expect, test } from "vitest";

import { en, nl } from "./catalog";

test("keeps the Dutch catalog complete and aligned with English", () => {
  expect(Object.keys(nl).sort()).toEqual(Object.keys(en).sort());
  expect(Object.values(nl).every((message) => message.trim().length > 0)).toBe(
    true,
  );
});
