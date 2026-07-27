# API Documentation

English | [简体中文](api.zh-CN.md)

> **Disclaimer**: this service's output is a check-item status compiled from public
> legal sources, **it does not constitute legal advice**. There is no LLM in the
> decision loop — `checks` can only be derived deterministically by the rule engine
> from `src/rules/*.json`.

This document is kept consistent with the zod schemas in `src/schemas/` (field
names, enum values, and required/optional-ness all follow the zod definitions;
every example below comes from an actual request/response reproducible via
`npm test`, not written from memory).

> **Note on literal string values**: throughout this document, JSON example values
> that the live service returns verbatim — the `disclaimer` field, `reason` text,
> and error `message` text — are preserved in the original Chinese, because that is
> what the service actually returns (see the `DISCLAIMER` constant in
> `src/http/constants.ts` and the message literals in `src/http/app.ts`). This is
> consistent across every module and code path; translating them here would make
> this document diverge from verifiable, actual output. Everything else in this
> document — field names, prose, and schema descriptions — is in English.

Base URL: local development defaults to `http://localhost:3000` (`PORT`
configurable). Current live instance:
`https://msb-agent-production-769d.up.railway.app` (Railway; see the README
"Live Demo" section).

## Endpoint Overview

| Method | Path                                    | Paid       | Description                                                           |
| ------ | ---------------------------------------- | ---------- | ---------------------------------------------------------------------- |
| GET    | `/`                                       | No         | Service directory JSON (name, description, endpoint map, repository)  |
| GET    | `/healthz`                               | No         | Deployment-platform health check; the only endpoint exempt from rate limiting |
| GET    | `/static/agent-icon.png`                 | No         | Agent card icon image                                                  |
| GET    | `/modules`                               | No         | Lists the 4 modules' pricing, payee address, legal sources, and version |
| GET    | `/modules/:id/schema`                    | No         | JSON Schema for that module's evidence fields                          |
| GET    | `/.well-known/agent-card.json`           | No         | ERC-8004 registration-v1 agent card                                    |
| GET    | `/.well-known/agent-registration.json`   | No         | Domain-control proof for a registered identity; `404` if unregistered  |
| POST   | `/modules/:id/check`                     | Yes (x402) | Submit transaction info, get a deterministic check result              |

`:id` ∈ `us-msb` \| `uk-msb` \| `eu-msb` \| `sg-msb` (`ModuleIdSchema`).

Free discovery paths, and the pre-payment validation path on the paid check
endpoint, are rate limited per client IP with a fixed window, default 60
requests/minute. Excess requests return HTTP 429 with a response body
containing `error=rate_limit_exceeded`, a human-readable `message`, and
`disclaimer`. Requests with an invalid or unverified payment credential still
count against the free-tier rate limit. Only retries of an already-settled
payment (within the 24-hour idempotency window) use a separate per-credential
bucket (default 60 requests/minute). **`GET /healthz` is the only endpoint
exempt from rate limiting** (intended for high-frequency polling by
deployment platforms); `GET /modules` and the other free endpoints — including
`GET /` and `GET /static/agent-icon.png` — are rate limited normally per the
rules above; they are **not** exempt.

