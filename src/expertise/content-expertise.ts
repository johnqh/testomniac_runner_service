import type { Expertise, ExpertiseContext, Outcome } from "./types";

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class ContentExpertise implements Expertise {
  name = "content";

  evaluate(context: ExpertiseContext): Outcome[] {
    const outcomes: Outcome[] = [];

    outcomes.push(this.checkMeaningfulBodyText(context.html));
    outcomes.push(this.checkSingleH1(context.html));
    outcomes.push(this.checkPlaceholderContent(context.html));
    outcomes.push(this.checkImageAltCoverage(context.html));
    outcomes.push(this.checkLanguageConsistency(context.html));

    return outcomes;
  }

  private checkMeaningfulBodyText(html: string): Outcome {
    const text = stripHtml(html);
    if (text.length < 120) {
      return {
        expected: "Page should contain meaningful body content",
        observed: `Only ${text.length} characters of visible text were detected`,
        result: "warning",
      };
    }

    return {
      expected: "Page should contain meaningful body content",
      observed: `${text.length} characters of visible text detected`,
      result: "pass",
    };
  }

  private checkSingleH1(html: string): Outcome {
    const matches = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) ?? [];
    if (matches.length === 1) {
      return {
        expected: "Page should have exactly one H1 heading",
        observed: "Found exactly one H1 heading",
        result: "pass",
      };
    }

    if (matches.length === 0) {
      return {
        expected: "Page should have exactly one H1 heading",
        observed: "No H1 heading detected",
        result: "warning",
      };
    }

    return {
      expected: "Page should have exactly one H1 heading",
      observed: `Found ${matches.length} H1 headings`,
      result: "warning",
    };
  }

  private checkPlaceholderContent(html: string): Outcome {
    const placeholderPatterns = [
      /lorem ipsum/i,
      /\bTODO\b/i,
      /coming soon/i,
      /placeholder/i,
      /insert text here/i,
    ];
    const matched = placeholderPatterns.find(pattern => pattern.test(html));

    if (matched) {
      return {
        expected: "Page content should not contain placeholder copy",
        observed: `Placeholder content matched pattern ${matched}`,
        result: "warning",
      };
    }

    return {
      expected: "Page content should not contain placeholder copy",
      observed: "No obvious placeholder copy detected",
      result: "pass",
    };
  }

  private checkImageAltCoverage(html: string): Outcome {
    const images = html.match(/<img\b[^>]*>/gi) ?? [];
    if (images.length === 0) {
      return {
        expected: "Images should provide alt text",
        observed: "No images detected on the page",
        result: "pass",
      };
    }

    const missingAlt = images.filter(
      image => !/\balt\s*=\s*["'][^"']*["']/i.test(image)
    );
    if (missingAlt.length > 0) {
      return {
        expected: "Images should provide alt text",
        observed: `${missingAlt.length} of ${images.length} image(s) are missing alt text`,
        result: "warning",
      };
    }

    return {
      expected: "Images should provide alt text",
      observed: `All ${images.length} image(s) include alt text`,
      result: "pass",
    };
  }

  private checkLanguageConsistency(html: string): Outcome {
    const langMatch = html.match(/<html\b[^>]*\blang=["']([^"']+)["']/i);
    const lang = (langMatch?.[1] ?? "").toLowerCase();
    const text = stripHtml(html);
    const lower = text.toLowerCase();

    const englishSignals = [
      "add to cart",
      "checkout",
      "search",
      "contact",
      "sign in",
      "register",
      "account",
    ].filter(token => lower.includes(token)).length;
    const foreignSignals = [
      "revisa",
      "comprar",
      "enviar",
      "buscar",
      "connexion",
      "anmelden",
      "registrarse",
    ].filter(token => lower.includes(token));

    if (
      (lang.startsWith("en") || englishSignals >= 2) &&
      foreignSignals.length > 0
    ) {
      return {
        expected: "Primary UI text should stay in a consistent language",
        observed: `Detected unexpected non-English UI tokens: ${foreignSignals.join(", ")}`,
        result: "warning",
      };
    }

    return {
      expected: "Primary UI text should stay in a consistent language",
      observed: "No obvious mixed-language UI tokens were detected",
      result: "pass",
    };
  }
}
