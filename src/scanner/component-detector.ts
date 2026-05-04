import { createHash } from "node:crypto";
import { normalizeHtml } from "../browser/page-utils";
import type { BrowserAdapter } from "../adapter";
import type { HtmlComponentType } from "@sudobility/testomniac_types";

export const COMPONENT_SELECTORS = [
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="search"]',
  '[role="complementary"]',
];

export const COMPONENT_TYPE_SELECTORS: Record<HtmlComponentType, string[]> = {
  topMenu: [
    "header nav",
    'nav[aria-label*="main" i]',
    'nav[aria-label*="primary" i]',
    '[role="banner"] nav',
    ".navbar",
    ".top-nav",
    "#main-nav",
    "header",
  ],
  footer: ["footer", '[role="contentinfo"]', ".footer", "#footer"],
  breadcrumb: [
    'nav[aria-label*="breadcrumb" i]',
    '[aria-label="breadcrumb"]',
    ".breadcrumb",
    "nav.breadcrumb",
    "ol.breadcrumb",
  ],
  leftMenu: [
    "aside nav",
    ".sidebar nav",
    ".side-nav",
    '[role="complementary"] nav',
    ".left-menu",
  ],
  hamburgerMenu: [
    ".hamburger-menu",
    ".mobile-menu",
    ".offcanvas",
    '[data-toggle="offcanvas"]',
    ".drawer",
    ".mobile-nav",
  ],
  rightSidebar: [
    ".sidebar-right",
    ".right-panel",
    '[class*="right-sidebar"]',
    ".aside-content",
  ],
  searchBar: [
    'form[role="search"]',
    '[aria-label*="search" i]',
    ".search-form",
    ".search-bar",
  ],
  userMenu: [
    ".user-menu",
    ".avatar-menu",
    '[aria-label*="account" i]',
    '[aria-label*="profile" i]',
    ".user-dropdown",
  ],
  cookieBanner: [
    ".cookie-banner",
    ".cookie-consent",
    "#cookie-notice",
    '[class*="cookie"]',
    '[class*="consent"]',
    ".gdpr-banner",
  ],
  chatWidget: [
    ".chat-widget",
    "#intercom-container",
    ".drift-widget",
    '[class*="chat-bot"]',
    "#hubspot-messages-iframe-container",
  ],
  socialLinks: [".social-links", '[class*="social-media"]', ".social-icons"],
  skipNav: [
    ".skip-nav",
    ".skip-to-content",
    'a[href="#main-content"]',
    'a[href="#content"]',
    ".skip-link",
  ],
  languageSwitcher: [
    ".language-switcher",
    ".lang-select",
    '[class*="locale-switcher"]',
    '[aria-label*="language" i]',
    ".language-selector",
  ],
  announcementBar: [
    ".announcement-bar",
    ".promo-bar",
    ".top-banner",
    '[class*="announcement"]',
    ".site-notice",
  ],
  backToTop: [
    ".back-to-top",
    "#back-to-top",
    ".scroll-to-top",
    '[aria-label*="back to top" i]',
    '[class*="scroll-top"]',
  ],
};

export interface DetectedScaffoldRegion {
  type: HtmlComponentType;
  selector: string;
  outerHtml: string;
  hash: string;
}

export async function detectScaffoldRegions(
  adapter: BrowserAdapter
): Promise<DetectedScaffoldRegion[]> {
  const typeEntries = Object.entries(COMPONENT_TYPE_SELECTORS) as Array<
    [HtmlComponentType, string[]]
  >;

  const results = await adapter.evaluate((...args: unknown[]) => {
    const entries = args[0] as Array<[string, string[]]>;
    const detected: Array<{
      type: string;
      selector: string;
      outerHtml: string;
    }> = [];
    const seen = new Set<Element>();

    for (const [type, selectors] of entries) {
      for (const sel of selectors) {
        try {
          const el = document.querySelector(sel);
          if (el && !seen.has(el) && (el as HTMLElement).offsetWidth > 0) {
            seen.add(el);
            detected.push({
              type,
              selector: sel,
              outerHtml: el.outerHTML,
            });
            break; // one match per type
          }
        } catch {
          // Invalid selector
        }
      }
    }
    return detected;
  }, typeEntries);

  const regions = (
    results as Array<{ type: string; selector: string; outerHtml: string }>
  ).map(r => ({
    type: r.type as HtmlComponentType,
    selector: r.selector,
    outerHtml: r.outerHtml,
    hash: sha256(normalizeHtml(r.outerHtml)),
  }));

  return regions;
}

