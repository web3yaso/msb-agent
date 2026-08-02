# 安全债务与已知观察项

本文件记录经审查确认、但按当前范围不处理（或留待后续设计）的安全/QA 观察项。
每条记录审查来源、事实依据、影响范围与后续动作；不重复记录 CHANGELOG「已知限制」
中已列出的产品级限制（规则聚合近似、法源链接待核实等）。

> 本文件本身不构成安全承诺；条目状态以最近一次审计记录为准。

---

## 2026-07-26 — v2.2 契约对齐（`docs/design/2026-07-25-hackathon-v2.2-alignment.md`）QA + 安全双审

### 1. `MODULE_MAINTAINER_WALLET` 显式配置为零地址时，x402 模式下仍可正常启动（Low）

- **事实**：`loadRoyaltyConfig`（`src/payment/royalty.ts:49-54`）的 fail-fast 校验只判断
  环境变量是否为 `undefined`/空字符串；若运维在 `x402-*` 模式下把
  `MODULE_MAINTAINER_WALLET` **显式**填成 `0x0000000000000000000000000000000000000000`
  （`ZERO_ADDRESS`，`src/http/constants.ts:6`），该值能通过 `EVM_ADDRESS_PATTERN`
  正则校验，服务会正常启动。
- **风险边界**：零地址本身是本设计明确的"不可支付"哨兵值（§4.1.1 字段语义、
  §9 安全考量第 3 条）；交叉校验（`royaltyBps > 0 && maintainerWallet === ZERO_ADDRESS`
  抛错，`royalty.ts:70-72`）已保证"零地址 + 非零费率"这一危险组合任何模式下都无法
  启动。因此该场景下**没有资金损失路径**——顶多是版税恒为 0 的静默降级，不是资金安全问题。
- **文档措辞落差**：`.env.example` 与 README 冒烟章节写"`x402-*` 模式下
  `MODULE_MAINTAINER_WALLET` 必填，否则 fail-fast"，读起来比实际行为更强——实际只拦
  "未设置"，不拦"设置为零地址"。本次审查确认这是**文档措辞可以更精确**，而非代码缺陷。
- **处置**：不在本次范围内修复（收紧为"x402 下显式零地址也拒绝启动"属于设计层面的
  校验规则变更，需回到 `docs/design/` 走设计评审）。部署核对清单新增一项：
  **上线前人工确认 `MODULE_MAINTAINER_WALLET`（及各模块覆盖项）取值非零地址**。
- **状态**：已记录，暂不处理，留待后续设计评估是否收紧。

### 2. `app.test.ts` 404 路径缺少"响应不含新字段"断言（QA 低优先级）

- **事实**：`src/http/app.test.ts` 中 400（第 174-175 行）、413（194-195 行）、
  422（217-218 行）三条错误路径均有 `expect(body).not.toHaveProperty("maintainer_wallet"/"royalty_bps")`
  断言，唯独 404（模块不存在）路径没有对应断言。
- **人工验证**：已人工构造 404 请求核对响应体，确认不含 `maintainer_wallet` /
  `royalty_bps`（`getDiscoveryModule`/404 handler 与新字段组装逻辑无关联路径，
  `src/http/app.ts:268-271` 仅在 200 响应组装时执行），行为正确，只是测试覆盖缺口。
- **处置**：补充断言属于纯测试增量，不改变任何行为；已记录为待办，不阻塞本次发布。

### 既有债务（本次核实未恶化）

- `@hono/node-server@1.19.14 <2.0.5`：moderate，Windows `serve-static` 路径穿越
  （GHSA-frvp-7c67-39w9）。`npm audit` 复核仍为该唯一 moderate 项；服务在容器/Linux
  部署下不可达（不使用 Windows 文件路径），升级到 2.x 为 breaking change，本次不做。
- Facilitator URL 允许 `http:` 协议（`src/payment/config.ts:75-80` `parseFacilitatorUrl`
  只拒绝非 HTTP(S) 协议，不强制 HTTPS）。本次未改动该函数，行为不变。
- 部分既有 schema 字段缺 `.max()` 上限（如 `deal_id`/`amount_usdc`/
  `monthly_volume_usdc`/`state`/`id`/`reason`/`source` 等仅有 `.min(1)`/`nonnegative()`，
  无长度或数值上界，`src/schemas/deal-input.ts`、`src/schemas/module-response.ts`、
  `src/schemas/rule.ts`）。本次新增的 `EvmAddressSchema`（固定 42 字符正则）与
  `RoyaltyBpsSchema`（`.max(10_000)`，`src/schemas/common.ts:5,7`）均带边界，未引入
  新的无界字段。

---

## 2026-07-26 — Marketplace + ERC-8004 上架（`docs/design/2026-07-26-marketplace-8004-registration.md`）QA + 安全双审

