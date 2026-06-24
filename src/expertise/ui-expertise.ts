import { ExpertiseRuleId } from "@sudobility/testomniac_types";
import type { Expertise, ExpertiseContext, Outcome } from "./types";
import { outcomesFromPageHealth } from "./page-health-outcomes";
import { applyRuleIds } from "./rule-id";

const UI_PAGE_HEALTH_RULE_IDS = {
  element_overlap: ExpertiseRuleId.UiPageHealthOverlap,
  dead_social_button: ExpertiseRuleId.UiPageHealthDeadSocialButton,
  inconsistent_grid: ExpertiseRuleId.UiPageHealthInconsistentGrid,
  horizontal_overflow: ExpertiseRuleId.UiPageHealthHorizontalOverflow,
  truncated_text: ExpertiseRuleId.UiPageHealthTruncatedText,
  duplicate_element: ExpertiseRuleId.UiPageHealthDuplicateElement,
  error_message_visible: ExpertiseRuleId.UiPageHealthErrorMessageVisible,
} as const;
const UI_RULE_IDS = {
  "Page should expose a main content landmark": ExpertiseRuleId.UiMainLandmark,
  "Shared page scaffolds should not be duplicated":
    ExpertiseRuleId.UiScaffoldConsistency,
  "Page should not load with visible error UI":
    ExpertiseRuleId.UiActiveErrorPatterns,
  "Social share buttons should be functional (links or have click handlers)":
    ExpertiseRuleId.UiSocialButtonIntegrity,
  "Breadcrumb navigation should be consistent":
    ExpertiseRuleId.UiBreadcrumbConsistency,
  "Page should expose at least one interactive control":
    ExpertiseRuleId.UiInteractiveDensity,
  "Page should not remain in a loading state after settling":
    ExpertiseRuleId.UiStuckLoadingIndicators,
  "Dialogs should provide an obvious close or cancel control":
    ExpertiseRuleId.UiDialogCloseAffordance,
  "Primary actions should not be disabled without clear context":
    ExpertiseRuleId.UiDisabledPrimaryActions,
  "Navigation-style actions should use links or clearly change state":
    ExpertiseRuleId.UiNavigationButtons,
} as const;

export class UiExpertise implements Expertise {
  name = "ui";

  evaluate(context: ExpertiseContext): Outcome[] {
    const outcomes: Outcome[] = [];

    outcomes.push(this.checkMainLandmark(context.html));
    outcomes.push(this.checkScaffoldConsistency(context));
    outcomes.push(this.checkActiveErrorPatterns(context));
    outcomes.push(this.checkInteractiveDensity(context.html));
    outcomes.push(this.checkSocialButtonIntegrity(context.html));
    outcomes.push(this.checkBreadcrumbConsistency(context.html));
    outcomes.push(this.checkStuckLoadingIndicators(context.html));
    outcomes.push(this.checkDialogCloseAffordance(context.html));
    outcomes.push(this.checkDisabledPrimaryActions(context.html));
    outcomes.push(this.checkNavigationButtons(context.html));
    outcomes.push(
      ...outcomesFromPageHealth(
        context.pageHealthIssues,
        UI_PAGE_HEALTH_RULE_IDS
      )
    );

    return applyRuleIds(outcomes, UI_RULE_IDS);
  }

