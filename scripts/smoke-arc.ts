import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

import { GatewayClient } from "@circle-fin/x402-batching/client";
import { serve, type ServerType } from "@hono/node-server";
import { decodePaymentRequiredHeader } from "@x402/core/http";

import { createApp } from "../src/http/app.js";
import { loadPaymentConfig } from "../src/payment/index.js";
import { ModuleResponseSchema } from "../src/schemas/index.js";
import {
  DEPOSIT_POLL_INTERVAL_MS,
  DEPOSIT_POLL_MAX_ATTEMPTS,
  getClientPrivateKey,
  getDepositAmount,
  getForceDeposit,
  getSmokeModule,
  MINIMUM_GATEWAY_BALANCE,
  parseDepositAmountAtomic,
  SMOKE_DEAL_INPUT,
} from "./smoke-shared.js";

const DEFAULT_SMOKE_PORT = 4402;

function getSmokePort(): number {
  const rawPort = process.env.SMOKE_PORT ?? String(DEFAULT_SMOKE_PORT);
  if (!/^\d+$/.test(rawPort)) {
    throw new Error(`SMOKE_PORT 非法：${rawPort}`);
  }
  const port = Number(rawPort);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`SMOKE_PORT 必须在 1 到 65535 之间：${rawPort}`);
  }
  return port;
}

async function startServer(port: number): Promise<ServerType> {
  const app = await createApp();
  const server = serve({
    fetch: app.fetch,
    hostname: "127.0.0.1",
    port,
  });
  if (!server.listening) {
    await once(server, "listening");
  }
  return server;
}

async function closeServer(server: ServerType): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
        return;
      }
      reject(error);
    });
  });
}

async function runSmoke(): Promise<void> {
  if (process.env.PAYMENT_MODE !== "x402-arc-testnet") {
    throw new Error("PAYMENT_MODE 必须显式设置为 x402-arc-testnet");
  }
  loadPaymentConfig();

  const moduleId = getSmokeModule();
  const port = getSmokePort();
  const isForceDeposit = getForceDeposit();
  const rpcUrl = process.env.SMOKE_ARC_RPC_URL?.trim();
  const gatewayClient = new GatewayClient({
    chain: "arcTestnet",
    privateKey: getClientPrivateKey(),
    ...(rpcUrl !== undefined && rpcUrl !== "" ? { rpcUrl } : {}),
  });
  const endpoint = `http://127.0.0.1:${String(port)}/modules/${moduleId}/check`;
  let server: ServerType | undefined;
  let depositTransaction: string | undefined;

  process.stdout.write(`Arc smoke payer: ${gatewayClient.address}\n`);
  process.stdout.write(`Arc smoke module: ${moduleId}\n`);

  try {
    server = await startServer(port);

    process.stdout.write("[1/5] balance: 查询 Gateway 可用余额\n");
    const balances = await gatewayClient.getBalances();
    process.stdout.write(
      `Gateway available balance: ${balances.gateway.formattedAvailable} USDC\n`,
    );

    const isDepositRequired =
      isForceDeposit || balances.gateway.available < MINIMUM_GATEWAY_BALANCE;
    if (isDepositRequired) {
      const depositAmount = getDepositAmount();
      const depositAtomic = parseDepositAmountAtomic(depositAmount);
      const expectedAvailable = balances.gateway.available + depositAtomic;

      process.stdout.write(
        `[2/5] deposit: ${isForceDeposit ? "强制" : "余额不足，"}存入 ${depositAmount} USDC\n`,
      );
      const deposit = await gatewayClient.deposit(depositAmount);
      depositTransaction = deposit.depositTxHash;
      process.stdout.write(`Deposit transaction: ${depositTransaction}\n`);

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
      process.stdout.write("[2/5] deposit: skipped（余额充足且未强制存款）\n");
    }

    process.stdout.write("[3/5] 402: 发送无支付凭证请求\n");
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
    process.stdout.write(
      `Payment requirements:\n${JSON.stringify(paymentRequired.accepts, null, 2)}\n`,
    );

    process.stdout.write("[4/5] pay: Circle Gateway 签名并提交支付请求\n");
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
    process.stdout.write("[5/5] 200: 支付与合规检查成功\n");
    process.stdout.write(`Payment settlement ID: ${payment.transaction}\n`);
    process.stdout.write(`evidence_hash: ${moduleResponse.evidence_hash}\n`);
    process.stdout.write(`maintainer_wallet: ${moduleResponse.maintainer_wallet}\n`);
    process.stdout.write(`royalty_bps: ${String(moduleResponse.royalty_bps)}\n`);
    process.stdout.write(`overall: ${moduleResponse.overall}\n`);
    process.stdout.write(`SMOKE OK ${payment.transaction}\n`);
  } finally {
    if (server !== undefined) {
      await closeServer(server);
    }
  }
}

try {
  await runSmoke();
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : "未知错误";
  process.stderr.write(`SMOKE FAILED: ${message}\n`);
  process.exitCode = 1;
}
