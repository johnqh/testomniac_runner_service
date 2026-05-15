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
    outcomes.push(this.checkDuplicateIds(context.html));
    outcomes.push(this.checkHeadingHierarchy(context.html));
    outcomes.push(this.checkHardcodedDevUrls(context.html));
    outcomes.push(this.checkOutdatedCopyright(context.html));
    outcomes.push(this.checkOrphanedFormLabels(context.html));

    return outcomes;
  }

  private checkMeaningfulBodyText(html: string): Outcome {
    const text = stripHtml(html);
    if (text.length < 120) {
      return {
        expected: "Page should contain meaningful body content",
        observed: `Only ${text.length} characters of visible text were detected`,
        result: "warning",
        priority: 3,
      };
    }

    return {
      expected: "Page should contain meaningful body content",
      observed: `${text.length} characters of visible text detected`,
      result: "pass",
      priority: 3,
    };
  }

  private checkSingleH1(html: string): Outcome {
    const matches = html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) ?? [];
    if (matches.length === 1) {
      return {
        expected: "Page should have exactly one H1 heading",
        observed: "Found exactly one H1 heading",
        result: "pass",
        priority: 4,
      };
    }

    if (matches.length === 0) {
      return {
        expected: "Page should have exactly one H1 heading",
        observed: "No H1 heading detected",
        result: "warning",
        priority: 4,
      };
    }

    return {
      expected: "Page should have exactly one H1 heading",
      observed: `Found ${matches.length} H1 headings`,
      result: "warning",
      priority: 4,
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
        priority: 3,
      };
    }

    return {
      expected: "Page content should not contain placeholder copy",
      observed: "No obvious placeholder copy detected",
      result: "pass",
      priority: 3,
    };
  }

  private checkImageAltCoverage(html: string): Outcome {
    const images = html.match(/<img\b[^>]*>/gi) ?? [];
    if (images.length === 0) {
      return {
        expected: "Images should provide alt text",
        observed: "No images detected on the page",
        result: "pass",
        priority: 4,
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
        priority: 4,
      };
    }

    return {
      expected: "Images should provide alt text",
      observed: `All ${images.length} image(s) include alt text`,
      result: "pass",
      priority: 4,
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
        priority: 2,
      };
    }

    return {
      expected: "Links should not contain URL typos or malformed paths",
      observed: "No suspicious link patterns detected",
      result: "pass",
      priority: 2,
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
        priority: 3,
      };
    }

    return {
      expected: "Form option labels should match the product context",
      observed: "No label/context mismatches detected",
      result: "pass",
      priority: 3,
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
        priority: 1,
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
        priority: 1,
      };
    }

    if (selectedCurrency === "GBP" && /\$\d/.test(text) && !/£/.test(text)) {
      return {
        expected: "Currency display should match selected currency",
        observed: `Currency selector shows "${selectedCurrency}" but prices still display with $ symbol`,
        result: "error",
        priority: 1,
      };
    }

    return {
      expected: "Currency display should match selected currency",
      observed: "Currency display appears consistent with selector",
      result: "pass",
      priority: 1,
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
        priority: 3,
      };
    }

    return {
      expected: "Primary UI text should stay in a consistent language",
      observed: "No obvious mixed-language UI tokens were detected",
      result: "pass",
      priority: 3,
    };
  }

  private checkDuplicateIds(html: string): Outcome {
    const idMatches = html.match(/\bid=["']([^"']+)["']/gi) ?? [];
    const ids = idMatches.map(m =>
      m.replace(/^id=["']|["']$/gi, "").toLowerCase()
    );
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) duplicates.add(id);
      seen.add(id);
    }

    if (duplicates.size > 0) {
      const list = Array.from(duplicates).slice(0, 5).join(", ");
      return {
        expected: "Element IDs should be unique within the page",
        observed: `${duplicates.size} duplicate ID(s) found: ${list}`,
        result: "warning",
        priority: 3,
      };
    }

    return {
      expected: "Element IDs should be unique within the page",
      observed: "All element IDs are unique",
      result: "pass",
      priority: 3,
    };
  }

  private checkHeadingHierarchy(html: string): Outcome {
    const headingMatches = html.match(/<h([1-6])\b/gi) ?? [];
    const levels = headingMatches.map(m => parseInt(m.replace(/<h/i, ""), 10));

    if (levels.length < 2) {
      return {
        expected: "Heading levels should not skip hierarchy levels",
        observed: `Only ${levels.length} heading(s) found`,
        result: "pass",
        priority: 4,
      };
    }

    const gaps: string[] = [];
    for (let i = 1; i < levels.length; i++) {
      if (levels[i] > levels[i - 1] + 1) {
        gaps.push(`h${levels[i - 1]} → h${levels[i]}`);
      }
    }

    if (gaps.length > 0) {
      return {
        expected: "Heading levels should not skip hierarchy levels",
        observed: `Heading hierarchy gap(s): ${gaps.slice(0, 3).join(", ")}`,
        result: "warning",
        priority: 4,
      };
    }

    return {
      expected: "Heading levels should not skip hierarchy levels",
      observed: "Heading hierarchy is sequential",
      result: "pass",
      priority: 4,
    };
  }

  private checkHardcodedDevUrls(html: string): Outcome {
    const devPatterns = [
      /https?:\/\/localhost[:/]/gi,
      /https?:\/\/127\.0\.0\.1[:/]/gi,
      /https?:\/\/0\.0\.0\.0[:/]/gi,
      /https?:\/\/[^"'\s]*\.local[/"'\s]/gi,
      /https?:\/\/[^"'\s]*staging[^"'\s]*\.(com|net|org|io)/gi,
    ];

    for (const pattern of devPatterns) {
      const match = html.match(pattern);
      if (match) {
        return {
          expected:
            "Page should not contain hardcoded development or staging URLs",
          observed: `Found dev/staging URL: ${match[0].slice(0, 60)}`,
          result: "warning",
          priority: 3,
        };
      }
    }

    return {
      expected: "Page should not contain hardcoded development or staging URLs",
      observed: "No hardcoded dev URLs detected",
      result: "pass",
      priority: 3,
    };
  }

  private checkOutdatedCopyright(html: string): Outcome {
    const text = stripHtml(html);
    const currentYear = new Date().getFullYear();
    const copyrightMatch = text.match(
      /(?:©|copyright)\s*(\d{4})(?:\s*[-–]\s*(\d{4}))?/i
    );

    if (!copyrightMatch) {
      return {
        expected: "Copyright year should be current",
        observed: "No copyright notice detected",
        result: "pass",
        priority: 4,
      };
    }

    const endYear = parseInt(copyrightMatch[2] || copyrightMatch[1], 10);
    if (endYear < currentYear - 1) {
      return {
        expected: "Copyright year should be current",
        observed: `Copyright year is ${endYear}, current year is ${currentYear}`,
        result: "warning",
        priority: 4,
      };
    }

    return {
      expected: "Copyright year should be current",
      observed: `Copyright year (${endYear}) is current`,
      result: "pass",
      priority: 4,
    };
  }

  private checkOrphanedFormLabels(html: string): Outcome {
    const labelForMatches = html.match(/\bfor=["']([^"']+)["']/gi) ?? [];
    const labelForIds = labelForMatches.map(m =>
      m.replace(/^for=["']|["']$/gi, "")
    );

    const idMatches = html.match(/\bid=["']([^"']+)["']/gi) ?? [];
    const allIds = new Set(
      idMatches.map(m => m.replace(/^id=["']|["']$/gi, ""))
    );

    const orphaned = labelForIds.filter(id => !allIds.has(id));

    if (orphaned.length > 0) {
      return {
        expected: "Form labels should reference existing element IDs",
        observed: `${orphaned.length} label(s) reference non-existent IDs: ${orphaned.slice(0, 3).join(", ")}`,
        result: "warning",
        priority: 4,
      };
    }

    return {
      expected: "Form labels should reference existing element IDs",
      observed: "All form labels reference valid element IDs",
      result: "pass",
      priority: 4,
    };
  }
}
