import type { AnalyzerContext } from "../types";

export async function generateNavigationTestInteractions(
  _analyzer: any,
  _context: AnalyzerContext
): Promise<void> {
  // Navigation surface is managed externally (scan bootstrap + auto-created
  // navigations from hover-click discovery). Do not reconcile — reconciling
  // with desiredKeys: [] would retire auto-created navigation interactions
  // before the runner can execute them.
}
