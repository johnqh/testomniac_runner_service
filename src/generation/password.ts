import type { TestAction, SizeClass } from "../domain/types";
import type { GeneratedTestCase } from "./render";

export interface PasswordTestCase {
  password: string;
  description: string;
  shouldFail: boolean;
}

interface PasswordTestInput {
  pageName: string;
  url: string;
  sizeClass: SizeClass;
  emailSelector: string;
  passwordSelector: string;
  submitSelector?: string;
  emailValue: string;
  passwordCases: PasswordTestCase[];
}

export function generatePasswordTests(
  input: PasswordTestInput
): GeneratedTestCase[] {
  const sorted = [...input.passwordCases].sort((a, b) => {
    if (a.shouldFail && !b.shouldFail) return -1;
    if (!a.shouldFail && b.shouldFail) return 1;
    return 0;
  });

  return sorted.map(pc => {
    const actions: TestAction[] = [
      { action: "navigate", url: input.url },
      { action: "waitForLoad" },
      {
        action: "fill",
        selector: input.emailSelector,
        value: input.emailValue,
      },
      { action: "fill", selector: input.passwordSelector, value: pc.password },
    ];

    if (input.submitSelector) {
      actions.push({ action: "click", selector: input.submitSelector });
    }

    if (pc.shouldFail) {
      actions.push({
        action: "assertUrl",
        pattern: new URL(input.url).pathname,
      });
    } else {
      actions.push({ action: "waitForNavigation" });
      actions.push({ action: "assertUrlChanged" });
    }

    return {
      testCase: {
        name: `Password ${pc.shouldFail ? "Fail" : "Pass"} — ${input.pageName} (${pc.description})`,
        type: "form" as const,
        sizeClass: input.sizeClass,
        suite_tags: ["regression"],
        priority: "high",
      },
      actions,
    };
  });
}
