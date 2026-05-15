import type { Expertise, ExpertiseContext, Outcome } from "./types";

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

    return outcomes;
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
}
