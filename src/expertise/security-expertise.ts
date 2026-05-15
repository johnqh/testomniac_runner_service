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
    outcomes.push(this.checkInsecureFormActions(context));
    outcomes.push(this.checkWrongInputTypes(context.html));

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
            priority: 0,
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
        priority: 0,
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
          priority: 3,
        },
      ];
    }

    return [
      {
        expected: "All requests should use HTTPS",
        observed: "All requests use HTTPS",
        result: "pass",
        priority: 3,
      },
    ];
  }

  private checkInsecureFormActions(context: ExpertiseContext): Outcome {
    const pageUrl = context.currentUrl || context.initialUrl || "";
    const isHttps = pageUrl.startsWith("https://");
    if (!isHttps) {
      return {
        expected: "Forms should not submit over insecure HTTP",
        observed: "Page is not HTTPS, skipping check",
        result: "pass",
        priority: 0,
      };
    }

    const httpForms = context.html.match(
      /<form\b[^>]*action=["']http:\/\/[^"']+["'][^>]*>/gi
    );
    if (httpForms && httpForms.length > 0) {
      return {
        expected: "Forms should not submit over insecure HTTP on HTTPS pages",
        observed: `${httpForms.length} form(s) submit to HTTP URLs instead of HTTPS`,
        result: "error",
        priority: 0,
      };
    }

    return {
      expected: "Forms should not submit over insecure HTTP on HTTPS pages",
      observed: "All form actions use HTTPS or relative URLs",
      result: "pass",
      priority: 0,
    };
  }

  private checkWrongInputTypes(html: string): Outcome {
    const textInputs =
      html.match(/<input\b[^>]*type=["']text["'][^>]*>/gi) ?? [];
    const mistyped: string[] = [];

    for (const input of textInputs) {
      const lower = input.toLowerCase();
      if (
        /\b(name|placeholder|id|autocomplete)=["'][^"']*(email)[^"']*["']/i.test(
          lower
        )
      ) {
        mistyped.push('email field using type="text"');
      } else if (
        /\b(name|placeholder|id|autocomplete)=["'][^"']*(phone|tel)[^"']*["']/i.test(
          lower
        )
      ) {
        mistyped.push('phone field using type="text"');
      } else if (
        /\b(name|placeholder|id|autocomplete)=["'][^"']*(url|website)[^"']*["']/i.test(
          lower
        )
      ) {
        mistyped.push('URL field using type="text"');
      }
    }

    if (mistyped.length > 0) {
      return {
        expected:
          "Input fields should use semantic types (email, tel, url) for better validation",
        observed: `${mistyped.length} input(s) use type="text" instead: ${mistyped.slice(0, 3).join(", ")}`,
        result: "warning",
        priority: 4,
      };
    }

    return {
      expected:
        "Input fields should use semantic types (email, tel, url) for better validation",
      observed: "Input types appear appropriate",
      result: "pass",
      priority: 4,
    };
  }
}