export interface CandidateRegion {
  pageStateId: number;
  selector: string;
  innerHtml: string;
  hash: string;
}

export interface ComponentGroup {
  selector: string;
  hash: string;
  instances: Array<{ pageStateId: number }>;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export function extractCandidateRegions(
  html: string
): Array<{ selector: string; innerHtml: string }> {
  const results: Array<{ selector: string; innerHtml: string }> = [];
  for (const selector of COMPONENT_SELECTORS) {
    const tagName = selector.replace(/\[.*\]/, "").trim();
    if (tagName && !tagName.startsWith("[")) {
      const pattern = new RegExp(
        `<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`,
        "gi"
      );
      let match;
      while ((match = pattern.exec(html)) !== null) {
        results.push({ selector: tagName, innerHtml: match[1].trim() });
      }
    }
    if (selector.startsWith("[role=")) {
      const role = selector.match(/role="([^"]+)"/)?.[1];
      if (role) {
        const rolePattern = new RegExp(
          `<\\w+[^>]*role=["']${role}["'][^>]*>([\\s\\S]*?)<\\/\\w+>`,
          "gi"
        );
        let match;
        while ((match = rolePattern.exec(html)) !== null) {
          results.push({ selector, innerHtml: match[1].trim() });
        }
      }
    }
  }
  return results;
}

export function hashRegion(innerHtml: string): string {
  return sha256(normalizeHtml(innerHtml));
}

export function groupByHash(regions: CandidateRegion[]): ComponentGroup[] {
  const groups = new Map<string, ComponentGroup>();
  for (const region of regions) {
    const key = `${region.selector}:${region.hash}`;
    if (!groups.has(key)) {
      groups.set(key, {
        selector: region.selector,
        hash: region.hash,
        instances: [],
      });
    }
    groups.get(key)!.instances.push({ pageStateId: region.pageStateId });
  }
  return [...groups.values()];
}

export interface DetectedComponent {
  name: string;
  selector: string;
  hash: string;
  canonicalPageStateId: number;
  instances: Array<{
    pageStateId: number;
    isIdentical: boolean;
    hash: string;
  }>;
}

export function detectComponents(
  allRegions: CandidateRegion[]
): DetectedComponent[] {
  const bySelector = new Map<string, CandidateRegion[]>();
  for (const r of allRegions) {
    if (!bySelector.has(r.selector)) bySelector.set(r.selector, []);
    bySelector.get(r.selector)!.push(r);
  }

  const components: DetectedComponent[] = [];

  for (const [selector, regions] of bySelector) {
    if (regions.length < 2) continue;
    const groups = groupByHash(regions);
    let canonicalGroup = groups[0];
    for (const g of groups) {
      if (g.instances.length > canonicalGroup.instances.length)
        canonicalGroup = g;
    }

    const name = selector.replace(/[[\]"'=]/g, "").replace(/^\./, "");
    const allInstances: DetectedComponent["instances"] = [];
    for (const group of groups) {
      for (const inst of group.instances) {
        allInstances.push({
          pageStateId: inst.pageStateId,
          isIdentical: group.hash === canonicalGroup.hash,
          hash: group.hash,
        });
      }
    }

    components.push({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      selector,
      hash: canonicalGroup.hash,
      canonicalPageStateId: canonicalGroup.instances[0].pageStateId,
      instances: allInstances,
    });
  }

  return components;
}
