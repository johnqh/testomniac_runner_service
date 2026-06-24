import { ExpertiseRuleId } from "@sudobility/testomniac_types";
import type { Expertise, ExpertiseContext, Outcome } from "./types";
import { applyRuleIds } from "./rule-id";

const SEO_RULE_IDS = {
  "Page should have a <title> tag": ExpertiseRuleId.SeoTitlePresent,
  "Page title should be a useful search snippet length":
    ExpertiseRuleId.SeoTitleLength,
  "Page should have meta description":
    ExpertiseRuleId.SeoMetaDescriptionPresent,
  "Meta description should be a useful search snippet length":
    ExpertiseRuleId.SeoMetaDescriptionLength,
  "Page should have meta keywords": ExpertiseRuleId.SeoMetaKeywordsPresent,
  'Page should have <link rel="canonical">':
    ExpertiseRuleId.SeoCanonicalPresent,
  "Canonical URL should point at this page or a valid parent":
    ExpertiseRuleId.SeoCanonicalTarget,
  "Canonical URL should be parseable": ExpertiseRuleId.SeoCanonicalTarget,
  "Robots meta should not accidentally block indexing":
    ExpertiseRuleId.SeoRobotsIndexability,
  "Page should have meta property og:title": ExpertiseRuleId.SeoOpenGraphTitle,
  "Page should have meta property og:description":
    ExpertiseRuleId.SeoOpenGraphDescription,
  "Link text should describe the destination":
    ExpertiseRuleId.SeoAnchorTextDescriptive,
} as const;

/**
 * Checks if essential SEO meta tags are present in the page HTML.
 * Creates warning outcomes for missing tags.
 */
export class SeoExpertise implements Expertise {
  name = "seo";

  evaluate(context: ExpertiseContext): Outcome[] {
    const outcomes: Outcome[] = [];
    const html = context.html;

    outcomes.push(
      this.checkTag(html, /<title[^>]*>([^<]+)<\/title>/i, "title")
    );
    outcomes.push(this.checkTitleLength(html));
    outcomes.push(this.checkMetaTag(html, "description"));
    outcomes.push(this.checkMetaDescriptionLength(html));
    outcomes.push(this.checkMetaTag(html, "keywords"));
    outcomes.push(this.checkLinkTag(html, "canonical"));
    outcomes.push(this.checkCanonicalTarget(html, context.currentUrl));
    outcomes.push(this.checkRobotsIndexability(html));
    outcomes.push(this.checkMetaProperty(html, "og:title"));
    outcomes.push(this.checkMetaProperty(html, "og:description"));
    outcomes.push(this.checkDescriptiveAnchors(html));

    return applyRuleIds(outcomes, SEO_RULE_IDS);
  }

  private extractTitle(html: string): string | null {
    return html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? null;
  }

