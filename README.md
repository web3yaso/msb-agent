# MSB Compliance Module Service

English | [简体中文](README.zh-CN.md)

A pay-per-call API that provides cross-border money-transfer regulatory compliance
checks for **Citely Global Agent Deal Desk (cleardesk)**. The service is a
deterministic rule engine: 4 jurisdiction modules (US / UK / EU / Singapore)
mechanically evaluate transaction input against rule files and emit a three-state
check status of `PASS` / `HOLD` / `ESCALATE`, charged per call in testnet USDC on
Circle Arc Testnet via the [x402](https://www.x402.org/) protocol.

This project is the reference implementation of the 4 Compliance Modules
(solution flow chart F1–F3) in the Circle / Arc hackathon proposal
(Citely Deal Desk v2.2).

> **Disclaimer**: this service's output is a check-item status compiled from
> public legal sources, **it does not constitute legal advice** and does not
> represent a conclusion of "compliance" or "legality". There is no LLM in the
> decision loop — every check result is derived deterministically by the rule
> engine from auditable rule files, and can be verified offline by replaying
> `evidence_hash` (see below).

## Table of Contents

- [Project Scope](#project-scope)
- [Hackathon Architecture Position (Citely Deal Desk v2.2)](#hackathon-architecture-position-citely-deal-desk-v22)
- [Quick Start](#quick-start)
- [Architecture Highlights](#architecture-highlights)
- [API Overview](#api-overview)
- [Payment Layer (x402)](#payment-layer-x402)
- [CI Checks](#ci-checks)
- [Testing](#testing)
- [Configuration Reference](#configuration-reference)

## Project Scope

| Module   | Jurisdiction                                         | Acceptance condition                    |
| -------- | ----------------------------------------------------- | ---------------------------------------- |
| `us-msb` | United States (federal + New York State)              | any party with `country = "US"`          |
| `uk-msb` | United Kingdom                                        | any party with `country = "GB"`          |
| `eu-msb` | European Union (incl. DE/FR/NL member-state specifics) | any party in one of the 27 EU member states |
| `sg-msb` | Singapore                                             | any party with `country = "SG"`          |

**Out of scope**: automated rule updates, multilingual output, KYB/wallet data
procurement (belongs to Citely F4, a different provider), Jurisdiction Review
(belongs to Citely F5), and real legal advice.

## Hackathon Architecture Position (Citely Deal Desk v2.2)

The four-layer architecture, top to bottom: L4 Client Execution Layer → L3 Arc
Testnet Protocol & Payment Layer → L2 Adjudication Service Layer (case engine,
main repo) → **L1 Knowledge & Supply Layer (this repo = the module-server)**.
L2 calls this repo over HTTP + x402 paid requests; from L2's perspective this
repo is a deployed third-party Module vendor, deployed independently and not
folded into the main-repo monorepo.

| Repository         | Responsibility                                                                    | Relationship                                       |
| ------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| `citely-deal-desk`  | L2/L3/L4 + rubrics, main repo (**TODO: GitHub link to be added once the main repo is public**) | Main repo's README will link back to this repo, forming a mutual link |
| `msb-agent`         | L1 module-server, this repo, independently deployed                                | Provides the paid Module API to the main repo       |

L2 calls `POST /modules/:id/check`; after a successful payment it reads
`evidence_hash` from the 200 response (recorded into the SA's `modules_used`),
as well as `maintainer_wallet` / `royalty_bps` (used for the royalty
micropayment and the ledger's `category=royalty` entries). This repo only
outputs check-item status; settlement orchestration and SA generation for
PASS/HOLD/ESCALATE happen in L2. This repo contains no LLM and produces no
legal advice.

> **Royalty parameter warning** (see [docs/api.md](docs/api.md) for the full
> spec): a `maintainer_wallet` of `0x000…000` (the zero address) means this
> instance has no royalty payee configured — purchasers must treat this as
> "no royalty is due" and **must not transfer funds to the zero address**;
> `royalty_bps` is an operational parameter, **it is not backed by
> `evidence_hash`**, and purchasers must validate it against their own
> whitelist and per-transaction cap before paying the royalty.

## Quick Start

Requirements: Node.js 20+ (verified against Node 22/25 in the dev environment), npm.

```bash
npm install
cp .env.example .env
```

`.env.example` ships with `PAYMENT_MODE=off` by default (starts locally without
payment; note that this is only the explicit value in the example file — the
source-code default is `x402-arc-testnet`, see "Payment Layer" below). Start
in `off` mode:

```bash
npm run dev        # tsx watch, listens on PORT (default 3000)
npm test            # vitest run, covers engine/HTTP/golden/payment layer tests
npx tsc --noEmit    # type check
```

Once running, you can probe the discovery endpoints directly:

```bash
curl http://localhost:3000/modules
curl http://localhost:3000/modules/us-msb/schema
```

In `off` mode, `POST /modules/:id/check` is free and can be wired up directly
for business-logic testing; in `x402-*` modes, the same endpoint first returns
HTTP 402 (see below).

## Architecture Highlights

- **No LLM in the decision loop**: the `checks` returned by
  `POST /modules/:id/check` can only be derived deterministically by the pure
  function `evaluate(rules, input, rulesFileBytes)` in `src/engine/engine.ts`
  from the `src/rules/*.json` rule files; any situation the rules cannot
  express is always output as `ESCALATE` — silent skipping is not allowed
  (for example, when a crypto asset crosses a specific regulatory boundary).
- **Rule files are the legal source**: one rule file per module
  (`src/rules/us-msb.json` / `uk-msb.json` / `eu-msb.json` / `sg-msb.json`);
  every rule must carry `source` / `source_url` / `accessed_date`; any rule
  change must bump `version` (`YYYY.MM.N`) and `updated_at` together — CI
  (`npm run validate:rules`) blocks omissions.
- **`evidence_hash` is replayable/verifiable**:

  ```
  evidence_hash = sha256( rules_file_bytes || 0x1F || canon(input) || 0x1F || canon(checks) )
  ```

  `canon()` is RFC 8785 (JCS)–style canonical JSON (keys sorted
  lexicographically, no whitespace, strings in NFC); the `parties` array is
  sorted by `(role, country, state)` before canonicalization, so array write
  order does not affect the hash; `canon(checks)` keeps only `{id, result}`
  (excluding the `reason` text, so wording fixes never change the hash). The
  rule file bytes themselves are not JSON-canonicalized — the file is a
  versioned artifact, and its bytes are its identity. See
  `src/evidence-hash/evidence-hash.ts` for the algorithm implementation and
  [docs/api.md](docs/api.md#evidence_hash-与-settlement_constraints) for
  field-level semantics.

- **Threshold rules are a conservative single-transaction lower bound**: legal
  thresholds are often expressed in aggregate terms (e.g. US currency
  exchange's $1,000/person/day cumulative threshold, Singapore's SPI/MPI
  monthly-volume tiers); the engine only looks at the single-transaction /
  monthly-volume input provided, applying the conservative trigger direction
  "single transaction ≥ threshold ⇒ aggregate must be ≥ threshold" — when the
  single transaction is below the threshold, the engine **never outputs
  PASS** (it can only output HOLD, indicating that the aggregate case needs
  to be verified by the purchaser). See [docs/api.md](docs/api.md) for details.
- **Jurisdiction acceptance boundary**: a request is accepted as long as
  **any** party falls within the module's jurisdiction (factors outside the
  module are expressed via an `ESCALATE` check item); 422 is only returned
  when **all** parties are outside the jurisdiction — this boundary is
  intentional, to prevent using 422 to bypass the "escalate when rules can't
  express it" invariant.

## API Overview

Three endpoints; see **[docs/api.md](docs/api.md)** for detailed fields and
error codes:

```
GET  /modules                  Free. Lists the 4 modules' pricing, payee address, legal sources, and version.
GET  /modules/:id/schema       Free. JSON Schema (exported from zod) for that module's evidence fields.
POST /modules/:id/check        Paid (x402). Submit transaction info, get a deterministic check result.
```

`POST /modules/:id/check` example (`us-msb`, `PAYMENT_MODE=off`):

```bash
curl -X POST http://localhost:3000/modules/us-msb/check \
  -H 'content-type: application/json' \
  -d '{
    "deal_id": "job-123",
    "parties": [
      { "role": "payer", "country": "US", "state": "NY" },
      { "role": "payee", "country": "SG" }
    ],
    "activity": "money_transmission",
    "amount_usdc": 10000,
    "monthly_volume_usdc": null,
    "evidence": {}
  }'
```

Response excerpt (no evidence submitted, `overall` is `HOLD`; see docs/api.md
for the complete field set):

```json
{
  "module": "us-msb",
  "version": "2026.07.1",
  "checks": [
    {
      "id": "us-fincen-registration-money-transmission",
      "result": "HOLD",
      "reason": "Missing required evidence: fincen_msb_registration",
      "source": "31 CFR § 1022.380"
    }
  ],
  "overall": "HOLD",
  "settlement_constraints": {
    "blocked_check_ids": ["us-fincen-registration-money-transmission", "..."],
    "...": "..."
  },
  "evidence_hash": "fbf59533a95ef45bf3067772d45778f7c875aa0240a07b7a6376925b857cc12d",
  "disclaimer": "This Module is a demo compiled from public legal sources; its output is check-item status and does not constitute legal advice."
}
```

> Note: the `reason` and `disclaimer` text above is translated for readability;
> the live service always returns Chinese text for these two fields (see
> `src/http/constants.ts` `DISCLAIMER` and the rule files' `note` values) —
> this is a documentation-only translation, not a change in service behavior.

## Payment Layer (x402)

Three `PAYMENT_MODE` tiers, **the source-code default is `x402-arc-testnet`**
(the default is never allowed to be `off` — this is an architectural red line):

| Mode                | Purpose                                                    | Network                       |
| ------------------- | ------------------------------------------------------------ | ------------------------------ |
| `off`               | Local development / unit tests; must be set explicitly to take effect | no payment is initiated |
| `x402-base-sepolia` | Fallback: degraded demo path if the Arc facilitator is unstable | Base Sepolia, `eip155:84532`  |
| `x402-arc-testnet`  | **Primary target**: Circle's hosted testnet facilitator      | Arc Testnet, `eip155:5042002` |

Differentiated default pricing per module, overridable via the corresponding
`{MODULE}_PRICE_USDC` environment variable:

| Module   | Price per call (testnet USDC) |
| -------- | -----------------------------: |
| `us-msb` |                     `0.800000` |
| `eu-msb` |                     `0.600000` |
| `uk-msb` |                     `0.400000` |
| `sg-msb` |                     `0.200000` |

Valid price range is `0 < price <= 100`, validated at startup and normalized to
six decimal places; invalid values immediately abort startup, guarding against
a misplaced decimal point causing a billing incident.
Payee addresses are configured via four environment variables such as
`US_MSB_PAY_TO` — the payee address is public information and appears in the
`GET /modules` response, but it is never written into code or documentation;
it is always sourced from environment variables.

Request processing order: **zod validation first (failure → 400, does not
enter the payment flow) → x402 middleware charges → rule engine evaluation**,
so invalid requests are never charged by mistake.

Arc Testnet uses Circle Gateway's `GatewayWalletBatched` payment scheme
(`@x402/hono` + `@circle-fin/x402-batching`). Sequence to exercise the real
on-chain flow:

1. Get testnet USDC on Arc Testnet from [faucet.circle.com](https://faucet.circle.com/);
2. Deposit testnet USDC into Circle Gateway via `GatewayClient.deposit(...)`
   (`smoke-arc.ts` performs this step automatically when the balance is
   insufficient);
3. The client calls `POST /modules/:id/check` → receives 402 →
   `GatewayClient.pay(...)` signs the payment → the server verifies/settles it
   → returns 200 + check results.

This repo has already exercised one real smoke test (not placeholder data):
Gateway deposit tx
`0xfcc78968b336ac103fe577cfd74075309cf70720eb086a7394c28146d83919f7`, payment
settlement ID `49f19918-632c-4ffe-9869-27be6472ac69`. Reproduce with:

```bash
PAYMENT_MODE=x402-arc-testnet \
MODULE_MAINTAINER_WALLET=<maintainer wallet address> \
X402_SMOKE_CLIENT_PRIVATE_KEY=<test wallet private key, placeholder, do not commit> \
npm run smoke:arc
```

`x402-arc-testnet` mode requires `MODULE_MAINTAINER_WALLET` to be set,
otherwise the service fails fast at startup; `npm run smoke:arc` is subject to
the same check.

For the environment variables the smoke script uses
(`X402_SMOKE_CLIENT_PRIVATE_KEY` / `SMOKE_ARC_RPC_URL` / `SMOKE_MODULE` /
`SMOKE_PORT` / `SMOKE_DEPOSIT_USDC`), see `scripts/smoke-arc.ts` itself and
"Configuration Reference" below; if `.env.example` has not yet listed this
family of variables, the definitions inside the script take precedence (the
script validates the format of every variable and reports errors).

## CI Checks

```bash
npm run validate:rules   # fails if a rule file is missing `source` / the version wasn't bumped / `updated_at` wasn't refreshed
CHECK_RULE_LINKS=1 npm run check:links   # checks that legal-source links are alive; skipped if this variable is unset
```

`check:links` supports an exemption list, `scripts/link-exemptions.json`: URLs
in the list only warn, they never fail the check (currently exempting the MAS
Notices official portal, pending manual verification of the exact PSN01/PSN02
deep links).

## Testing

```bash
npm test
```

Three layers of tests (see `docs/api.md` or the corresponding source for
details):

1. Engine unit tests: at least one triggering/non-triggering case per rule +
   determinism test (evaluating the same input twice produces identical
   `checks`/`evidence_hash`);
2. Golden tests (`src/golden/citely-demo.test.ts`): fixed input/output
   snapshots for all four modules under the Citely Demo scenario (US Client →
   Singapore Marketplace → UK/DE service providers, nominal 10,000 USDC),
   including cross-run `evidence_hash` consistency assertions and a
   `disclaimer` presence assertion; snapshots must be regenerated and the
   diff manually reviewed after any rule version bump;
3. Integration tests: the full x402 402 → pay → 200 flow (`base-sepolia` is
   covered continuously by unit tests; `arc-testnet` is covered by
   `npm run smoke:arc`, a real on-chain smoke test that is not part of the
   regular `npm test` flow).

## Configuration Reference

See `.env.example` for the complete template (copy it to `.env` and adjust as
needed; never commit real payee addresses/private keys to the repo). Core
configuration items:

| Variable                                                                              | Description                                                                                  | Default                                                        |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `PAYMENT_MODE`                                                                        | `off` \| `x402-base-sepolia` \| `x402-arc-testnet`                                          | source default `x402-arc-testnet` (`.env.example` explicitly shows `off`) |
| `PORT`                                                                                | HTTP listen port                                                                             | `3000`                                                          |
| `US_MSB_PRICE_USDC` / `UK_MSB_PRICE_USDC` / `EU_MSB_PRICE_USDC` / `SG_MSB_PRICE_USDC` | Per-module price per call, up to 6 decimal places                                           | `0.800000` / `0.400000` / `0.600000` / `0.200000` respectively  |
| `US_MSB_PAY_TO` / `UK_MSB_PAY_TO` / `EU_MSB_PAY_TO` / `SG_MSB_PAY_TO`                 | Per-module payee address (`0x` + 40 hex chars); not validated in `off` mode, required in x402 modes | placeholder address, must be replaced before going live         |
| `MODULE_MAINTAINER_WALLET`                                                            | Global maintainer royalty payee address; required in x402 modes, overridable per module via the four `{MODULE}_MAINTAINER_WALLET` variables | falls back to the zero address in `off` mode                    |
| `MODULE_ROYALTY_BPS`                                                                  | Global royalty basis points (integer 0–10000), overridable per module via the four `{MODULE}_ROYALTY_BPS` variables | `0`                                                              |
| `X402_ARC_TESTNET_FACILITATOR_URL`                                                    | Circle Arc Testnet hosted facilitator URL; used only in `x402-arc-testnet`                  | none (required in that mode)                                    |
| `X402_BASE_SEPOLIA_FACILITATOR_URL`                                                   | Base Sepolia facilitator URL; used only in `x402-base-sepolia`                               | none (required in that mode)                                    |
| `CHECK_RULE_LINKS`                                                                    | Set to `1` to enable legal-source link liveness checks (makes network requests)             | `0` (skipped)                                                    |
| `RULES_BASE_REF`                                                                      | git comparison base ref for the rule-version CI check                                       | `HEAD^`                                                          |

Additional variables used only by `npm run smoke:arc` (real on-chain smoke
test only; does not affect `npm run dev` / `npm test`):
`X402_SMOKE_CLIENT_PRIVATE_KEY` (required, test wallet private key),
`SMOKE_ARC_RPC_URL` (optional, custom RPC), `SMOKE_MODULE` (optional, default
`us-msb`), `SMOKE_PORT` (optional, default `4402`), `SMOKE_DEPOSIT_USDC`
(optional, default `1.50`).

---

This service's output is a check-item status compiled from public legal
sources; **it does not constitute legal advice**.
