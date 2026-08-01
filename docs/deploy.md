# 本地开发、公网部署与 ERC-8004 注册

> 本 Module 为基于公开法源整理的 Demo 版本，输出为检查项状态，不构成法律意见。

当前线上实例：<https://msb-agent-production-769d.up.railway.app>（Railway，已实测
`/healthz`、`/modules`、`/.well-known/agent-card.json`、`POST /modules/:id/check`
的 402 报价流程；见 README「AI Agent 接入三步」小节的可复制 curl 示例）。

## 本地开发

要求：Node.js 20+（开发环境用 Node 22/25 验证过）、npm。

```bash
npm install
cp .env.example .env
```

`.env.example` 默认给出 `PAYMENT_MODE=off`（本地无支付启动，注意：这只是示例文件里
的显式值，源码默认值是 `x402-arc-testnet`，见下文「环境变量」）。以 off 模式启动：

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
同一端点会先返回 HTTP 402（见下文「环境变量」与 `docs/api.md` 的「Payment Modes and
Pricing」）。

## 测试与 CI

```bash
npm test
```

三层测试（详见 `docs/api.zh-CN.md` 或对应源码）：

1. 引擎单元测试：每条规则至少一个触发/不触发用例 + 确定性测试（同输入两次求值
   `checks`/`evidence_hash` 完全一致）；
2. golden 测试（`src/golden/citely-demo.test.ts`）：Citely Demo 场景（美国 Client →
   新加坡 Marketplace → 英/德服务商，名义 10,000 USDC）四个模块的固定输入输出快照，
   含 `evidence_hash` 跨运行一致性断言与 `disclaimer` 存在性断言；规则 version bump
   后必须重新生成快照并人工 review diff；
3. 集成测试：x402 402 → 支付 → 200 全流程（`base-sepolia` 走单元测试常态覆盖，
   `arc-testnet` 走 `npm run smoke:arc` 真实链上冒烟——见下方「本地对 Arc Testnet
   的真实链上冒烟」——不进 `npm test` 常规流程）。

```bash
npm run validate:rules   # 规则文件缺 source / 版本未 bump / updated_at 未更新 → 失败
CHECK_RULE_LINKS=1 npm run check:links   # 法源链接存活检查；未设置该变量时跳过
```

`check:links` 支持豁免清单 `scripts/link-exemptions.json`：清单内的 URL 只警告不
失败（当前豁免 MAS Notices 官方入口，PSN01/PSN02 具体直达页待核实）。

## Railway 部署

1. 在 Railway 创建项目并连接 `web3yaso/msb-agent` 仓库，保持单实例常驻。
2. 按下方清单注入环境变量，明确设置 `PAYMENT_MODE=x402-arc-testnet`，**并显式设置
   `PORT=3000`**（见下方「已知坑」）。
3. 首次部署后生成 Railway 分配的 `*.up.railway.app` HTTPS 子域名。
4. 将 `PUBLIC_BASE_URL` 设置为该 Railway URL 后重新部署。
5. Railway 健康检查使用 `GET /healthz`；该专用端点豁免应用层限流。

依赖安装必须走 `npm ci`（按 package-lock.json 的 integrity 校验安装，esbuild 等带
install script 的依赖由锁文件背书；Railway/Railpack 默认即 `npm ci`，勿改用忽略锁文件的方式）。
服务由 `npm start` 启动（`node --import tsx src/index.ts`，生产环境经 tsx 直跑 TypeScript 源码，
不产出编译产物——规则文件原始字节是 evidence_hash 输入，不引入拷贝/重排环节）。
Node 版本要求 `>=20`（package.json `engines` 已声明，Railway 据此选择运行时）。

启动失败应先检查环境变量，不要通过修改代码绕过 fail-fast。规则文件必须保留在 Node
文件系统中，服务必须保持单实例，否则进程内付款重试状态无法共享。

### 已知坑（2026-07-27 部署过程实测记录）

