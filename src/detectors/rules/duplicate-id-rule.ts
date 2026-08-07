import type {
  DetectionRule,
  DetectionContext,
  DetectedIssue,
} from "../detection-rule.js";

export const duplicateIdRule: DetectionRule = {
  name: "duplicate_id",
  severity: "warning",

  async detect(context: DetectionContext): Promise<DetectedIssue[]> {
    const { html, currentActionChain } = context;

    const idRegex = /\sid\s*=\s*"([^"]+)"/gi;
    const idCounts = new Map<string, number>();
    let match: RegExpExecArray | null;
    while ((match = idRegex.exec(html)) !== null) {
      const id = match[1];
      idCounts.set(id, (idCounts.get(id) || 0) + 1);
    }

    const duplicateIds: string[] = [];
    for (const [id, count] of idCounts) {
      if (count > 1) duplicateIds.push(id);
    }

    if (duplicateIds.length > 0) {
      return [
        {
          severity: "warning",
          ruleName: "duplicate_id",
          title: `${duplicateIds.length} duplicate element ID(s)`,
          expectedOutcome: "Each element ID should be unique in the document",
          observedOutcome: `${duplicateIds.length} duplicate element ID(s): ${duplicateIds.slice(0, 5).join(", ")}${duplicateIds.length > 5 ? "..." : ""}`,
          actionChain: currentActionChain.map(a => a.id),
        },
      ];
    }

    return [];
  },
};
