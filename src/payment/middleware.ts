import { HTTPFacilitatorClient } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { paymentMiddlewareFromConfig } from "@x402/hono";
import type { MiddlewareHandler } from "hono";

import { DISCLAIMER } from "../http/constants.js";
import type { ModuleId } from "../schemas/index.js";
import type { PaymentConfig } from "./config.js";
import { getPaymentCredentialId, getPaymentRetryKey, PaidRetryStore } from "./idempotency.js";

export interface X402MiddlewareConfig {
  facilitatorUrl: string;
  moduleId: ModuleId;
  network: "base-sepolia" | "arc-testnet";
  path: string;
  payTo: `0x${string}`;
  priceAtomic: string;
  priceUsdc: string;
}

export type X402MiddlewareFactory = (
  config: X402MiddlewareConfig,
) => Promise<MiddlewareHandler> | MiddlewareHandler;

export interface PaymentRequestState {
  credentialId?: string;
  isPaymentAccepted: boolean;
  retryKey?: string;
}

const X402_NETWORKS: Record<X402MiddlewareConfig["network"], Network> = {
  "base-sepolia": "eip155:84532",
  "arc-testnet": "eip155:5042002",
};

function defaultX402MiddlewareFactory(config: X402MiddlewareConfig): MiddlewareHandler {
  const network = X402_NETWORKS[config.network];
  const facilitatorClient = new HTTPFacilitatorClient({ url: config.facilitatorUrl });

  return paymentMiddlewareFromConfig(
    {
      [`POST ${config.path}`]: {
        accepts: {
          network,
          payTo: config.payTo,
          price: `$${config.priceUsdc}`,
          scheme: "exact",
        },
        description: `${config.moduleId} deterministic compliance check`,
        mimeType: "application/json",
      },
    },
    facilitatorClient,
    [{ network, server: new ExactEvmScheme() }],
  );
}

function readPaymentCredential(request: Request): string | undefined {
  return request.headers.get("payment-signature") ?? request.headers.get("x-payment") ?? undefined;
}

export async function createPaymentMiddlewares(
  config: PaymentConfig,
  requestStates: WeakMap<Request, PaymentRequestState>,
  retryStore: PaidRetryStore,
  factory: X402MiddlewareFactory = defaultX402MiddlewareFactory,
): Promise<Partial<Record<ModuleId, MiddlewareHandler>>> {
  if (config.mode === "off") {
    return {};
  }
  const { facilitatorUrl, network } = config;
  if (facilitatorUrl === undefined || network === undefined) {
    throw new Error("支付配置缺少 facilitator 或 network");
  }

  const moduleEntries = await Promise.all(
    Object.entries(config.modules).map(async ([rawModuleId, moduleConfig]) => {
      const moduleId = rawModuleId as ModuleId;
      const path = `/modules/${moduleId}/check`;
      const x402Middleware = await factory({
        ...moduleConfig,
        facilitatorUrl,
        moduleId,
        network,
        path,
      });

      const middleware: MiddlewareHandler = async (context, next) => {
        const credential = readPaymentCredential(context.req.raw);
        const credentialId =
          credential === undefined ? undefined : getPaymentCredentialId(credential);
        const retryKey =
          credentialId === undefined
            ? undefined
            : getPaymentRetryKey(
                credentialId,
                new URL(context.req.url).pathname,
                await context.req.raw.clone().text(),
              );
        const state: PaymentRequestState = {
          credentialId,
          isPaymentAccepted: retryKey !== undefined && retryStore.has(retryKey),
          retryKey,
        };
        requestStates.set(context.req.raw, state);

        if (state.isPaymentAccepted) {
          await next();
          return;
        }

        try {
          const response = await x402Middleware(context, async () => {
            state.isPaymentAccepted = credentialId !== undefined;
            await next();
          });
          if (response instanceof Response) {
            context.res = response;
          }
        } catch (error: unknown) {
          const acceptedState = requestStates.get(context.req.raw);
          if (acceptedState?.isPaymentAccepted !== true) {
            return context.json(
              {
                error: "facilitator_unavailable",
                message: "支付服务暂不可用，请稍后重试",
                disclaimer: DISCLAIMER,
              },
              502,
            );
          }
          if (acceptedState.retryKey !== undefined) {
            retryStore.remember(acceptedState.retryKey);
          }
          throw error;
        } finally {
          const finalState = requestStates.get(context.req.raw);
          if (
            finalState?.isPaymentAccepted === true &&
            finalState.retryKey !== undefined &&
            context.res.status >= 500
          ) {
            retryStore.remember(finalState.retryKey);
          }
        }
      };
      return [moduleId, middleware] as const;
    }),
  );

  return Object.fromEntries(moduleEntries);
}
