import { computeEvidenceHash } from "../evidence-hash/index.js";
import type {
  CheckResult,
  CheckStatus,
  DealInput,
  Party,
  Rule,
  RuleWhen,
} from "../schemas/index.js";

export interface EngineResult {
  checks: CheckResult[];
  overall: CheckStatus;
  evidence_hash: string;
}

function matchesCountry(party: Party, condition: NonNullable<RuleWhen["party_country"]>): boolean {
  return typeof condition === "string"
    ? party.country === condition
    : party.role === condition.role && party.country === condition.country;
}

function matchesState(party: Party, condition: NonNullable<RuleWhen["party_state"]>): boolean {
  return typeof condition === "string"
    ? party.state === condition
    : party.role === condition.role && party.state === condition.state;
}

function matchesPartyConditions(parties: readonly Party[], when: RuleWhen): boolean {
  if (when.party_country === undefined && when.party_state === undefined) {
    return true;
  }

  return parties.some(
    (party) =>
      (when.party_country === undefined || matchesCountry(party, when.party_country)) &&
      (when.party_state === undefined || matchesState(party, when.party_state)),
  );
}

function matchesApplicability(input: DealInput, when: RuleWhen): boolean {
  const isActivityMatched = when.activity === undefined || when.activity.includes(input.activity);

  return isActivityMatched && matchesPartyConditions(input.parties, when);
}

function hasEvidence(value: unknown): boolean {
  if (value === undefined || value === null || value === false) {
    return false;
  }

  if (typeof value === "string" || Array.isArray(value)) {
    return value.length > 0;
  }

  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }

  return true;
}

function createCheck(rule: Rule, result: CheckStatus, reason: string): CheckResult {
  return {
    id: rule.id,
    result,
    reason,
    source: rule.source,
  };
}

function evaluateApplicableRule(rule: Rule, input: DealInput): CheckResult {
  if (rule.always_escalate) {
    return createCheck(rule, "ESCALATE", `规则无法确定性判定，需人工核实：${rule.note}`);
  }

  if (rule.when.amount_gte !== undefined && input.amount_usdc < rule.when.amount_gte) {
    return createCheck(rule, "HOLD", "单笔未达门槛，聚合情形需采购方自行核实");
  }

  if (rule.when.monthly_volume_gte !== undefined) {
    if (input.monthly_volume_usdc === undefined || input.monthly_volume_usdc === null) {
      return createCheck(rule, "HOLD", "无法判定分级，需补交易量数据");
    }

    if (input.monthly_volume_usdc < rule.when.monthly_volume_gte) {
      return createCheck(rule, "PASS", "月交易量未达规则门槛");
    }
  }

  const missingEvidence = rule.required_evidence.filter(
    (evidenceKey) =>
      !Object.hasOwn(input.evidence, evidenceKey) || !hasEvidence(input.evidence[evidenceKey]),
  );

  return missingEvidence.length === 0
    ? createCheck(rule, "PASS", "所需证据齐全")
    : createCheck(rule, rule.result_if_missing, `缺少所需证据：${missingEvidence.join(", ")}`);
}

function evaluateRule(rule: Rule, input: DealInput): CheckResult {
  if (!matchesApplicability(input, rule.when)) {
    return createCheck(rule, "PASS", "规则条件未触发");
  }

  return evaluateApplicableRule(rule, input);
}

/**
 * 按 ESCALATE、HOLD、PASS 的优先级聚合最坏检查结果。
 */
export function aggregateCheckStatus(checks: readonly CheckResult[]): CheckStatus {
  if (checks.some(({ result }) => result === "ESCALATE")) {
    return "ESCALATE";
  }

  return checks.some(({ result }) => result === "HOLD") ? "HOLD" : "PASS";
}

/**
 * 确定性求值全部规则，并用规则文件原始字节计算 evidence_hash。
 */
export function evaluate(
  rules: readonly Rule[],
  input: DealInput,
  rulesFileBytes: Uint8Array,
): EngineResult {
  const checks = rules.map((rule) => evaluateRule(rule, input));

  return {
    checks,
    overall: aggregateCheckStatus(checks),
    evidence_hash: computeEvidenceHash(rulesFileBytes, input, checks),
  };
}
