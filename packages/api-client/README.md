# `@trax-os/api-client`

Validated same-origin browser transport for the canonical Trax OS HTTP contract.

The maintained transport and negotiation code lives under `src/`. `generated/client.ts` is a deterministic projection of the canonical FastAPI OpenAPI document and server discovery fixture; never edit it manually. `make generate` performs one generation and writes the committed projection. `make contract-check` generates twice in independent temporary directories, checks byte determinism and rejects committed drift.

The client:

- performs one cached `/api/contract` bootstrap before versioned traffic;
- negotiates the highest overlapping positive integer API and command version;
- validates requests before sending and validates declared success/error responses before returning;
- tolerates additive unknown response fields but rejects unknown request fields;
- always uses `credentials: "same-origin"` and adds CSRF only where OpenAPI marks it required;
- returns typed errors without retaining raw payloads or credentials.

It is not a native, cross-origin, offline or local-authority client. Server authorization, CSRF, validation and command resolution remain authoritative.
