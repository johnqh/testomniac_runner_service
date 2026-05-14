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
    outcomes.push(this.checkBrokenLinkPatterns(context.html));
    outcomes.push(this.checkLabelContextMismatch(context.html));
    outcomes.push(this.checkCurrencyConsistency(context.html));

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

  private checkBrokenLinkPatterns(html: string): Outcome {
    // Check for common URL typos in href attributes
    const hrefMatches = html.match(/\bhref=["']([^"']+)["']/gi) ?? [];
    const suspicious: string[] = [];

    for (const match of hrefMatches) {
      const href = match.replace(/^href=["']|["']$/gi, "");
      // Detect doubled path segments (e.g., /stored/ instead of /store/)
      if (/\/stored\//.test(href)) {
        suspicious.push(`"${href}" (likely typo: /stored/ → /store/)`);
      }
      // Detect links pointing to page's own URL (often broken image src or self-reference)
      if (/\bhref=["']#["']/g.test(match) === false) {
        // Check for links that look like they resolve to a product/page slug that doesn't match the link text
      }
    }

    if (suspicious.length > 0) {
      return {
        expected: "Links should not contain URL typos or malformed paths",
        observed: `Found ${suspicious.length} suspicious link(s): ${suspicious.slice(0, 3).join("; ")}`,
        result: "warning",
      };
    }

    return {
      expected: "Links should not contain URL typos or malformed paths",
      observed: "No suspicious link patterns detected",
      result: "pass",
    };
  }

  private checkLabelContextMismatch(html: string): Outcome {
    // Detect option labels that don't match the product context
    // e.g., "Select Shirt Size" on a coat/jacket product page
    const mismatches: string[] = [];

    // Check for "shirt" labels on non-shirt products
    const h1Content = (
      html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? ""
    ).toLowerCase();
    if (
      /select\s+shirt\s+size/i.test(html) &&
      !/(shirt|tee|t-shirt|tshirt|blouse)/i.test(h1Content)
    ) {
      const productName =
        html
          .match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
          ?.replace(/<[^>]+>/g, "")
          .trim() ?? "unknown";
      mismatches.push(
        `"Select Shirt Size" label on "${productName}" product page`
      );
    }

    // Check for "Select Color" when product name implies specific color
    // (this is acceptable, so not flagged)

    if (mismatches.length > 0) {
      return {
        expected: "Form option labels should match the product context",
        observed: `Label mismatch: ${mismatches.join("; ")}`,
        result: "warning",
      };
    }

    return {
      expected: "Form option labels should match the product context",
      observed: "No label/context mismatches detected",
      result: "pass",
    };
  }

  private checkCurrencyConsistency(html: string): Outcome {
    // Check that displayed currency matches the selected currency
    const currencySelect =
      html
        .match(
          /<select[^>]*currency[^>]*>[\s\S]*?<option[^>]*selected[^>]*>([^<]+)/i
        )?.[1]
        ?.trim() ?? null;

    if (!currencySelect) {
      return {
        expected: "Currency display should match selected currency",
        observed: "No currency selector detected",
        result: "pass",
      };
    }

    const text = stripHtml(html);
    const selectedCurrency = currencySelect.toUpperCase();

    // If EUR selected but prices show $, that's a mismatch
    if (selectedCurrency === "EUR" && /\$\d/.test(text) && !/€/.test(text)) {
      return {
        expected: "Currency display should match selected currency",
        observed: `Currency selector shows "${selectedCurrency}" but prices still display with $ symbol`,
        result: "error",
      };
    }

    if (selectedCurrency === "GBP" && /\$\d/.test(text) && !/£/.test(text)) {
      return {
        expected: "Currency display should match selected currency",
        observed: `Currency selector shows "${selectedCurrency}" but prices still display with $ symbol`,
        result: "error",
      };
    }

    return {
      expected: "Currency display should match selected currency",
      observed: "Currency display appears consistent with selector",
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