- **必须显式设置 `PORT=3000`**：Railway 不会自动注入 `PORT` 环境变量。若缺失，服务
  监听的端口与 Railway 边缘代理转发的目标端口对不上，会出现「健康检查通过、但对外
  请求 502」的现象——`/healthz` 走的是 Railway 内部探活路径，可能先于边缘路由暴露
  问题被发现，掩盖了端口不匹配。部署前务必确认 `PORT` 与域名目标端口一致。
- **变量填写后必须点击 Deploy 应用**：Railway 控制台修改/新增环境变量后默认停留在
  staged（待应用）状态，不会自动生效；必须手动触发一次 Deploy，新配置才会应用到
  运行中的实例。

## 环境变量

服务运行需要 `PUBLIC_BASE_URL`、`PAYMENT_MODE`、四个 `{MODULE}_PAY_TO`、四模块价格
（可使用默认值）、`MODULE_MAINTAINER_WALLET`、`MODULE_ROYALTY_BPS` 和
`X402_ARC_TESTNET_FACILITATOR_URL`。身份公开信息为 `ERC8004_AGENT_ID` 与
`ERC8004_IDENTITY_REGISTRY`。限流可用 `RATE_LIMIT_WINDOW_MS`、
`RATE_LIMIT_MAX_REQUESTS`、`RATE_LIMIT_TRUST_PROXY_HEADER` 调整。Railway 部署必须设置
`RATE_LIMIT_TRUST_PROXY_HEADER=true`：服务位于 Railway 可信平台代理之后，socket IP
是边缘节点地址，必须读取平台转发的客户端 IP 才能正确分桶。本地或裸机部署保持
`RATE_LIMIT_TRUST_PROXY_HEADER=false`，避免客户端伪造转发头绕过限流。

脚本使用 `ERC8004_RPC_URL`、`AGENT_CARD_URL` 与
`ERC8004_REGISTRAR_PRIVATE_KEY`。**`ERC8004_REGISTRAR_PRIVATE_KEY` 不要写入部署平台**；
它只应在本地运行注册与校验脚本时临时设置。注册钱包应与收款及维护者钱包分离，只放不
超过约 1 USDC 的测试网 gas。

### 完整配置项参考表

完整模板见 `.env.example`（复制为 `.env` 后按需修改；真实收款地址/私钥永远不要
提交到仓库）。核心配置项：

