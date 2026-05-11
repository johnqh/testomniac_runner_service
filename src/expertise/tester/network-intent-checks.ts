import type { ExpertiseContext, Outcome } from "../types";

export function checkNetworkRequestMade(
  expectation: {
    description: string;
    expectedValue?: string;
    expectedTextTokens?: string[];
  },
  context: ExpertiseContext
): Outcome {
  const methodExpectation = normalizeMethodExpectation(
    expectation.expectedValue
  );
  const tokens = (expectation.expectedTextTokens ?? [])
    .map(token => token.trim().toLowerCase())
    .filter(Boolean);

  const candidates = context.networkLogs.filter(log => {
    const method = (log.method ?? "").toUpperCase();
    const haystack = `${method} ${log.url}`.toLowerCase();

    if (methodExpectation === "MUTATION" && !isMutationMethod(method)) {
      return false;
    }

    if (
      methodExpectation !== "ANY" &&
      methodExpectation !== "MUTATION" &&
      method !== methodExpectation
    ) {
      return false;
    }

    if (tokens.length === 0) {
      return true;
    }

    return tokens.some(token => haystack.includes(token));
  });

  if (candidates.length === 0) {
    return {
      expected: expectation.description,
      observed: describeMissingRequest(methodExpectation, tokens),
      result: "error",
    };
  }

  const matched = candidates[0];
  return {
    expected: expectation.description,
    observed: `Observed ${matched.method} ${matched.url} (${matched.status})`,
    result: "pass",
  };
}

function normalizeMethodExpectation(value?: string): string {
  const normalized = (value ?? "ANY").trim().toUpperCase();
  if (!normalized) return "ANY";
  if (normalized === "POST_OR_MUTATION") return "MUTATION";
  return normalized;
}

function isMutationMethod(method: string): boolean {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method);
}

function describeMissingRequest(
  methodExpectation: string,
  tokens: string[]
): string {
  const methodDescription =
    methodExpectation === "ANY"
      ? "network request"
      : methodExpectation === "MUTATION"
        ? "mutation request"
        : `${methodExpectation} request`;
  const tokenDescription =
    tokens.length > 0 ? ` matching [${tokens.join(", ")}]` : "";

  return `No ${methodDescription}${tokenDescription} was observed`;
}
