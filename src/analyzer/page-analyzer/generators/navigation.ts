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
 * Items are passed through selectRepresentativeItems so that product grids
 * (18 product links with the same structure) produce only a few representative
 * navigations instead of one per product.
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
    // Skip action URLs (e.g. add-to-cart links with side effects)
    const path = extractRelativePath(item.href);
    if (!path) return false;
    if (isActionUrl(path)) return false;
    // Skip current page
    if (path === context.currentPath) return false;
    return true;
  });

  if (navItems.length === 0) return;

  // Apply representative-item dedup with a higher cap than hover/content
  // surfaces.  Navigation is for page discovery — we need enough variety
  // to catch bugs on different product pages and utility pages (cart,
  // account) while still avoiding 18× identical product navigations.
  const MAX_NAV_REPS_PER_STYLE = 5;
  const representative = analyzer.selectRepresentativeItems(
    navItems,
    MAX_NAV_REPS_PER_STYLE
  );

  // Deduplicate by relative path
  const seenPaths = new Set<string>();
  seenPaths.add(context.currentPath);

  const navPaths: string[] = [];
  for (const item of representative) {
    const path = extractRelativePath(item.href);
    if (!path || seenPaths.has(path)) continue;
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

  for (const path of navPaths) {
    const navInteraction = analyzer.buildNavigationTestInteraction(
      path,
      sizeClass,
      uid
    );
    const saved = await api.ensureTestInteraction(
      runnerId,
      navSurfaceId,
      navInteraction,
      testEnvironmentId
    );
    try {
      await api.createTestInteractionRun({
        testInteractionId: saved.id,
        testSurfaceRunId: navSurfaceRun.id,
      });
    } catch {
      // Run may already exist
    }
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
