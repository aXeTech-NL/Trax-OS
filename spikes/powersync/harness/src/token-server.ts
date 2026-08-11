import { createServer, type ServerResponse } from "node:http";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import pg from "pg";
import { ids, type Principal } from "./fixtures.js";
import {
  parseTokenRequest,
  type PrincipalCredentials,
} from "./token-policy.js";

const host = process.env.PS8_TOKEN_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.PS8_TOKEN_PORT ?? "6060", 10);
const databaseUrl = process.env.PS8_DATABASE_URL;
const credentialsJson = process.env.PS8_TOKEN_CREDENTIALS_JSON;
if (!databaseUrl || !credentialsJson) {
  throw new Error(
    "PS8_DATABASE_URL and PS8_TOKEN_CREDENTIALS_JSON are required.",
  );
}

function loadCredentials(value: string): PrincipalCredentials {
  const parsed = JSON.parse(value) as Partial<Record<Principal, unknown>>;
  const entries = (Object.keys(ids.users) as Principal[]).map((principal) => {
    const secret = parsed[principal];
    if (typeof secret !== "string" || secret.length < 32) {
      throw new Error(`Missing strong per-run credential for ${principal}.`);
    }
    return [principal, secret] as const;
  });
  if (new Set(entries.map((entry) => entry[1])).size !== entries.length) {
    throw new Error("Every simulated principal requires a distinct credential.");
  }
  return Object.fromEntries(entries) as PrincipalCredentials;
}

const credentials = loadCredentials(credentialsJson);
const pool = new pg.Pool({
  connectionString: databaseUrl,
  max: 4,
  connectionTimeoutMillis: 5_000,
  query_timeout: 5_000,
  statement_timeout: 5_000,
});
const keyId = "trax-ps8-ephemeral-rs256";
const issuer = "urn:trax-os:issue-8-spike";
const audience = "powersync-dev";
const { publicKey, privateKey } = await generateKeyPair("RS256", {
  extractable: true,
});
const publicJwk = await exportJWK(publicKey);
const jwks = { keys: [{ ...publicJwk, alg: "RS256", kid: keyId, use: "sig" }] };

function json(response: ServerResponse, status: number, body: object): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(`${JSON.stringify(body)}\n`);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? `${host}:${port}`}`,
    );
    if (request.method === "GET" && url.pathname === "/health") {
      await pool.query("SELECT 1");
      json(response, 200, { status: "ready" });
      return;
    }
    if (request.method === "GET" && url.pathname === "/jwks") {
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=30",
      });
      response.end(`${JSON.stringify(jwks)}\n`);
      return;
    }
    if (request.method === "GET" && url.pathname === "/token") {
      let tokenRequest;
      try {
        tokenRequest = parseTokenRequest(
          url,
          request.headers.authorization,
          credentials,
        );
      } catch (error) {
        const message = (error as Error).message;
        const isScopeError = message.startsWith("Client-supplied");
        json(response, isScopeError ? 400 : 401, {
          error: isScopeError ? "scope_not_accepted" : "invalid_credential",
          message,
        });
        return;
      }

      const result = await pool.query<{ active: boolean }>(
        "SELECT active FROM users WHERE id = $1",
        [tokenRequest.subject],
      );
      if (result.rowCount !== 1 || result.rows[0]?.active !== true) {
        json(response, 403, { error: "principal_inactive" });
        return;
      }

      const testVariant = request.headers["x-ps8-test-token-variant"];
      if (
        testVariant !== undefined &&
        process.env.PS8_ENABLE_INVALID_TOKEN_FIXTURES !== "1"
      ) {
        json(response, 400, { error: "invalid_token_fixture_disabled" });
        return;
      }
      if (
        testVariant !== undefined &&
        testVariant !== "wrong-audience" &&
        testVariant !== "expired"
      ) {
        json(response, 400, { error: "unknown_token_fixture" });
        return;
      }

      const now = Math.floor(Date.now() / 1_000);
      const token = await new SignJWT({ spike: "issue-8" })
        .setProtectedHeader({ alg: "RS256", kid: keyId, typ: "JWT" })
        .setSubject(tokenRequest.subject)
        .setIssuer(issuer)
        .setAudience(
          testVariant === "wrong-audience" ? "not-powersync" : audience,
        )
        .setIssuedAt(now)
        .setExpirationTime(testVariant === "expired" ? now - 60 : now + 15 * 60)
        .sign(privateKey);
      json(response, 200, { token });
      return;
    }
    json(response, 404, { error: "not_found" });
  } catch (error) {
    console.error(
      "token-server request failed",
      error instanceof Error ? error.message : "unknown error",
    );
    json(response, 500, { error: "internal_error" });
  }
});

server.listen(port, host, () => {
  console.log(`Issue #8 token server listening on ${host}:${port}`);
});

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await pool.end();
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
