# Security design documentation

- [Phase 0 Threat Model](PHASE_0_THREAT_MODEL.md) — the human-readable scope, trust-boundary inventory, evidence semantics, compatibility impact and risk-acceptance process for issue #10.
- [`phase-0-threat-model.json`](phase-0-threat-model.json) — the authored, machine-readable traceability register. It is reviewed data, not generated output.
- [Phase 0 review procedure](evidence/PHASE_0_REVIEW.md) — pending independent review and explicit residual-risk acceptance. The template is not passing evidence.
- [Security policy](../../SECURITY.md) — confidential vulnerability-reporting instructions. Do not disclose exploit details in public design documents or issues.

Validate the model without making closure claims:

```bash
make threat-model-check
```

After a genuine independent review updates the fixed model version and review record, validate closure separately:

```bash
npm run security:closure
```

Normal validation proves structural completeness, referential integrity and truthful evidence statuses. It does not prove that designed controls are implemented or that a human accepted residual risk.
