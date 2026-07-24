import type { RulesFile } from "../src/schemas/index.js";

export interface LinkExemption {
  url: string;
  reason: string;
}

export interface LinkFailure {
  url: string;
  status: number;
}

export interface LinkNetworkError {
  url: string;
  message: string;
}

export interface LinkCheckResult {
  checked: string[];
  exempted: LinkExemption[];
  failures: LinkFailure[];
  networkErrors: LinkNetworkError[];
}

export type LinkFetcher = (url: string, init: RequestInit) => Promise<Response>;

/**
 * 从所有规则中收集并去重法源 URL。
 */
export function collectSourceUrls(rulesFiles: readonly RulesFile[]): string[] {
  return [
    ...new Set(
      rulesFiles.flatMap(({ rules }) => rules.map(({ source_url: sourceUrl }) => sourceUrl)),
    ),
  ].sort();
}

async function checkSingleLink(
  url: string,
  fetcher: LinkFetcher,
): Promise<{
  failure?: LinkFailure;
  networkError?: LinkNetworkError;
}> {
  try {
    const response = await fetcher(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(10_000),
    });
    const isReachable =
      response.status < 400 ||
      response.status === 401 ||
      response.status === 403 ||
      response.status === 429;

    return isReachable ? {} : { failure: { url, status: response.status } };
  } catch (error: unknown) {
    return {
      networkError: {
        url,
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

/**
 * 检查非豁免 URL；网络异常单独返回，由 CLI 按 CI 策略决定是否跳过。
 */
export async function checkSourceLinks(
  urls: readonly string[],
  exemptions: readonly LinkExemption[],
  fetcher: LinkFetcher,
): Promise<LinkCheckResult> {
  const exemptionByUrl = new Map(exemptions.map((exemption) => [exemption.url, exemption]));
  const exempted = urls.flatMap((url) => {
    const exemption = exemptionByUrl.get(url);
    return exemption === undefined ? [] : [exemption];
  });
  const checked = urls.filter((url) => !exemptionByUrl.has(url));
  const outcomes = await Promise.all(checked.map((url) => checkSingleLink(url, fetcher)));

  return {
    checked,
    exempted,
    failures: outcomes.flatMap(({ failure }) => (failure === undefined ? [] : [failure])),
    networkErrors: outcomes.flatMap(({ networkError }) =>
      networkError === undefined ? [] : [networkError],
    ),
  };
}
