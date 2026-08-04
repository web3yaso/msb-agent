# Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 格式，
版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

> 本服务输出为基于公开法源整理的检查项状态，**不构成法律意见**。

## [Unreleased]

对应设计：`docs/design/2026-08-01-ae-msb-module.md`。

### 变更

- 4 条 `always_escalate` 规则的 `note` 由中文改为英文（它是唯一会拼进
  `checks[].reason` 对外输出的 note；其余规则的 note 不外露，未动）。
  规则文件字节变更，按不变量 4 逐模块 bump version：
  `uk-msb` / `eu-msb` / `sg-msb` → `2026.08.1`，`ae-msb` → `2026.08.2`，
  `us-msb` 未动。**4 个模块的 evidence_hash 随规则字节全部轮换**（golden
  期望值已更新），下游认证清单须按新版本重签。ENGINE_VERSION 不变
  （引擎代码未动，判定语义无变化）。

- 引擎生成的 `checks[].reason` 文案由中文改为英文（消费方 Deal Desk 的演示 UI
  为英文，混排影响可读性）。**不 bump ENGINE_VERSION 的豁免理由**（架构不变量 6）：
  reason 不在 evidence_hash 预映射内（`canonicalizeChecks` 仅保留
  `{id, result, basis}`），且任何合法输入下新旧引擎的 checks 判定结果逐字节相同——
  golden 快照重生成后全部 `evidence_hash` 零变化（`git diff` 可核）。
  `always_escalate` 规则的 reason 前缀已英文化，但其拼接的 `rule.note` 仍为中文——
  翻译 note 需改规则文件字节，触发模块 version bump 与认证清单重签，单独排期。

### 新增

- 新增第 5 个法域模块 `ae-msb`（阿联酋，United Arab Emirates），版本 `2026.08.1`，
  默认价 `1.000000` 测试网 USDC，6 条规则：
  - `ae-cbuae-rps-license`：CBUAE Retail Payment Services and Card Schemes Regulation
    （Circular No. 15/2021）在岸零售支付牌照；
  - `ae-aml-cft-program`：Federal Decree by Law No. (10) of 2025（AML/CFT/CPF）
    AML/CFT 计划证据（2025-10-14 生效，取代 Federal Decree-Law No. (20) of 2018）；
  - `ae-goaml-registration`：UAE FIU goAML Portal 可疑交易报告平台注册；
  - `ae-wire-transfer-information`：Cabinet Resolution No. (134) of 2025（AML 法
    执行细则）跨境汇款人/收款人信息（FATF R.16 本地化）；
  - `ae-vasp-license-path`：VARA VA Transfer and Settlement Services Rulebook，
    虚拟资产转移牌照路径，`result_if_missing: ESCALATE`（多轨监管无法由静态输入
    判定应落在哪一轨，缺证据即转人工而非扣住）；
  - `ae-payment-token-restrictions`：CBUAE Payment Token Services Regulation
    Article 12（Restrictions on Payment Tokens），`always_escalate: true`——
    **任何 AE + `crypto_transfer` 或 AE + `stored_value` 的交易，`overall` 恒为
    `ESCALATE`**，这是对"pay-in AED / settle in USDC"灰区的刻意处理，不是缺陷。
  详见 `docs/api.md` / `docs/api.zh-CN.md` 的对应说明。
- `GET /modules`、`GET /modules/ae-msb/schema`、`POST /modules/ae-msb/check`、
  agent card `x-msb.modules` 自动纳入第 5 个模块（由既有 `ModuleIdSchema` 与
  注册表驱动，无新增路由代码）。

### 修复

- `src/http/app.ts` 的 `isPartyInJurisdiction` 由硬编码三元链改为
  `MODULE_COUNTRIES: Record<ModuleId, ReadonlySet<string>>` 查表实现。修复一处
  在新增第 5 个模块时会**静默出错**的既有缺陷：旧实现的 else 分支把非
  us/uk/eu 模块一律映射到 `{"SG"}`，导致① 真正的 AE 交易被 422 拒收，
  ② SG 交易会被 `ae-msb` 受理并收费，返回全 `NOT_APPLICABLE`（采购方付费拿到
  零信息量响应）。修复后 US/GB/EU（27 国）/SG/AE 五个法域的受理集合逐一等价于
  修复前的行为，不改变既有四模块的受理结果。

