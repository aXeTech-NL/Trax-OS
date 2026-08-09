import { timingSafeEqual } from "node:crypto";
import { ids, type Principal } from "./fixtures.js";

export interface TokenRequest {
  principal: Principal;
  subject: string;
}

export type PrincipalCredentials = Readonly<Record<Principal, string>>;

function decodeBasicAuthorization(value: string | undefined): {
  principal: string;
  secret: string;
} {
  if (!value?.startsWith("Basic ")) {
    throw new Error("Authenticated test principal is required.");
  }
  let decoded: string;
  try {
    decoded = Buffer.from(value.slice("Basic ".length), "base64").toString(
      "utf8",
    );
  } catch {
    throw new Error("Malformed test credential.");
  }
  const separator = decoded.indexOf(":");
  if (separator <= 0) {
    throw new Error("Malformed test credential.");
  }
  return {
    principal: decoded.slice(0, separator),
    secret: decoded.slice(separator + 1),
  };
}

function secretsEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}

export function parseTokenRequest(
  url: URL,
  authorization: string | undefined,
  credentials: PrincipalCredentials,
): TokenRequest {
  const keys = [...url.searchParams.keys()];
  if (keys.length > 0) {
    throw new Error(
      `Client-supplied identity or scope is forbidden: ${keys.sort().join(", ")}`,
    );
  }

  const { principal, secret } = decodeBasicAuthorization(authorization);
  if (!(principal in ids.users)) {
    throw new Error("Invalid test credential.");
  }
  const typedPrincipal = principal as Principal;
  if (!secretsEqual(secret, credentials[typedPrincipal])) {
    throw new Error("Invalid test credential.");
  }
  return { principal: typedPrincipal, subject: ids.users[typedPrincipal] };
}
