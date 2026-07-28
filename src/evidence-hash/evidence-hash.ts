import { createHash } from "node:crypto";

import type { CheckResult, DealInput, Party } from "../schemas/index.js";

const SEPARATOR = new Uint8Array([0x1f]);
const TEXT_ENCODER = new TextEncoder();

export const ENGINE_VERSION = "1.0.0";
export const EVIDENCE_HASH_SCHEME_VERSION = "2";

export interface EvidenceHashVersions {
  engineVersion: string;
  hashSchemeVersion: string;
}

function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function serializeObject(value: object): string {
  const entries = Object.entries(value).map(
    ([key, entryValue]) => [key.normalize("NFC"), entryValue] as const,
  );
  const normalizedKeys = new Set(entries.map(([key]) => key));

  if (normalizedKeys.size !== entries.length) {
    throw new TypeError("JSON 对象包含 NFC 规范化后重复的键");
  }

  entries.sort(([leftKey], [rightKey]) => compareStrings(leftKey, rightKey));

  return `{${entries
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${serializeJson(entryValue)}`)
    .join(",")}}`;
}

function serializeJson(value: unknown): string {
  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (typeof value === "string") {
    return JSON.stringify(value.normalize("NFC"));
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("JSON 数字必须是有限数值");
    }

    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => serializeJson(item)).join(",")}]`;
  }

  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return serializeObject(value);
  }

  throw new TypeError("只能规范化 JSON 值");
}

function compareParties(left: Party, right: Party): number {
  return (
    compareStrings(left.role, right.role) ||
    compareStrings(left.country, right.country) ||
    compareStrings(left.state ?? "", right.state ?? "")
  );
}

/**
 * 按设计文档 §4.2 生成无空白、键有序且字符串 NFC 化的 JSON。
 */
export function canonicalizeJson(value: unknown): string {
  return serializeJson(value);
}

/**
 * 规范化 DealInput，并使 parties 的原始数组顺序不影响结果。
 */
export function canonicalizeDealInput(input: DealInput): string {
  const normalizedInput = {
    deal_id: input.deal_id,
    parties: input.parties.map((party) => ({ ...party })).sort(compareParties),
    activity: input.activity,
    amount_usdc: input.amount_usdc,
    ...(input.monthly_volume_usdc === undefined
      ? {}
      : { monthly_volume_usdc: input.monthly_volume_usdc }),
    evidence: input.evidence,
  };

  return canonicalizeJson(normalizedInput);
}

/**
 * 仅保留影响判定的 check id、result 与 basis，并按 id 排序后规范化。
 */
export function canonicalizeChecks(checks: readonly CheckResult[]): string {
  const materialChecks = checks
    .map(({ id, result, basis }) => ({ id, result, basis }))
    .sort((left, right) => compareStrings(left.id, right.id));

  return canonicalizeJson(materialChecks);
}

/**
 * 使用版本上下文、规则文件原始字节、规范化输入和规范化 checks 计算 evidence_hash。
 */
export function computeEvidenceHash(
  rulesFileBytes: Uint8Array,
  input: DealInput,
  checks: readonly CheckResult[],
  versions: EvidenceHashVersions = {
    engineVersion: ENGINE_VERSION,
    hashSchemeVersion: EVIDENCE_HASH_SCHEME_VERSION,
  },
): string {
  const versionContext = canonicalizeJson({
    engine_version: versions.engineVersion,
    hash_scheme_version: versions.hashSchemeVersion,
  });

  return createHash("sha256")
    .update(TEXT_ENCODER.encode(versionContext))
    .update(SEPARATOR)
    .update(rulesFileBytes)
    .update(SEPARATOR)
    .update(TEXT_ENCODER.encode(canonicalizeDealInput(input)))
    .update(SEPARATOR)
    .update(TEXT_ENCODER.encode(canonicalizeChecks(checks)))
    .digest("hex");
}
