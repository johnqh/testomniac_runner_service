import type { BrowserAdapter } from "../adapter";

/**
 * A page health issue found during browser-side evaluation.
 */
export interface PageHealthIssue {
  type:
    | "broken_image"
    | "element_overlap"
    | "dead_social_button"
    | "broken_link_pattern"
    | "cart_math_error"
    | "grammar_error"
    | "defunct_service"
    | "missing_price"
    | "inconsistent_grid"
    | "empty_link"
    | "broken_anchor"
    | "missing_noopener"
    | "horizontal_overflow"
    | "truncated_text"
    | "invalid_price"
    | "invalid_discount"
    | "invalid_rating"
    | "unlabeled_button"
    | "small_touch_target";
  severity: "error" | "warning";
  priority: number;
  title: string;
  description: string;
}

/**
 * Run browser-side page health checks that require DOM evaluation.
 * Returns an array of issues found on the current page.
 */
export async function evaluatePageHealth(
  adapter: BrowserAdapter
): Promise<PageHealthIssue[]> {
  const issues: PageHealthIssue[] = [];

  const results = await adapter.evaluate(() => {
    const found: Array<{
      type: string;
      severity: string;
      priority: number;
      title: string;
      description: string;
    }> = [];

    // =========================================================================
    // 1. Broken images — check naturalWidth for loaded images
    // =========================================================================
    const images = Array.from(document.querySelectorAll("img"));
    const brokenImages: string[] = [];
    for (const img of images) {
      if (
        img.complete &&
        img.naturalWidth === 0 &&
        img.src &&
        img.offsetParent !== null
      ) {
        const alt = img.alt || img.src.split("/").pop() || "unknown";
        brokenImages.push(alt);
      }
    }
    if (brokenImages.length > 0) {
      found.push({
        type: "broken_image",
        severity: "error",
        priority: 3,
        title: `${brokenImages.length} broken image(s) detected`,
        description: `Images that failed to load: ${brokenImages.slice(0, 5).join(", ")}${brokenImages.length > 5 ? ` and ${brokenImages.length - 5} more` : ""}`,
      });
    }

    // =========================================================================
    // 2. Element overlap — check if interactive elements are obscured
    // =========================================================================
    const interactiveSelectors =
      "a[href], button, input, select, textarea, [role='button']";
    const interactiveEls = Array.from(
      document.querySelectorAll(interactiveSelectors)
    );
    const overlappedElements: string[] = [];
    for (const el of interactiveEls.slice(0, 50)) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.top < 0 || rect.left < 0) continue;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const topEl = document.elementFromPoint(cx, cy);
      if (
        topEl &&
        topEl !== el &&
        !el.contains(topEl) &&
        !topEl.closest(interactiveSelectors)?.contains(el)
      ) {
        const elDesc = el.textContent?.trim().slice(0, 40) || el.tagName;
        const blockDesc =
          topEl.tagName +
          (topEl.className ? "." + String(topEl.className).split(" ")[0] : "");
        overlappedElements.push(`"${elDesc}" obscured by <${blockDesc}>`);
      }
    }
    if (overlappedElements.length > 0) {
      found.push({
        type: "element_overlap",
        severity: "error",
        priority: 2,
        title: `${overlappedElements.length} interactive element(s) obscured by overlapping content`,
        description: overlappedElements.slice(0, 3).join("; "),
      });
    }

    // =========================================================================
    // 3. Dead social share buttons — icons/buttons without proper links
    // =========================================================================
    const socialKeywords = [
      "facebook",
      "twitter",
      "linkedin",
      "pinterest",
      "email",
      "share",
      "myspace",
      "whatsapp",
    ];
    const socialEls = Array.from(
      document.querySelectorAll('[class*="social"], [class*="share"]')
    );
    const deadSocial: string[] = [];
    for (const el of socialEls) {
      const cls = el.className.toLowerCase();
      if (!socialKeywords.some(k => cls.includes(k))) continue;
      const isLink =
        el.tagName === "A" &&
        el.getAttribute("href") &&
        el.getAttribute("href") !== "#";
      const hasLinkChild = !!el.querySelector('a[href]:not([href="#"])');
      const hasOnclick = !!el.getAttribute("onclick");
      if (!isLink && !hasLinkChild && !hasOnclick) {
        const name = socialKeywords.find(k => cls.includes(k)) || "unknown";
        deadSocial.push(name);
      }
    }
    if (deadSocial.length > 0) {
      found.push({
        type: "dead_social_button",
        severity: "warning",
        priority: 3,
        title: `${deadSocial.length} social share button(s) are non-functional`,
        description: `Non-clickable social buttons: ${deadSocial.join(", ")}`,
      });
    }

    // =========================================================================
    // 4. Cart math validation — check subtotal + shipping = grand total
    // =========================================================================
    const pageText = document.body?.innerText || "";
    const priceRe = /[$€£]\s?([\d,.]+)/;
    const subtotalMatch = pageText.match(
      new RegExp("(?:sub\\s*total|cart\\s*sub)[^\\n]*?" + priceRe.source, "i")
    );
    const shippingMatch = pageText.match(
      new RegExp("shipping[^\\n]*?" + priceRe.source, "i")
    );
    const grandTotalMatch = pageText.match(
      new RegExp(
        "(?:grand\\s*total|order\\s*total)[^\\n]*?" + priceRe.source,
        "i"
      )
    );

    if (subtotalMatch && shippingMatch && grandTotalMatch) {
      const subtotal = parseFloat(subtotalMatch[1].replace(/,/g, ""));
      const shipping = parseFloat(shippingMatch[1].replace(/,/g, ""));
      const grandTotal = parseFloat(grandTotalMatch[1].replace(/,/g, ""));
      const expected = Math.round((subtotal + shipping) * 100) / 100;
      if (Math.abs(grandTotal - expected) > 0.01) {
        found.push({
          type: "cart_math_error",
          severity: "error",
          priority: 1,
          title: "Cart grand total does not match subtotal + shipping",
          description: `Subtotal ($${subtotal.toFixed(2)}) + Shipping ($${shipping.toFixed(2)}) = $${expected.toFixed(2)}, but Grand Total shows $${grandTotal.toFixed(2)}`,
        });
      }
    }

    // =========================================================================
    // 5. Grammar: singular/plural mismatch (e.g., "1 results")
    // =========================================================================
    const grammarPatterns = [
      { pattern: /\b1\s+results\b/i, fix: '"1 result"' },
      { pattern: /\b1\s+items\b/i, fix: '"1 item"' },
      { pattern: /\b1\s+products\b/i, fix: '"1 product"' },
      { pattern: /\b0\s+result\b(?!s)/i, fix: '"0 results"' },
    ];
    for (const { pattern, fix } of grammarPatterns) {
      const match = pageText.match(pattern);
      if (match) {
        found.push({
          type: "grammar_error",
          severity: "warning",
          priority: 3,
          title: `Grammar error: "${match[0]}"`,
          description: `Should be ${fix} — singular/plural mismatch`,
        });
      }
    }

    // =========================================================================
    // 6. Defunct service links (MySpace, Google+, etc.)
    // =========================================================================
    const defunctServices = [
      { pattern: /myspace\.com|class.*myspace/i, name: "MySpace" },
      { pattern: /plus\.google\.com/i, name: "Google+" },
      { pattern: /vine\.co(?!mcast)/i, name: "Vine" },
    ];
    const allLinks = Array.from(document.querySelectorAll("a[href], [class]"));
    for (const { pattern, name } of defunctServices) {
      for (const el of allLinks) {
        const href = el.getAttribute("href") || "";
        const cls = el.className || "";
        if (pattern.test(href) || pattern.test(cls)) {
          found.push({
            type: "defunct_service",
            severity: "warning",
            priority: 4,
            title: `Link to defunct service: ${name}`,
            description: `Page contains a link/reference to ${name}, which is no longer operational`,
          });
          break;
        }
      }
    }

    // =========================================================================
    // 7. Missing product price — product page without visible price
    // =========================================================================
    const hasProductIndicators = !!document.querySelector(
      '[class*="product_details"], [class*="ec_details"], .product-details'
    );
    const hasAddToCart = !!document.querySelector(
      '[class*="addtocart"], .add-to-cart, [class*="add_to_cart"]'
    );
    const hasPriceElement = !!document.querySelector(
      '[class*="price"]:not([class*="price_filter"])'
    );
    const hasLoginForPricing = /login\s*for\s*pricing/i.test(pageText);

    if (hasProductIndicators && !hasPriceElement && !hasAddToCart) {
      found.push({
        type: "missing_price",
        severity: "error",
        priority: 2,
        title: "Product page missing price and add-to-cart",
        description:
          "Product detail page detected but no price or add-to-cart button is visible",
      });
    }
    if (hasLoginForPricing) {
      found.push({
        type: "missing_price",
        severity: "warning",
        priority: 2,
        title: "Product price hidden behind login",
        description:
          '"Login for Pricing" shown instead of product price — public visitors cannot see the price',
      });
    }

    // =========================================================================
    // 8. Grid/layout inconsistency — product grid items with wildly different heights
    // =========================================================================
    const gridItems = document.querySelectorAll(
      '[class*="product_li"], .product-card, [class*="product-item"]'
    );
    if (gridItems.length >= 3) {
      const heights = Array.from(gridItems)
        .map(el => el.getBoundingClientRect().height)
        .filter(h => h > 0);
      if (heights.length >= 3) {
        const avgHeight = heights.reduce((a, b) => a + b, 0) / heights.length;
        const outliers = heights.filter(
          h => Math.abs(h - avgHeight) > avgHeight * 0.5
        );
        if (outliers.length > 0) {
          found.push({
            type: "inconsistent_grid",
            severity: "warning",
            priority: 3,
            title: `Product grid layout has ${outliers.length} inconsistently sized item(s)`,
            description: `Average item height is ${Math.round(avgHeight)}px but ${outliers.length} item(s) deviate by more than 50%`,
          });
        }
      }
    }

    // =========================================================================
    // 9. Result count mismatch — "Showing N results" vs actual visible items
    // =========================================================================
    const showingMatch = pageText.match(
      /showing\s+(?:all\s+)?(\d+)\s+results?/i
    );
    if (showingMatch && gridItems.length > 0) {
      const claimed = parseInt(showingMatch[1], 10);
      const actual = gridItems.length;
      if (claimed !== actual) {
        found.push({
          type: "grammar_error",
          severity: "warning",
          priority: 3,
          title: `Result count mismatch: claims ${claimed} but shows ${actual}`,
          description: `Page text says "Showing ${claimed} results" but ${actual} product items are visible on the page`,
        });
      }
    }

    // =========================================================================
    // 10. Filter count validation — sidebar filter counts should sum correctly
    // =========================================================================
    const filterLinks = Array.from(
      document.querySelectorAll(
        '[class*="price_filter"] a, [class*="filter_list"] a'
      )
    );
    if (filterLinks.length >= 2) {
      let filterSum = 0;
      for (const link of filterLinks) {
        const countMatch = link.textContent?.match(/\((\d+)\)/);
        if (countMatch) {
          filterSum += parseInt(countMatch[1], 10);
        }
      }
      if (
        filterSum > 0 &&
        gridItems.length > 0 &&
        filterSum !== gridItems.length
      ) {
        found.push({
          type: "grammar_error",
          severity: "warning",
          priority: 3,
          title: `Filter counts sum (${filterSum}) doesn't match total products (${gridItems.length})`,
          description: `Price filter counts add up to ${filterSum} but ${gridItems.length} products are displayed`,
        });
      }
    }

    // =========================================================================
    // 11. Empty/dead links — visible links with no real destination
    // =========================================================================
    const allAnchors = Array.from(document.querySelectorAll("a"));
    let emptyLinkCount = 0;
    for (const a of allAnchors) {
      const href = a.getAttribute("href");
      const text = a.textContent?.trim();
      const isVisible = a.offsetParent !== null && a.offsetWidth > 0;
      if (
        isVisible &&
        text &&
        text.length > 1 &&
        (!href || href === "#" || href === "javascript:void(0)")
      ) {
        emptyLinkCount++;
      }
    }
    if (emptyLinkCount > 0) {
      found.push({
        type: "empty_link",
        severity: "warning",
        priority: 3,
        title: `${emptyLinkCount} link(s) with no real destination`,
        description: `Found ${emptyLinkCount} visible link(s) pointing to "#" or with empty href`,
      });
    }

    // =========================================================================
    // 12. Broken anchor links — href="#id" where #id doesn't exist on page
    // =========================================================================
    const brokenAnchors: string[] = [];
    for (const a of allAnchors) {
      const href = a.getAttribute("href");
      if (href && href.startsWith("#") && href.length > 1) {
        const targetId = href.slice(1);
        if (!document.getElementById(targetId)) {
          brokenAnchors.push(href);
        }
      }
    }
    if (brokenAnchors.length > 0) {
      found.push({
        type: "broken_anchor",
        severity: "warning",
        priority: 3,
        title: `${brokenAnchors.length} broken anchor link(s)`,
        description: `Anchor targets not found: ${brokenAnchors.slice(0, 5).join(", ")}`,
      });
    }

    // =========================================================================
    // 13. External links missing rel="noopener" — security issue
    // =========================================================================
    let unsafeExternalCount = 0;
    for (const a of allAnchors) {
      const href = a.getAttribute("href") || "";
      const target = a.getAttribute("target");
      const rel = a.getAttribute("rel") || "";
      if (
        target === "_blank" &&
        href.startsWith("http") &&
        !rel.includes("noopener")
      ) {
        unsafeExternalCount++;
      }
    }
    if (unsafeExternalCount > 0) {
      found.push({
        type: "missing_noopener",
        severity: "warning",
        priority: 4,
        title: `${unsafeExternalCount} external link(s) missing rel="noopener"`,
        description: `Links opening in new tab without rel="noopener" are a security risk (reverse tabnabbing)`,
      });
    }

    // =========================================================================
    // 14. Horizontal overflow — unintended horizontal scrollbar
    // =========================================================================
    if (
      document.documentElement.scrollWidth >
      document.documentElement.clientWidth + 5
    ) {
      found.push({
        type: "horizontal_overflow",
        severity: "warning",
        priority: 3,
        title: "Page has horizontal overflow",
        description: `Page width (${document.documentElement.scrollWidth}px) exceeds viewport (${document.documentElement.clientWidth}px), causing horizontal scrollbar`,
      });
    }

    // =========================================================================
    // 15. Truncated text — important content hidden by overflow
    // =========================================================================
    const truncatedEls = Array.from(
      document.querySelectorAll(
        "h1, h2, h3, a, button, [class*='title'], [class*='name'], [class*='price']"
      )
    );
    let truncatedCount = 0;
    for (const el of truncatedEls.slice(0, 40)) {
      const style = window.getComputedStyle(el);
      if (
        style.overflow === "hidden" &&
        style.textOverflow === "ellipsis" &&
        el.scrollWidth > el.clientWidth + 2
      ) {
        truncatedCount++;
      }
    }
    if (truncatedCount > 0) {
      found.push({
        type: "truncated_text",
        severity: "warning",
        priority: 3,
        title: `${truncatedCount} element(s) have truncated text`,
        description:
          "Important text (headings, links, titles, prices) is being cut off by CSS overflow",
      });
    }

    // =========================================================================
    // 16. Invalid prices — $0.00, negative, or NaN prices
    // =========================================================================
    const priceEls = Array.from(
      document.querySelectorAll(
        '[class*="price"], [class*="amount"], [class*="cost"]'
      )
    );
    const invalidPrices: string[] = [];
    for (const el of priceEls) {
      const text = el.textContent?.trim() || "";
      const priceMatch = text.match(/[$€£]\s*(-?[\d,.]+)/);
      if (priceMatch) {
        const val = parseFloat(priceMatch[1].replace(/,/g, ""));
        if (val <= 0 || isNaN(val)) {
          invalidPrices.push(`"${text.slice(0, 30)}" (${val})`);
        }
      }
    }
    if (invalidPrices.length > 0) {
      found.push({
        type: "invalid_price",
        severity: "error",
        priority: 1,
        title: `${invalidPrices.length} invalid price(s): zero, negative, or NaN`,
        description: `Invalid prices found: ${invalidPrices.slice(0, 3).join(", ")}`,
      });
    }

    // =========================================================================
    // 17. Sale price higher than original — discount makes no sense
    // =========================================================================
    const saleContainers = Array.from(
      document.querySelectorAll('[class*="price"], [class*="sale"]')
    );
    for (const container of saleContainers) {
      const strikes = container.querySelectorAll(
        "del, s, strike, .ec_product_price_old, [class*='original'], [class*='was'], [class*='old_price']"
      );
      if (strikes.length === 0) continue;
      for (const strike of Array.from(strikes)) {
        const origMatch = strike.textContent?.match(/[$€£]\s*([\d,.]+)/);
        const containerText = container.textContent || "";
        const allPrices = Array.from(
          containerText.matchAll(/[$€£]\s*([\d,.]+)/g)
        );
        if (origMatch && allPrices.length >= 2) {
          const original = parseFloat(origMatch[1].replace(/,/g, ""));
          const prices = allPrices.map(m => parseFloat(m[1].replace(/,/g, "")));
          const salePrice = prices.find(
            p => p !== original && p < original * 2
          );
          if (salePrice != null && salePrice > original) {
            found.push({
              type: "invalid_discount",
              severity: "error",
              priority: 1,
              title: "Sale price is higher than original price",
              description: `Original: $${original.toFixed(2)}, Sale: $${salePrice.toFixed(2)}`,
            });
            break;
          }
        }
      }
    }

    // =========================================================================
    // 18. Invalid star ratings — values > 5 or < 0
    // =========================================================================
    const ratingEls = Array.from(
      document.querySelectorAll(
        '[class*="rating"], [class*="stars"], [aria-label*="rating"]'
      )
    );
    for (const el of ratingEls) {
      const text = el.textContent?.trim() || "";
      const ariaLabel = el.getAttribute("aria-label") || "";
      const combined = text + " " + ariaLabel;
      const ratingMatch = combined.match(
        /([\d.]+)\s*(?:\/\s*5|out\s*of\s*5|stars?)/i
      );
      if (ratingMatch) {
        const val = parseFloat(ratingMatch[1]);
        if (val > 5 || val < 0) {
          found.push({
            type: "invalid_rating",
            severity: "error",
            priority: 3,
            title: `Invalid rating value: ${val}`,
            description: `Star rating of ${val} is outside the valid 0-5 range`,
          });
          break;
        }
      }
    }

    // =========================================================================
    // 19. Icon-only buttons without accessible labels
    // =========================================================================
    const buttons = Array.from(
      document.querySelectorAll(
        'button, [role="button"], a[class*="btn"], a[class*="button"]'
      )
    );
    let unlabeledCount = 0;
    for (const btn of buttons.slice(0, 30)) {
      const text = btn.textContent?.trim() || "";
      const ariaLabel = btn.getAttribute("aria-label") || "";
      const title = btn.getAttribute("title") || "";
      const hasImg = !!btn.querySelector("img, svg, [class*='icon']");
      const isVisible = (btn as HTMLElement).offsetParent !== null;
      if (
        isVisible &&
        hasImg &&
        text.length === 0 &&
        ariaLabel.length === 0 &&
        title.length === 0
      ) {
        unlabeledCount++;
      }
    }
    if (unlabeledCount > 0) {
      found.push({
        type: "unlabeled_button",
        severity: "warning",
        priority: 4,
        title: `${unlabeledCount} icon-only button(s) without accessible label`,
        description:
          "Buttons with only icons and no text, aria-label, or title attribute are inaccessible to screen readers",
      });
    }

    // =========================================================================
    // 20. Small touch targets — interactive elements < 44x44px
    // =========================================================================
    const touchTargets = Array.from(
      document.querySelectorAll("a, button, input, select, [role='button']")
    );
    let smallTargetCount = 0;
    for (const el of touchTargets.slice(0, 50)) {
      const rect = el.getBoundingClientRect();
      if (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.width < 24 &&
        rect.height < 24
      ) {
        smallTargetCount++;
      }
    }
    if (smallTargetCount > 0) {
      found.push({
        type: "small_touch_target",
        severity: "warning",
        priority: 4,
        title: `${smallTargetCount} interactive element(s) smaller than 24x24px`,
        description:
          "Small touch targets are difficult to tap on mobile devices (WCAG recommends minimum 44x44px)",
      });
    }

    return found;
  });

  for (const r of results) {
    issues.push({
      type: r.type as PageHealthIssue["type"],
      severity: r.severity as "error" | "warning",
      priority: r.priority,
      title: r.title,
      description: r.description,
    });
  }

  return issues;
}
