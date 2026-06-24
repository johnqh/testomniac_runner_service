import {
  ExpectationSeverity,
  type ExpertiseRuleId,
} from "@sudobility/testomniac_types";
import type { PageHealthIssue } from "../scanner/page-health-evaluator";
import type { Outcome } from "./types";

export function outcomesFromPageHealth(
  issues: PageHealthIssue[] | undefined,
  ruleIdsByType: Readonly<
    Partial<Record<PageHealthIssue["type"], ExpertiseRuleId>>
  >
): Outcome[] {
  return (issues ?? [])
    .filter(issue => ruleIdsByType[issue.type])
    .map(issue => ({
      ruleId: ruleIdsByType[issue.type],
      expected: issue.title,
      observed: issue.description,
      result: issue.severity,
      severity:
        issue.severity === "error"
          ? ExpectationSeverity.MustPass
          : ExpectationSeverity.ShouldPass,
      priority: issue.priority,
    }));
}
