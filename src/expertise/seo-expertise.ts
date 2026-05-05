import type { Expertise, ExpertiseContext, Outcome } from "./types";

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
    outcomes.push(this.checkMetaTag(html, "description"));
    outcomes.push(this.checkMetaTag(html, "keywords"));
    outcomes.push(this.checkLinkTag(html, "canonical"));
    outcomes.push(this.checkMetaProperty(html, "og:title"));
    outcomes.push(this.checkMetaProperty(html, "og:description"));

    return outcomes;
  }

  private checkTag(html: string, regex: RegExp, tagName: string): Outcome {
    const match = regex.exec(html);
    if (match && match[1]?.trim()) {
      return {
        expected: `Page should have a <${tagName}> tag`,
        observed: `Found <${tagName}>: "${match[1].trim().slice(0, 80)}"`,
        result: "pass",
      };
    }
    return {
      expected: `Page should have a <${tagName}> tag`,
      observed: `Missing <${tagName}> tag`,
      result: "warning",
    };
  }

  private checkMetaTag(html: string, name: string): Outcome {
    const regex = new RegExp(
      `<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`,
      "i"
    );
    const regexAlt = new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`,
      "i"
    );
    const match = regex.exec(html) || regexAlt.exec(html);
    if (match && match[1]?.trim()) {
      return {
        expected: `Page should have meta ${name}`,
        observed: `Found meta ${name}: "${match[1].trim().slice(0, 80)}"`,
        result: "pass",
      };
    }
    return {
      expected: `Page should have meta ${name}`,
      observed: `Missing meta ${name}`,
      result: "warning",
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
      };
    }
    return {
      expected: `Page should have <link rel="${rel}">`,
      observed: `Missing <link rel="${rel}">`,
      result: "warning",
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
      };
    }
    return {
      expected: `Page should have meta property ${property}`,
      observed: `Missing meta property ${property}`,
      result: "warning",
    };
  }
}
