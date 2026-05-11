import { describe, expect, it } from "vitest";
import type { ActionableItem } from "@sudobility/testomniac_types";
import { PageAnalyzer } from ".";
import type { DetectedScaffoldRegion } from "../../scanner/component-detector";

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

  it("limits scaffold surface items to the current scaffold selector", () => {
    const analyzer = new PageAnalyzer() as any;
    const headerScaffold: DetectedScaffoldRegion = {
      type: "header",
      selector: "#site-header",
      outerHtml: "<header id='site-header'></header>",
      hash: "header-hash",
    };
    const sidebarScaffold: DetectedScaffoldRegion = {
      type: "sidebar",
      selector: "#site-sidebar",
      outerHtml: "<aside id='site-sidebar'></aside>",
      hash: "sidebar-hash",
    };
    const headerItem = createItem("[data-tmnc-id='header-cart']", {
      actionKind: "click",
      textContent: "Cart",
      attributes: {
        _containerFingerprint: "header-cart",
      },
    });
    const sidebarItem = createItem("[data-tmnc-id='sidebar-search']", {
      actionKind: "fill",
      textContent: "Search",
      attributes: {
        _containerFingerprint: "sidebar-search",
      },
    });

    const context = {
      actionableItems: [headerItem, sidebarItem],
      scaffoldSelectorByItemSelector: {
        [headerItem.selector as string]: headerScaffold.selector,
        [sidebarItem.selector as string]: sidebarScaffold.selector,
      },
    };

    const headerItems = analyzer.getScaffoldSurfaceItems(
      context,
      headerScaffold
    );
    const sidebarItems = analyzer.getScaffoldSurfaceItems(
      context,
      sidebarScaffold
    );

    expect(headerItems).toHaveLength(1);
    expect(headerItems[0]?.selector).toBe(headerItem.selector);
    expect(sidebarItems).toHaveLength(1);
    expect(sidebarItems[0]?.selector).toBe(sidebarItem.selector);
  });

  it("dedupes repeated items within a single scaffold after scoping to that scaffold", () => {
    const analyzer = new PageAnalyzer() as any;
    const sidebarScaffold: DetectedScaffoldRegion = {
      type: "sidebar",
      selector: "#site-sidebar",
      outerHtml: "<aside id='site-sidebar'></aside>",
      hash: "sidebar-hash",
    };
    const repeatedSidebarItems: ActionableItem[] = [
      createItem("[data-tmnc-id='sidebar-item-1']", {
        actionKind: "click",
        accessibleName: "ADD TO CART",
        textContent: "ADD TO CART",
        attributes: {
          _containerFingerprint: "sidebar-card|price|img|add to cart",
        },
      }),
      createItem("[data-tmnc-id='sidebar-item-2']", {
        actionKind: "click",
        accessibleName: "ADD TO CART",
        textContent: "ADD TO CART",
        attributes: {
          _containerFingerprint: "sidebar-card|price|img|add to cart",
        },
      }),
      createItem("[data-tmnc-id='content-item']", {
        actionKind: "click",
        accessibleName: "ADD TO CART",
        textContent: "ADD TO CART",
        attributes: {
          _containerFingerprint: "content-card|price|img|add to cart",
        },
      }),
    ];
    const context = {
      actionableItems: repeatedSidebarItems,
      scaffoldSelectorByItemSelector: {
        "[data-tmnc-id='sidebar-item-1']": sidebarScaffold.selector,
        "[data-tmnc-id='sidebar-item-2']": sidebarScaffold.selector,
      },
    };

    const scoped = analyzer.getScaffoldSurfaceItems(context, sidebarScaffold);
    const selected = analyzer.selectRepresentativeItems(scoped);

    expect(scoped).toHaveLength(2);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.selector).toBe("[data-tmnc-id='sidebar-item-1']");
  });
});
