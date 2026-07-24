import { RulesFileSchema, type RulesFile } from "../src/schemas/index.js";

export interface RuleDocument {
  path: string;
  content: string;
  previousContent?: string;
}

export interface RuleValidationResult {
  errors: string[];
  rulesFile?: RulesFile;
}

function parseRulesFile(path: string, content: string): RuleValidationResult {
  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(content);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { errors: [`${path}: JSON 解析失败：${message}`] };
  }

  const parsedRules = RulesFileSchema.safeParse(parsedJson);
  if (!parsedRules.success) {
    const issues = parsedRules.error.issues.map(
      (issue) => `${path}:${issue.path.join(".") || "<root>"}: ${issue.message}`,
    );
    return { errors: issues };
  }

  return { errors: [], rulesFile: parsedRules.data };
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);

  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

function validateChangedMetadata(path: string, current: RulesFile, previous: RulesFile): string[] {
  const errors: string[] = [];

  if (compareVersions(current.version, previous.version) <= 0) {
    errors.push(
      `${path}: 规则内容已变更，version 必须高于上一版 ${previous.version}，当前为 ${current.version}`,
    );
  }

  if (Date.parse(current.updated_at) <= Date.parse(previous.updated_at)) {
    errors.push(
      `${path}: 规则内容已变更，updated_at 必须晚于上一版 ${previous.updated_at}，当前为 ${current.updated_at}`,
    );
  }

  return errors;
}

/**
 * 校验单个规则文件，并在内容变化时强制递增 version 与 updated_at。
 */
export function validateRuleDocument(document: RuleDocument): RuleValidationResult {
  const currentResult = parseRulesFile(document.path, document.content);
  if (currentResult.rulesFile === undefined || document.previousContent === undefined) {
    return currentResult;
  }

  if (document.content === document.previousContent) {
    return currentResult;
  }

  const previousResult = parseRulesFile(`${document.path}（上一版）`, document.previousContent);
  if (previousResult.rulesFile === undefined) {
    return {
      errors: [...currentResult.errors, ...previousResult.errors],
      rulesFile: currentResult.rulesFile,
    };
  }

  return {
    errors: [
      ...currentResult.errors,
      ...validateChangedMetadata(document.path, currentResult.rulesFile, previousResult.rulesFile),
    ],
    rulesFile: currentResult.rulesFile,
  };
}