Both `/.well-known/` endpoints are free and never enter the decision loop. The
agent card response uses `application/json; charset=utf-8` and
`Cache-Control: public, max-age=300`, and includes the four modules' pricing,
legal sources, endpoints, public payment parameters, and the disclaimer;
payment parameters are **not** covered by `evidence_hash`. `GET
/static/agent-icon.png` (the image the agent card's `image` field points to)
is served with `Cache-Control: public, max-age=86400`.

---

## GET /healthz

No payment required; does not load module metadata; never enters the decision
loop. Fixed response:

```json
{
  "status": "ok",
  "disclaimer": "本 Module 为基于公开法源整理的 Demo 版本，输出为检查项状态，不构成法律意见。"
}
```

The `disclaimer` field is the same `DISCLAIMER` constant used by every other
endpoint. This is the address deployment platforms (e.g. Railway) should point
their health check at; it is also the only path the rate-limit middleware's
`shouldSkip` allows through — it never consumes or counts against any rate
limit window.

---

## GET /modules

No payment required. Response:

```json
{
  "disclaimer": "本 Module 为基于公开法源整理的 Demo 版本，输出为检查项状态，不构成法律意见。",
  "modules": [
    {
      "module": "us-msb",
      "version": "2026.07.1",
      "updated_at": "2026-07-24T00:00:00Z",
      "jurisdiction": "United States",
      "maintainer": "MSB Compliance Module Service",
      "price_usdc": "0.800000",
      "pay_to": "0x0000000000000000000000000000000000000000",
      "sources": [
        {
          "source": "31 CFR § 1022.380",
          "source_url": "https://www.ecfr.gov/current/title-31/subtitle-B/chapter-X/part-1022",
          "accessed_date": "2026-07-23"
        }
      ],
      "input_schema_url": "/modules/us-msb/schema"
    }
  ]
}
```

Field semantics:

- `jurisdiction`: `United States` / `United Kingdom` / `European Union` /
  `Singapore` (fixed strings, see `MODULE_JURISDICTIONS` in
  `src/http/constants.ts`);
- `price_usdc`: sourced from `{MODULE}_PRICE_USDC` or the module's source-code
  default price, normalized to six decimal places; `pay_to` is read directly
  from `{MODULE}_PAY_TO`. Both are public information, **not secrets**;
  `pay_to` returns an empty string when unconfigured;
- `sources`: the de-duplicated set of every `{source, source_url,
  accessed_date}` entry in that module's rule file (de-duplicated by
  `source_url`);
- `input_schema_url`: points to `GET /modules/:id/schema`, so a purchaser can
  know in advance which `evidence` keys to submit, without trial and error.

## GET /modules/:id/schema

No payment required. Returns the JSON Schema for that module's input (exported
from zod via `z.toJSONSchema()`); the property set of the `evidence`
sub-schema is the **union** of every `required_evidence` entry across that
module's rule file (`createInputSchema` in `src/http/module-loader.ts`). The
response also carries a top-level `disclaimer` field.

Unknown module → `404`:

```json
{ "error": "module_not_found", "message": "未知模块", "disclaimer": "..." }
```

## POST /modules/:id/check

Paid endpoint (x402; see "Payment and Error Codes" below).

### Request Body (`DealInputSchema`, `z.strictObject`, extra fields are rejected)

| Field                  | Type                       | Required        | Description                                                                                            |
| ---------------------- | --------------------------- | --------------- | -------------------------------------------------------------------------------------------------------- |
| `deal_id`               | `string` (non-empty)       | Yes              | Transaction identifier generated by the purchaser, echoed into `settlement_constraints.deal_id`         |
| `parties`               | `Party[]` (at least 1 item) | Yes              | Transaction participants                                                                                 |
| `activity`              | `enum`                      | Yes              | `money_transmission` \| `currency_exchange` \| `stored_value` \| `crypto_transfer` \| `check_cashing`    |
| `amount_usdc`           | `number` (≥ 0)              | Yes              | Single-transaction amount, in USDC                                                                       |
| `monthly_volume_usdc`   | `number` (≥ 0) \| `null`    | No               | Monthly transaction volume; volume-tiered check items (e.g. Singapore SPI/MPI) depend on this field, and output `HOLD` when it is missing |
| `evidence`              | `Record<string, unknown>`  | Yes (`{}` is OK) | Evidence key/value pairs; the key set is that module's `GET /modules/:id/schema`                        |

`Party` (`z.strictObject`):

| Field     | Type                          | Required | Description                                   |
| --------- | ------------------------------ | -------- | ---------------------------------------------- |
| `role`    | `"payer"` \| `"payee"`         | Yes      |                                                 |
| `country` | `string`, matching `^[A-Z]{2}$` | Yes      | ISO 3166-1 alpha-2                             |
| `state`   | `string` (non-empty)           | No       | Currently only used by `us-msb`'s New York rule |

Request example:

```json
{
  "deal_id": "job-123",
  "parties": [
    { "role": "payer", "country": "US", "state": "NY" },
    { "role": "payee", "country": "SG" }
  ],
  "activity": "money_transmission",
  "amount_usdc": 10000,
  "monthly_volume_usdc": null,
  "evidence": { "fincen_msb_registration": false }
}
```

### Response Body (`ModuleResponseSchema`)

