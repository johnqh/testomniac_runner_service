import { ExpertiseRuleId } from "@sudobility/testomniac_types";
import type { Expertise, ExpertiseContext, Outcome } from "./types";
import { outcomesFromPageHealth } from "./page-health-outcomes";
import { applyRuleIds } from "./rule-id";

const SECURITY_PAGE_HEALTH_RULE_IDS = {
  missing_noopener: ExpertiseRuleId.SecurityPageHealthNoopener,
} as const;
const SECURITY_RULE_IDS = {
  "API keys should not be exposed in URLs":
    ExpertiseRuleId.SecurityApiKeysInUrls,
  "Sensitive user data should not be sent in URL parameters":
    ExpertiseRuleId.SecuritySensitiveDataInUrls,
  "All requests should use HTTPS": ExpertiseRuleId.SecurityHttpsRequests,
  "HTTPS pages should not load insecure HTTP subresources":
    ExpertiseRuleId.SecurityMixedContent,
  "Forms should not submit over insecure HTTP":
    ExpertiseRuleId.SecurityInsecureFormActions,
  "Forms should not submit over insecure HTTP on HTTPS pages":
    ExpertiseRuleId.SecurityInsecureFormActions,
  "Password fields should only appear on HTTPS pages":
    ExpertiseRuleId.SecurityPasswordFieldsHttps,
  "Input fields should use semantic types (email, tel, url) for better validation":
    ExpertiseRuleId.SecuritySemanticInputTypes,
  'Links opening a new tab should use rel="noopener noreferrer"':
    ExpertiseRuleId.SecurityBlankTargetRel,
} as const;

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
    outcomes.push(...this.checkSensitiveDataInUrls(context));
    outcomes.push(...this.checkInsecureRequests(context));
    outcomes.push(this.checkMixedContent(context));
    outcomes.push(this.checkInsecureFormActions(context));
    outcomes.push(this.checkPasswordFieldsOnHttps(context));
    outcomes.push(this.checkWrongInputTypes(context.html));
    outcomes.push(this.checkUnsafeBlankTargets(context.html));
    outcomes.push(
      ...outcomesFromPageHealth(
        context.pageHealthIssues,
        SECURITY_PAGE_HEALTH_RULE_IDS
      )
    );

    return applyRuleIds(outcomes, SECURITY_RULE_IDS);
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

  private checkSensitiveDataInUrls(context: ExpertiseContext): Outcome[] {
    const sensitive = context.networkLogs.filter(log =>
      /[?&](password|pass|pwd|email|session|jwt|id_token)=([^&]+)/i.test(
        log.url
      )
    );
    if (sensitive.length === 0) {
      return [
        {
          expected: "Sensitive user data should not be sent in URL parameters",
          observed: "No sensitive query parameters detected in network URLs",
          result: "pass",
          priority: 1,
        },
      ];
    }
    return [
      {
        expected: "Sensitive user data should not be sent in URL parameters",
        observed: `${sensitive.length} request(s) include sensitive-looking query parameters; first: ${sensitive[0]!.url.slice(0, 120)}`,
        result: "error",
        priority: 0,
      },
    ];
  }

  private checkMixedContent(context: ExpertiseContext): Outcome {
    const pageUrl = context.currentUrl || context.initialUrl || "";
    if (!pageUrl.startsWith("https://")) {
      return {
        expected: "HTTPS pages should not load insecure HTTP subresources",
        observed: "Page is not HTTPS, skipping mixed-content check",
        result: "pass",
        priority: 2,
      };
    }
    const insecureSubresources = context.networkLogs.filter(
      log =>
        log.url.startsWith("http://") && !log.url.startsWith("http://localhost")
    );
    if (insecureSubresources.length > 0) {
      return {
        expected: "HTTPS pages should not load insecure HTTP subresources",
        observed: `${insecureSubresources.length} insecure subresource request(s); first: ${insecureSubresources[0]!.url.slice(0, 120)}`,
        result: "warning",
        priority: 2,
      };
    }
    return {
      expected: "HTTPS pages should not load insecure HTTP subresources",
      observed: "No mixed-content requests detected",
      result: "pass",
      priority: 2,
    };
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

  private checkPasswordFieldsOnHttps(context: ExpertiseContext): Outcome {
    const hasPasswordField = /<input\b[^>]*type=["']password["'][^>]*>/i.test(
      context.html
    );
    if (!hasPasswordField) {
      return {
        expected: "Password fields should only appear on HTTPS pages",
        observed: "No password fields detected",
        result: "pass",
        priority: 0,
      };
    }
    const pageUrl = context.currentUrl || context.initialUrl || "";
    if (
      !pageUrl.startsWith("https://") &&
      !pageUrl.startsWith("http://localhost")
    ) {
      return {
        expected: "Password fields should only appear on HTTPS pages",
        observed: `Password field detected on non-HTTPS page: ${pageUrl || "unknown URL"}`,
        result: "error",
        priority: 0,
      };
    }
    return {
      expected: "Password fields should only appear on HTTPS pages",
      observed: "Password fields are on HTTPS or localhost",
      result: "pass",
      priority: 0,
    };
  }

  private checkUnsafeBlankTargets(html: string): Outcome {
    const blankLinks =
      html.match(/<a\b[^>]*target=["']_blank["'][^>]*>/gi) ?? [];
    const unsafe = blankLinks.filter(
      link =>
        !/\brel=["'][^"']*\bnoopener\b/i.test(link) ||
        !/\brel=["'][^"']*\bnoreferrer\b/i.test(link)
    );
    if (unsafe.length > 0) {
      return {
        expected:
          'Links opening a new tab should use rel="noopener noreferrer"',
        observed: `${unsafe.length} target="_blank" link(s) are missing noopener or noreferrer`,
        result: "warning",
        priority: 3,
      };
    }
    return {
      expected: 'Links opening a new tab should use rel="noopener noreferrer"',
      observed: "All new-tab links include safe rel attributes",
      result: "pass",
      priority: 3,
    };
  }
}
