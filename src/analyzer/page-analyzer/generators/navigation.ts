import type { AnalyzerContext } from "../types";

/**
 * Create direct navigation interactions for same-origin links discovered on
 * the current page.  These are placed in the "Direct Navigations" surface
 * which runs as execution group 0 (before hover/content interactions), so
 * discovered pages get short dependency chains.
 *
 * Navigation interactions never have a dependencyTestInteractionId — they
 * navigate directly via goto.
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

  // Collect unique same-origin relative paths from actionable navigation items
  const seenPaths = new Set<string>();
  seenPaths.add(context.currentPath); // skip the current page

  const navPaths: string[] = [];
  for (const item of context.actionableItems) {
    if (item.actionKind !== "navigate" || !item.href) continue;

    const relativePath = extractRelativePath(item.href);
    if (!relativePath || seenPaths.has(relativePath)) continue;
    // Skip external links, anchors, and non-http
    if (
      item.href.startsWith("mailto:") ||
      item.href.startsWith("tel:") ||
      item.href.startsWith("javascript:") ||
      item.href === "#" ||
      item.href.startsWith("#")
    ) {
      continue;
    }

    seenPaths.add(relativePath);
    navPaths.push(relativePath);
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

function extractRelativePath(href: string): string | null {
  try {
    const url = new URL(href, "http://placeholder");
    return url.pathname + url.search;
  } catch {
    return null;
  }
}