| Field                     | Type                                                       | Description                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `module`                  | `ModuleId`                                                   | Echoes the requested module                                                                                                                              |
| `version`                 | `string`, `^\d{4}\.\d{2}\.\d+$`                               | Rule file version (e.g. `2026.07.1`)                                                                                                                     |
| `updated_at`               | ISO8601 UTC (no offset suffix, `YYYY-MM-DDTHH:mm:ssZ`)        | Rule file's last-revised timestamp                                                                                                                        |
| `maintainer_wallet`         | `string`, `^0x[0-9a-fA-F]{40}$`                               | Module maintainer's royalty payee address; the zero address means this instance has no royalty payee configured — purchasers **must** treat this as "no royalty due" and **must not** transfer to the zero address |
| `royalty_bps`              | `integer`, 0–10000                                           | Royalty in basis points (10000 = 100%), based on this call's purchase price; this is an operational parameter **not covered by `evidence_hash`** — purchasers must validate against their own allow-list and per-transaction cap before paying it |
| `checks`                   | `CheckResult[]`                                               | See below                                                                                                                                                 |
| `overall`                  | `"PASS"` \| `"HOLD"` \| `"ESCALATE"`                          | Aggregate result, see "Aggregation Semantics"                                                                                                             |
| `settlement_constraints`   | `SettlementConstraints`                                       | See below                                                                                                                                                 |
| `evidence_hash`            | 64-character hex string                                       | Identical to `settlement_constraints.evidence_hash`                                                                                                       |
| `disclaimer`                | `string`                                                      | Fixed disclaimer text                                                                                                                                    |

`CheckResult`:

