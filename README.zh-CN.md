# MSB Compliance Module Service

[English](README.md) | 简体中文

一个确定性、按次付费的 API：对跨境汇款活动核对五个法域（美国 / 英国 / 欧盟 /
新加坡 / 阿联酋）的 MSB 监管要求，通过 [x402](https://www.x402.org/) 协议在 Circle Arc
Testnet 上以测试网 USDC 按次计费。

> **免责声明**：本服务输出为基于公开法源整理的检查项状态，**不构成法律意见**，
> 也不代表"合规"或"合法"结论。判定回路中不含 LLM——每个 check 结果都由规则引擎
> 从可审计的规则文件确定性推导，可用 `evidence_hash` 离线重放验证。

## AI Agent 接入三步

线上实例：**<https://msb-agent-production-769d.up.railway.app>**

### 1. 发现

```bash
curl https://msb-agent-production-769d.up.railway.app/modules
```

返回五个模块（`us-msb`、`uk-msb`、`eu-msb`、`sg-msb`、`ae-msb`）的定价、收款地址、
法源与 `input_schema_url`。也可以通过 [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) 身份发现本服务：`GET
/.well-known/agent-card.json` 已在 Arc Testnet 的 Identity Registry 注册为
Agent ID `851930`。

### 2. 支付

不带支付凭证调用付费端点会返回 `402`：

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

`402` 响应体是空 JSON（`{}`）；真正的报价单按 x402 协议 base64 编码在
`payment-required` 响应头里（`scheme: "exact"`、`network: "eip155:5042002"`，
结算走 Circle Gateway 的 `GatewayWalletBatched`）。任何支持 x402 协议的客户端都
能完成支付。用 `@circle-fin/x402-batching` 的一个最小示例（钱包的 USDC 需要已经
存入 Circle Gateway 余额）：

```ts
import { GatewayClient } from "@circle-fin/x402-batching/client";

const gatewayClient = new GatewayClient({ chain: "arcTestnet", privateKey });
const response = await gatewayClient.pay(
  "https://msb-agent-production-769d.up.railway.app/modules/us-msb/check",
  { method: "POST", headers: { "content-type": "application/json" }, body: dealInput },
);
// response.status === 200；response.transaction 是结算 ID；response.data 是检查结果
```

### 3. 验证

`200` 响应的大致形状如下（不是逐字示例——真实可复现的请求/响应见
[docs/api.zh-CN.md](docs/api.zh-CN.md)）：

```json
{
  "module": "us-msb",
  "engine_version": "1.0.0",
  "hash_scheme_version": "2",
  "checks": [
    {
      "id": "...",
      "result": "PASS | HOLD | ESCALATE | NOT_APPLICABLE",
      "basis": "...",
      "reason": "...",
      "source": "..."
    }
  ],
  "overall": "PASS | HOLD | ESCALATE | NOT_APPLICABLE",
  "settlement_constraints": {
    "blocked_check_ids": [],
    "escalated_check_ids": [],
    "evidence_hash": "..."
  },
  "evidence_hash": "...",
  "disclaimer": "..."
}
```

`overall = NOT_APPLICABLE` 表示本模块没有适用检查项，不构成放行，也不代表合规通过。

`evidence_hash` 是对版本上下文、规则文件字节、规范化输入、规范化 checks 的
sha256——任何人都可以用相同的公开规则文件离线重放，确认这些材料和结果未被修改。
它不证明调用方提交的证据真实。逐字段完整参考见
**[docs/api.zh-CN.md](docs/api.zh-CN.md)**。

### 立即体验

```bash
git clone https://github.com/web3yaso/msb-agent.git && cd msb-agent && npm ci
```

创建 `.env.local` 并写入两行——可以用编辑器手动创建，也可以用 `read -rs`：这样
私钥不会出现在命令行里，且不会覆盖该文件里可能已有的其它私钥：

```
X402_SMOKE_CLIENT_PRIVATE_KEY=0x你的测试钱包私钥
SMOKE_FORCE_DEPOSIT=1
```

```bash
read -rs KEY && printf 'X402_SMOKE_CLIENT_PRIVATE_KEY=%s\nSMOKE_FORCE_DEPOSIT=1\n' "$KEY" >> .env.local
node --env-file=.env.local --import tsx scripts/smoke-public.ts
```

`.env.local` 已被本仓库的 `.gitignore`（`.env.*`）覆盖，不会被提交。行内写法传参
（`X402_SMOKE_CLIENT_PRIVATE_KEY=0x... npm run smoke:public`）会让私钥同时留在
shell 历史里，且同机其它进程可通过 `ps` 看到。上面的 `.env.local` + `--env-file`
写法消除了 `ps` 暴露——但只有在私钥从未以明文出现在命令行时才能同时避开 shell
历史：用编辑器创建该文件，或像上面那样用 `read -rs`（不回显、也不记入 shell
历史），才能两者都避开。若直接用把私钥明文写进命令行的 `printf` 命令，私钥仍会
留在 shell 历史里。

这会对线上实例用真实测试网 USDC 完整跑一遍上面的流程并打印结果：

```
Payment settlement ID: c4449fea-c80a-4b40-97db-baf8740678cf
evidence_hash: f89b48ed…ca2f
overall: HOLD
```

请使用**仅用于测试**、持有 Arc Testnet USDC 的钱包（可到
[faucet.circle.com](https://faucet.circle.com/) 免费领取）——绝不要使用持有真实
资产的钱包。`SMOKE_FORCE_DEPOSIT=1` 会在需要时自动把它存入你的 Circle Gateway
余额（可能需要几分钟）。默认模块 `us-msb` 每次调用 `0.800000` 测试网 USDC。前置
条件（Node 20+）与完整脚本说明见 [docs/deploy.md](docs/deploy.md)。

## 模块一览

| 模块     | 法域                 | 规则版本  | 规则数 | 默认单价（测试网 USDC） |
| -------- | -------------------- | --------- | ------ | ----------------------- |
| `us-msb` | 美国                 | 2026.07.1 | 6      | 0.800000                |
| `uk-msb` | 英国                 | 2026.07.1 | 6      | 0.400000                |
| `eu-msb` | 欧盟（27 国）        | 2026.07.2 | 9      | 0.600000                |
| `sg-msb` | 新加坡               | 2026.07.1 | 5      | 0.200000                |
| `ae-msb` | 阿联酋               | 2026.08.1 | 6      | 1.000000                |

每个模块有法域前置校验：至少一个交易方的 `country` 落在该模块法域内
（`US` / `GB` / 欧盟成员国 / `SG` / `AE`）才受理，否则在扣费前返回 `422`。

**阿联酋（`ae-msb`）专门说明**：规则法源包括 CBUAE 零售支付服务与卡计划条例
（Retail Payment Services and Card Schemes Regulation）、2025 年第 10 号联邦法令
（AML/CFT/CPF 主法，2025-10-14 起生效）、UAE FIU goAML 平台注册要求、2025 年
第 134 号内阁决议（跨境汇款人/收款人信息）、VARA 虚拟资产转移与结算服务规则手册，
以及 CBUAE 支付代币服务条例（PTSR）第 12 条。注意：任何 AE 交易只要
`activity` 为 `crypto_transfer` 或 `stored_value`，`overall` 恒为
`ESCALATE`——外币支付代币（如 USDC）能否在阿联酋境内用于支付在 PTSR 第 12 条下
属真实监管灰区，模块刻意将其转人工复核而非猜测。这是设计行为，不是服务故障，
详见 [docs/api.zh-CN.md](docs/api.zh-CN.md)。

## 这是什么

本项目是 Circle / Arc 黑客松方案（Citely Deal Desk v2.2）中合规检查模块的参考
实现，也可被任何 agent 独立使用。它是一个确定性规则引擎——每个 check 结果与
`evidence_hash` 都由带版本、带法源引用的规则文件机械推导，判定回路中完全不含
LLM。每次调用通过 x402 在 Circle Arc Testnet 上以测试网 USDC 单独计费。输出是
检查项状态，绝不是法律意见。

## 参考与延伸阅读

- **[docs/api.zh-CN.md](docs/api.zh-CN.md)** — 完整 API 参考：每个端点、请求/响应
  schema、错误码、`evidence_hash` 算法、支付模式与定价（含版税参数警示：
  `maintainer_wallet` / `royalty_bps` 是运营参数，**不被 `evidence_hash` 背书**，
  `maintainer_wallet` 为零地址表示本实例未配置版税收款方）。
- **[docs/deploy.md](docs/deploy.md)** — 本地开发、测试与 CI、完整环境变量参考，
  以及 Railway 部署 + ERC-8004 注册流程。
- **[docs/marketplace/](docs/marketplace/)** — Circle Agent Marketplace 提交材料。

服务已部署在上述 Railway 地址。ERC-8004 链上身份注册**已完成**：Identity
Registry `0x8004A818BFB912233c491871b3d84c89A494BD9e`（Arc Testnet）、Agent ID
`851930`、注册交易
[`0x519b1a5d94d0d4e28468cf4fd07143d776d78cf9df0035ea498b17fd48be2097`](https://testnet.arcscan.app/tx/0x519b1a5d94d0d4e28468cf4fd07143d776d78cf9df0035ea498b17fd48be2097)。
Circle Agent Marketplace 申请**已于 2026-07-27 提交，待 Circle 审核**——本仓库不
声称该服务已上架或已通过审核。

## 黑客松归属

本项目是 Circle / Arc 黑客松方案（Citely Deal Desk v2.2）中 4 个 Compliance
Module（方案流程图 F1–F3）的参考实现，在该方案里作为独立部署的 L1
module-server，由主仓库的 L2 判定服务层通过 x402 调用。

---

本服务输出为基于公开法源整理的检查项状态，**不构成法律意见**。
