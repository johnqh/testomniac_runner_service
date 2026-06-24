import { ExpertiseRuleId } from "@sudobility/testomniac_types";
import type { Expertise, ExpertiseContext, Outcome } from "./types";
import { outcomesFromPageHealth } from "./page-health-outcomes";
import { applyRuleIds } from "./rule-id";

const ACCESSIBILITY_PAGE_HEALTH_RULE_IDS = {
  empty_link: ExpertiseRuleId.AccessibilityPageHealthEmptyLink,
  broken_anchor: ExpertiseRuleId.AccessibilityPageHealthBrokenAnchor,
  unlabeled_button: ExpertiseRuleId.AccessibilityPageHealthUnlabeledButton,
  small_touch_target: ExpertiseRuleId.AccessibilityPageHealthSmallTouchTarget,
} as const;
const ACCESSIBILITY_RULE_IDS = {
  "Document should declare a language":
    ExpertiseRuleId.AccessibilityDocumentLanguage,
  "Page should expose a main landmark for screen readers":
    ExpertiseRuleId.AccessibilityMainLandmark,
  "Page should expose only one main landmark":
    ExpertiseRuleId.AccessibilityMainLandmark,
  "Form controls should have accessible labels":
    ExpertiseRuleId.AccessibilityFormLabels,
  "Images should have alt text or be explicitly decorative":
    ExpertiseRuleId.AccessibilityImageAltCoverage,
  "Dialogs should be labelled for assistive technologies":
    ExpertiseRuleId.AccessibilityDialogLabelling,
  "Elements should not use positive tabindex values (disrupts natural tab order)":
    ExpertiseRuleId.AccessibilityPositiveTabindex,
  "Media should not autoplay with sound":
    ExpertiseRuleId.AccessibilityAutoplayMedia,
  "Interactive controls should have accessible names":
    ExpertiseRuleId.AccessibilityInteractiveNames,
  "ARIA references should point to existing element IDs":
    ExpertiseRuleId.AccessibilityAriaReferences,
  "Clickable non-semantic elements should expose role and keyboard focus":
    ExpertiseRuleId.AccessibilityClickableSemantics,
  "Links should not be empty for assistive technologies":
    ExpertiseRuleId.AccessibilityEmptyLinks,
} as const;

function countMatches(html: string, regex: RegExp): number {
  return html.match(regex)?.length ?? 0;
}

export class AccessibilityExpertise implements Expertise {
  name = "accessibility";

  evaluate(context: ExpertiseContext): Outcome[] {
    const outcomes: Outcome[] = [];

    outcomes.push(this.checkDocumentLanguage(context.html));
    outcomes.push(this.checkMainLandmark(context.html));
    outcomes.push(this.checkFormLabels(context.html));
    outcomes.push(this.checkImageAltCoverage(context.html));
    outcomes.push(this.checkDialogLabelling(context.html));
    outcomes.push(this.checkPositiveTabindex(context.html));
    outcomes.push(this.checkAutoplayMedia(context.html));
    outcomes.push(this.checkInteractiveNames(context.html));
    outcomes.push(this.checkAriaReferences(context.html));
    outcomes.push(this.checkClickableSemantics(context.html));
    outcomes.push(this.checkEmptyLinks(context.html));
    outcomes.push(
      ...outcomesFromPageHealth(
        context.pageHealthIssues,
        ACCESSIBILITY_PAGE_HEALTH_RULE_IDS
      )
    );

    return applyRuleIds(outcomes, ACCESSIBILITY_RULE_IDS);
  }

  private checkDocumentLanguage(html: string): Outcome {
    const hasLang = /<html\b[^>]*\blang=["'][^"']+["']/i.test(html);
    if (!hasLang) {
      return {
        expected: "Document should declare a language",
        observed: "No lang attribute detected on the <html> element",
        result: "warning",
        priority: 4,
      };
    }

    return {
      expected: "Document should declare a language",
      observed: "lang attribute detected on the <html> element",
      result: "pass",
      priority: 4,
    };
  }

