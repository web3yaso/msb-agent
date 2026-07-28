# API 文档

[English](api.md) | 简体中文

> **免责声明**：本服务输出为基于公开法源整理的检查项状态，**不构成法律意见**。
> 判定回路中不含 LLM——`checks` 只能由规则引擎从 `src/rules/*.json` 确定性推导。

本文档与 `src/schemas/` 下的 zod schema 保持一致（字段名、枚举值、必填/可选性均以
zod 定义为准；本文示例均来自可通过 `npm test` 复现的实际请求/响应，不是凭记忆编写）。

## 背景

本服务是 Citely Global Agent Deal Desk（cleardesk）四层架构中的 L1 知识与供给层
（module-server）：L2 判定服务层（案件引擎，位于另一个主仓库）通过 HTTP + x402
付费调用本服务，本仓库独立部署，不并入主仓库 monorepo。调用方（L2 或任何 agent）
在支付成功后从 200 响应读取 `evidence_hash`（可离线重放验证本次调用依据的规则与
结果）与 `maintainer_wallet` / `royalty_bps`（用于版税微支付）；本服务只输出检查
项状态，不做结算编排，不产出法律意见。

## 模块一览

| 模块     | 法域                               | 受理条件                        |
| -------- | ---------------------------------- | ------------------------------- |
| `us-msb` | 美国（联邦 + 纽约州）              | 任一 party `country = "US"`     |
| `uk-msb` | 英国                               | 任一 party `country = "GB"`     |
| `eu-msb` | 欧盟（含德/法/荷成员国专项检查项） | 任一 party 落在 27 个欧盟成员国 |
| `sg-msb` | 新加坡                             | 任一 party `country = "SG"`     |

**不做**：规则自动更新、多语言输出、KYB/钱包数据采购（属 Citely F4，另一供应商）、
Jurisdiction Review（属 Citely F5）、真实法律意见。

Base URL：本地开发默认 `http://localhost:3000`（`PORT` 可配）。当前线上实例：
`https://msb-agent-production-769d.up.railway.app`（Railway，见 README「AI Agent
接入三步」小节）。

## 端点一览

| 方法 | 路径                                   | 收费       | 说明                                            |
| ---- | -------------------------------------- | ---------- | ----------------------------------------------- |
| GET  | `/`                                    | 否         | 服务目录 JSON（名称、描述、端点映射、仓库地址） |
| GET  | `/healthz`                             | 否         | 部署平台健康检查；唯一豁免限流的端点            |
| GET  | `/static/agent-icon.png`               | 否         | agent card 图标图片                             |
| GET  | `/modules`                             | 否         | 列出 4 个模块的定价、收款地址、法源、版本       |
| GET  | `/modules/:id/schema`                  | 否         | 该模块 evidence 字段的 JSON Schema              |
| GET  | `/.well-known/agent-card.json`         | 否         | ERC-8004 registration-v1 agent card             |
| GET  | `/.well-known/agent-registration.json` | 否         | 已注册身份的域名控制证明；未注册时 404          |
| POST | `/modules/:id/check`                   | 是（x402） | 提交交易信息，返回确定性检查结果                |

`:id` ∈ `us-msb` \| `uk-msb` \| `eu-msb` \| `sg-msb`（`ModuleIdSchema`）。

免费发现路径以及付费检查在支付前的校验路径按客户端 IP 固定窗口限流，默认每分钟 60 次。
超限返回 HTTP 429，响应含 `error=rate_limit_exceeded`、可读 `message` 与
`disclaimer`。无效或未验证的支付凭证同样计入免费限流；只有已完成支付、24 小时幂等
窗口内的重试才走每凭证独立的宽松桶（默认 60 次/分钟）。**`GET /healthz` 是唯一豁免
限流的端点**（供部署平台高频探活使用）；`GET /modules` 与其余免费端点——包括
`GET /` 与 `GET /static/agent-icon.png`——按上述规则正常计入限流，不享有豁免。