| 变量                                                                                  | 说明                                                                                        | 默认值                                                         |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `PAYMENT_MODE`                                                                        | `off` \| `x402-base-sepolia` \| `x402-arc-testnet`                                          | 源码默认 `x402-arc-testnet`（`.env.example` 示例显式写 `off`） |
| `PORT`                                                                                | HTTP 监听端口                                                                               | `3000`                                                         |
| `PUBLIC_BASE_URL`                                                                     | 公网 HTTPS 基地址；`off` 模式未设时回落 localhost，付费模式必填                             | 无                                                             |
| `US_MSB_PRICE_USDC` / `UK_MSB_PRICE_USDC` / `EU_MSB_PRICE_USDC` / `SG_MSB_PRICE_USDC` | 每模块单次调用价格，最多 6 位小数                                                           | 分别为 `0.800000` / `0.400000` / `0.600000` / `0.200000`       |
| `US_MSB_PAY_TO` / `UK_MSB_PAY_TO` / `EU_MSB_PAY_TO` / `SG_MSB_PAY_TO`                 | 每模块收款地址（`0x` + 40 位十六进制），`off` 模式不校验，x402 模式必填                     | 占位地址，启用前必须替换                                       |
| `MODULE_MAINTAINER_WALLET`                                                            | 全局维护者版税收款地址；x402 模式必填，可用四个 `{MODULE}_MAINTAINER_WALLET` 变量按模块覆盖 | `off` 模式回落零地址                                           |
| `MODULE_ROYALTY_BPS`                                                                  | 全局版税基点（0–10000 整数），可用四个 `{MODULE}_ROYALTY_BPS` 变量按模块覆盖                | `0`                                                            |
| `X402_ARC_TESTNET_FACILITATOR_URL`                                                    | Circle Arc Testnet hosted facilitator URL；仅 `x402-arc-testnet` 用                         | 无（该模式下必填）                                             |
| `X402_BASE_SEPOLIA_FACILITATOR_URL`                                                   | Base Sepolia facilitator URL；仅 `x402-base-sepolia` 用                                     | 无（该模式下必填）                                             |
| `CHECK_RULE_LINKS`                                                                    | 设为 `1` 启用规则法源链接存活检查（网络请求）                                               | `0`（跳过）                                                    |
| `RULES_BASE_REF`                                                                      | 规则版本 CI 校验的 git 对比基准                                                             | `HEAD^`                                                        |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_REQUESTS` / `RATE_LIMIT_TRUST_PROXY_HEADER`  | 限流窗口/上限/是否信任代理头（见上文）                                                      | `60000` / `60` / `false`                                       |
| `ERC8004_IDENTITY_REGISTRY` / `ERC8004_AGENT_ID`                                      | ERC-8004 公开身份信息（见「阶段 1-4」）                                                     | 无                                                             |

## 本地对 Arc Testnet 的真实链上冒烟

`npm run smoke:arc` 针对**本地启动的服务**（而非公网实例，公网实例的真实付费见
README「AI Agent 接入三步」的 `npm run smoke:public`）跑一次真实链上 402 → 支付 →
200：

```bash
PAYMENT_MODE=x402-arc-testnet \
MODULE_MAINTAINER_WALLET=<维护者钱包地址> \
X402_SMOKE_CLIENT_PRIVATE_KEY=<测试钱包私钥，占位符，不要提交到仓库> \
npm run smoke:arc
```

`x402-arc-testnet` 模式要求 `MODULE_MAINTAINER_WALLET` 已设置，否则服务会在启动时
fail-fast；`npm run smoke:arc` 同样受此校验约束。本仓库已跑通一次真实冒烟（非占位
数据）：Gateway 存款交易
`0xfcc78968b336ac103fe577cfd74075309cf70720eb086a7394c28146d83919f7`，支付结算 ID
`49f19918-632c-4ffe-9869-27be6472ac69`。

### 已知坑：官方公共 RPC 会限流，存款路径必撞（2026-07-31 实测）

Arc Testnet 官方公共节点 `https://rpc.testnet.arc.network` 有较紧的请求配额，
**跑存款路径时几乎必然撞上**，表现为：

```
SMOKE PUBLIC FAILED: RPC Request failed.
Contract Call:
  function:  allowance(address owner, address spender)
Details: request limit reached          ← JSON-RPC 错误码 -32011
```

注意这是 viem 的 `RpcRequestError`（节点正常响应但返回了错误对象），
**不是** `HttpRequestError`（网络不通）——不要往「端点挂了」的方向排查。

触发条件是**调用密度**，不是调用总量：Gateway 余额低于 `MINIMUM_GATEWAY_BALANCE`
（1.05 USDC）时脚本进入存款分支，approve 前要读 `allowance`，这段调用比单纯查余额
密集一个数量级。只查余额的路径基本不会触发。

同一 `eth_call` 连打 15 次的实测结果：

| 端点                                          | 成功 / 失败                  |
| --------------------------------------------- | ---------------------------- |
| `https://rpc.testnet.arc.network`（SDK 默认） | 7 / **8**                    |
| `https://rpc.testnet.arc.io`                  | 11 / 4（表现相近，疑似同源） |
| `https://arc-testnet.drpc.org`                | **15 / 0**                   |
| `https://arc-testnet.rpc.thirdweb.com`        | **15 / 0**                   |

**处置**：用 `SMOKE_ARC_RPC_URL` 换到 dRPC 或 thirdweb（两者 chainId 均实测为
`0x4cef52` = 5042002）：

私钥与 `SMOKE_FORCE_DEPOSIT=1` 的准备方式**完全照 README「Try It Now」那一节**
（`read -rs` 写入 `.env.local`，不在命令行上敲私钥、用 `>>` 不覆盖已有内容），
这里不重复。相对那节命令，本处只多一个环境变量：

```bash
SMOKE_ARC_RPC_URL=https://arc-testnet.drpc.org \
node --env-file=.env.local --import tsx scripts/smoke-public.ts
```