  private checkMainLandmark(html: string): Outcome {
    const mainCount =
      countMatches(html, /<main\b/gi) +
      countMatches(html, /\brole=["']main["']/gi);

    if (mainCount === 0) {
      return {
        expected: "Page should expose a main landmark for screen readers",
        observed: 'No <main> or role="main" landmark detected',
        result: "warning",
        priority: 4,
      };
    }

    if (mainCount > 1) {
      return {
        expected: "Page should expose only one main landmark",
        observed: `Detected ${mainCount} main landmarks`,
        result: "warning",
        priority: 4,
      };
    }

    return {
      expected: "Page should expose only one main landmark",
      observed: "Exactly one main landmark detected",
      result: "pass",
      priority: 4,
    };
  }

  private checkFormLabels(html: string): Outcome {
    const inputs =
      html.match(
        /<(input|textarea|select)\b(?![^>]*type=["']hidden["'])[^>]*>/gi
      ) ?? [];
    if (inputs.length === 0) {
      return {
        expected: "Form controls should have accessible labels",
        observed: "No form controls detected on the page",
        result: "pass",
        priority: 4,
      };
    }

    const missingLabels = inputs.filter(control => {
      const hasAria =
        /\baria-label=["'][^"']+["']/i.test(control) ||
        /\baria-labelledby=["'][^"']+["']/i.test(control);
      const hasId = /\bid=["'][^"']+["']/i.test(control);
      return !hasAria && !hasId;
    });

    if (missingLabels.length > 0) {
      return {
        expected: "Form controls should have accessible labels",
        observed: `${missingLabels.length} of ${inputs.length} control(s) are missing obvious label hooks`,
        result: "warning",
        priority: 4,
      };
    }

    return {
      expected: "Form controls should have accessible labels",
      observed: `All ${inputs.length} control(s) have ids or ARIA labelling hooks`,
      result: "pass",
      priority: 4,
    };
  }

  private checkImageAltCoverage(html: string): Outcome {
    const images = html.match(/<img\b[^>]*>/gi) ?? [];
    if (images.length === 0) {
      return {
        expected: "Images should have alt text or be explicitly decorative",
        observed: "No images detected on the page",
        result: "pass",
        priority: 4,
      };
    }

    const missingAlt = images.filter(
      image =>
        !/\balt\s*=\s*["'][^"']*["']/i.test(image) &&
        !/\brole\s*=\s*["']presentation["']/i.test(image) &&
        !/\baria-hidden\s*=\s*["']true["']/i.test(image)
    );

    if (missingAlt.length > 0) {
      return {
        expected: "Images should have alt text or be explicitly decorative",
        observed: `${missingAlt.length} of ${images.length} image(s) lack alt text or decorative markup`,
        result: "warning",
        priority: 4,
      };
    }

    return {
      expected: "Images should have alt text or be explicitly decorative",
      observed: `All ${images.length} image(s) include alt text or decorative markup`,
      result: "pass",
      priority: 4,
    };
  }

  private checkDialogLabelling(html: string): Outcome {
    const dialogs =
      html.match(/<(dialog|[^>]+\brole=["']dialog["'])[\s\S]*?>/gi) ?? [];
    if (dialogs.length === 0) {
      return {
        expected: "Dialogs should be labelled for assistive technologies",
        observed: "No dialogs detected on the page",
        result: "pass",
        priority: 4,
      };
    }

    const unlabeled = dialogs.filter(
      dialog =>
        !/\baria-label=["'][^"']+["']/i.test(dialog) &&
        !/\baria-labelledby=["'][^"']+["']/i.test(dialog)
    );

    if (unlabeled.length > 0) {
      return {
        expected: "Dialogs should be labelled for assistive technologies",
        observed: `${unlabeled.length} of ${dialogs.length} dialog(s) are missing aria-label or aria-labelledby`,
        result: "warning",
        priority: 4,
      };
    }

    return {
      expected: "Dialogs should be labelled for assistive technologies",
      observed: `All ${dialogs.length} dialog(s) have accessible labelling`,
      result: "pass",
      priority: 4,
    };
  }

  private checkPositiveTabindex(html: string): Outcome {
    const tabindexMatches = html.match(/\btabindex=["'](\d+)["']/gi) ?? [];
    const positiveTabindexes = tabindexMatches.filter(m => {
      const val = parseInt(m.replace(/\btabindex=["']|["']/gi, ""), 10);
      return val > 0;
    });

    if (positiveTabindexes.length > 0) {
      return {
        expected:
          "Elements should not use positive tabindex values (disrupts natural tab order)",
        observed: `${positiveTabindexes.length} element(s) have positive tabindex values`,
        result: "warning",
        priority: 4,
      };
    }

    return {
      expected:
        "Elements should not use positive tabindex values (disrupts natural tab order)",
      observed: "No positive tabindex values detected",
      result: "pass",
      priority: 4,
    };
  }

  private checkAutoplayMedia(html: string): Outcome {
    const autoplayVideo =
      /<video\b[^>]*\bautoplay\b/gi.test(html) &&
      !/<video\b[^>]*\bmuted\b/gi.test(html);
    const autoplayAudio = /<audio\b[^>]*\bautoplay\b/gi.test(html);

    if (autoplayVideo || autoplayAudio) {
      const type = autoplayVideo ? "video" : "audio";
      return {
        expected: "Media should not autoplay with sound",
        observed: `Detected ${type} element with autoplay attribute (without muted)`,
        result: "warning",
        priority: 3,
      };
    }

    return {
      expected: "Media should not autoplay with sound",
      observed: "No autoplaying unmuted media detected",
      result: "pass",
      priority: 3,
    };
  }

  private checkInteractiveNames(html: string): Outcome {
    const controls =
      html.match(/<(button|a)\b[^>]*>[\s\S]*?<\/(button|a)>/gi) ?? [];
    const unnamed = controls.filter(control => {
      const visibleText = control
        .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return (
        visibleText.length === 0 &&
        !/\baria-label=["'][^"']+["']/i.test(control) &&
        !/\baria-labelledby=["'][^"']+["']/i.test(control) &&
        !/\btitle=["'][^"']+["']/i.test(control)
      );
    });
    if (unnamed.length > 0) {
      return {
        expected: "Interactive controls should have accessible names",
        observed: `${unnamed.length} button/link control(s) have no visible text or accessible label`,
        result: "warning",
        priority: 4,
      };
    }
    return {
      expected: "Interactive controls should have accessible names",
      observed: "All detected button/link controls have accessible names",
      result: "pass",
      priority: 4,
    };
  }

  private checkAriaReferences(html: string): Outcome {
    const idMatches = html.match(/\bid=["']([^"']+)["']/gi) ?? [];
    const ids = new Set(idMatches.map(m => m.replace(/^id=["']|["']$/gi, "")));
    const references =
      html.match(/\baria-(?:labelledby|describedby)=["']([^"']+)["']/gi) ?? [];
    const missing: string[] = [];
    for (const ref of references) {
      const values =
        ref
          .match(/=["']([^"']+)["']/)?.[1]
          ?.split(/\s+/)
          .filter(Boolean) ?? [];
      for (const value of values) {
        if (!ids.has(value)) missing.push(value);
      }
    }
    if (missing.length > 0) {
      return {
        expected: "ARIA references should point to existing element IDs",
        observed: `${missing.length} missing ARIA reference(s): ${missing.slice(0, 3).join(", ")}`,
        result: "warning",
        priority: 4,
      };
    }
    return {
      expected: "ARIA references should point to existing element IDs",
      observed: "All ARIA references resolve to existing IDs",
      result: "pass",
      priority: 4,
    };
  }

  private checkClickableSemantics(html: string): Outcome {
    const clickable =
      html.match(
        /<(div|span)\b[^>]*(onclick=|role=["']button["']|class=["'][^"']*(button|btn|clickable)[^"']*["'])[^>]*>/gi
      ) ?? [];
    const inaccessible = clickable.filter(
      item =>
        !/\brole=["']button["']/i.test(item) ||
        !/\btabindex=["']0["']/i.test(item)
    );
    if (inaccessible.length > 0) {
      return {
        expected:
          "Clickable non-semantic elements should expose role and keyboard focus",
        observed: `${inaccessible.length} clickable-looking div/span element(s) lack role="button" or tabindex="0"`,
        result: "warning",
        priority: 4,
      };
    }
    return {
      expected:
        "Clickable non-semantic elements should expose role and keyboard focus",
      observed: "No inaccessible clickable div/span elements detected",
      result: "pass",
      priority: 4,
    };
  }

  private checkEmptyLinks(html: string): Outcome {
    const links =
      html.match(/<a\b[^>]*href=["'][^"']*["'][^>]*>[\s\S]*?<\/a>/gi) ?? [];
    const empty = links.filter(link => {
      const text = link
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return (
        text.length === 0 &&
        !/\baria-label=["'][^"']+["']/i.test(link) &&
        !/\baria-labelledby=["'][^"']+["']/i.test(link)
      );
    });
    if (empty.length > 0) {
      return {
        expected: "Links should not be empty for assistive technologies",
        observed: `${empty.length} link(s) have no text or accessible label`,
        result: "warning",
        priority: 4,
      };
    }
    return {
      expected: "Links should not be empty for assistive technologies",
      observed: "No empty links detected",
      result: "pass",
      priority: 4,
    };
  }
}
