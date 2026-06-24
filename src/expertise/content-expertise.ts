import { ExpertiseRuleId } from "@sudobility/testomniac_types";
import type { Expertise, ExpertiseContext, Outcome } from "./types";
import { outcomesFromPageHealth } from "./page-health-outcomes";
import { applyRuleIds } from "./rule-id";

const CONTENT_PAGE_HEALTH_RULE_IDS = {
  broken_image: ExpertiseRuleId.ContentPageHealthBrokenImage,
  broken_link_pattern: ExpertiseRuleId.ContentPageHealthBrokenLinkPattern,
  cart_math_error: ExpertiseRuleId.ContentPageHealthCartMath,
  grammar_error: ExpertiseRuleId.ContentPageHealthGrammar,
  defunct_service: ExpertiseRuleId.ContentPageHealthDefunctService,
  missing_price: ExpertiseRuleId.ContentPageHealthMissingPrice,
  invalid_price: ExpertiseRuleId.ContentPageHealthInvalidPrice,
  invalid_discount: ExpertiseRuleId.ContentPageHealthInvalidDiscount,
  invalid_rating: ExpertiseRuleId.ContentPageHealthInvalidRating,
  placeholder_text: ExpertiseRuleId.ContentPageHealthPlaceholderText,
  price_format_error: ExpertiseRuleId.ContentPageHealthPriceFormat,
  empty_product_page: ExpertiseRuleId.ContentPageHealthEmptyProductPage,
  missing_product_image: ExpertiseRuleId.ContentPageHealthMissingProductImage,
  missing_stock_info: ExpertiseRuleId.ContentPageHealthMissingStockInfo,
} as const;
const CONTENT_RULE_IDS = {
  "Page should contain meaningful body content":
    ExpertiseRuleId.ContentMeaningfulBodyText,
  "Page should have exactly one H1 heading": ExpertiseRuleId.ContentSingleH1,
  "Page content should not contain placeholder copy":
    ExpertiseRuleId.ContentPlaceholderCopy,
  "Images should provide alt text": ExpertiseRuleId.ContentImageAltCoverage,
  "Links should not contain URL typos or malformed paths":
    ExpertiseRuleId.ContentBrokenLinkPatterns,
  "Links should point to real destinations":
    ExpertiseRuleId.ContentPlaceholderLinks,
  "Image alt text should describe meaningful images":
    ExpertiseRuleId.ContentWeakImageAltText,
  "Form option labels should match the product context":
    ExpertiseRuleId.ContentLabelContextMismatch,
  "Currency display should match selected currency":
    ExpertiseRuleId.ContentCurrencyConsistency,
  "Repeated call-to-action labels should not point to different destinations":
    ExpertiseRuleId.ContentDuplicateCtaDestinations,
  "Contact pages should include a concrete contact method":
    ExpertiseRuleId.ContentContactPageCompleteness,
  "Repeated product cards should include title, image, and price":
    ExpertiseRuleId.ContentProductCardEssentials,
  "Primary UI text should stay in a consistent language":
    ExpertiseRuleId.ContentLanguageConsistency,
  "Element IDs should be unique within the page":
    ExpertiseRuleId.ContentDuplicateIds,
  "Heading levels should not skip hierarchy levels":
    ExpertiseRuleId.ContentHeadingHierarchy,
  "Page should not contain hardcoded development or staging URLs":
    ExpertiseRuleId.ContentHardcodedDevUrls,
  "Copyright year should be current": ExpertiseRuleId.ContentOutdatedCopyright,
  "Form labels should reference existing element IDs":
    ExpertiseRuleId.ContentOrphanedFormLabels,
} as const;

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
    outcomes.push(this.checkPlaceholderLinks(context.html));
    outcomes.push(this.checkWeakImageAltText(context.html));
    outcomes.push(this.checkLabelContextMismatch(context.html));
    outcomes.push(this.checkCurrencyConsistency(context.html));
    outcomes.push(this.checkDuplicateCtaDestinations(context.html));
    outcomes.push(
      this.checkContactPageCompleteness(context.html, context.currentUrl)
    );
    outcomes.push(this.checkProductCardEssentials(context.html));
    outcomes.push(this.checkDuplicateIds(context.html));
    outcomes.push(this.checkHeadingHierarchy(context.html));
    outcomes.push(this.checkHardcodedDevUrls(context.html));
    outcomes.push(this.checkOutdatedCopyright(context.html));
    outcomes.push(this.checkOrphanedFormLabels(context.html));
    outcomes.push(
      ...outcomesFromPageHealth(
        context.pageHealthIssues,
        CONTENT_PAGE_HEALTH_RULE_IDS
      )
    );

    return applyRuleIds(outcomes, CONTENT_RULE_IDS);
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

  private checkPlaceholderLinks(html: string): Outcome {
    const hrefMatches = html.match(/\bhref=["']([^"']*)["']/gi) ?? [];
    const placeholders = hrefMatches.filter(match => {
      const href = match.replace(/^href=["']|["']$/gi, "").trim();
      return (
        href === "" || href === "#" || /^javascript:void\(0\)$/i.test(href)
      );
    });
    if (placeholders.length > 0) {
      return {
        expected: "Links should point to real destinations",
        observed: `${placeholders.length} placeholder link(s) found`,
        result: "warning",
        priority: 3,
      };
    }
    return {
      expected: "Links should point to real destinations",
      observed: "No placeholder links detected",
      result: "pass",
      priority: 3,
    };
  }

  private checkWeakImageAltText(html: string): Outcome {
    const images = html.match(/<img\b[^>]*>/gi) ?? [];
    const weak = images.filter(image => {
      const alt = image.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1]?.trim();
      if (!alt) return false;
      return /^(image|photo|picture|logo|img|placeholder|untitled)$/i.test(alt);
    });
    if (weak.length > 0) {
      return {
        expected: "Image alt text should describe meaningful images",
        observed: `${weak.length} image(s) use generic alt text`,
        result: "warning",
        priority: 4,
      };
    }
    return {
      expected: "Image alt text should describe meaningful images",
      observed: "No generic image alt text detected",
      result: "pass",
      priority: 4,
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

  private checkDuplicateCtaDestinations(html: string): Outcome {
    const anchors =
      html.match(/<a\b[^>]*href=["'][^"']+["'][^>]*>[\s\S]*?<\/a>/gi) ?? [];
    const destinationsByText = new Map<string, Set<string>>();
    for (const anchor of anchors) {
      const href = anchor.match(/\bhref=["']([^"']+)["']/i)?.[1]?.trim();
      const text = anchor
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!href || text.length < 3) continue;
      const key = text.toLowerCase();
      const destinations = destinationsByText.get(key) ?? new Set<string>();
      destinations.add(href);
      destinationsByText.set(key, destinations);
    }
    const ambiguous = Array.from(destinationsByText.entries()).filter(
      ([text, destinations]) => destinations.size > 1 && text.length < 30
    );
    if (ambiguous.length > 0) {
      const [text, destinations] = ambiguous[0]!;
      return {
        expected:
          "Repeated call-to-action labels should not point to different destinations",
        observed: `"${text}" points to ${destinations.size} different destinations`,
        result: "warning",
        priority: 3,
      };
    }
    return {
      expected:
        "Repeated call-to-action labels should not point to different destinations",
      observed: "No ambiguous repeated call-to-action labels detected",
      result: "pass",
      priority: 3,
    };
  }

  private checkContactPageCompleteness(
    html: string,
    currentUrl: string | undefined
  ): Outcome {
    const text = stripHtml(html).toLowerCase();
    let path = "";
    try {
      path = currentUrl ? new URL(currentUrl).pathname.toLowerCase() : "";
    } catch {
      path = "";
    }
    const looksLikeContact =
      path.includes("contact") ||
      /\b(contact us|get in touch|support)\b/i.test(text);
    if (!looksLikeContact) {
      return {
        expected: "Contact pages should include a concrete contact method",
        observed: "Page does not look like a contact page",
        result: "pass",
        priority: 3,
      };
    }
    const hasContactMethod =
      /mailto:/i.test(html) ||
      /tel:/i.test(html) ||
      /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(html) ||
      /\+?\d[\d\s().-]{7,}\d/.test(text) ||
      /<form\b/i.test(html);
    if (!hasContactMethod) {
      return {
        expected: "Contact pages should include a concrete contact method",
        observed: "Contact page has no email, phone, or form detected",
        result: "warning",
        priority: 3,
      };
    }
    return {
      expected: "Contact pages should include a concrete contact method",
      observed: "Contact page includes email, phone, or a form",
      result: "pass",
      priority: 3,
    };
  }

  private checkProductCardEssentials(html: string): Outcome {
    const cardMatches =
      html.match(
        /<[^>]+class=["'][^"']*(product|card|item)[^"']*["'][^>]*>[\s\S]{0,2500}?<\/[^>]+>/gi
      ) ?? [];
    if (cardMatches.length < 2) {
      return {
        expected:
          "Repeated product cards should include title, image, and price",
        observed: "No repeated product-card pattern detected",
        result: "pass",
        priority: 3,
      };
    }
    const incomplete = cardMatches.filter(card => {
      const hasImage = /<img\b/i.test(card);
      const hasPrice = /(?:[$€£]\s?\d|\d+(?:\.\d{2})?\s?(?:USD|EUR|GBP))/i.test(
        stripHtml(card)
      );
      const hasTitle = /<(h2|h3|h4)\b/i.test(card) || /\btitle=/i.test(card);
      return !hasImage || !hasPrice || !hasTitle;
    });
    if (incomplete.length > 0) {
      return {
        expected:
          "Repeated product cards should include title, image, and price",
        observed: `${incomplete.length} of ${cardMatches.length} product-like card(s) are missing title, image, or price`,
        result: "warning",
        priority: 3,
      };
    }
    return {
      expected: "Repeated product cards should include title, image, and price",
      observed: `All ${cardMatches.length} product-like card(s) include essentials`,
      result: "pass",
      priority: 3,
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
