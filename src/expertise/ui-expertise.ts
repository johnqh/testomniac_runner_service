import type { Expertise, ExpertiseContext, Outcome } from "./types";

export class UiExpertise implements Expertise {
  name = "ui";

  evaluate(context: ExpertiseContext): Outcome[] {
    const outcomes: Outcome[] = [];

    outcomes.push(this.checkMainLandmark(context.html));
    outcomes.push(this.checkScaffoldConsistency(context));
    outcomes.push(this.checkActiveErrorPatterns(context));
    outcomes.push(this.checkInteractiveDensity(context.html));

    return outcomes;
  }

  private checkMainLandmark(html: string): Outcome {
    const hasMain = /<main\b/i.test(html) || /\brole=["']main["']/i.test(html);

    if (!hasMain) {
      return {
        expected: "Page should expose a main content landmark",
        observed: 'No <main> element or role="main" landmark detected',
        result: "warning",
      };
    }

    return {
      expected: "Page should expose a main content landmark",
      observed: "Main content landmark detected",
      result: "pass",
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
      };
    }

    return {
      expected: "Shared page scaffolds should not be duplicated",
      observed: `Detected ${topMenus.length} top menu(s) and ${footers.length} footer(s)`,
      result: "pass",
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
      };
    }

    return {
      expected: "Page should not load with visible error UI",
      observed: "No error or alert patterns detected on initial render",
      result: "pass",
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
      };
    }

    return {
      expected: "Page should expose at least one interactive control",
      observed: `Detected ${controls} interactive control(s) in the HTML`,
      result: "pass",
    };
  }
}
