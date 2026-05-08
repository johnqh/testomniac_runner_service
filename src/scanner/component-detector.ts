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

/**
 * Detect scaffold regions using CSS selectors first, then position/content
 * heuristics as a fallback for pages without semantic HTML or common classes.
 */
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
      method: string;
    }> = [];
    const seen = new Set<Element>();
    const foundTypes = new Set<string>();

    // ================================================================
    // Phase 1: CSS selector matching (existing logic)
    // ================================================================
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
              method: "selector",
            });
            foundTypes.add(type);
            break;
          }
        } catch {
          // Invalid selector
        }
      }
    }

    // ================================================================
    // Phase 2: Position & content heuristics for missing types
    // ================================================================

    function buildSelector(el: Element): string {
      if (el.id) return "#" + el.id;
      const tag = el.tagName.toLowerCase();
      const parent = el.parentElement;
      if (!parent) return tag;
      const siblings = Array.from(parent.children).filter(
        c => c.tagName === el.tagName
      );
      if (siblings.length === 1) {
        const parentSel = parent.id
          ? "#" + parent.id
          : parent.tagName.toLowerCase();
        return parentSel + " > " + tag;
      }
      const idx = siblings.indexOf(el);
      return (
        parent.tagName.toLowerCase() +
        " > " +
        tag +
        ":nth-of-type(" +
        (idx + 1) +
        ")"
      );
    }

    function countLinks(el: Element): number {
      return el.querySelectorAll("a[href]").length;
    }

    // --- topMenu heuristic ---
    if (!foundTypes.has("topMenu")) {
      const candidates = Array.from(document.body.querySelectorAll("*"));
      for (const el of candidates) {
        if (seen.has(el)) continue;
        const htmlEl = el as HTMLElement;
        const rect = htmlEl.getBoundingClientRect();
        if (rect.top > 150) break;
        if (rect.width < window.innerWidth * 0.8) continue;
        if (rect.height > 200 || rect.height < 20) continue;
        if (countLinks(el) < 3) continue;
        const style = window.getComputedStyle(htmlEl);
        const isSticky =
          style.position === "fixed" || style.position === "sticky";
        if (isSticky || rect.top < 10) {
          seen.add(el);
          detected.push({
            type: "topMenu",
            selector: buildSelector(el),
            outerHtml: el.outerHTML,
            method: "heuristic:position-top-links",
          });
          foundTypes.add("topMenu");
          break;
        }
      }
    }

    // --- footer heuristic ---
    if (!foundTypes.has("footer")) {
      const bodyChildren = Array.from(document.body.children);
      for (let i = bodyChildren.length - 1; i >= 0; i--) {
        const el = bodyChildren[i] as HTMLElement;
        if (seen.has(el) || !el.offsetWidth) continue;
        const rect = el.getBoundingClientRect();
        if (rect.width < window.innerWidth * 0.8) continue;
        const text = el.textContent || "";
        const hasCopyright = /\u00A9|copyright|all rights reserved|\d{4}/i.test(
          text
        );
        const hasLinks = countLinks(el) >= 2;
        if (hasCopyright || (hasLinks && rect.top > window.innerHeight * 0.5)) {
          seen.add(el);
          detected.push({
            type: "footer",
            selector: buildSelector(el),
            outerHtml: el.outerHTML,
            method: "heuristic:bottom-copyright",
          });
          foundTypes.add("footer");
          break;
        }
      }
    }

    // --- breadcrumb heuristic ---
    if (!foundTypes.has("breadcrumb")) {
      const allElements = Array.from(
        document.querySelectorAll("ol, ul, div, nav")
      );
      for (const el of allElements) {
        if (seen.has(el)) continue;
        const htmlEl = el as HTMLElement;
        const rect = htmlEl.getBoundingClientRect();
        if (rect.height > 60 || rect.width < 100) continue;
        if (rect.top > 400) continue;
        const links = el.querySelectorAll("a");
        if (links.length < 1 || links.length > 8) continue;
        const text = el.textContent || "";
        if (
          /[/\u203A\u00BB\u00B7\u2192>]/.test(text) ||
          el.querySelectorAll("li").length >= 2
        ) {
          seen.add(el);
          detected.push({
            type: "breadcrumb",
            selector: buildSelector(el),
            outerHtml: el.outerHTML,
            method: "heuristic:link-separators",
          });
          foundTypes.add("breadcrumb");
          break;
        }
      }
    }

    // --- searchBar heuristic ---
    if (!foundTypes.has("searchBar")) {
      const inputs = Array.from(
        document.querySelectorAll(
          'input[type="search"], input[placeholder*="search" i], input[name*="search" i], input[name*="query" i]'
        )
      );
      for (const input of inputs) {
        if (seen.has(input)) continue;
        const form = input.closest("form") || input.parentElement;
        if (form && (form as HTMLElement).offsetWidth > 0) {
          seen.add(form);
          detected.push({
            type: "searchBar",
            selector: buildSelector(form),
            outerHtml: form.outerHTML,
            method: "heuristic:search-input",
          });
          foundTypes.add("searchBar");
          break;
        }
      }
    }

    // --- hamburgerMenu heuristic ---
    if (!foundTypes.has("hamburgerMenu")) {
      const buttons = Array.from(
        document.querySelectorAll(
          'button[aria-expanded], button[aria-haspopup="menu"]'
        )
      );
      for (const btn of buttons) {
        if (seen.has(btn)) continue;
        const htmlBtn = btn as HTMLElement;
        const rect = htmlBtn.getBoundingClientRect();
        if (rect.top > 150) continue;
        const ariaLabel = (btn.getAttribute("aria-label") || "").toLowerCase();
        const isMenu = ariaLabel.includes("menu");
        const isResponsive = htmlBtn.closest(
          '[class*="lg:hidden"], [class*="md:hidden"]'
        );
        if (isMenu || isResponsive) {
          seen.add(btn);
          detected.push({
            type: "hamburgerMenu",
            selector: buildSelector(btn),
            outerHtml: btn.outerHTML,
            method: "heuristic:menu-button",
          });
          foundTypes.add("hamburgerMenu");
          break;
        }
      }
    }

    // --- languageSwitcher heuristic ---
    if (!foundTypes.has("languageSwitcher")) {
      const flagPattern = /[\u{1F1E0}-\u{1F1FF}]{2}/u;
      const langPattern =
        /\b(english|french|german|spanish|português|italiano)\b/i;
      const langCandidates = Array.from(
        document.querySelectorAll("button, select, [role='listbox']")
      );
      for (const el of langCandidates) {
        if (seen.has(el)) continue;
        const text = el.textContent || "";
        if (flagPattern.test(text) || langPattern.test(text)) {
          const container = el.parentElement || el;
          seen.add(container);
          detected.push({
            type: "languageSwitcher",
            selector: buildSelector(container),
            outerHtml: container.outerHTML,
            method: "heuristic:flag-or-lang-text",
          });
          foundTypes.add("languageSwitcher");
          break;
        }
      }
    }

    // --- skipNav heuristic ---
    if (!foundTypes.has("skipNav")) {
      const skipLinks = Array.from(document.querySelectorAll('a[href^="#"]'));
      for (const link of skipLinks) {
        const text = (link.textContent || "").toLowerCase();
        if (
          text.includes("skip") &&
          (text.includes("content") ||
            text.includes("main") ||
            text.includes("nav"))
        ) {
          seen.add(link);
          detected.push({
            type: "skipNav",
            selector: buildSelector(link),
            outerHtml: link.outerHTML,
            method: "heuristic:skip-link-text",
          });
          foundTypes.add("skipNav");
          break;
        }
      }
    }

    // --- userMenu heuristic ---
    if (!foundTypes.has("userMenu")) {
      const avatarCandidates = Array.from(
        document.querySelectorAll(
          'img[class*="avatar"], img[alt*="avatar" i], img[alt*="profile" i], [class*="avatar"], button[aria-label*="user" i]'
        )
      );
      for (const el of avatarCandidates) {
        if (seen.has(el)) continue;
        const container = el.closest("button, a, div") || el;
        if ((container as HTMLElement).offsetWidth > 0) {
          seen.add(container);
          detected.push({
            type: "userMenu",
            selector: buildSelector(container),
            outerHtml: container.outerHTML,
            method: "heuristic:avatar-or-user-label",
          });
          foundTypes.add("userMenu");
          break;
        }
      }
    }

    // --- cookieBanner heuristic ---
    if (!foundTypes.has("cookieBanner")) {
      const allEls = Array.from(document.querySelectorAll("*"));
      for (const el of allEls) {
        if (seen.has(el)) continue;
        const htmlEl = el as HTMLElement;
        const style = window.getComputedStyle(htmlEl);
        if (style.position !== "fixed" && style.position !== "sticky") continue;
        const rect = htmlEl.getBoundingClientRect();
        if (rect.top < window.innerHeight * 0.5) continue;
        const text = (el.textContent || "").toLowerCase();
        if (
          text.includes("cookie") ||
          text.includes("consent") ||
          text.includes("privacy")
        ) {
          seen.add(el);
          detected.push({
            type: "cookieBanner",
            selector: buildSelector(el),
            outerHtml: el.outerHTML,
            method: "heuristic:fixed-bottom-cookie-text",
          });
          foundTypes.add("cookieBanner");
          break;
        }
      }
    }

    return detected;
  }, typeEntries);

  const regions = (
    results as Array<{
      type: string;
      selector: string;
      outerHtml: string;
      method: string;
    }>
  ).map(r => ({
    type: r.type as HtmlComponentType,
    selector: r.selector + " [" + r.method + "]",
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
