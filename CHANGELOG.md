# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

> 本服务输出为基于公开法源整理的检查项状态，**不构成法律意见**。

## [0.1.0] - 2026-07-24

首个可运行版本：确定性 MSB 合规检查 API + x402 按次收费，覆盖 4 个法域模块。
对应设计：`docs/design/2026-07-23-msb-compliance-module-design.md`（步骤清单
15 条，实现流程见项目 `CLAUDE.md`）。

### 新增

- 项目骨架：TypeScript strict + Hono + zod + vitest + ESLint + Prettier。
- zod schema（`src/schemas/`）：`DealInput`（含可选 `monthly_volume_usdc`）、
  `CheckResult`、`ModuleResponse`、`SettlementConstraints`、规则文件 schema。
- 规范化与 `evidence_hash` 纯函数模块（`src/evidence-hash/`）：RFC 8785 (JCS)
  风格规范化 + `0x1F` 分隔的 `sha256(rules_file_bytes || canon(input) ||
  canon(checks))`，`parties` 排序保证数组顺序不影响 hash，`checks` 仅取
  `{id, result}` 保证措辞修正不改变 hash。
- 确定性规则引擎（`src/engine/`）：`when` 条件匹配（`activity` /
  `party_country` / `party_state` / `amount_gte` / `monthly_volume_gte`）+
  证据判定 + 单笔/月交易量门槛的安全下界语义 + `ESCALATE > HOLD > PASS` 聚合。
- 4 个法域规则文件（`src/rules/*.json`），均带 `source` / `source_url` /
  `accessed_date`：
  - `us-msb` v2026.07.1：FinCEN MSB 注册、BSA/AML 计划、SAR 监测控制、纽约州
    汇款许可、纽约 BitLicense 共 6 条规则；
  - `uk-msb` v2026.07.1：FCA 支付机构/电子货币授权、HMRC AML 监管、MLR 政策
    控制、POCA SAR 控制、加密监管边界（`always_escalate`）共 6 条规则；
  - `eu-msb` v2026.07.2：PSD2 支付机构授权、EMD2 电子货币授权、AMLD 政策控制、
    MiCA CASP 授权、资金转移信息控制（Reg 2023/1113）、AMLR 2027 过渡期提示
    （`always_escalate`）、德/法/荷（BaFin/ACPR/DNB）成员国专项检查共 9 条规则；
  - `sg-msb` v2026.07.1：PSA 牌照分级（月交易量门槛，含 SGD→USDC 固定汇率换算
    并在 `note` 标注）、MAS 金融机构名录、PSN01/PSN02 AML/CFT 控制、DPT 服务
    范围边界（`always_escalate`）共 5 条规则。
- CI 校验脚本：`npm run validate:rules`（规则缺 `source`/版本未 bump/
  `updated_at` 未更新时失败）、`npm run check:links`（`CHECK_RULE_LINKS=1` 启用
  法源链接存活检查，`scripts/link-exemptions.json` 豁免清单机制）。
- HTTP 层（`src/http/`）：
  - `GET /modules`：定价、收款地址、法源、版本、`input_schema_url`，全局
    `disclaimer`；
  - `GET /modules/:id/schema`：按模块 `required_evidence` 并集生成的 evidence
    JSON Schema；
  - `POST /modules/:id/check`：法域受理边界（任一 party 在法域内即受理，全部
    party 均在法域外才 422）、400/413/422 错误处理、`settlement_constraints`
    输出（`valid_until` = 请求时间 + 72h）。
- 支付层（`src/payment/`）：三档 `PAYMENT_MODE`（`off` / `x402-base-sepolia` /
  `x402-arc-testnet`，**源码默认值 `x402-arc-testnet`**）、`@x402/hono` 2.19.0
  中间件、价格单位校验（USDC 十进制小数，`0 < price <= 100`，启动时拒绝非法
  值）、付费后 24 小时幂等重试（支付凭证 + 请求体哈希组合键，同一凭证重试不
  二次收费）、facilitator 不可达 → 502。
- Arc Testnet 支付适配：Circle hosted testnet facilitator，`GatewayWalletBatched`
  scheme（`@circle-fin/x402-batching`），`eip155:5042002` 网络。
- golden 测试（`src/golden/citely-demo.test.ts`）：Citely Demo 场景（美国
  Client → 新加坡 Marketplace → 英/德服务商，名义 10,000 USDC）四模块固定
  输入输出快照，含 `evidence_hash` 跨运行一致性断言与 `disclaimer` 存在性
  断言。
- `.env.example`：`PAYMENT_MODE`、`PORT`、每模块 `PRICE_USDC`/`PAY_TO`、
  facilitator URL、`CHECK_RULE_LINKS`、`RULES_BASE_REF` 全量配置项及注释。
- `npm run smoke:arc`：Arc Testnet 真实链上冒烟脚本（402 → `GatewayClient`
  签名支付 → 200 全流程）。已跑通一次真实冒烟：Gateway 存款交易
  `0xfcc78968b336ac103fe577cfd74075309cf70720eb086a7394c28146d83919f7`，
  支付结算 ID `49f19918-632c-4ffe-9869-27be6472ac69`。
- 文档：README、`docs/api.md` API 参考。

### 已知限制

- 门槛类规则（`amount_gte` / `monthly_volume_gte`）仅表达单笔/月交易量的安全
  下界近似，不做真实的多笔聚合追踪；
- `sg-msb` 的 MAS Notice PSN01/PSN02 具体直达页 URL 待人工核实（当前指向 MAS
  Notices 官方入口，已列入 `scripts/link-exemptions.json` 豁免清单）；
- 不做规则自动更新、多语言输出、KYB/钱包数据采购（属 Citely F4）、
  Jurisdiction Review（属 Citely F5）、真实法律意见。
