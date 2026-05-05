import type { Expertise, ExpertiseContext, Outcome } from "./types";

const API_KEY_PATTERNS = [
  /[?&](api[_-]?key|apikey|key|token|secret|access[_-]?token)=([^&]+)/i,
  /[?&](authorization)=([^&]+)/i,
];

/**
 * Checks network calls for insecure practices.
 * Flags API keys in URLs and non-HTTPS requests.
 */
export class SecurityExpertise implements Expertise {
  name = "security";

  evaluate(context: ExpertiseContext): Outcome[] {
    const outcomes: Outcome[] = [];

    outcomes.push(...this.checkApiKeysInUrls(context));
    outcomes.push(...this.checkInsecureRequests(context));

    return outcomes;
  }

  private checkApiKeysInUrls(context: ExpertiseContext): Outcome[] {
    const outcomes: Outcome[] = [];

    for (const log of context.networkLogs) {
      for (const pattern of API_KEY_PATTERNS) {
        const match = pattern.exec(log.url);
        if (match) {
          outcomes.push({
            expected: "API keys should not be exposed in URLs",
            observed: `Found "${match[1]}" parameter in URL: ${log.url.slice(0, 120)}`,
            result: "error",
          });
          break;
        }
      }
    }

    if (outcomes.length === 0) {
      outcomes.push({
        expected: "API keys should not be exposed in URLs",
        observed: "No API keys detected in request URLs",
        result: "pass",
      });
    }

    return outcomes;
  }

  private checkInsecureRequests(context: ExpertiseContext): Outcome[] {
    const insecure = context.networkLogs.filter(
      log =>
        log.url.startsWith("http://") && !log.url.startsWith("http://localhost")
    );

    if (insecure.length > 0) {
      return [
        {
          expected: "All requests should use HTTPS",
          observed: `${insecure.length} insecure HTTP request(s): ${insecure[0].url.slice(0, 120)}`,
          result: "warning",
        },
      ];
    }

    return [
      {
        expected: "All requests should use HTTPS",
        observed: "All requests use HTTPS",
        result: "pass",
      },
    ];
  }
}
