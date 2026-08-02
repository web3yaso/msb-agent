# Circle Agent Marketplace 提交材料

> 本 Module 为基于公开法源整理的 Demo 版本，输出为检查项状态，不构成法律意见。

## 中文描述

MSB Compliance Module Service 为 US、UK、EU、SG、AE 五法域提供跨境汇款监管检查项状态。
服务使用确定性规则引擎，每条规则包含公开法源引用，不在判定回路中使用 LLM。调用方通过
x402 使用 Arc Testnet USDC 按次支付。输出是检查项状态，不构成法律意见。

## English description

MSB Compliance Module Service provides regulatory check-item statuses for cross-border money
transmission across the US, UK, EU, Singapore, and the UAE. Its deterministic rule engine cites a
public legal source for every rule and uses no LLM in the decision path. Calls are paid per
request via x402 in Arc Testnet USDC. Output is a check-item status compiled from public legal
sources and does not constitute legal advice.

## 表单字段

- Service name: `MSB Compliance Module Service`
- Category: `compliance`
- Base URL: `https://msb-agent-production-769d.up.railway.app`
- Agent card: `https://msb-agent-production-769d.up.railway.app/.well-known/agent-card.json`
- Repository: `https://github.com/web3yaso/msb-agent`
- Contact: `<提交人填写>`

## 链上身份

- 步骤 0a 字段与地址人工复核：已完成（2026-07-26，对照 EIP-8004 原文修正 endpoints→services，QA 独立 curl 原文复核）
- 步骤 0c 只读探测输出：chainId=5042002 / codeBytes=130 / name=AgentIdentity / symbol=AGENT（2026-07-27，经 https://arc-testnet.drpc.org）
- Identity Registry：`0x8004A818BFB912233c491871b3d84c89A494BD9e`（Arc Testnet）
- Agent ID：`851930`
- Transaction hash：[`0x519b1a5d94d0d4e28468cf4fd07143d776d78cf9df0035ea498b17fd48be2097`](https://testnet.arcscan.app/tx/0x519b1a5d94d0d4e28468cf4fd07143d776d78cf9df0035ea498b17fd48be2097)

## 状态跟踪

| 提交时间       | 提交人         | 回执编号或截图路径 | 状态            |
| -------------- | -------------- | ------------------ | --------------- |
| 2026-07-27     | web3yaso       | 无（Google 表单未提供回执编号） | `submitted`     |