  private extractMetaContent(html: string, name: string): string | null {
    const regex = new RegExp(
      `<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`,
      "i"
    );
    const regexAlt = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`,
      "i"
    );
    return (regex.exec(html) || regexAlt.exec(html))?.[1]?.trim() ?? null;
  }

  private checkTag(html: string, regex: RegExp, tagName: string): Outcome {
    const match = regex.exec(html);
    if (match && match[1]?.trim()) {
      return {
        expected: `Page should have a <${tagName}> tag`,
        observed: `Found <${tagName}>: "${match[1].trim().slice(0, 80)}"`,
        result: "pass",
        priority: 4,
      };
    }
    return {
      expected: `Page should have a <${tagName}> tag`,
      observed: `Missing <${tagName}> tag`,
      result: "warning",
      priority: 4,
    };
  }

  private checkMetaTag(html: string, name: string): Outcome {
    const content = this.extractMetaContent(html, name);
    if (content) {
      return {
        expected: `Page should have meta ${name}`,
        observed: `Found meta ${name}: "${content.slice(0, 80)}"`,
        result: "pass",
        priority: 4,
      };
    }
    return {
      expected: `Page should have meta ${name}`,
      observed: `Missing meta ${name}`,
      result: "warning",
      priority: 4,
    };
  }

  private checkLinkTag(html: string, rel: string): Outcome {
    const regex = new RegExp(
      `<link[^>]+rel=["']${rel}["'][^>]+href=["']([^"']+)["']`,
      "i"
    );
    const match = regex.exec(html);
    if (match && match[1]?.trim()) {
      return {
        expected: `Page should have <link rel="${rel}">`,
        observed: `Found ${rel}: "${match[1].trim()}"`,
        result: "pass",
        priority: 4,
      };
    }
    return {
      expected: `Page should have <link rel="${rel}">`,
      observed: `Missing <link rel="${rel}">`,
      result: "warning",
      priority: 4,
    };
  }

  private checkMetaProperty(html: string, property: string): Outcome {
    const regex = new RegExp(
      `<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']+)["']`,
      "i"
    );
    const regexAlt = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${property}["']`,
      "i"
    );
    const match = regex.exec(html) || regexAlt.exec(html);
    if (match && match[1]?.trim()) {
      return {
        expected: `Page should have meta property ${property}`,
        observed: `Found ${property}: "${match[1].trim().slice(0, 80)}"`,
        result: "pass",
        priority: 4,
      };
    }
    return {
      expected: `Page should have meta property ${property}`,
      observed: `Missing meta property ${property}`,
      result: "warning",
      priority: 4,
    };
  }

  private checkTitleLength(html: string): Outcome {
    const title = this.extractTitle(html);
    if (!title) {
      return {
        expected: "Page title should be a useful search snippet length",
        observed: "No title text available to measure",
        result: "pass",
        priority: 4,
      };
    }
    if (title.length < 15 || title.length > 70) {
      return {
        expected: "Page title should be a useful search snippet length",
        observed: `Title is ${title.length} characters; target range is 15-70`,
        result: "warning",
        priority: 4,
      };
    }
    return {
      expected: "Page title should be a useful search snippet length",
      observed: `Title length is ${title.length} characters`,
      result: "pass",
      priority: 4,
    };
  }

  private checkMetaDescriptionLength(html: string): Outcome {
    const description = this.extractMetaContent(html, "description");
    if (!description) {
      return {
        expected: "Meta description should be a useful search snippet length",
        observed: "No meta description available to measure",
        result: "pass",
        priority: 4,
      };
    }
    if (description.length < 50 || description.length > 170) {
      return {
        expected: "Meta description should be a useful search snippet length",
        observed: `Meta description is ${description.length} characters; target range is 50-170`,
        result: "warning",
        priority: 4,
      };
    }
    return {
      expected: "Meta description should be a useful search snippet length",
      observed: `Meta description length is ${description.length} characters`,
      result: "pass",
      priority: 4,
    };
  }

  private checkCanonicalTarget(
    html: string,
    currentUrl: string | undefined
  ): Outcome {
    const href =
      html.match(
        /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i
      )?.[1] ?? null;
    if (!href || !currentUrl) {
      return {
        expected: "Canonical URL should point at this page or a valid parent",
        observed: href ? "Canonical URL present" : "No canonical URL present",
        result: "pass",
        priority: 4,
      };
    }
    try {
      const canonical = new URL(href, currentUrl);
      const current = new URL(currentUrl);
      if (canonical.origin !== current.origin) {
        return {
          expected: "Canonical URL should point at this page or a valid parent",
          observed: `Canonical points to a different origin: ${canonical.origin}`,
          result: "warning",
          priority: 3,
        };
      }
    } catch {
      return {
        expected: "Canonical URL should be parseable",
        observed: `Canonical href is not a valid URL: ${href}`,
        result: "warning",
        priority: 3,
      };
    }
    return {
      expected: "Canonical URL should point at this page or a valid parent",
      observed: "Canonical URL is same-origin and parseable",
      result: "pass",
      priority: 4,
    };
  }

  private checkRobotsIndexability(html: string): Outcome {
    const robots = this.extractMetaContent(html, "robots");
    if (!robots) {
      return {
        expected: "Robots meta should not accidentally block indexing",
        observed: "No robots meta tag detected",
        result: "pass",
        priority: 4,
      };
    }
    if (/\b(noindex|none)\b/i.test(robots)) {
      return {
        expected: "Robots meta should not accidentally block indexing",
        observed: `Robots meta contains "${robots}"`,
        result: "warning",
        priority: 2,
      };
    }
    return {
      expected: "Robots meta should not accidentally block indexing",
      observed: `Robots meta is "${robots}"`,
      result: "pass",
      priority: 4,
    };
  }

  private checkDescriptiveAnchors(html: string): Outcome {
    const anchors =
      html.match(/<a\b[^>]*href=["'][^"']+["'][^>]*>[\s\S]*?<\/a>/gi) ?? [];
    const weak = anchors.filter(anchor => {
      const text = anchor
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      return /^(click here|learn more|read more|more|here)$/i.test(text);
    });
    if (weak.length > 0) {
      return {
        expected: "Link text should describe the destination",
        observed: `${weak.length} link(s) use generic anchor text such as "learn more"`,
        result: "warning",
        priority: 4,
      };
    }
    return {
      expected: "Link text should describe the destination",
      observed: "No generic anchor text detected",
      result: "pass",
      priority: 4,
    };
  }
}
