import type { BrowserAdapter } from "../adapter";
import type { ApiClient } from "../api/client";
import type { ScanConfig, ScanEventHandler } from "./types";
import { generatePairwiseCombinations } from "../scanner/pairwise";
import { computeHashes } from "../browser/page-utils";
import { extractActionableItems } from "../extractors";
// fillValuePlanner will be used when we add smart input mapping
// import { fillValuePlanner } from "../planners/fill-value-planner";

export async function runInputScanningPhase(
  adapter: BrowserAdapter,
  config: ScanConfig,
  api: ApiClient,
  events: ScanEventHandler
): Promise<void> {
  const sizeClass = config.sizeClass || "desktop";
  const personas = await api.getPersonasByApp(config.appId);

  const pages = await api.getPagesByApp(config.appId);
  const formsToTest: Array<{
    pageUrl: string;
    pageId: number;
    pageStateId: number;
    fields: any[];
    submitSelector?: string;
  }> = [];

  for (const page of pages) {
    const states = await api.getPageStates(page.id);
    for (const state of states) {
      const stateForms = await api.getFormsByPageState(state.id);
      for (const form of stateForms) {
        const fields = form.fieldsJson as any[];
        if (fields && fields.length > 0) {
          formsToTest.push({
            pageUrl: page.url,
            pageId: page.id,
            pageStateId: state.id,
            fields,
            submitSelector: form.submitSelector || undefined,
          });
        }
      }
    }
  }

  for (const persona of personas) {
    const useCases = await api.getUseCasesByPersona(persona.id);

    for (const useCase of useCases) {
      const inputValues = await api.getInputValuesByUseCase(useCase.id);

      for (const form of formsToTest) {
        const discreteFields = form.fields.filter((f: any) =>
          ["checkbox", "radio", "select-one", "select"].includes(f.type)
        );
        const textFields = form.fields.filter(
          (f: any) =>
            !["checkbox", "radio", "select-one", "select"].includes(f.type)
        );

        // Generate pairwise combinations for discrete fields
        const factors = discreteFields.map((f: any) => ({
          name: f.name,
          values: f.options?.length ? f.options : ["on", "off"],
        }));

        const combinations =
          factors.length > 0 ? generatePairwiseCombinations(factors) : [{}];

        for (const combo of combinations) {
          try {
            // Navigate to form page
            await adapter.goto(form.pageUrl, {
              waitUntil: "networkidle0",
              timeout: 30_000,
            });

            // Fill text fields with persona-specific values
            for (const field of textFields) {
              const personaValue = inputValues.find(
                iv =>
                  iv.fieldSelector === field.selector ||
                  iv.fieldName === field.name
              );
              const value = personaValue?.value || "test";
              try {
                await adapter.type(field.selector, value);
              } catch {
                // Field not found
              }
            }

            // Set discrete controls from pairwise combo
            for (const field of discreteFields) {
              const value = (combo as Record<string, string>)[field.name];
              if (!value) continue;
              try {
                if (field.type === "checkbox" || field.type === "radio") {
                  await adapter.click(field.selector, { timeout: 2000 });
                } else {
                  await adapter.select(field.selector, value);
                }
              } catch {
                // Control not found
              }
            }

            // Submit form
            if (form.submitSelector) {
              try {
                await adapter.click(form.submitSelector, { timeout: 3000 });
                await new Promise(r => setTimeout(r, 2000));
              } catch {
                // Submit failed
              }
            }

            // Capture result state
            const html = await adapter.content();
            const items = await extractActionableItems(adapter);
            const hashes = await computeHashes(html, items);
            const currentUrl = await adapter.getUrl();

            const pageRecord = await api.findOrCreatePage(
              config.appId,
              currentUrl
            );
            const existing = await api.findMatchingPageState(
              pageRecord.id,
              hashes,
              sizeClass
            );

            if (!existing) {
              await adapter.screenshot({ type: "jpeg", quality: 72 });
              await api.createPageState({
                pageId: pageRecord.id,
                sizeClass,
                hashes,
                contentText: "",
              });
            }

            // Record fill action
            await api.createActionAndExecution(config.appId, config.runId, {
              type: "fill",
              startingPageStateId: form.pageStateId,
            });

            events.onActionCompleted({
              type: "fill",
              pageUrl: form.pageUrl,
            });
          } catch {
            // Combination failed, continue
          }
        }
      }
    }
  }
}
