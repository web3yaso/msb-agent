import { EVIDENCE_HASH_SCHEME_VERSION, ENGINE_VERSION } from "../evidence-hash/index.js";
import type { PaymentConfig } from "../payment/index.js";
import type { ModuleId } from "../schemas/index.js";
import {
  AGENT_DOCS_PATH,
  AGENT_IMAGE_PATH,
  AGENT_NAME,
  AGENT_SHORT_DESCRIPTION,
  DISCLAIMER,
  MODULE_JURISDICTIONS,
} from "./constants.js";
import type { LoadedModule } from "./module-loader.js";

const REGISTRATION_TYPE = "https://eips.ethereum.org/EIPS/eip-8004#registration-v1";
const SERVICE_VERSION = "0.3.0";
const NETWORK_CHAIN_IDS = {
  "arc-testnet": 5_042_002,
  "base-sepolia": 84_532,
} as const;

function getChainId(paymentConfig: PaymentConfig): number {
  return NETWORK_CHAIN_IDS[paymentConfig.network ?? "arc-testnet"];
}

export interface AgentCardInput {
  agentId?: number;
  baseUrl: string;
  identityRegistry?: string;
  modulePrices: Record<ModuleId, { priceAtomic: string; priceUsdc: string }>;
  modules: Record<ModuleId, LoadedModule>;
  paymentConfig: PaymentConfig;
  payTo: Record<ModuleId, string>;
}

interface AgentRegistration {
  agentId: number;
  agentRegistry: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function getSources(module: LoadedModule) {
  const sources = new Map(
    module.metadata.rules.map(({ source, source_url, accessed_date }) => [
      source_url,
      { source, source_url, accessed_date },
    ]),
  );
  return [...sources.values()];
}

/** 构造域名控制证明；未完成链上注册时不作空声明。 */
export function buildAgentRegistration(
  input: AgentCardInput,
): { registrations: AgentRegistration[] } | undefined {
  if (input.agentId === undefined || input.identityRegistry === undefined) return undefined;
  return {
    registrations: [
      {
        agentId: input.agentId,
        agentRegistry: `eip155:${String(getChainId(input.paymentConfig))}:${input.identityRegistry.toLowerCase()}`,
      },
    ],
  };
}

/** 由规则元数据和支付配置确定性构造 ERC-8004 registration 文件。 */
export function buildAgentCard(input: AgentCardInput): Record<string, unknown> {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const moduleIds = Object.keys(input.modules) as ModuleId[];
  const registration = buildAgentRegistration(input);
  const pricing = moduleIds
    .map((moduleId) => `${moduleId} ${input.modulePrices[moduleId].priceUsdc}`)
    .join(" / ");

  return {
    type: REGISTRATION_TYPE,
    name: AGENT_NAME,
    description: `${AGENT_SHORT_DESCRIPTION.replace(DISCLAIMER, "")}定价：${pricing} 测试网 USDC 每次调用。${DISCLAIMER}`,
    image: `${baseUrl}${AGENT_IMAGE_PATH}`,
    services: [
      { name: "web", endpoint: `${baseUrl}${AGENT_DOCS_PATH}`, version: SERVICE_VERSION },
      { name: "x402", endpoint: `${baseUrl}/modules`, version: "x402/2" },
    ],
    x402Support: true,
    active: true,
    supportedTrust: ["reputation"],
    ...(registration ?? {}),
    "x-msb": {
      protocol: "x402",
      network: input.paymentConfig.network ?? "arc-testnet",
      chain_id: getChainId(input.paymentConfig),
      engine_version: ENGINE_VERSION,
      hash_scheme_version: EVIDENCE_HASH_SCHEME_VERSION,
      settlement_asset: "USDC",
      modules: moduleIds.map((moduleId) => ({
        id: moduleId,
        version: input.modules[moduleId].metadata.version,
        jurisdiction: MODULE_JURISDICTIONS[moduleId],
        price_usdc: input.modulePrices[moduleId].priceUsdc,
        pay_to: input.payTo[moduleId],
        check_endpoint: `${baseUrl}/modules/${moduleId}/check`,
        input_schema_url: `${baseUrl}/modules/${moduleId}/schema`,
        sources: getSources(input.modules[moduleId]),
      })),
      evidence_hash_definition:
        "sha256(canonical_version_context || rules_file_bytes || canonical_input || checks[{id,result,basis}])",
      no_llm_in_decision_path: true,
      payment_parameters_are_not_covered_by_evidence_hash: true,
    },
    disclaimer: DISCLAIMER,
  };
}
