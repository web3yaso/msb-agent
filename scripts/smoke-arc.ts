import { once } from "node:events";

import { GatewayClient } from "@circle-fin/x402-batching/client";
import { serve, type ServerType } from "@hono/node-server";
import { decodePaymentRequiredHeader } from "@x402/core/http";

import { createApp } from "../src/http/app.js";
import { loadPaymentConfig } from "../src/payment/index.js";
import { ModuleIdSchema, ModuleResponseSchema, type ModuleId } from "../src/schemas/index.js";

const DEFAULT_SMOKE_PORT = 4402;
const DEFAULT_DEPOSIT_USDC = "1.50";
const MINIMUM_GATEWAY_BALANCE = 1_050_000n;

const SMOKE_DEAL_INPUT = {
  deal_id: "arc-testnet-smoke",
  parties: [
    { role: "payer", country: "US", state: "NY" },
    { role: "payee", country: "SG" },
    { role: "payee", country: "GB" },
    { role: "payee", country: "DE" },
  ],
  activity: "money_transmission",
  amount_usdc: 10_000,
  monthly_volume_usdc: 3_000_000,
  evidence: {},
};

function getSmokeModule(): ModuleId {
  const parsedModule = ModuleIdSchema.safeParse(process.env.SMOKE_MODULE ?? "us-msb");
  if (!parsedModule.success) {
    throw new Error(`SMOKE_MODULE 非法：${process.env.SMOKE_MODULE ?? ""}`);
  }
  return parsedModule.data;
}

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

function getClientPrivateKey(): `0x${string}` {
  const rawPrivateKey = process.env.X402_SMOKE_CLIENT_PRIVATE_KEY?.trim();
  const privateKey =
    rawPrivateKey !== undefined && !rawPrivateKey.startsWith("0x")
      ? `0x${rawPrivateKey}`
      : rawPrivateKey;
  if (privateKey === undefined || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("X402_SMOKE_CLIENT_PRIVATE_KEY 缺失或不是 32 字节十六进制私钥");
  }
  return privateKey as `0x${string}`;
}

function getDepositAmount(): string {
  const configuredAmount = process.env.SMOKE_DEPOSIT_USDC?.trim();
  const amount =
    configuredAmount === undefined || configuredAmount === ""
      ? DEFAULT_DEPOSIT_USDC
      : configuredAmount;
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(amount) || Number(amount) <= 0) {
    throw new Error(`SMOKE_DEPOSIT_USDC 必须是正数且最多 6 位小数：${amount}`);
  }
  return amount;
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

    const balances = await gatewayClient.getBalances();
    process.stdout.write(
      `Gateway available balance: ${balances.gateway.formattedAvailable} USDC\n`,
    );
    if (balances.gateway.available < MINIMUM_GATEWAY_BALANCE) {
      const deposit = await gatewayClient.deposit(getDepositAmount());
      depositTransaction = deposit.depositTxHash;
      process.stdout.write(`Deposit transaction: ${depositTransaction}\n`);
    }

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
    if (depositTransaction === undefined) {
      process.stdout.write("Deposit transaction: not required\n");
    }
    process.stdout.write(`Payment settlement ID: ${payment.transaction}\n`);
    process.stdout.write(`evidence_hash: ${moduleResponse.evidence_hash}\n`);
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
