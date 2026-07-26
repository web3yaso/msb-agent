# 公网部署与 ERC-8004 注册

> 本 Module 为基于公开法源整理的 Demo 版本，输出为检查项状态，不构成法律意见。

## Railway 部署

1. 在 Railway 创建项目并连接 `web3yaso/msb-agent` 仓库，保持单实例常驻。
2. 按下方清单注入环境变量，明确设置 `PAYMENT_MODE=x402-arc-testnet`。
3. 首次部署后生成 Railway 分配的 `*.up.railway.app` HTTPS 子域名。
4. 将 `PUBLIC_BASE_URL` 设置为该 Railway URL 后重新部署。
5. Railway 健康检查使用 `GET /healthz`；该专用端点豁免应用层限流。

启动失败应先检查环境变量，不要通过修改代码绕过 fail-fast。规则文件必须保留在 Node
文件系统中，服务必须保持单实例，否则进程内付款重试状态无法共享。

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
