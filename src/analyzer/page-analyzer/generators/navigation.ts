import type { BatchTestInteractionItem } from "@sudobility/testomniac_types";
import type { AnalyzerContext } from "../types";

/**
 * Create direct navigation interactions for same-origin links discovered on
 * the current page.  These are placed in the "Direct Navigations" surface
 * which runs as execution group 0 (before hover/content interactions), so
 * discovered pages get short dependency chains.
 *
 * Navigation interactions never have a dependencyTestInteractionId — they
 * navigate directly via goto.
 *
 * Items are deduplicated by relative path.  Action URLs (add-to-cart, etc.)
 * are not navigated directly but their base page path is discovered.
 */
export async function generateNavigationTestInteractions(
  analyzer: any,
  context: AnalyzerContext
): Promise<void> {
  const { api, runnerId, testEnvironmentId, sizeClass, uid, bundleRun } =
    context;

  // Only generate for discovery runs that have a navigation surface
  if (!context.navigationSurface || !bundleRun) return;

  const navSurfaceId = context.navigationSurface.id;

  // Filter to navigation items with valid same-origin hrefs
  const navItems = context.actionableItems.filter(item => {
    if (item.actionKind !== "navigate" || !item.href) return false;
    // Skip anchors, mailto, tel, javascript
    if (
      item.href === "#" ||
      item.href.startsWith("#") ||
      item.href.startsWith("mailto:") ||
      item.href.startsWith("tel:") ||
      item.href.startsWith("javascript:")
    ) {
      return false;
    }
    // Skip absolute URLs pointing to external domains.  Relative paths
    // (e.g. "/intent/tweet") are kept — if the site links to a relative
    // path that 404s, that is a genuine broken-link bug.
    if (isExternalAbsoluteUrl(item.href, context.siteOrigin)) return false;
    const path = extractRelativePath(item.href);
    if (!path) return false;
    // Skip current page
    if (path === context.currentPath) return false;
    // Skip paths outside the scan scope boundary
    if (context.scanScopePath && !path.startsWith(context.scanScopePath)) {
      return false;
    }
    return true;
  });

  if (navItems.length === 0) return;

  // Deduplicate navigation targets:
  // - Every unique base path (pathname without query string) is navigated
  //   so that all distinct pages are discovered.
  // - Query-string variants of the same base path are capped at
  //   MAX_QUERY_VARIANTS to avoid exploding on filter/sort/pagination links.
  const MAX_QUERY_VARIANTS = 2;

  const seenPaths = new Set<string>();
  seenPaths.add(context.currentPath);

  // Track how many query-string variants we've accepted per base path
  const queryVariantCounts = new Map<string, number>();

  const navPaths: string[] = [];
  for (const item of navItems) {
    const path = extractRelativePath(item.href!);
    if (!path || seenPaths.has(path)) continue;

    // For action URLs (e.g. /my-cart/?ec_action=addtocart), don't
    // navigate to the action URL itself (which triggers side effects),
    // but DO discover the base page path (e.g. /my-cart/).
    if (isActionUrl(path)) {
      const basePath = extractBasePath(path);
      if (basePath && basePath !== "/" && !seenPaths.has(basePath)) {
        seenPaths.add(basePath);
        navPaths.push(basePath);
      }
      continue;
    }

    const basePath = extractBasePath(path);
    const hasQuery = path.includes("?");

    if (hasQuery && basePath) {
      // Always ensure the base path itself is queued first
      if (!seenPaths.has(basePath)) {
        seenPaths.add(basePath);
        navPaths.push(basePath);
      }
      // Cap query-string variants per base path
      const count = queryVariantCounts.get(basePath) ?? 0;
      if (count >= MAX_QUERY_VARIANTS) continue;
      queryVariantCounts.set(basePath, count + 1);
    }

    seenPaths.add(path);
    navPaths.push(path);
  }

  if (navPaths.length === 0) return;

  // Get the open surface run for Direct Navigations
  const surfaceRuns = await api.getOpenTestSurfaceRuns(bundleRun.id);
  const navSurfaceRun = surfaceRuns.find(
    (sr: { testSurfaceId: number }) => sr.testSurfaceId === navSurfaceId
  );
  if (!navSurfaceRun) return;

  const batchItems: BatchTestInteractionItem[] = [];
  for (const path of navPaths) {
    const navInteraction = analyzer.buildNavigationTestInteraction(
      path,
      sizeClass,
      uid
    );
    batchItems.push({
      runnerId,
      testSurfaceId: navSurfaceId,
      testInteraction: navInteraction,
      testEnvironmentId,
      testSurfaceRunId: navSurfaceRun.id,
    });
  }
  if (batchItems.length > 0) {
    await api.ensureTestInteractionBatch(batchItems);
  }

  // Do NOT reconcile — other navigation interactions (from hover-click
  // discovery or scan bootstrap) should not be retired.
}

/**
 * Returns true when href is an absolute URL pointing to a different origin
 * than the current site.  Relative paths like "/intent/tweet" return false
 * (they should be tested — if the site links to them, a 404 is a real bug).
 */
function isExternalAbsoluteUrl(
  href: string,
  siteOrigin: string | undefined
): boolean {
  if (!/^https?:\/\//i.test(href)) return false;
  try {
    const parsed = new URL(href);
    if (!siteOrigin) return true;
    return parsed.origin !== new URL(siteOrigin).origin;
  } catch {
    return false;
  }
}

function extractRelativePath(href: string): string | null {
  try {
    const url = new URL(href, "http://placeholder");
    return url.pathname + url.search;
  } catch {
    return null;
  }
}

/**
 * Detect URLs that trigger server-side actions (add to cart, delete, etc.)
 * rather than navigating to a viewable page.
 */
function isActionUrl(path: string): boolean {
  return /[?&](ec_action|action|add_to_cart|remove|delete)=/i.test(path);
}

/**
 * Extract the base page path from an action URL by stripping the query string.
 * e.g. "/my-cart/?ec_action=addtocart&model_number=123" → "/my-cart/"
 */
function extractBasePath(path: string): string | null {
  try {
    const url = new URL(path, "http://placeholder");
    const base = url.pathname;
    return base || null;
  } catch {
    return null;
  }
}
