# MSB Compliance Module Service

为 **Citely Global Agent Deal Desk（cleardesk）** 提供跨境汇款监管合规检查的按次付费
API。服务是一个确定性规则引擎：4 个法域模块（美国 / 英国 / 欧盟 / 新加坡）依据规则
文件对交易输入做机械求值，输出 `PASS` / `HOLD` / `ESCALATE` 三态检查项状态，通过
[x402](https://www.x402.org/) 协议在 Circle Arc Testnet 上以测试网 USDC 收费结算。

本项目是 Circle / Arc 黑客松方案（Citely Deal Desk v2.2）中的 4 个 Compliance
Module（方案流程图 F1–F3）参考实现。

> **免责声明**：本服务输出为基于公开法源整理的检查项状态，**不构成法律意见**，
> 也不代表"合规"或"合法"结论。判定回路中不含 LLM——每个 check 结果都由规则引擎
> 从可审计的规则文件确定性推导，可用 `evidence_hash` 离线重放验证（见下文）。

## 目录

- [项目定位](#项目定位)
- [黑客松架构位置（Citely Deal Desk v2.2）](#黑客松架构位置citely-deal-desk-v22)
- [快速开始](#快速开始)
- [架构要点](#架构要点)
- [API 概览](#api-概览)
- [支付层（x402）](#支付层x402)
- [CI 校验](#ci-校验)
- [测试](#测试)
- [配置项一览](#配置项一览)

## 项目定位

| 模块     | 法域                               | 受理条件                        |
| -------- | ---------------------------------- | ------------------------------- |
| `us-msb` | 美国（联邦 + 纽约州）              | 任一 party `country = "US"`     |
| `uk-msb` | 英国                               | 任一 party `country = "GB"`     |
| `eu-msb` | 欧盟（含德/法/荷成员国专项检查项） | 任一 party 落在 27 个欧盟成员国 |
| `sg-msb` | 新加坡                             | 任一 party `country = "SG"`     |

**不做**：规则自动更新、多语言输出、KYB/钱包数据采购（属 Citely F4，另一供应商）、
Jurisdiction Review（属 Citely F5）、真实法律意见。

## 黑客松架构位置（Citely Deal Desk v2.2）

四层架构从上到下为：L4 客户执行层 → L3 Arc Testnet 协议与支付层 → L2 判定服务层
（案件引擎，主仓库）→ **L1 知识与供给层（本仓库 = module-server）**。L2 通过
HTTP + x402 付费调用本仓库；本仓库对 L2 是已部署的第三方 Module 供应商，保持独立
部署，不并入主仓库 monorepo。

| 仓库               | 职责                                                                | 关系                                 |
| ------------------ | ------------------------------------------------------------------- | ------------------------------------ |
| `citely-deal-desk` | L2/L3/L4 + rubrics，主仓库（**TODO：GitHub 链接待主仓库公开后补**） | 主仓库 README 将回链本仓库，形成互链 |
| `msb-agent`        | L1 module-server，本仓库，独立部署                                  | 为主仓库提供付费 Module API          |

L2 调用 `POST /modules/:id/check`，付费成功后从 200 响应取得 `evidence_hash`（写入
SA 的 `modules_used`），以及 `maintainer_wallet` / `royalty_bps`（用于版税微支付与
账本 `category=royalty`）。本仓库只输出检查项状态；PASS/HOLD/ESCALATE 的结算编排
与 SA 生成均在 L2。本仓库不含 LLM，也不产出法律意见。

## 快速开始

要求：Node.js 20+（开发环境用 Node 22/25 验证过）、npm。

```bash
npm install
cp .env.example .env
```

`.env.example` 默认给出 `PAYMENT_MODE=off`（本地无支付启动，注意：这只是示例文件里
的显式值，源码默认值是 `x402-arc-testnet`，见下文「支付层」）。以 off 模式启动：

```bash
npm run dev        # tsx watch，监听 PORT（默认 3000）
npm test            # vitest run，含引擎/HTTP/golden/支付层测试
npx tsc --noEmit    # 类型检查
```

启动后可直接试探发现端点：

```bash
curl http://localhost:3000/modules
curl http://localhost:3000/modules/us-msb/schema
```

`off` 模式下 `POST /modules/:id/check` 不收费，可直接联调业务逻辑；`x402-*` 模式下
同一端点会先返回 HTTP 402（见下文）。

## 架构要点

- **判定回路无 LLM**：`POST /modules/:id/check` 的 `checks` 只能由
  `src/engine/engine.ts` 的纯函数 `evaluate(rules, input, rulesFileBytes)` 从
  `src/rules/*.json` 规则文件确定性推导；规则表达不了的情形一律输出 `ESCALATE`，
  不允许静默跳过（例如加密资产穿透具体监管边界时）。
- **规则文件即法源**：每个模块一个规则文件（`src/rules/us-msb.json` /
  `uk-msb.json` / `eu-msb.json` / `sg-msb.json`），每条规则必须带 `source` /
  `source_url` / `accessed_date`；变更规则必须同步 bump `version`
  （`YYYY.MM.N`）和 `updated_at`——CI（`npm run validate:rules`）会挡掉遗漏。
- **`evidence_hash` 可重放验证**：

  ```
  evidence_hash = sha256( rules_file_bytes || 0x1F || canon(input) || 0x1F || canon(checks) )
  ```

  `canon()` 是 RFC 8785（JCS）风格的规范化 JSON（键按字典序排序、无空白、字符串
  NFC）；`parties` 数组按 `(role, country, state)` 排序后再规范化，数组书写顺序不
  影响 hash；`canon(checks)` 只保留 `{id, result}`（不含 `reason` 文案，修正措辞不
  改变 hash）。规则文件字节本身不做 JSON 规范化——文件是版本化产物，字节即身份。
  算法实现见 `src/evidence-hash/evidence-hash.ts`，字段级语义见
  [docs/api.md](docs/api.md#evidence_hash-与-settlement_constraints)。

- **门槛类规则是单笔安全下界**：法源门槛多为聚合口径（如美国货币兑换
  $1,000/人/日累计、新加坡 SPI/MPI 月均交易量分级）；引擎只看单笔/月交易量输入，
  语义是"单笔 ≥ 门槛 ⇒ 聚合必然 ≥ 门槛"的保守触发方向，单笔未达门槛时**不输出
  PASS**（只能输出 HOLD，说明聚合情形需采购方自行核实）。详见
  [docs/api.md](docs/api.md)。
- **法域受理边界**：只要请求中**任一** party 落在模块法域内即受理（模块外因素以
  `ESCALATE` 检查项表达）；**全部** party 都在法域外才返回 422——这条边界是有意
  设计的，防止用 422 绕过"规则表达不了就 ESCALATE"的不变量。

## API 概览

三个端点，详细字段/错误码见 **[docs/api.md](docs/api.md)**：

```
GET  /modules                  免费。列出 4 个模块的定价、收款地址、法源、版本。
GET  /modules/:id/schema       免费。该模块 evidence 字段的 JSON Schema（由 zod 导出）。
POST /modules/:id/check        付费（x402）。提交交易信息，返回确定性检查结果。
```

`POST /modules/:id/check` 示例（`us-msb`，`PAYMENT_MODE=off`）：

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

响应节选（未提交任何证据，`overall` 为 `HOLD`；完整字段见 docs/api.md）：

```json
{
  "module": "us-msb",
  "version": "2026.07.1",
  "checks": [
    {
      "id": "us-fincen-registration-money-transmission",
      "result": "HOLD",
      "reason": "缺少所需证据：fincen_msb_registration",
      "source": "31 CFR § 1022.380"
    }
  ],
  "overall": "HOLD",
  "settlement_constraints": {
    "blocked_check_ids": ["us-fincen-registration-money-transmission", "..."],
    "...": "..."
  },
  "evidence_hash": "fbf59533a95ef45bf3067772d45778f7c875aa0240a07b7a6376925b857cc12d",
  "disclaimer": "本 Module 为基于公开法源整理的 Demo 版本，输出为检查项状态，不构成法律意见。"
}
```

## 支付层（x402）

三档 `PAYMENT_MODE`，**源码默认值为 `x402-arc-testnet`**（默认不允许是 `off`，这是
一条架构红线）：

| 模式                | 用途                                          | 网络                          |
| ------------------- | --------------------------------------------- | ----------------------------- |
| `off`               | 本地开发 / 单元测试；必须显式设置才生效       | 不发起支付                    |
| `x402-base-sepolia` | 兜底：Arc facilitator 不稳定时的降级演示      | Base Sepolia，`eip155:84532`  |
| `x402-arc-testnet`  | **主目标**：Circle hosted testnet facilitator | Arc Testnet，`eip155:5042002` |

四模块差异化默认定价如下，可用对应 `{MODULE}_PRICE_USDC` 环境变量覆盖：

| 模块     | 每次调用价格（测试网 USDC） |
| -------- | --------------------------: |
| `us-msb` |                  `0.800000` |
| `eu-msb` |                  `0.600000` |
| `uk-msb` |                  `0.400000` |
| `sg-msb` |                  `0.200000` |

价格合法范围为 `0 < price <= 100`，启动时校验并规范化为六位小数；非法值直接拒绝
启动，防止小数点错位导致计费事故。
收款地址通过 `US_MSB_PAY_TO` 等四个环境变量配置——收款地址是公开信息会出现在
`GET /modules` 响应里，但绝不写入代码或文档，只走环境变量。

请求处理顺序：**先 zod 校验（失败 400，不进付费流程）→ x402 中间件收费 → 规则引擎
求值**，避免无效请求被误收费。

Arc Testnet 走 Circle Gateway 的 `GatewayWalletBatched` 支付方案（`@x402/hono` +
`@circle-fin/x402-batching`）。跑通真实链上流程的顺序：

1. 到 [faucet.circle.com](https://faucet.circle.com/) 领取 Arc Testnet 测试网 USDC；
2. 用 `GatewayClient.deposit(...)` 把测试网 USDC 存入 Circle Gateway（`smoke-arc.ts`
   在余额不足时会自动执行这一步）；
3. 客户端调用 `POST /modules/:id/check` → 收到 402 → `GatewayClient.pay(...)` 签名
   支付 → 服务端验证/结算 → 返回 200 + 检查结果。

本仓库已跑通一次真实冒烟（非占位数据）：Gateway 存款交易
`0xfcc78968b336ac103fe577cfd74075309cf70720eb086a7394c28146d83919f7`，支付结算 ID
`49f19918-632c-4ffe-9869-27be6472ac69`。复现命令：

```bash
PAYMENT_MODE=x402-arc-testnet \
MODULE_MAINTAINER_WALLET=<维护者钱包地址> \
X402_SMOKE_CLIENT_PRIVATE_KEY=<测试钱包私钥，占位符，不要提交到仓库> \
npm run smoke:arc
```

`x402-arc-testnet` 模式要求 `MODULE_MAINTAINER_WALLET` 已设置，否则服务会在启动时
fail-fast；`npm run smoke:arc` 同样受此校验约束。

冒烟脚本相关环境变量（`X402_SMOKE_CLIENT_PRIVATE_KEY` / `SMOKE_ARC_RPC_URL` /
`SMOKE_MODULE` / `SMOKE_PORT` / `SMOKE_DEPOSIT_USDC`）说明见脚本本身
`scripts/smoke-arc.ts` 及下方「配置项一览」；`.env.example` 中若尚未列出该系列变量，
以脚本内定义为准（脚本对每个变量都有格式校验与报错提示）。

## CI 校验

```bash
npm run validate:rules   # 规则文件缺 source / 版本未 bump / updated_at 未更新 → 失败
CHECK_RULE_LINKS=1 npm run check:links   # 法源链接存活检查；未设置该变量时跳过
```

`check:links` 支持豁免清单 `scripts/link-exemptions.json`：清单内的 URL 只警告不
失败（当前豁免 MAS Notices 官方入口，PSN01/PSN02 具体直达页待核实）。

## 测试

```bash
npm test
```

三层测试（详见 `docs/api.md` 或对应源码）：

1. 引擎单元测试：每条规则至少一个触发/不触发用例 + 确定性测试（同输入两次求值
   `checks`/`evidence_hash` 完全一致）；
2. golden 测试（`src/golden/citely-demo.test.ts`）：Citely Demo 场景（美国 Client →
   新加坡 Marketplace → 英/德服务商，名义 10,000 USDC）四个模块的固定输入输出快照，
   含 `evidence_hash` 跨运行一致性断言与 `disclaimer` 存在性断言；规则 version bump
   后必须重新生成快照并人工 review diff；
3. 集成测试：x402 402 → 支付 → 200 全流程（`base-sepolia` 走单元测试常态覆盖，
   `arc-testnet` 走 `npm run smoke:arc` 真实链上冒烟，不进 `npm test` 常规流程）。

## 配置项一览

完整模板见 `.env.example`（复制为 `.env` 后按需修改；真实收款地址/私钥永远不要
提交到仓库）。核心配置项：

| 变量                                                                                  | 说明                                                                                        | 默认值                                                         |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `PAYMENT_MODE`                                                                        | `off` \| `x402-base-sepolia` \| `x402-arc-testnet`                                          | 源码默认 `x402-arc-testnet`（`.env.example` 示例显式写 `off`） |
| `PORT`                                                                                | HTTP 监听端口                                                                               | `3000`                                                         |
| `US_MSB_PRICE_USDC` / `UK_MSB_PRICE_USDC` / `EU_MSB_PRICE_USDC` / `SG_MSB_PRICE_USDC` | 每模块单次调用价格，最多 6 位小数                                                           | 分别为 `0.800000` / `0.400000` / `0.600000` / `0.200000`       |
| `US_MSB_PAY_TO` / `UK_MSB_PAY_TO` / `EU_MSB_PAY_TO` / `SG_MSB_PAY_TO`                 | 每模块收款地址（`0x` + 40 位十六进制），`off` 模式不校验，x402 模式必填                     | 占位地址，启用前必须替换                                       |
| `MODULE_MAINTAINER_WALLET`                                                            | 全局维护者版税收款地址；x402 模式必填，可用四个 `{MODULE}_MAINTAINER_WALLET` 变量按模块覆盖 | `off` 模式回落零地址                                           |
| `MODULE_ROYALTY_BPS`                                                                  | 全局版税基点（0–10000 整数），可用四个 `{MODULE}_ROYALTY_BPS` 变量按模块覆盖                | `0`                                                            |
| `X402_ARC_TESTNET_FACILITATOR_URL`                                                    | Circle Arc Testnet hosted facilitator URL；仅 `x402-arc-testnet` 用                         | 无（该模式下必填）                                             |
| `X402_BASE_SEPOLIA_FACILITATOR_URL`                                                   | Base Sepolia facilitator URL；仅 `x402-base-sepolia` 用                                     | 无（该模式下必填）                                             |
| `CHECK_RULE_LINKS`                                                                    | 设为 `1` 启用规则法源链接存活检查（网络请求）                                               | `0`（跳过）                                                    |
| `RULES_BASE_REF`                                                                      | 规则版本 CI 校验的 git 对比基准                                                             | `HEAD^`                                                        |

`npm run smoke:arc` 额外使用的变量（真实链上冒烟专用，不影响 `npm run dev` /
`npm test`）：`X402_SMOKE_CLIENT_PRIVATE_KEY`（必填，测试钱包私钥）、
`SMOKE_ARC_RPC_URL`（可选，自定义 RPC）、`SMOKE_MODULE`（可选，默认 `us-msb`）、
`SMOKE_PORT`（可选，默认 `4402`）、`SMOKE_DEPOSIT_USDC`（可选，默认 `1.50`）。

---

本服务输出为基于公开法源整理的检查项状态，**不构成法律意见**。