两点说明：

- **必须走 `node --env-file=`，不能用 `npm run smoke:public`**：package.json 里那条
  script 没有 `--env-file`，项目也没有 dotenv，`.env.local` 不会被加载，
  只会得到「`X402_SMOKE_CLIENT_PRIVATE_KEY` 缺失」这个与限流无关的报错；
- README 的 `.env.local` 模板里已含 `SMOKE_FORCE_DEPOSIT=1`，**本节场景必须有它**
  ——否则余额低于门槛时脚本在进入存款分支前就 throw「Gateway 可用余额不足」而退出，
  走不到会触发限流的那段调用，也就验证不了换端点是否有效
  （见 `scripts/smoke-public.ts` 的余额门槛分支）。余额充足时该变量不产生任何副作用，
  可以一直留在文件里。

**次要缓解**：把 `SMOKE_DEPOSIT_USDC` 调大（如 `5`），一次存款够跑好几轮，
后续运行余额充足会直接跳过存款分支，从根上避开这段密集调用。

本仓库已用 dRPC 跑通一次公网真实付费冒烟：存款交易
`0x6ac9fa96ecc555c41396e96cddd57bb7c6426acd24356db19c1abc528084c70e`，
支付结算 ID `f22febf0-8a7a-4649-bc1d-aa9f9f168e7b`，
`evidence_hash` `55b687d6d79d24602eca450a353a5dc6577367e3927256e1ab13e8213fdf0d05`，
`overall` 为 `HOLD`。该次冒烟同时验证了响应能通过 `ModuleResponseSchema.parse`，
即线上实例的三个必填字段齐全：根级的 `engine_version` 与 `hash_scheme_version`、
以及 `settlement_constraints.evaluated_check_count`。

脚本相关环境变量：`X402_SMOKE_CLIENT_PRIVATE_KEY`（必填，测试钱包私钥）、
`SMOKE_ARC_RPC_URL`（可选，自定义 RPC；**公共节点限流时必须设置**，见上）、
`SMOKE_MODULE`（可选，默认 `us-msb`）、
`SMOKE_PORT`（可选，默认 `4402`）、`SMOKE_DEPOSIT_USDC`（可选，默认 `1.50`）、
`SMOKE_FORCE_DEPOSIT`（可选，`0`/`1`/`false`/`true`，为真时余额不足自动调用
`GatewayClient.deposit(...)` 存款并轮询等待到账）。

## 阶段 1：先部署 agent card

不设置 `ERC8004_AGENT_ID` 部署。确认 agent card 返回 200，registration 证明返回 404。

## 阶段 2：注册链上身份

先运行 `npm run register:8004` 完成只读探测，再由人工运行
`npm run register:8004 -- --confirm`。Agent card 必须已经通过公网 HTTPS 可访问。

## 阶段 3：回填公开身份

将脚本输出的 `ERC8004_AGENT_ID` 与经人工复核的 `ERC8004_IDENTITY_REGISTRY` 加入
Railway 环境并重启。不要加入注册私钥。

## 阶段 4：验证闭环

设置公开的 `ERC8004_REGISTRAR_ADDRESS`，运行 `npm run verify:8004`，确认 owner、
token URI、agent card registration 和免责声明四项全部通过；验证阶段不需要保存或提供
注册私钥。

## Render 兜底

若 Railway 绑卡受阻，可部署到 Render Free，并用外部 keep-alive 每 10 分钟请求
`GET /modules`。免费实例仍可能休眠并产生 30–60 秒冷启动，且休眠会清空进程内
`PaidRetryStore`；演示和调用方必须被明确告知。

## 运维检查表

- 每周确认 Railway 子域名和 TLS 可用，避免 token URI 指向失控域名。
- 定期检查 `/.well-known/agent-card.json` 与链上 token URI 一致。
- 注册钱包离线保管；仅需要更新 URI 时补充少量 Arc Testnet USDC。
- 测试网 USDC 水龙头：`https://faucet.circle.com`。
- 部署回滚到上一稳定 Railway deployment 后，重新检查 agent card URL 和四模块发现端点。
