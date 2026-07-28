# MSB Compliance Module Service

English | [简体中文](README.zh-CN.md)

A deterministic, pay-per-call API that checks cross-border money-transmission
activity against MSB regulatory requirements for four jurisdictions (US / UK /
EU / Singapore), billed per call in testnet USDC via the
[x402](https://www.x402.org/) protocol on Circle Arc Testnet.

> **Disclaimer**: this service's output is a check-item status compiled from
> public legal sources, **it does not constitute legal advice** and does not
> represent a conclusion of "compliance" or "legality". There is no LLM in the
> decision loop — every check result is derived deterministically by the rule
> engine from auditable rule files, and can be verified offline by replaying
> `evidence_hash`.

## For AI Agents: Integrate in 3 Steps

Live instance: **<https://msb-agent-production-769d.up.railway.app>**

### 1. Discover

```bash
curl https://msb-agent-production-769d.up.railway.app/modules
```

Returns the four modules (`us-msb`, `uk-msb`, `eu-msb`, `sg-msb`), their
pricing, payee addresses, legal sources, and `input_schema_url`. You can also
discover this service through its
[ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) identity: `GET
/.well-known/agent-card.json` is registered on Arc Testnet's Identity
Registry as Agent ID `851930`.

### 2. Pay

Calling the paid endpoint without a payment credential returns `402`:

```bash
curl -i -X POST https://msb-agent-production-769d.up.railway.app/modules/us-msb/check \
  -H 'content-type: application/json' \
  -d '{
    "deal_id": "demo-001",
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

The `402` body is an empty `{}`; the actual price quote is base64-encoded in
the `payment-required` response header per the x402 protocol (`scheme:
"exact"`, `network: "eip155:5042002"`, settlement via Circle Gateway's
`GatewayWalletBatched`). Any x402-aware client can pay it. A minimal example
using `@circle-fin/x402-batching` (your wallet's USDC must already be
deposited into its Circle Gateway balance):

```ts
import { GatewayClient } from "@circle-fin/x402-batching/client";

const gatewayClient = new GatewayClient({ chain: "arcTestnet", privateKey });
const response = await gatewayClient.pay(
  "https://msb-agent-production-769d.up.railway.app/modules/us-msb/check",
  { method: "POST", headers: { "content-type": "application/json" }, body: dealInput },
);
// response.status === 200; response.transaction is the settlement ID; response.data is the check result
```

### 3. Verify

A successful `200` response has this shape (not a literal example — see
[docs/api.md](docs/api.md) for real, reproducible request/response pairs):

```json
{
  "module": "us-msb",
  "checks": [{ "id": "...", "result": "PASS | HOLD | ESCALATE", "reason": "...", "source": "..." }],
  "overall": "PASS | HOLD | ESCALATE",
  "settlement_constraints": { "blocked_check_ids": [], "escalated_check_ids": [], "evidence_hash": "..." },
  "evidence_hash": "...",
  "disclaimer": "..."
}
```

`evidence_hash` is a sha256 over the rule file bytes, the canonicalized input,
and the canonicalized checks — anyone can replay it offline with the same
public rule files to independently verify the result. Full field-by-field
reference: **[docs/api.md](docs/api.md)**.

### Try It Now

```bash
git clone https://github.com/web3yaso/msb-agent.git && cd msb-agent && npm ci
```

Create `.env.local` with two lines — with your editor, or with `read -rs` so
the key is never typed on the command line and you don't overwrite any
secrets the file may already hold:

```
X402_SMOKE_CLIENT_PRIVATE_KEY=0xyour_test_wallet_private_key
SMOKE_FORCE_DEPOSIT=1
```

```bash
read -rs KEY && printf 'X402_SMOKE_CLIENT_PRIVATE_KEY=%s\nSMOKE_FORCE_DEPOSIT=1\n' "$KEY" >> .env.local
node --env-file=.env.local --import tsx scripts/smoke-public.ts
```

`.env.local` is already covered by this repo's `.gitignore` (`.env.*`), so it is
never committed. Passing the key inline (`X402_SMOKE_CLIENT_PRIVATE_KEY=0x...
npm run smoke:public`) leaves it in both your shell history and visible to
other local processes via `ps`. The `.env.local` + `--env-file` approach above
removes the `ps` exposure — but only if the key is never typed out literally on
a command line: creating the file with an editor, or with `read -rs` (which
doesn't echo and isn't recorded in shell history) as shown, keeps it out of
history too. A `printf` command with the key written out literally would still
land in shell history.

This runs the full loop above against the live instance with real testnet
USDC and prints the result:

```
Payment settlement ID: c4449fea-c80a-4b40-97db-baf8740678cf
evidence_hash: f89b48ed…ca2f
overall: HOLD
```

Use a **test-only** wallet holding Arc Testnet USDC (free from
[faucet.circle.com](https://faucet.circle.com/)) — never a wallet holding real
assets. `SMOKE_FORCE_DEPOSIT=1` deposits it into your Circle Gateway balance
automatically if needed (can take a few minutes). Default module `us-msb`
costs `0.800000` testnet USDC per call. Prerequisites (Node 20+) and the full
script reference are in [docs/deploy.md](docs/deploy.md).

## What This Is

This is a reference implementation of the compliance-check modules for the
Circle / Arc hackathon proposal (Citely Deal Desk v2.2), usable standalone by
any agent. It is a deterministic rule engine — every check result and
`evidence_hash` is derived mechanically from versioned, source-cited rule
files, with no LLM anywhere in the decision loop. Each call is billed
individually via x402 in testnet USDC on Circle Arc Testnet. Output is a
check-item status, never legal advice.

## Reference and Further Reading

- **[docs/api.md](docs/api.md)** — full API reference: every endpoint, request/response
  schema, error code, the `evidence_hash` algorithm, and payment modes/pricing
  (also includes the royalty-parameter caveat: `maintainer_wallet` /
  `royalty_bps` are operational parameters **not backed by `evidence_hash`**,
  and a zero `maintainer_wallet` means no royalty is configured).
- **[docs/deploy.md](docs/deploy.md)** — local development, testing/CI, the full
  environment-variable reference, and the Railway deployment + ERC-8004
  registration procedure.
- **[docs/marketplace/](docs/marketplace/)** — Circle Agent Marketplace submission
  materials.

The service is deployed on Railway at the URL above. Its ERC-8004 on-chain
identity registration is **complete**: Identity Registry
`0x8004A818BFB912233c491871b3d84c89A494BD9e` (Arc Testnet), Agent ID `851930`,
registration transaction
[`0x519b1a5d94d0d4e28468cf4fd07143d776d78cf9df0035ea498b17fd48be2097`](https://testnet.arcscan.app/tx/0x519b1a5d94d0d4e28468cf4fd07143d776d78cf9df0035ea498b17fd48be2097).
The Circle Agent Marketplace application was **submitted on 2026-07-27, pending
Circle review** — this repository does not claim the service is listed or
approved.

## Hackathon Attribution

This project is the reference implementation of the 4 Compliance Modules
(solution flow chart F1–F3) in the Circle / Arc hackathon proposal (Citely
Deal Desk v2.2), where it serves as the independently-deployed L1
module-server that the main repo's L2 adjudication layer calls over x402.

---

This service's output is a check-item status compiled from public legal
sources; **it does not constitute legal advice**.
