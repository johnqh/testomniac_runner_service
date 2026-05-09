import type { LegacyTestAction, SizeClass } from "../domain/types";
import type { LegacyGeneratedTestElement } from "./render";
import { assignSurfaceTags } from "./surface-tagger";

interface E2EStep {
  pageName: string;
  url: string;
  triggerSelector?: string;
}

interface E2EInput {
  sizeClass: SizeClass;
  steps: E2EStep[];
}

export function generateE2ETest(input: E2EInput): LegacyGeneratedTestElement {
  const actions: LegacyTestAction[] = [
    { action: "navigate", url: input.steps[0].url },
    { action: "waitForLoad" },
  ];
  for (let i = 0; i < input.steps.length - 1; i++) {
    const from = input.steps[i];
    const to = input.steps[i + 1];
    actions.push({
      action: "step",
      label: `Step ${i + 1}: ${from.pageName} → ${to.pageName}`,
    });
    if (from.triggerSelector) {
      actions.push({ action: "click", selector: from.triggerSelector });
    } else {
      actions.push({ action: "navigate", url: to.url });
    }
    actions.push({ action: "assertUrl", pattern: new URL(to.url).pathname });
  }
  const scenarioName = input.steps.map(s => s.pageName).join(" → ");
  return {
    testElement: {
      name: `E2E — ${scenarioName}`,
      type: "e2e",
      sizeClass: input.sizeClass,
      surface_tags: assignSurfaceTags("e2e", "high"),
      priority: "high",
    },
    actions,
  };
}

export function enumerateE2EPaths(
  adjacency: Map<number, number[]>,
  maxDepth: number = 6,
  maxPaths: number = 20
): number[][] {
  const allPaths: number[][] = [];
  function dfs(current: number, path: number[]): void {
    if (allPaths.length >= maxPaths) return;
    if (path.length >= 3) {
      allPaths.push([...path]);
      if (path.length >= maxDepth) return;
    }
    for (const neighbor of adjacency.get(current) || []) {
      if (!path.includes(neighbor)) {
        path.push(neighbor);
        dfs(neighbor, path);
        path.pop();
      }
    }
  }
  for (const node of adjacency.keys()) {
    if (allPaths.length >= maxPaths) break;
    dfs(node, [node]);
  }
  return allPaths;
}