### 版本裁决留痕（ae-msb 新增，独立于上一条 CheckStatus 变更的裁决）

- **`ENGINE_VERSION` 保持 `1.0.0`，未 bump。** 本次新增模块唯一的行为性代码改动
  是上述 `isPartyInJurisdiction` 查表重写，该改动位于 HTTP 法域前置网关、在规则
  引擎之外，不进入 `checks` 或 `evidence_hash` 的任何输入；`src/engine/engine.ts`
  与 `src/evidence-hash/evidence-hash.ts` 一个字符未改。豁免依据（实证）：
  `src/golden/citely-demo.test.ts` 中 `us-msb` / `uk-msb` / `eu-msb` / `sg-msb`
  四个既有 `evidence_hash` 常量与 `__snapshots__/citely-demo.test.ts.snap` 中对应
  四份快照**逐字节未变**（新增内容仅为 `ae-msb` 的追加条目）。`hash_scheme_version`
  同样保持 `"2"`，预映射字节序列未动。
- golden 测试新增 `AE_DEMO_INPUT`（Citely Demo 输入追加 `{role:"payee",
  country:"AE"}` 变体，`deal_id: "citely-demo-10000-usdc-ae"`），而非直接扩展
  共享 `CITELY_DEMO_INPUT`，正是为了保住上一条"四个既有 hash 未变"的实证——
  后者会一次性改掉全部既有哈希，使"引擎语义未变"无法自证。
- `ae-msb` 的 `evidence_hash` 已连续三次运行验证一致，钉为
  `48fe82dd6b6dfe2dd1191638cb6270e548cb361cceefd1674c4bb623836be686`。

### 破坏性变更

- `ModuleResponse` 新增必填字段 `engine_version` / `hash_scheme_version`；使用严格
  schema 校验的既有消费方会解析失败。
- `settlement_constraints` 新增必填字段 `evaluated_check_count`；使用严格 schema
  校验的既有消费方会解析失败。
- `CheckStatus` 枚举扩容为 `PASS` / `HOLD` / `ESCALATE` / `NOT_APPLICABLE` 四值；
  对旧枚举做穷举 switch 的消费方会遗漏新分支。
- Evidence hash 升级后全部 `evidence_hash` 取值改变；依赖旧值的缓存与对账逻辑会
  全量 miss。消费方可读取 `response.hash_scheme_version` 区分新旧预映射方案。
- 空证据要求且非 `always_escalate` 的规则现在会在校验期被拒绝；运行时遇到此类规则
  会防御性返回 `ESCALATE` / `manual_review`，不再返回 `PASS`。

### 版本裁决留痕

- **`ENGINE_VERSION` 保持 `1.0.0`，未 bump。** 本次确实改动了引擎判定语义
  （空证据分支由 `PASS` 改为 `ESCALATE`），字面上触及"引擎判定语义变更必须 bump"
  这条约束，豁免理由如下：
  1. 该分支对**任何能通过 schema 校验的规则文件均不可达**——`RuleSchema` 新增的硬闸
     会在校验期拒绝此类规则，四个法域共 26 条规则实测 26/26 全部通过且行为不变；
  2. 实证：四个模块的 `evidence_hash` 与改动前**逐字符一致**，由三个互不依赖的
     实现路径独立复算确认，即语义变化在可观测层面为零；
  3. `ENGINE_VERSION` 由本轮变更集自身引入，`1.0.0` 从未对外发布过，
     不存在以旧语义签发的历史证据需要区分；
  4. 若强行 bump，四个 `evidence_hash` 会全部改变，等于再次作废已公示的哈希值，
     纯损失。
- `hash_scheme_version` 同样保持 `"2"`：`evaluated_check_count` 可由 `checks[]` 推导，
  不进入哈希预映射，预映射字节序列一字未动。

### 变更

