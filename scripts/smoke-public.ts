import { setTimeout as delay } from "node:timers/promises";

import { GatewayClient } from "@circle-fin/x402-batching/client";
import { decodePaymentRequiredHeader } from "@x402/core/http";

import { ModuleResponseSchema } from "../src/schemas/index.js";
import {
  DEPOSIT_POLL_INTERVAL_MS,
  DEPOSIT_POLL_MAX_ATTEMPTS,
  getClientPrivateKey,
  getDepositAmount,
  getForceDeposit,
  getPublicSmokeBaseUrl,
  getSafeErrorMessage,
  getSmokeModule,
  MINIMUM_GATEWAY_BALANCE,
  parseDepositAmountAtomic,
  SMOKE_DEAL_INPUT,
} from "./smoke-shared.js";

let clientPrivateKey: `0x${string}` | undefined;

try {
  const moduleId = getSmokeModule();
  const baseUrl = getPublicSmokeBaseUrl();
  const endpoint = `${baseUrl}/modules/${moduleId}/check`;
  const isForceDeposit = getForceDeposit();
  clientPrivateKey = getClientPrivateKey();
  const rpcUrl = process.env.SMOKE_ARC_RPC_URL?.trim();
  const gatewayClient = new GatewayClient({
    chain: "arcTestnet",
    privateKey: clientPrivateKey,
    ...(rpcUrl !== undefined && rpcUrl !== "" ? { rpcUrl } : {}),
  });

  process.stdout.write(`Public smoke payer: ${gatewayClient.address}\n`);
  process.stdout.write(`Public smoke endpoint: ${endpoint}\n`);
  process.stdout.write("[1/4] balance: 查询 Gateway 可用余额\n");
  const balances = await gatewayClient.getBalances();
  process.stdout.write(`Gateway available balance: ${balances.gateway.formattedAvailable} USDC\n`);

  if (balances.gateway.available < MINIMUM_GATEWAY_BALANCE) {
    if (!isForceDeposit) {
      throw new Error(
        "Gateway 可用余额不足。请先从 https://faucet.circle.com 获取 Arc Testnet USDC，" +
          "再设置 SMOKE_FORCE_DEPOSIT=1 让脚本调用 GatewayClient.deposit 存款并等待到账",
      );
    }

    const depositAmount = getDepositAmount();
    const expectedAvailable = balances.gateway.available + parseDepositAmountAtomic(depositAmount);
    process.stdout.write(`[2/4] deposit: 余额不足，存入 ${depositAmount} USDC\n`);
    const deposit = await gatewayClient.deposit(depositAmount);
    process.stdout.write(`Deposit transaction: ${deposit.depositTxHash}\n`);

    let isDepositAvailable = false;
    for (let attempt = 1; attempt <= DEPOSIT_POLL_MAX_ATTEMPTS; attempt += 1) {
      await delay(DEPOSIT_POLL_INTERVAL_MS);
      const updatedBalances = await gatewayClient.getBalances();
      process.stdout.write(
        `Deposit confirmation ${String(attempt)}/${String(DEPOSIT_POLL_MAX_ATTEMPTS)}: ${updatedBalances.gateway.formattedAvailable} USDC available\n`,
      );
      if (updatedBalances.gateway.available >= expectedAvailable) {
        isDepositAvailable = true;
        break;
      }
    }
    if (!isDepositAvailable) {
      throw new Error(
        `存款等待超时：Gateway 可用余额未在 ${String(DEPOSIT_POLL_MAX_ATTEMPTS * 15)} 秒内增加 ${depositAmount} USDC`,
      );
    }
  } else {
    process.stdout.write("[2/4] deposit: skipped（余额充足）\n");
  }

  process.stdout.write("[3/4] 402: 发送无支付凭证请求并校验公网资源 URL\n");
  const unpaidResponse = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(SMOKE_DEAL_INPUT),
  });
  const unpaidBody: unknown = await unpaidResponse.json();
  if (unpaidResponse.status !== 402) {
    throw new Error(
      `首次请求应返回 402，实际为 ${String(unpaidResponse.status)}：${JSON.stringify(unpaidBody)}`,
    );
  }
  const paymentRequiredHeader = unpaidResponse.headers.get("payment-required");
  if (paymentRequiredHeader === null) {
    throw new Error("402 响应缺少 PAYMENT-REQUIRED 头");
  }
  const paymentRequired = decodePaymentRequiredHeader(paymentRequiredHeader);
  if (!paymentRequired.resource.url.startsWith("https://")) {
    throw new Error(
      `PAYMENT-REQUIRED resource.url 必须使用 HTTPS：${paymentRequired.resource.url}`,
    );
  }

  process.stdout.write("[4/4] pay: Circle Gateway 真实支付并校验模块响应\n");
  const payment = await gatewayClient.pay(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: SMOKE_DEAL_INPUT,
  });
  if (payment.status !== 200) {
    throw new Error(
      `付费请求应返回 200，实际为 ${String(payment.status)}：${JSON.stringify(payment.data)}`,
    );
  }
  if (payment.transaction === "") {
    throw new Error("付费请求缺少结算 ID");
  }

  const moduleResponse = ModuleResponseSchema.parse(payment.data);
  process.stdout.write(`Payment settlement ID: ${payment.transaction}\n`);
  process.stdout.write(`evidence_hash: ${moduleResponse.evidence_hash}\n`);
  process.stdout.write(`overall: ${moduleResponse.overall}\n`);
  process.stdout.write(`maintainer_wallet: ${moduleResponse.maintainer_wallet}\n`);
  process.stdout.write(`royalty_bps: ${String(moduleResponse.royalty_bps)}\n`);
  process.stdout.write(`SMOKE PUBLIC OK ${payment.transaction}\n`);
} catch (error: unknown) {
  process.stderr.write(`SMOKE PUBLIC FAILED: ${getSafeErrorMessage(error, clientPrivateKey)}\n`);
  process.exitCode = 1;
}
