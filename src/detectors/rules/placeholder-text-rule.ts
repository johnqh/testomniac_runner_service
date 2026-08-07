import type {
  DetectionRule,
  DetectionContext,
  DetectedIssue,
} from "../detection-rule.js";

const PLACEHOLDER_PATTERNS = [
  /lorem ipsum/i,
  /dolor sit amet/i,
  /placeholder text/i,
  /todo[:\s]/i,
  /fixme[:\s]/i,
  /your (?:name|email|text) here/i,
  /example\.com/i,
  /test@test/i,
  /foo\s*bar/i,
];

export const placeholderTextRule: DetectionRule = {
  name: "placeholder_text",
  severity: "warning",

  async detect(context: DetectionContext): Promise<DetectedIssue[]> {
    const { visibleText, currentActionChain } = context;

    for (const pattern of PLACEHOLDER_PATTERNS) {
      if (pattern.test(visibleText)) {
        return [
          {
            severity: "warning",
            ruleName: "placeholder_text",
            title: `Placeholder text detected`,
            expectedOutcome:
              "Page should not contain placeholder or dummy text",
            observedOutcome: `Placeholder text detected: matches "${pattern.source}"`,
            actionChain: currentActionChain.map(a => a.id),
          },
        ];
      }
    }

    return [];
  },
};
