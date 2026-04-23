import type { ApiClient } from "../api/client";
import type { ScanConfig } from "./types";
import { generateTestCases } from "../generation/generator";
import type { SizeClass } from "../domain/types";

export async function runTestGenerationPhase(
  config: ScanConfig,
  api: ApiClient
): Promise<void> {
  const sizeClass = (config.sizeClass || "desktop") as SizeClass;

  const generated = await generateTestCases({
    appId: config.appId,
    runId: config.runId,
    sizeClass,
    api,
  });

  for (const { testCase } of generated) {
    await api.insertTestCase(config.appId, testCase);
  }
}