两个 `/.well-known/` 端点均免费且不进入判定回路。Agent card 响应使用
`application/json; charset=utf-8` 和 `Cache-Control: public, max-age=300`，包含四模块
价格、法源、端点、公开支付参数以及免责声明；支付参数不受 `evidence_hash` 背书。
`GET /static/agent-icon.png`（agent card `image` 字段指向的图片）响应使用
`Cache-Control: public, max-age=86400`。

---

## 支付模式与定价

三档 `PAYMENT_MODE`，**源码默认值为 `x402-arc-testnet`**（默认不允许是 `off`，
这是一条架构红线）：

| 模式                | 用途                                          | 网络                          |
| ------------------- | --------------------------------------------- | ----------------------------- |
| `off`               | 本地开发 / 单元测试；必须显式设置才生效       | 不发起支付                    |
| `x402-base-sepolia` | 兜底：Arc facilitator 不稳定时的降级演示      | Base Sepolia，`eip155:84532`  |
| `x402-arc-testnet`  | **主目标**：Circle hosted testnet facilitator | Arc Testnet，`eip155:5042002` |

四模块差异化默认定价（可用对应 `{MODULE}_PRICE_USDC` 环境变量覆盖）：

| 模块     | 每次调用价格（测试网 USDC） |
| -------- | --------------------------: |
| `us-msb` |                  `0.800000` |
| `eu-msb` |                  `0.600000` |
| `uk-msb` |                  `0.400000` |
| `sg-msb` |                  `0.200000` |

价格合法范围为 `0 < price <= 100`，启动时校验并规范化为六位小数；非法值直接拒绝
启动，防止小数点错位造成计费事故。收款地址通过四个 `{MODULE}_PAY_TO` 环境变量
配置——是公开信息，会出现在 `GET /modules` 响应里，但从不写入代码或文档。

Arc Testnet 的结算方案是 Circle Gateway 的 `GatewayWalletBatched`
（`@x402/hono` + `@circle-fin/x402-batching`）。以线上实例实测的 402 响应为例，
`payment-required` 响应头 base64 解码后的核心字段：

```json
{
  "resource": { "url": "https://msb-agent-production-769d.up.railway.app/modules/us-msb/check" },
  "accepts": [
    {
      "scheme": "exact",
      "network": "eip155:5042002",
      "amount": "800000",
      "asset": "0x3600000000000000000000000000000000000000",
      "payTo": "0x76B05e56872E097dB94Ee8cD55de7882603047B9",
      "extra": { "name": "GatewayWalletBatched", "version": "1" }
    }
  ]
}
```

`amount` 是原子单位（USDC 6 位小数，`800000` = 0.8 USDC）；`asset` 是 Arc Testnet
上 USDC 的合约地址。完成支付要求调用方钱包的 USDC 已经存入 Circle Gateway 余额
（不是仅停留在钱包里）。本仓库的 `scripts/smoke-public.ts`（`npm run smoke:public`）
演示了对线上实例的完整支付闭环，用法见 README「AI Agent 接入三步」。

---

## GET /healthz

无需支付，不加载模块元数据，不进入判定回路。固定响应：

```json
{
  "status": "ok",
  "disclaimer": "本 Module 为基于公开法源整理的 Demo 版本，输出为检查项状态，不构成法律意见。"
}
```

`disclaimer` 字段与其余端点一致，均为 `DISCLAIMER` 常量原文。本端点是部署平台
（如 Railway）健康检查应指向的地址，也是限流中间件里唯一 `shouldSkip` 放行的路径，
不消耗、不计入任何限流窗口。

---

## GET /modules

无需支付。响应：

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

字段语义：

- `jurisdiction`：`United States` / `United Kingdom` / `European Union` / `Singapore`
  （固定字符串，见 `src/http/constants.ts` 的 `MODULE_JURISDICTIONS`）；
- `price_usdc`：来自 `{MODULE}_PRICE_USDC` 或模块源码默认价，并统一规范化为六位小数；
  `pay_to` 直接读自 `{MODULE}_PAY_TO`。两者是公开信息，**不是秘密**；`pay_to`
  未配置时返回空字符串；