### 1. 按 IP 分桶的限流对分布式来源（多 IP）请求 fail-open（设计取舍，非缺陷）

- **事实**：`createRateLimiter`（`src/http/rate-limit.ts`）的分桶键是
  `${客户端IP}:${路由前缀}`（`getClientIp` + `getRoutePrefix` 组合，同文件
  第 40-45、90-92 行）；同一免费端点从大量不同源 IP 发起的请求，每个 IP 各自拥有
  独立的窗口计数，单实例内存 `Map` 无法把它们识别为同一攻击者。因此**一个使用多
  个源 IP（僵尸网络、代理池、云函数出口 IP 轮换等）的调用方可以在事实上不受本限流
  约束**地持续打免费发现路径与付费检查的支付前校验（`bodyLimit` 256KB 仍生效，
  规则引擎本身在支付前不被调用）。
- **风险边界**：本服务无状态、无数据库，免费路径的计算成本是 JSON 解析 + zod
  校验 + 法域判断，单请求成本很低；`POST /modules/:id/check` 真正收费与规则求值
  发生在支付通过之后，分布式刷量拿不到规则判定结果，也不产生资金损失路径。影响
  面是**计算资源消耗与访问日志噪音**，不是资金安全或数据泄露问题。
- **为什么是设计取舍而非缺陷**：`docs/design/2026-07-26-marketplace-8004-registration.md`
  §3.1／§3.3 明确要求"零新依赖"与"单实例常驻"（`PaidRetryStore` 幂等窗口本就要求
  单实例，边缘/多实例运行时因此被一票否决），分布式限流需要共享存储（Redis 等）或
  平台层 WAF，这两者都会引入新依赖或新的外部服务，与本次范围（黑客松窗口内、
  Railway 单实例部署）冲突。按 IP 分桶的固定窗口限流覆盖的是"单一来源误用/失控
  客户端重试"这一主要威胁，分布式场景的缓解依赖部署平台或未来接入的 CDN/WAF。
- **处置**：不在本次范围内修复。若后续接入 Cloudflare 或类似边缘代理，应优先在
  平台层做分布式限流，`src/http/rate-limit.ts` 的应用层限流作为第二道防线保留。
- **状态**：已记录，暂不处理，接受为当前部署形态下的已知限制。

## 部署前核对清单（追加项）

- [ ] `x402-*` 模式上线前，人工确认 `MODULE_MAINTAINER_WALLET`
      （及 `US_MSB_MAINTAINER_WALLET` 等按模块覆盖项，若使用）已替换为真实维护者钱包，
      非 `.env.example` 中的零地址占位值。

## 2026-08-01 ae-msb 安全审计遗留（Medium/Low，已随 PR 放行）

报告全文：`docs/design/reviews/sec-ae-msb-20260801-2250.md`（design 目录不入库）。

- [ ] **M1（上线前必须完成，部分完成）** `docs/deploy.md` 已于 2026-08-01 doc-writer
      同步补齐 `AE_MSB_PRICE_USDC` / `AE_MSB_PAY_TO` / `AE_MSB_MAINTAINER_WALLET` /
      `AE_MSB_ROYALTY_BPS` 的环境变量表条目及"先配置再发布"的部署顺序提示。
      **`.env.example` 仍未同步**——doc-writer 对该文件的 Read/Edit/Bash 全部被沙箱权限
      拒绝（deny rule 覆盖该文件路径，无法确认现状或写入），需人工补一次性编辑，
      具体待补内容见 `docs/design/2026-08-01-ae-msb-module.md` 的「已知缺口」小节。
      任一 x402 模式下缺 `AE_MSB_PAY_TO` 会让**整个服务**启动失败（fail-closed，非收款风险）。
      部署顺序：先配环境变量，再发布本次代码。
- [ ] **L2** `src/http/constants.ts` 的 `MODULE_COUNTRIES["eu-msb"]` 直接引用可变的
      `EU_MEMBER_COUNTRIES`（`ReadonlySet` 只是类型约束），运行时可被 `.add()` 扩大受理法域。
      建议 `Object.freeze` 或改存副本。
- [ ] **L3** 付费墙 402 回归测试只覆盖 `us-msb`；建议加
      `it.each(ModuleIdSchema.options)` 断言"每个模块未付费必 402"，防止将来某模块端点意外免费。
- [ ] **L4** 本地未跟踪文件 `.env.local` / `.env.smoke` 各含 2 处 gitleaks 命中（已 gitignore、
      历史扫描无泄漏）。勿 `git add -f`，建议将私密配置移出仓库目录。
- [ ] **L5** 存量依赖告警：`@hono/node-server <2.0.5`（GHSA-frvp-7c67-39w9，Windows serve-static
      路径穿越）。本仓未使用 serve-static，路径不可达；升级 2.x 为破坏性变更，需单独设计。
