# 公网部署与 ERC-8004 注册

> 本 Module 为基于公开法源整理的 Demo 版本，输出为检查项状态，不构成法律意见。

当前线上实例：<https://msb-agent-production-769d.up.railway.app>（Railway，已实测
`/healthz`、`/modules`、`/.well-known/agent-card.json`、`POST /modules/:id/check`
的 402 报价流程；见 README「Live Demo / 线上服务」小节的可复制 curl 示例）。

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
