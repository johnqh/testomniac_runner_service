import { describe, expect, it } from "vitest";
import type { ActionableItem } from "@sudobility/testomniac_types";
import { PageAnalyzer } from ".";

function createItem(
  selector: string,
  overrides: Partial<ActionableItem> = {}
): ActionableItem {
  return {
    stableKey: selector,
    selector,
    tagName: "A",
    actionKind: "navigate",
    accessibleName: "Product tile",
    textContent: "Product tile",
    href: "/product",
    disabled: false,
    visible: true,
    attributes: {},
    ...overrides,
  };
}

describe("PageAnalyzer repeated item selection", () => {
  it("dedupes repeated container items by style but preserves distinct CTA styles", () => {
    const analyzer = new PageAnalyzer() as any;
    const items: ActionableItem[] = [
      createItem("[data-tmnc-id='1']", {
        actionKind: "click",
        accessibleName: "ADD TO CART",
        textContent: "ADD TO CART",
        attributes: {
          _containerFingerprint:
            "product-card|price|img|add to cart|checkout now",
          _containerCtaStyle: "add to cart|checkout now",
        },
      }),
      createItem("[data-tmnc-id='2']", {
        actionKind: "click",
        accessibleName: "ADD TO CART",
        textContent: "ADD TO CART",
        attributes: {
          _containerFingerprint:
            "product-card|price|img|add to cart|checkout now",
          _containerCtaStyle: "add to cart|checkout now",
        },
      }),
      createItem("[data-tmnc-id='3']", {
        actionKind: "click",
        accessibleName: "Login for Pricing",
        textContent: "Login for Pricing",
        attributes: {
          _containerFingerprint: "product-card|no-price|img|login for pricing",
          _containerCtaStyle: "login for pricing",
        },
      }),
      createItem("[data-tmnc-id='4']", {
        actionKind: "click",
        accessibleName: "Select Options",
        textContent: "Select Options",
        attributes: {
          _containerFingerprint: "product-card|price|img|select options",
          _containerCtaStyle: "select options",
        },
      }),
    ];

    const selected = analyzer.selectRepresentativeItems(items);

    expect(selected).toHaveLength(3);
    expect(
      selected.some(
        (item: ActionableItem) => item.textContent === "ADD TO CART"
      )
    ).toBe(true);
    expect(
      selected.some(
        (item: ActionableItem) => item.textContent === "Login for Pricing"
      )
    ).toBe(true);
    expect(
      selected.some(
        (item: ActionableItem) => item.textContent === "Select Options"
      )
    ).toBe(true);
  });

  it("preserves one tile click representative alongside one CTA representative for the same repeated container style", () => {
    const analyzer = new PageAnalyzer() as any;
    const items: ActionableItem[] = [
      createItem("[data-tmnc-id='tile-1']", {
        actionKind: "navigate",
        accessibleName: "DNK Yellow Shoes",
        textContent: "DNK Yellow Shoes",
        href: "/product/dnk-yellow-shoes",
        attributes: {
          _containerFingerprint:
            "product-card|price|img|add to cart|checkout now",
          _containerTitle: "DNK Yellow Shoes",
          _sourceHints: "exact-target",
        },
      }),
      createItem("[data-tmnc-id='tile-2']", {
        actionKind: "click",
        accessibleName: "Product tile",
        textContent: "DNK Yellow Shoes",
        attributes: {
          _containerFingerprint:
            "product-card|price|img|add to cart|checkout now",
          _containerTitle: "DNK Yellow Shoes",
          _sourceHints: "promoted-target",
        },
      }),
      createItem("[data-tmnc-id='cta-1']", {
        actionKind: "click",
        accessibleName: "ADD TO CART",
        textContent: "ADD TO CART",
        attributes: {
          _containerFingerprint:
            "product-card|price|img|add to cart|checkout now",
          _containerTitle: "DNK Yellow Shoes",
          _sourceHints: "exact-target",
        },
      }),
      createItem("[data-tmnc-id='tile-3']", {
        actionKind: "navigate",
        accessibleName: "Dark Grey Jeans",
        textContent: "Dark Grey Jeans",
        href: "/product/dark-grey-jeans",
        attributes: {
          _containerFingerprint:
            "product-card|price|img|add to cart|checkout now",
          _containerTitle: "Dark Grey Jeans",
          _sourceHints: "exact-target",
        },
      }),
    ];

    const selected = analyzer.selectRepresentativeItems(items);

    expect(selected).toHaveLength(2);
    expect(
      selected.some((item: ActionableItem) =>
        String(item.attributes?._sourceHints).includes("promoted-target")
      )
    ).toBe(true);
    expect(
      selected.some(
        (item: ActionableItem) => item.textContent === "ADD TO CART"
      )
    ).toBe(true);
  });

  // Tests for getScaffoldSurfaceItems removed — method moved to testomniac_api generators.

  it("caps per action style when many different containers share the same CTA", () => {
    const analyzer = new PageAnalyzer() as any;
    // Simulate a product grid where each card has a unique fingerprint
    // (different title shape) but the same "ADD TO CART" CTA
    const items: ActionableItem[] = Array.from({ length: 8 }, (_, i) =>
      createItem(`[data-tmnc-id='card-${i}']`, {
        actionKind: "click",
        accessibleName: "ADD TO CART",
        textContent: "ADD TO CART",
        attributes: {
          _containerFingerprint: `product-card-${i}|price|img|add to cart`,
        },
      })
    );

    const selected = analyzer.selectRepresentativeItems(items);

    // 8 different fingerprints each produce 1 representative, but the
    // per-style cap (2) collapses them to at most 2
    expect(selected).toHaveLength(2);
    expect(
      selected.every(
        (item: ActionableItem) => item.textContent === "ADD TO CART"
      )
    ).toBe(true);
  });

  it("caps items without container fingerprints by action style", () => {
    const analyzer = new PageAnalyzer() as any;
    // Simulate product grid links that lack _containerFingerprint
    // (container detection missed the grid)
    const items: ActionableItem[] = Array.from({ length: 10 }, (_, i) =>
      createItem(`[data-tmnc-id='product-${i}']`, {
        actionKind: "navigate",
        accessibleName: `Product ${i}`,
        textContent: `Product ${i}`,
        href: `/product/${i}`,
        attributes: {},
      })
    );

    const selected = analyzer.selectRepresentativeItems(items);

    // Without fingerprints, items previously bypassed the cap.
    // Now they should be capped to MAX_REPS_PER_STYLE (2).
    expect(selected).toHaveLength(2);
  });
});
