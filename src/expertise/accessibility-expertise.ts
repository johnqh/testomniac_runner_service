import type { Expertise, ExpertiseContext, Outcome } from "./types";

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

    return outcomes;
  }

  private checkDocumentLanguage(html: string): Outcome {
    const hasLang = /<html\b[^>]*\blang=["'][^"']+["']/i.test(html);
    if (!hasLang) {
      return {
        expected: "Document should declare a language",
        observed: "No lang attribute detected on the <html> element",
        result: "warning",
      };
    }

    return {
      expected: "Document should declare a language",
      observed: "lang attribute detected on the <html> element",
      result: "pass",
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
      };
    }

    if (mainCount > 1) {
      return {
        expected: "Page should expose only one main landmark",
        observed: `Detected ${mainCount} main landmarks`,
        result: "warning",
      };
    }

    return {
      expected: "Page should expose only one main landmark",
      observed: "Exactly one main landmark detected",
      result: "pass",
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
      };
    }

    return {
      expected: "Form controls should have accessible labels",
      observed: `All ${inputs.length} control(s) have ids or ARIA labelling hooks`,
      result: "pass",
    };
  }

  private checkImageAltCoverage(html: string): Outcome {
    const images = html.match(/<img\b[^>]*>/gi) ?? [];
    if (images.length === 0) {
      return {
        expected: "Images should have alt text or be explicitly decorative",
        observed: "No images detected on the page",
        result: "pass",
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
      };
    }

    return {
      expected: "Images should have alt text or be explicitly decorative",
      observed: `All ${images.length} image(s) include alt text or decorative markup`,
      result: "pass",
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
      };
    }

    return {
      expected: "Dialogs should be labelled for assistive technologies",
      observed: `All ${dialogs.length} dialog(s) have accessible labelling`,
      result: "pass",
    };
  }
}