  private checkMainLandmark(html: string): Outcome {
    const hasMain = /<main\b/i.test(html) || /\brole=["']main["']/i.test(html);

    if (!hasMain) {
      return {
        expected: "Page should expose a main content landmark",
        observed: 'No <main> element or role="main" landmark detected',
        result: "warning",
        priority: 4,
      };
    }

    return {
      expected: "Page should expose a main content landmark",
      observed: "Main content landmark detected",
      result: "pass",
      priority: 4,
    };
  }

  private checkScaffoldConsistency(context: ExpertiseContext): Outcome {
    const topMenus = context.scaffolds.filter(item => item.type === "topMenu");
    const footers = context.scaffolds.filter(item => item.type === "footer");

    if (topMenus.length > 1 || footers.length > 1) {
      return {
        expected: "Shared page scaffolds should not be duplicated",
        observed: `Detected ${topMenus.length} top menu(s) and ${footers.length} footer(s)`,
        result: "warning",
        priority: 3,
      };
    }

    return {
      expected: "Shared page scaffolds should not be duplicated",
      observed: `Detected ${topMenus.length} top menu(s) and ${footers.length} footer(s)`,
      result: "pass",
      priority: 3,
    };
  }

  private checkActiveErrorPatterns(context: ExpertiseContext): Outcome {
    const errorPattern = context.patterns.find(
      pattern => pattern.type === "errorMessage" || pattern.type === "alert"
    );

    if (errorPattern && errorPattern.count > 0) {
      return {
        expected: "Page should not load with visible error UI",
        observed: `Detected ${errorPattern.count} ${errorPattern.type} pattern(s)`,
        result: "warning",
        priority: 2,
      };
    }

    return {
      expected: "Page should not load with visible error UI",
      observed: "No error or alert patterns detected on initial render",
      result: "pass",
      priority: 2,
    };
  }

  private checkSocialButtonIntegrity(html: string): Outcome {
    // Check for social share buttons that are not wrapped in links
    const socialPatterns = [
      /class="[^"]*social[^"]*facebook/gi,
      /class="[^"]*social[^"]*twitter/gi,
      /class="[^"]*social[^"]*linkedin/gi,
      /class="[^"]*social[^"]*pinterest/gi,
      /class="[^"]*social[^"]*email/gi,
      /class="[^"]*social[^"]*myspace/gi,
    ];

    let totalSocial = 0;
    let deadSocial = 0;

    for (const pattern of socialPatterns) {
      const matches = html.match(pattern);
      if (!matches) continue;
      for (const match of matches) {
        totalSocial++;
        // Check if the element is a div (not an a tag) — indicates non-functional button
        const tagContext = html.slice(
          Math.max(0, html.indexOf(match) - 30),
          html.indexOf(match) + match.length
        );
        if (/<div\b/i.test(tagContext) && !/<a\b/i.test(tagContext)) {
          deadSocial++;
        }
      }
    }

    if (deadSocial > 0) {
      return {
        expected:
          "Social share buttons should be functional (links or have click handlers)",
        observed: `${deadSocial} of ${totalSocial} social button(s) appear to be non-functional <div> elements without links`,
        result: "warning",
        priority: 3,
      };
    }

    if (totalSocial > 0) {
      return {
        expected:
          "Social share buttons should be functional (links or have click handlers)",
        observed: `All ${totalSocial} social button(s) appear functional`,
        result: "pass",
        priority: 3,
      };
    }

    return {
      expected:
        "Social share buttons should be functional (links or have click handlers)",
      observed: "No social share buttons detected",
      result: "pass",
      priority: 3,
    };
  }

  private checkBreadcrumbConsistency(html: string): Outcome {
    // Check breadcrumb navigation for common issues
    const breadcrumbMatch = html.match(
      /(?:class="[^"]*breadcrumb[^"]*"|nav[^>]*aria-label="[^"]*breadcrumb[^"]*")[^>]*>[\s\S]*?(?:<\/nav>|<\/div>)/i
    );

    if (!breadcrumbMatch) {
      return {
        expected: "Breadcrumb navigation should be consistent",
        observed: "No breadcrumb navigation detected",
        result: "pass",
        priority: 3,
      };
    }

    // Check if breadcrumb links point to valid paths
    const breadcrumbHtml = breadcrumbMatch[0];
    const links = breadcrumbHtml.match(/href="([^"]+)"/gi) ?? [];
    const brokenBreadcrumbs = links.filter(link => {
      const href = link.replace(/^href="|"$/g, "");
      return /\/stored\//.test(href) || href === "#";
    });

    if (brokenBreadcrumbs.length > 0) {
      return {
        expected: "Breadcrumb navigation should be consistent",
        observed: `${brokenBreadcrumbs.length} breadcrumb link(s) appear broken or have typos`,
        result: "warning",
        priority: 3,
      };
    }

    return {
      expected: "Breadcrumb navigation should be consistent",
      observed: "Breadcrumb navigation appears consistent",
      result: "pass",
      priority: 3,
    };
  }