- `sources`：该模块规则文件里全部 `{source, source_url, accessed_date}` 的去重集合
  （按 `source_url` 去重）；
- `input_schema_url`：指向 `GET /modules/:id/schema`，采购方可据此预知需提交哪些
  `evidence` 键，无需试错。

## GET /modules/:id/schema

无需支付。返回该模块输入的 JSON Schema（由 zod 通过 `z.toJSONSchema()` 导出），
`evidence` 子 schema 的属性集合是该模块规则文件中全部 `required_evidence` 的**并
集**（`src/http/module-loader.ts` 的 `createInputSchema`）。响应额外附加顶层
`disclaimer` 字段。

未知模块 → `404`：

```json
{ "error": "module_not_found", "message": "未知模块", "disclaimer": "..." }
```

## POST /modules/:id/check

付费端点（x402，见下文「支付与错误码」）。

### 请求体（`DealInputSchema`，`z.strictObject`，多余字段会被拒绝）

| 字段                  | 类型                      | 必填            | 说明                                                                                                  |
| --------------------- | ------------------------- | --------------- | ----------------------------------------------------------------------------------------------------- |
| `deal_id`             | `string`（非空）          | 是              | 由采购方生成的交易标识，回显进 `settlement_constraints.deal_id`                                       |
| `parties`             | `Party[]`（至少 1 项）    | 是              | 交易参与方                                                                                            |
| `activity`            | `enum`                    | 是              | `money_transmission` \| `currency_exchange` \| `stored_value` \| `crypto_transfer` \| `check_cashing` |
| `amount_usdc`         | `number`（≥ 0）           | 是              | 单笔交易金额，单位 USDC                                                                               |
| `monthly_volume_usdc` | `number`（≥ 0）\| `null`  | 否              | 月交易量；交易量分级类检查项（如新加坡 SPI/MPI）依赖此字段，缺失时相关检查项输出 `HOLD`               |
| `evidence`            | `Record<string, unknown>` | 是（可为 `{}`） | 证据键值对，键集合见该模块 `GET /modules/:id/schema`                                                  |

`Party`（`z.strictObject`）：

| 字段      | 类型                        | 必填 | 说明                             |
| --------- | --------------------------- | ---- | -------------------------------- |
| `role`    | `"payer"` \| `"payee"`      | 是   |                                  |
| `country` | `string`，匹配 `^[A-Z]{2}$` | 是   | ISO 3166-1 alpha-2               |
| `state`   | `string`（非空）            | 否   | 目前仅 `us-msb` 的纽约州规则用到 |

请求示例：

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

### 响应体（`ModuleResponseSchema`）

| 字段                     | 类型                                                       | 说明                                                                                                                            |
| ------------------------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `module`                 | `ModuleId`                                                 | 回显请求的模块                                                                                                                  |
| `version`                | `string`，`^\d{4}\.\d{2}\.\d+$`                            | 规则文件版本（如 `2026.07.1`）                                                                                                  |
| `engine_version`         | 语义化版本字符串                                           | 确定性引擎语义版本，纳入 `evidence_hash`                                                                                        |
| `hash_scheme_version`    | 数字字符串                                                 | Evidence hash 预映射方案版本，纳入 `evidence_hash`                                                                              |
| `updated_at`             | ISO8601 UTC（无偏移量后缀，`YYYY-MM-DDTHH:mm:ssZ`）        | 规则文件最后修订时间                                                                                                            |
| `maintainer_wallet`      | `string`，`^0x[0-9a-fA-F]{40}$`                            | Module 维护者版税收款地址；零地址表示实例未配置版税收款方，采购方必须视为“不支付版税”，不得向零地址转账                         |
| `royalty_bps`            | `integer`，0–10000                                         | 版税基点（10000 = 100%），基数为本次调用采购价；该运营参数不被 `evidence_hash` 背书，采购方须按自身白名单与单笔上限校验后再支付 |
| `checks`                 | `CheckResult[]`                                            | 见下                                                                                                                            |
| `overall`                | `"PASS"` \| `"HOLD"` \| `"ESCALATE"` \| `"NOT_APPLICABLE"` | 聚合结果，见「聚合语义」                                                                                                        |
| `settlement_constraints` | `SettlementConstraints`                                    | 见下                                                                                                                            |
| `evidence_hash`          | 64 位十六进制字符串                                        | 与 `settlement_constraints.evidence_hash` 相同                                                                                  |
| `disclaimer`             | `string`                                                   | 固定免责声明文案                                                                                                                |

