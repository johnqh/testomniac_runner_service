import type { TestAction, TestCase, SizeClass } from "../domain/types";
import { assignSuiteTags } from "./suite-tagger";

export interface GeneratedTestCase {
  testCase: TestCase;
  actions: TestAction[];
}

interface RenderInput {
  pageId: number;
  pageName: string;
  url: string;
  sizeClass: SizeClass;
  priority: string;
  elements: Array<{
    selector: string;
    accessibleName?: string;
    visible: boolean;
  }>;
}

export function generateRenderTest(input: RenderInput): GeneratedTestCase {
  const actions: TestAction[] = [
    { action: "navigate", url: input.url },
    { action: "waitForLoad" },
  ];
  for (const el of input.elements.filter(e => e.visible).slice(0, 10)) {
    actions.push({ action: "assertVisible", selector: el.selector });
  }
  actions.push({
    action: "screenshot",
    label: `render-${input.pageName.toLowerCase().replace(/\s+/g, "-")}`,
  });
  return {
    testCase: {
      name: `Render — ${input.pageName}`,
      type: "render",
      sizeClass: input.sizeClass,
      suite_tags: assignSuiteTags("render", input.priority),
      page_id: input.pageId,
      priority: input.priority,
    },
    actions,
  };
}
