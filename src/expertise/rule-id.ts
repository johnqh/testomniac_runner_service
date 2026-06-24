import type { ExpertiseRuleId } from "@sudobility/testomniac_types";
import type { Outcome } from "./types";

export function applyRuleIds(
  outcomes: Outcome[],
  ruleIdsByExpected: Readonly<Record<string, ExpertiseRuleId>>
): Outcome[] {
  return outcomes.map(outcome => ({
    ...outcome,
    ruleId: outcome.ruleId ?? ruleIdsByExpected[outcome.expected],
  }));
}