`CheckResult`：

| 字段     | 说明                                                                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`     | 规则 id，如 `us-fincen-registration-money-transmission`                                                                                             |
| `result` | `PASS` \| `HOLD` \| `ESCALATE` \| `NOT_APPLICABLE`                                                                                                  |
| `basis`  | 机器可读依据：`not_applicable`、`caller_assertion`、`missing_evidence`、`deterministic_threshold`、`insufficient_aggregate_data` 或 `manual_review` |
| `reason` | 人类可读原因（不参与 `evidence_hash` 计算，措辞修正不改变 hash）                                                                                    |
| `source` | 法源引用（对应规则文件 `source` 字段）                                                                                                              |

`SettlementConstraints`：

| 字段                        | 说明                                                                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `module` / `module_version` | 冗余自根字段，便于独立传入结算层且自证来源                                                                                                                             |
| `deal_id`                   | 回显请求 `deal_id`                                                                                                                                                     |
| `valid_until`               | 请求时间（UTC）+ 72 小时，ISO8601。**`PASS` 时**表示"72h 内本结果可被结算层引用"；**`HOLD`/`ESCALATE` 时**表示"72h 内本阻断状态可被引用"——过期不等于放行，只表示需重查 |
| `blocked_check_ids`         | 仅含 `result = HOLD` 的 check id（"缺证据暂停付款"路由）                                                                                                               |
| `escalated_check_ids`       | 仅含 `result = ESCALATE` 的 check id（"灰区转人工"路由，与上者分开路由）                                                                                               |
| `evidence_hash`             | 同响应根字段                                                                                                                                                           |

### 聚合语义

任一 check `ESCALATE` → `overall = ESCALATE`；否则任一 `HOLD` → `overall = HOLD`；
否则任一 `PASS` → `overall = PASS`。`NOT_APPLICABLE` 为中性；若所有检查均为
`NOT_APPLICABLE`，overall 也返回 `NOT_APPLICABLE`（`src/engine/engine.ts` 的
`aggregateCheckStatus`，`ESCALATE > HOLD > PASS > NOT_APPLICABLE` 优先级）。

### `evidence_hash` 与 `settlement_constraints`

```
evidence_hash = sha256( canon(version_context) || 0x1F || rules_file_bytes || 0x1F || canon(input) || 0x1F || canon(checks) )
```

- `canon(version_context)`：`{engine_version, hash_scheme_version}`，按下述相同 JSON
  规则规范化；
- `rules_file_bytes`：该模块规则文件的原始 UTF-8 字节（不做 JSON 规范化——文件本身
  是版本化产物，字节即身份）；
- `canon(input)`：`{deal_id, parties, activity, amount_usdc, monthly_volume_usdc?,
evidence}` 按 RFC 8785(JCS) 风格规范化（键字典序、无空白、字符串 NFC）；
  `parties` 先按 `(role, country, state)` 排序，数组书写顺序不影响 hash；
  `monthly_volume_usdc` 为 `undefined` 时整个字段省略（不是写入 `null`）；
- `canon(checks)`：仅 `{id, result, basis}` 数组，按 `id` 排序后规范化——**不含
  `reason`**，修正措辞不改变 hash，`result` 或 `basis` 变化才是实质变更；
- `0x1F`（Unit Separator）分隔四段，各段自身合法 JSON/UTF-8，消除拼接歧义。

该算法是公开规范，采购方或第三方审计者可用相同规则文件、相同请求体、相同 checks
离线重放验证 `evidence_hash`（实现见 `src/evidence-hash/evidence-hash.ts`，golden
测试对已知输入的具体 hash 值断言，见 `src/golden/citely-demo.test.ts`）。

该 hash 证明版本上下文、规则字节、请求输入和实质检查结果未被修改，**不证明**
调用方提交的材料真实，也不表示外部登记库已经核验。非空调用方材料形成的 `PASS`
因此使用 `basis: "caller_assertion"`。

### 示例：完整证据 → `PASS`

请求 `evidence` 补全 `us-msb` 全部所需字段后：

```json
{
  "overall": "PASS",
  "settlement_constraints": {
    "blocked_check_ids": [],
    "escalated_check_ids": []
  }
}
```

### 示例：无证据 → `HOLD`（节选自 golden 测试固定快照）

```json
{
  "module": "us-msb",
  "version": "2026.07.1",
  "engine_version": "1.0.0",
  "hash_scheme_version": "2",
  "updated_at": "2026-07-24T00:00:00Z",
  "maintainer_wallet": "0x1111111111111111111111111111111111111111",
  "royalty_bps": 500,
  "checks": [
    {
      "id": "us-fincen-registration-money-transmission",
      "result": "HOLD",
      "basis": "missing_evidence",
      "reason": "缺少所需证据：fincen_msb_registration",
      "source": "31 CFR § 1022.380"
    },
    {
      "id": "us-fincen-registration-threshold-activities",
      "result": "NOT_APPLICABLE",
      "basis": "not_applicable",
      "reason": "规则条件未触发",
      "source": "31 CFR § 1010.100(ff)"
    },
    {
      "id": "us-bsa-aml-program",
      "result": "HOLD",
      "basis": "missing_evidence",
      "reason": "缺少所需证据：bsa_aml_program",
      "source": "31 CFR § 1022.210"
    },
    {
      "id": "us-sar-controls",
      "result": "HOLD",
      "basis": "missing_evidence",
      "reason": "缺少所需证据：sar_monitoring_and_filing_controls",
      "source": "31 CFR § 1022.320"
    },
    {
      "id": "us-ny-money-transmitter-license",
      "result": "HOLD",
      "basis": "missing_evidence",
      "reason": "缺少所需证据：ny_money_transmitter_license",
      "source": "NY Banking Law Article 13-B"
    },
    {
      "id": "us-ny-bitlicense",
      "result": "NOT_APPLICABLE",
      "basis": "not_applicable",
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
    "evidence_hash": "44bf07506c3ba782b93d8208757737aee4894c0227a47865ca1d34e7b2aa45e4"
  },
  "evidence_hash": "44bf07506c3ba782b93d8208757737aee4894c0227a47865ca1d34e7b2aa45e4",
  "disclaimer": "本 Module 为基于公开法源整理的 Demo 版本，输出为检查项状态，不构成法律意见。"
}
```

### 示例：`ESCALATE`（`eu-msb`，节选）

`eu-amlr-2027-applicability` 规则 `always_escalate: true`（AMLR 已生效但主体条款自
2027-07-10 起才适用，规则表达不了"过渡期尚未适用"这一时间维度，因此转人工而不是
静默跳过或误判为违规）：

```json
{
  "id": "eu-amlr-2027-applicability",
  "result": "ESCALATE",
  "reason": "规则无法确定性判定，需人工核实：AMLR 已生效但主体条款尚未适用，将自 2027-07-10 起适用；本项仅提示过渡准备并转人工，不把未来条款表述为当前违规",
  "source": "Regulation (EU) 2024/1624 (AMLR)"
}
```

带任一 `ESCALATE` 的响应 `overall = "ESCALATE"`，对应 check id 出现在
`settlement_constraints.escalated_check_ids`（不出现在 `blocked_check_ids`）。

### 门槛类检查项（金额/交易量下界判定）

规则的 `when.amount_gte` / `when.monthly_volume_gte` 表达"单笔/月交易量下界"，语义：

- `amount_gte` 是**单笔下界判定**：单笔 `amount_usdc ≥ amount_gte` 才触发证据要求；
  法源门槛多为聚合口径（如美国货币兑换 $1,000/人/日累计），单笔 ≥ 门槛可以安全推出
  聚合必然 ≥ 门槛，但**单笔 < 门槛不能推出聚合 < 门槛**，因此规则条件"未触发"时
  仍输出 `HOLD`（`reason: "单笔未达门槛，聚合情形需采购方自行核实"`），**不输出
  `PASS`**；
- `monthly_volume_gte` 依赖可选字段 `monthly_volume_usdc`：缺失（`undefined` 或
  `null`）→ 相关检查项 `HOLD`，`reason: "无法判定分级，需补交易量数据"`；达到该字段
  但低于门槛 → `NOT_APPLICABLE`，`basis: "deterministic_threshold"`，
  `reason: "月交易量未达规则门槛"`；
- 币种统一假设 USDC ≈ USD；非美元法源门槛（如新加坡 SGD）在规则文件里写死换算后的
  USDC 门槛值，`note` 字段标注换算汇率与换算日期，引擎内部不做隐式汇率换算。

---

## 支付与错误码

| 状态码 | 触发条件                                                                                                                                                            | 响应体要点                                                                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `200`  | 校验通过、法域受理、（付费模式下）支付成功                                                                                                                          | 见上文 `ModuleResponseSchema`                                                                                                                                          |
| `400`  | 请求体不是合法 JSON，或不满足 `DealInputSchema`（**不收费**，在 x402 中间件之前完成校验）                                                                           | `{ "error": "invalid_request", "issues": [{ "path": [...], "message": "..." }], "disclaimer": "..." }`                                                                 |
| `402`  | 仅 `PAYMENT_MODE = x402-base-sepolia` / `x402-arc-testnet` 时，请求未携带有效支付凭证                                                                               | x402 标准 `PAYMENT-REQUIRED` 响应头 + 402 payload（由 `@x402/hono` 生成，非本服务自定义 JSON）                                                                         |
| `404`  | `:id` 不是 `us-msb` \| `uk-msb` \| `eu-msb` \| `sg-msb`                                                                                                             | `{ "error": "module_not_found", ... }`                                                                                                                                 |
| `413`  | 请求体超过 256KB                                                                                                                                                    | `{ "error": "request_too_large", "message": "请求体不得超过 256KB", "disclaimer": "..." }`                                                                             |
| `422`  | Schema 校验通过，但**全部** party 均不在模块法域内（法域受理边界：**任一** party 在法域内即受理，422 只在全部 party 都不在时触发，避免用 422 绕过 ESCALATE 不变量） | `{ "error": "jurisdiction_not_applicable", "message": "全部交易方均不在 <法域> 模块适用法域内", "disclaimer": "..." }`                                                 |
| `500`  | 支付结算成功后引擎求值/序列化抛异常                                                                                                                                 | `{ "error": "internal_error", "message": "检查执行失败，可使用同一支付凭证重试", "payment_credential_id": "<sha256(凭证)>"（若已收到支付凭证）, "disclaimer": "..." }` |
| `502`  | facilitator 不可达（支付验证/结算请求失败，且尚未确认扣款）                                                                                                         | `{ "error": "facilitator_unavailable", "message": "支付服务暂不可用，请稍后重试", "disclaimer": "..." }`；不产生半计费状态                                             |

**付费后幂等**：x402 支付被接受后，若引擎求值或响应序列化抛异常（→ 500），服务记录
支付凭证哈希（`sha256(凭证)`，不落原始凭证）与请求体哈希的组合键；同一支付凭证对
同一 `:id` + 请求体在 **24 小时内**重试 `POST /modules/:id/check`，会跳过二次收费，
直接重新求值返回结果（`src/payment/idempotency.ts` 的 `PaidRetryStore`，滑动窗口
`24 * 60 * 60 * 1000` 毫秒）。

请求处理顺序：**请求体大小（413）→ zod 校验（400）→ 法域受理（422）→ x402 中间件
（402/502）→ 规则引擎求值（200，异常态 500）**——无效请求或法域外请求不会进入付费
流程。

---

本服务输出为基于公开法源整理的检查项状态，**不构成法律意见**。
