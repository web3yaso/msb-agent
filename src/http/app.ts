import { Hono } from "hono";

import { evaluate } from "../engine/index.js";
import {
  ModuleIdSchema,
  ModuleResponseSchema,
  type DealInput,
  type ModuleId,
} from "../schemas/index.js";
import {
  DISCLAIMER,
  EU_MEMBER_COUNTRIES,
  MODULE_JURISDICTIONS,
  MODULE_PAY_TO_ENV,
  MODULE_PRICE_ENV,
} from "./constants.js";
import { loadModules, type LoadedModule } from "./module-loader.js";

const MODULE_MAINTAINER = "MSB Compliance Module Service";
const RESULT_VALIDITY_MS = 72 * 60 * 60 * 1000;

export interface CreateAppOptions {
  now?: () => Date;
}

function isPartyInJurisdiction(moduleId: ModuleId, input: DealInput): boolean {
  const acceptedCountries =
    moduleId === "eu-msb"
      ? EU_MEMBER_COUNTRIES
      : new Set([moduleId === "us-msb" ? "US" : moduleId === "uk-msb" ? "GB" : "SG"]);

  return input.parties.some(({ country }) => acceptedCountries.has(country));
}

function getSources(module: LoadedModule) {
  const sourcesByUrl = new Map(
    module.metadata.rules.map(({ source, source_url, accessed_date }) => [
      source_url,
      { source, source_url, accessed_date },
    ]),
  );

  return [...sourcesByUrl.values()];
}

function getDiscoveryModule(moduleId: ModuleId, module: LoadedModule) {
  return {
    module: moduleId,
    version: module.metadata.version,
    updated_at: module.metadata.updated_at,
    jurisdiction: MODULE_JURISDICTIONS[moduleId],
    maintainer: MODULE_MAINTAINER,
    price_usdc: process.env[MODULE_PRICE_ENV[moduleId]] ?? "1.000000",
    pay_to: process.env[MODULE_PAY_TO_ENV[moduleId]] ?? "",
    sources: getSources(module),
    input_schema_url: `/modules/${moduleId}/schema`,
  };
}

function getModule(
  modules: Record<ModuleId, LoadedModule>,
  rawModuleId: string,
): { id: ModuleId; module: LoadedModule } | undefined {
  const parsedModuleId = ModuleIdSchema.safeParse(rawModuleId);
  return parsedModuleId.success
    ? { id: parsedModuleId.data, module: modules[parsedModuleId.data] }
    : undefined;
}

/**
 * 创建已加载规则的 HTTP 应用；支付中间件由步骤 11 在 check 路由边界接入。
 */
export async function createApp(options: CreateAppOptions = {}): Promise<Hono> {
  const modules = await loadModules();
  const now = options.now ?? (() => new Date());
  const app = new Hono();

  app.get("/modules", (context) =>
    context.json({
      disclaimer: DISCLAIMER,
      modules: ModuleIdSchema.options.map((moduleId) =>
        getDiscoveryModule(moduleId, modules[moduleId]),
      ),
    }),
  );

  app.get("/modules/:id/schema", (context) => {
    const selectedModule = getModule(modules, context.req.param("id"));
    if (selectedModule === undefined) {
      return context.json(
        { error: "module_not_found", message: "未知模块", disclaimer: DISCLAIMER },
        404,
      );
    }

    return context.json({
      ...selectedModule.module.inputJsonSchema,
      disclaimer: DISCLAIMER,
    });
  });

  // 步骤 11 在此处为 check 路由接入 x402 支付中间件。
  app.post("/modules/:id/check", async (context) => {
    const selectedModule = getModule(modules, context.req.param("id"));
    if (selectedModule === undefined) {
      return context.json(
        { error: "module_not_found", message: "未知模块", disclaimer: DISCLAIMER },
        404,
      );
    }

    let requestBody: unknown;
    try {
      requestBody = await context.req.json<unknown>();
    } catch {
      return context.json(
        {
          error: "invalid_request",
          issues: [{ path: [], message: "请求体必须是有效 JSON" }],
          disclaimer: DISCLAIMER,
        },
        400,
      );
    }

    const parsedInput = selectedModule.module.inputSchema.safeParse(requestBody);
    if (!parsedInput.success) {
      return context.json(
        {
          error: "invalid_request",
          issues: parsedInput.error.issues.map(({ path, message }) => ({ path, message })),
          disclaimer: DISCLAIMER,
        },
        400,
      );
    }

    if (!isPartyInJurisdiction(selectedModule.id, parsedInput.data)) {
      return context.json(
        {
          error: "jurisdiction_not_applicable",
          message: `全部交易方均不在 ${MODULE_JURISDICTIONS[selectedModule.id]} 模块适用法域内`,
          disclaimer: DISCLAIMER,
        },
        422,
      );
    }

    const engineResult = evaluate(
      selectedModule.module.metadata.rules,
      parsedInput.data,
      selectedModule.module.rulesFileBytes,
    );
    const validUntil = new Date(now().getTime() + RESULT_VALIDITY_MS).toISOString();
    const response = ModuleResponseSchema.parse({
      module: selectedModule.id,
      version: selectedModule.module.metadata.version,
      updated_at: selectedModule.module.metadata.updated_at,
      checks: engineResult.checks,
      overall: engineResult.overall,
      settlement_constraints: {
        module: selectedModule.id,
        module_version: selectedModule.module.metadata.version,
        deal_id: parsedInput.data.deal_id,
        valid_until: validUntil,
        blocked_check_ids: engineResult.checks
          .filter(({ result }) => result === "HOLD")
          .map(({ id }) => id),
        escalated_check_ids: engineResult.checks
          .filter(({ result }) => result === "ESCALATE")
          .map(({ id }) => id),
        evidence_hash: engineResult.evidence_hash,
      },
      evidence_hash: engineResult.evidence_hash,
      disclaimer: DISCLAIMER,
    });

    return context.json(response);
  });

  return app;
}