| Field    | Description                                                                              |
| -------- | ------------------------------------------------------------------------------------------ |
| `id`     | Rule id, e.g. `us-fincen-registration-money-transmission`                                  |
| `result` | `PASS` \| `HOLD` \| `ESCALATE`                                                              |
| `reason` | Human-readable reason (not part of `evidence_hash`; wording fixes never change the hash)    |
| `source` | Legal source citation (corresponds to the rule file's `source` field)                       |

`SettlementConstraints`:

| Field                          | Description                                                                                                                                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `module` / `module_version`      | Redundant copies of the root fields, so the payload is self-describing when passed to the settlement layer independently                                                                                                       |
| `deal_id`                        | Echoes the request's `deal_id`                                                                                                                                                                                                  |
| `valid_until`                    | Request time (UTC) + 72 hours, ISO8601. **When `PASS`**, means "this result may be referenced by the settlement layer within 72h"; **when `HOLD`/`ESCALATE`**, means "this blocking state may be referenced within 72h" — expiry does not imply approval, it only means the case needs to be re-checked |
| `blocked_check_ids`              | Only the ids of checks with `result = HOLD` (the "missing evidence, hold payment" routing path)                                                                                                                                 |
| `escalated_check_ids`            | Only the ids of checks with `result = ESCALATE` (the "gray area, route to human review" path, kept separate from the above)                                                                                                     |
| `evidence_hash`                  | Identical to the root-level field                                                                                                                                                                                                |

### Aggregation Semantics

Any check with `ESCALATE` → `overall = ESCALATE`; otherwise any check with
`HOLD` → `overall = HOLD`; otherwise `overall = PASS` (`aggregateCheckStatus`
in `src/engine/engine.ts`, priority order `ESCALATE > HOLD > PASS`).

### `evidence_hash` and `settlement_constraints`

```
evidence_hash = sha256( rules_file_bytes || 0x1F || canon(input) || 0x1F || canon(checks) )
```

- `rules_file_bytes`: the module's rule file's raw UTF-8 bytes (not
  JSON-canonicalized — the file itself is a versioned artifact, and its bytes
  are its identity);
- `canon(input)`: `{deal_id, parties, activity, amount_usdc,
  monthly_volume_usdc?, evidence}` canonicalized in RFC 8785 (JCS) style (keys
  sorted lexicographically, no whitespace, strings in NFC); `parties` is
  sorted by `(role, country, state)` first, so array write order does not
  affect the hash; when `monthly_volume_usdc` is `undefined` the whole field
  is omitted (not written as `null`);
- `canon(checks)`: an array of only `{id, result}`, sorted by `id` then
  canonicalized — **excluding `reason`**, so wording fixes never change the
  hash; only a `result` change is a substantive change;
- `0x1F` (Unit Separator) separates the three segments; each segment is itself
  valid JSON/UTF-8, eliminating concatenation ambiguity.

This algorithm is a public specification; a purchaser or third-party auditor
can offline-replay `evidence_hash` from the same rule file, the same request
body, and the same `checks` (implementation in
`src/evidence-hash/evidence-hash.ts`; the golden tests assert specific hash
values for known inputs, see `src/golden/citely-demo.test.ts`).

### Example: Complete Evidence → `PASS`

Once the request's `evidence` fills in every field `us-msb` requires:

```json
{
  "overall": "PASS",
  "settlement_constraints": {
    "blocked_check_ids": [],
    "escalated_check_ids": []
  }
}
```

### Example: No Evidence → `HOLD` (excerpted from the golden test's fixed snapshot)

```json
{
  "module": "us-msb",
  "version": "2026.07.1",
  "updated_at": "2026-07-24T00:00:00Z",
  "maintainer_wallet": "0x1111111111111111111111111111111111111111",
  "royalty_bps": 500,
  "checks": [
    {
      "id": "us-fincen-registration-money-transmission",
      "result": "HOLD",
      "reason": "缺少所需证据：fincen_msb_registration",
      "source": "31 CFR § 1022.380"
    },
    {
      "id": "us-fincen-registration-threshold-activities",
      "result": "PASS",
      "reason": "规则条件未触发",
      "source": "31 CFR § 1010.100(ff)"
    },
    {
      "id": "us-bsa-aml-program",
      "result": "HOLD",
      "reason": "缺少所需证据：bsa_aml_program",
      "source": "31 CFR § 1022.210"
    },
    {
      "id": "us-sar-controls",
      "result": "HOLD",
      "reason": "缺少所需证据：sar_monitoring_and_filing_controls",
      "source": "31 CFR § 1022.320"
    },
    {
      "id": "us-ny-money-transmitter-license",
      "result": "HOLD",
      "reason": "缺少所需证据：ny_money_transmitter_license",
      "source": "NY Banking Law Article 13-B"
    },
    {
      "id": "us-ny-bitlicense",
      "result": "PASS",
      "reason": "规则条件未触发",
      "source": "23 NYCRR Part 200"
    }
  ],
  "overall": "HOLD",
  "settlement_constraints": {
    "module": "us-msb",
    "module_version": "2026.07.1",
    "deal_id": "citely-demo-10000-usdc",
    "valid_until": "2026-07-27T12:00:00.000Z",
    "blocked_check_ids": [
      "us-fincen-registration-money-transmission",
      "us-bsa-aml-program",
      "us-sar-controls",
      "us-ny-money-transmitter-license"
    ],
    "escalated_check_ids": [],
    "evidence_hash": "fbf59533a95ef45bf3067772d45778f7c875aa0240a07b7a6376925b857cc12d"
  },
  "evidence_hash": "fbf59533a95ef45bf3067772d45778f7c875aa0240a07b7a6376925b857cc12d",
  "disclaimer": "本 Module 为基于公开法源整理的 Demo 版本，输出为检查项状态，不构成法律意见。"
}
```

### Example: `ESCALATE` (`eu-msb`, excerpt)

The `eu-amlr-2027-applicability` rule has `always_escalate: true` (AMLR is
already in force, but its main-body provisions only apply starting
2027-07-10; the rule engine has no way to express "not yet applicable during
the transition period", so this is routed to human review instead of being
silently skipped or misjudged as a violation):

```json
{
  "id": "eu-amlr-2027-applicability",
  "result": "ESCALATE",
  "reason": "规则无法确定性判定，需人工核实：AMLR 已生效但主体条款尚未适用，将自 2027-07-10 起适用；本项仅提示过渡准备并转人工，不把未来条款表述为当前违规",
  "source": "Regulation (EU) 2024/1624 (AMLR)"
}
```

A response with any `ESCALATE` has `overall = "ESCALATE"`, and the
corresponding check id appears in
`settlement_constraints.escalated_check_ids` (not in `blocked_check_ids`).

### Threshold-Based Check Items (amount / volume lower-bound determination)

The rule fields `when.amount_gte` / `when.monthly_volume_gte` express a
"single-transaction / monthly-volume lower bound". Semantics:

- `amount_gte` is a **single-transaction lower-bound test**: the evidence
  requirement is only triggered when the single-transaction
  `amount_usdc ≥ amount_gte`; legal thresholds are often expressed in
  aggregate terms (e.g. US currency exchange's $1,000/person/day cumulative
  threshold) — a single transaction ≥ the threshold can safely imply the
  aggregate is ≥ the threshold, but **a single transaction < the threshold
  cannot imply the aggregate < the threshold**. So when the rule condition is
  "not triggered", the engine still outputs `HOLD`
  (`reason: "单笔未达门槛，聚合情形需采购方自行核实"`), **never `PASS`**;
- `monthly_volume_gte` depends on the optional `monthly_volume_usdc` field:
  when missing (`undefined` or `null`) → the relevant check item is `HOLD`,
  `reason: "无法判定分级，需补交易量数据"`; when present but below the
  threshold → `PASS`, `reason: "月交易量未达规则门槛"`;
- Currency is uniformly assumed as USDC ≈ USD; non-USD legal thresholds (e.g.
  Singapore's SGD) are hard-coded in the rule file as already-converted USDC
  threshold values, with the conversion rate and conversion date noted in the
  `note` field — the engine performs no implicit currency conversion.

---

## Payment and Error Codes

| Status | Trigger condition                                                                                                                                                      | Response body highlights                                                                                                                                             |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `200`  | Validation passed, jurisdiction accepted, (in paid modes) payment succeeded                                                                                            | See `ModuleResponseSchema` above                                                                                                                                        |
| `400`  | Request body is not valid JSON, or fails `DealInputSchema` (**not charged**, validated before the x402 middleware)                                                    | `{ "error": "invalid_request", "issues": [{ "path": [...], "message": "..." }], "disclaimer": "..." }`                                                                 |
| `402`  | Only when `PAYMENT_MODE = x402-base-sepolia` / `x402-arc-testnet`, request carries no valid payment credential                                                        | Standard x402 `PAYMENT-REQUIRED` response header + 402 payload (generated by `@x402/hono`, not custom JSON written by this service — see below)                       |
| `404`  | `:id` is not one of `us-msb` \| `uk-msb` \| `eu-msb` \| `sg-msb`                                                                                                        | `{ "error": "module_not_found", ... }`                                                                                                                                  |
| `413`  | Request body exceeds 256KB                                                                                                                                              | `{ "error": "request_too_large", "message": "请求体不得超过 256KB", "disclaimer": "..." }`                                                                             |
| `422`  | Schema validation passed, but **every** party is outside the module's jurisdiction (jurisdiction acceptance boundary: **any** party inside the jurisdiction is accepted; `422` only fires when all parties are outside, to prevent using `422` to bypass the "escalate when rules can't express it" invariant) | `{ "error": "jurisdiction_not_applicable", "message": "全部交易方均不在 <法域> 模块适用法域内", "disclaimer": "..." }`                                                 |
| `500`  | Engine evaluation or response serialization throws after payment settlement has succeeded                                                                              | `{ "error": "internal_error", "message": "检查执行失败，可使用同一支付凭证重试", "payment_credential_id": "<sha256(credential)>" (if a payment credential was received), "disclaimer": "..." }` |
| `502`  | Facilitator unreachable (payment verification/settlement request failed, and no charge has been confirmed)                                                             | `{ "error": "facilitator_unavailable", "message": "支付服务暂不可用，请稍后重试", "disclaimer": "..." }`; produces no half-charged state                              |

**On the `402` response**: the response body is an empty JSON object (`{}`);
the actual x402 price quote is not in the body, it is base64-encoded in the
`payment-required` response header, per the x402 protocol (verified live
against the deployed instance; see the README "Live Demo" section for a
copy-pasteable example). An x402-aware client decodes that header
automatically — a plain `curl` without x402 support will only see `402` and
an empty body.

**Idempotency after payment**: once an x402 payment has been accepted, if
engine evaluation or response serialization then throws (→ `500`), the
service records a composite key made of the payment credential's hash
(`sha256(credential)`, the raw credential itself is never stored) and the
request body's hash. The same payment credential retried against the same
`:id` + request body **within 24 hours** skips being charged a second time,
and directly re-evaluates and returns the result (`PaidRetryStore` in
`src/payment/idempotency.ts`, sliding window of `24 * 60 * 60 * 1000`
milliseconds).

Request processing order: **request-body size (`413`) → zod validation
(`400`) → jurisdiction acceptance (`422`) → x402 middleware (`402`/`502`) →
rule engine evaluation (`200`, exception state `500`)** — invalid requests or
requests outside the jurisdiction never enter the paid flow.

---

This service's output is a check-item status compiled from public legal
sources, **it does not constitute legal advice**.
