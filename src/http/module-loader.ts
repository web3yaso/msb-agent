import { readFile } from "node:fs/promises";

import { z } from "zod";

import {
  DealInputSchema,
  RulesFileSchema,
  type DealInput,
  type ModuleId,
  type Rule,
  type RulesFile,
} from "../schemas/index.js";

const RULE_FILE_URLS: Record<ModuleId, URL> = {
  "us-msb": new URL("../rules/us-msb.json", import.meta.url),
  "uk-msb": new URL("../rules/uk-msb.json", import.meta.url),
  "eu-msb": new URL("../rules/eu-msb.json", import.meta.url),
  "sg-msb": new URL("../rules/sg-msb.json", import.meta.url),
};

export interface LoadedModule {
  metadata: RulesFile;
  rulesFileBytes: Uint8Array;
  inputSchema: z.ZodType<DealInput>;
  inputJsonSchema: Record<string, unknown>;
}

function createInputSchema(rules: readonly Rule[]): z.ZodType<DealInput> {
  const evidenceKeys = [...new Set(rules.flatMap(({ required_evidence: keys }) => keys))].sort();
  const evidenceShape = Object.fromEntries(
    evidenceKeys.map((evidenceKey) => [evidenceKey, z.unknown().optional()]),
  );

  return DealInputSchema.extend({
    evidence: z.looseObject(evidenceShape),
  });
}

async function loadModule(moduleId: ModuleId): Promise<LoadedModule> {
  const rulesFileBytes = await readFile(RULE_FILE_URLS[moduleId]);
  const parsedJson: unknown = JSON.parse(rulesFileBytes.toString("utf8"));
  const metadata = RulesFileSchema.parse(parsedJson);
  const inputSchema = createInputSchema(metadata.rules);

  return {
    metadata,
    rulesFileBytes,
    inputSchema,
    inputJsonSchema: z.toJSONSchema(inputSchema),
  };
}

/**
 * 一次性加载并校验四个法域的版本化规则文件。
 */
export async function loadModules(): Promise<Record<ModuleId, LoadedModule>> {
  const moduleIds = Object.keys(RULE_FILE_URLS) as ModuleId[];
  const entries = await Promise.all(
    moduleIds.map(async (moduleId) => [moduleId, await loadModule(moduleId)] as const),
  );

  return Object.fromEntries(entries) as Record<ModuleId, LoadedModule>;
}
