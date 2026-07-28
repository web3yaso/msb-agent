import { beforeAll, describe, expect, it } from "vitest";
import { resolveModulePrices } from "../payment/index.js";
import type { ModuleId } from "../schemas/index.js";
import { buildAgentCard, buildAgentRegistration, type AgentCardInput } from "./agent-card.js";
import { DISCLAIMER } from "./constants.js";
import { loadModules } from "./module-loader.js";

describe("agent card", () => {
  let input: AgentCardInput;
  beforeAll(async () => {
    const modules = await loadModules();
    input = {
      baseUrl: "https://example.com/",
      modules,
      modulePrices: resolveModulePrices({}),
      payTo: Object.fromEntries(
        Object.keys(modules).map((moduleId) => [moduleId, "0xplaceholder"]),
      ) as Record<ModuleId, string>,
      paymentConfig: { mode: "x402-arc-testnet", modules: {}, network: "arc-testnet" },
    };
  });

  it("包含规范、免责声明和确定性架构声明", () => {
    const card = buildAgentCard(input);
    expect(card.type).toBe("https://eips.ethereum.org/EIPS/eip-8004#registration-v1");
    expect(card.disclaimer).toBe(DISCLAIMER);
    expect(card.description).toContain(DISCLAIMER);
    expect(card.services).toEqual([
      { name: "web", endpoint: "https://example.com/", version: "0.3.0" },
      { name: "x402", endpoint: "https://example.com/modules", version: "x402/2" },
    ]);
    expect(card).not.toHaveProperty("endpoints");
    expect(card.x402Support).toBe(true);
    expect(card.active).toBe(true);
    expect(card).not.toHaveProperty("registrations");
    expect(buildAgentRegistration(input)).toBeUndefined();
    expect((card["x-msb"] as { no_llm_in_decision_path: boolean }).no_llm_in_decision_path).toBe(
      true,
    );
    expect(card["x-msb"]).toMatchObject({
      engine_version: "1.0.0",
      hash_scheme_version: "2",
    });
  });

  it("四模块元数据、价格和法源完整", () => {
    const extension = buildAgentCard(input)["x-msb"] as {
      modules: {
        id: ModuleId;
        price_usdc: string;
        sources: { source: string; source_url: string; accessed_date: string }[];
        version: string;
      }[];
    };
    expect(extension.modules).toHaveLength(4);
    for (const module of extension.modules) {
      expect(module.price_usdc).toMatch(/^\d+\.\d{6}$/);
      expect(module.sources.length).toBeGreaterThan(0);
      expect(typeof module.sources[0]?.source).toBe("string");
      expect(typeof module.sources[0]?.source_url).toBe("string");
      expect(typeof module.sources[0]?.accessed_date).toBe("string");
      expect(module.version).toBe(input.modules[module.id].metadata.version);
    }
  });

  it("规范化 URL 且不声明 A2A 或 MCP", () => {
    const serialized = JSON.stringify(buildAgentCard(input));
    expect(serialized).not.toContain("example.com//");
    expect(serialized).not.toContain("A2A");
    expect(serialized).not.toContain("MCP");
    expect(buildAgentCard({ ...input, baseUrl: "https://example.com" })).toEqual(
      buildAgentCard(input),
    );
  });

  it("注册信息使用 CAIP 形式并保持纯函数性", () => {
    const registeredInput = {
      ...input,
      agentId: 123,
      identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    };
    const first = buildAgentCard(registeredInput);
    expect(first.registrations).toEqual([
      {
        agentId: 123,
        agentRegistry: "eip155:5042002:0x8004a818bfb912233c491871b3d84c89a494bd9e",
      },
    ]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(buildAgentCard(registeredInput)));
  });

  it("chain_id 由支付网络派生", () => {
    const baseInput = {
      ...input,
      paymentConfig: { mode: "x402-base-sepolia", modules: {}, network: "base-sepolia" },
    } satisfies AgentCardInput;
    expect((buildAgentCard(baseInput)["x-msb"] as { chain_id: number }).chain_id).toBe(84_532);
  });
});
