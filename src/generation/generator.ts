import { generateRenderTest, type GeneratedTestCase } from "./render";
import { assignPriority } from "./suite-tagger";
import type { SizeClass } from "../domain/types";
import type { ApiClient } from "../api/client";

export interface GeneratorOptions {
  appId: number;
  runId: number;
  sizeClass: SizeClass;
  api: ApiClient;
}

export async function generateTestCases(
  options: GeneratorOptions
): Promise<GeneratedTestCase[]> {
  const { appId, sizeClass, api } = options;
  const results: GeneratedTestCase[] = [];
  const allPages = await api.getPagesByApp(appId);

  for (const page of allPages) {
    const priority = assignPriority(page.routeKey || "", page.url);
    results.push(
      generateRenderTest({
        pageId: page.id,
        pageName: page.routeKey || page.url,
        url: page.url,
        sizeClass,
        priority,
        elements: [],
      })
    );
  }

  return results;
}