  private checkInteractiveDensity(html: string): Outcome {
    const controls =
      (html.match(/<button\b/gi) ?? []).length +
      (html.match(/<a\b[^>]*href=/gi) ?? []).length +
      (html.match(/<input\b/gi) ?? []).length +
      (html.match(/<select\b/gi) ?? []).length;

    if (controls === 0) {
      return {
        expected: "Page should expose at least one interactive control",
        observed: "No links, buttons, inputs, or selects were detected",
        result: "warning",
        priority: 3,
      };
    }

    return {
      expected: "Page should expose at least one interactive control",
      observed: `Detected ${controls} interactive control(s) in the HTML`,
      result: "pass",
      priority: 3,
    };
  }

  private checkStuckLoadingIndicators(html: string): Outcome {
    const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const loadingTokens =
      text.match(/\b(loading|please wait|spinner|skeleton|fetching)\b/gi) ?? [];
    const busyElements = html.match(/\baria-busy=["']true["']/gi) ?? [];
    if (loadingTokens.length + busyElements.length > 3) {
      return {
        expected: "Page should not remain in a loading state after settling",
        observed: `${loadingTokens.length} loading token(s) and ${busyElements.length} aria-busy element(s) detected`,
        result: "warning",
        priority: 3,
      };
    }
    return {
      expected: "Page should not remain in a loading state after settling",
      observed: "No excessive loading indicators detected",
      result: "pass",
      priority: 3,
    };
  }

  private checkDialogCloseAffordance(html: string): Outcome {
    const dialogs =
      html.match(/<(dialog|[^>]+\brole=["']dialog["'])[\s\S]*?<\/[^>]+>/gi) ??
      [];
    const withoutClose = dialogs.filter(
      dialog =>
        !/\b(aria-label|title)=["'][^"']*(close|dismiss|cancel)/i.test(
          dialog
        ) && !/>\s*(close|dismiss|cancel|×|x)\s*</i.test(dialog)
    );
    if (withoutClose.length > 0) {
      return {
        expected: "Dialogs should provide an obvious close or cancel control",
        observed: `${withoutClose.length} dialog(s) lack an obvious close affordance`,
        result: "warning",
        priority: 3,
      };
    }
    return {
      expected: "Dialogs should provide an obvious close or cancel control",
      observed: "All detected dialogs include a close/cancel affordance",
      result: "pass",
      priority: 3,
    };
  }

  private checkDisabledPrimaryActions(html: string): Outcome {
    const primaryButtons =
      html.match(
        /<button\b[^>]*(?:class=["'][^"']*(primary|submit|checkout|buy|cart)[^"']*["']|type=["']submit["'])[^>]*>/gi
      ) ?? [];
    const disabled = primaryButtons.filter(button =>
      /\bdisabled\b/i.test(button)
    );
    if (disabled.length > 0) {
      return {
        expected:
          "Primary actions should not be disabled without clear context",
        observed: `${disabled.length} primary-looking button(s) are disabled`,
        result: "warning",
        priority: 3,
      };
    }
    return {
      expected: "Primary actions should not be disabled without clear context",
      observed: "No disabled primary-looking actions detected",
      result: "pass",
      priority: 3,
    };
  }

  private checkNavigationButtons(html: string): Outcome {
    const suspicious =
      html.match(
        /<button\b(?![^>]*type=["']submit["'])[^>]*>[\s\S]*?\b(view|details|learn more|read more|shop now|continue)\b[\s\S]*?<\/button>/gi
      ) ?? [];
    if (suspicious.length > 0) {
      return {
        expected:
          "Navigation-style actions should use links or clearly change state",
        observed: `${suspicious.length} button(s) look like navigation actions without link semantics`,
        result: "warning",
        priority: 4,
      };
    }
    return {
      expected:
        "Navigation-style actions should use links or clearly change state",
      observed: "No navigation-looking buttons without link semantics detected",
      result: "pass",
      priority: 4,
    };
  }
}