- 增加 `NOT_APPLICABLE`，不再用 `PASS` 表示规则未触发或已知数值低于适用门槛。
- 为每个 check 增加机器可读 `basis`，区分调用方自述、缺失证据、确定性门槛、
  聚合数据不足、人工复核与不适用。
- Evidence hash 升级为 scheme `2`：将 `basis`、`engine_version` 与
  `hash_scheme_version` 纳入预映射；旧 hash 值不再沿用。
- 文档明确 `evidence_hash` 证明材料与结果未被修改，不证明调用方证据真实。

## [0.3.0] - 2026-07-26

### 新增

- 新增 `GET /healthz` 健康检查端点，供部署平台探活；该端点是限流中间件唯一豁免的路径。
- 新增 ERC-8004 agent card（`GET /.well-known/agent-card.json`）与域名 registration
  证明（`GET /.well-known/agent-registration.json`）发现端点。
- 新增单实例固定窗口限流（免费发现路径 + 付费检查支付前校验路径，默认每分钟 60 次，
  按凭证独立计数的已付重试宽松桶）、公网 URL 启动校验和最小访问日志。
- 新增 `scripts/register-8004.ts`（`npm run register:8004`）与 `scripts/verify-8004.ts`
  （`npm run verify:8004`）：ERC-8004 只读探测、注册、URI 更新与链上闭环校验脚本。
- 新增 `docs/deploy.md`（Railway 部署手册与四阶段注册流程）与
  `docs/marketplace/offering.json` / `docs/marketplace/listing.md`（Circle Agent
  Marketplace 提交材料，申请尚未提交）。
- API 文档拆分为双语版本：`docs/api.md`（英文，供 Circle Marketplace 申请表单的
  Documentation URL 引用）与新增的 `docs/api.zh-CN.md`（中文，原文完整迁移）；
  README.md / README.zh-CN.md 中指向 `docs/api.md` 的交叉链接与锚点同步更新。
- README.md / README.zh-CN.md 按"agent 开发者优先"重构：新首节"For AI Agents:
  Integrate in 3 Steps" / "AI Agent 接入三步"（发现/支付/验证 + `npm run
smoke:public` 一键体验），全文长度砍到约三分之一；被移除的长配置表、限流细节、
  支付层详述、CI/测试说明迁移进 `docs/api.md`（新增「Background」「Module
  Overview」「Payment Modes and Pricing」小节）与 `docs/deploy.md`（新增「本地
  开发」「测试与 CI」「完整配置项参考表」「本地对 Arc Testnet 的真实链上冒烟」
  小节，标题相应扩展为「本地开发、公网部署与 ERC-8004 注册」）；版税参数警示、
  链上注册完成状态、Marketplace 提交状态等事实性内容保留（前者移入 api.md，后两者
  在 README 保留精简版）。
- 版本号 `0.2.0` → `0.3.0`。

### 未变更（不变量）

- 规则文件、模块版本、规则引擎、既有响应 schema 与 `evidence_hash` 定义均未变更。

## [0.2.0] - 2026-07-25

对应设计：`docs/design/2026-07-25-hackathon-v2.2-alignment.md`。

### 新增

- `POST /modules/:id/check` 的 200 响应新增 `maintainer_wallet` 与 `royalty_bps`。
- 新增全局及按模块覆盖的维护者钱包、版税基点环境配置。
- 新增双语 README：`README.md`（英文，面向国际评审）与 `README.zh-CN.md`
  （原中文内容），两者互链、内容忠实对应；两版同时新增版税参数警示（零地址
  不得转账、`royalty_bps` 不被 `evidence_hash` 背书）。

### 变更

- 四模块默认价格调整为 `us-msb` 0.800000、`eu-msb` 0.600000、`uk-msb`
  0.400000、`sg-msb` 0.200000 测试网 USDC。
- `GET /modules` 的 `price_usdc` 与支付层使用同一价格解析，并规范化为六位小数。

### 未变更（不变量）

- `src/rules/*.json` 零改动，不 bump 任何模块 version。
- `evidence_hash` 定义与四模块全部既有值保持不变。

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
