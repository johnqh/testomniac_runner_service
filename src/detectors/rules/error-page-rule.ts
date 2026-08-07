import type {
  DetectionRule,
  DetectionContext,
  DetectedIssue,
} from "../detection-rule.js";

const ERROR_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /404\s*(not found|error|page)/i, label: "404 Not Found" },
  { pattern: /500\s*(internal|server|error)/i, label: "500 Server Error" },
  {
    pattern: /503\s*(service|unavailable)/i,
    label: "503 Service Unavailable",
  },
  { pattern: /502\s*(bad gateway)/i, label: "502 Bad Gateway" },
  { pattern: /page\s*not\s*found/i, label: "Page Not Found" },
  { pattern: /server\s*error/i, label: "Server Error" },
  { pattern: /internal\s*server\s*error/i, label: "Internal Server Error" },
  { pattern: /access\s*denied/i, label: "Access Denied" },
  { pattern: /403\s*forbidden/i, label: "403 Forbidden" },
  { pattern: /something\s*went\s*wrong/i, label: "Something Went Wrong" },
  { pattern: /an?\s*error\s*(has\s*)?occurred/i, label: "Error Occurred" },
  { pattern: /application\s*error/i, label: "Application Error" },
];

export const errorPageRule: DetectionRule = {
  name: "error_page",
  severity: "bug",

  async detect(context: DetectionContext): Promise<DetectedIssue[]> {
    const { visibleText, currentActionChain } = context;

    for (const { pattern, label } of ERROR_PATTERNS) {
      if (pattern.test(visibleText)) {
        return [
          {
            severity: "bug",
            ruleName: "error_page",
            title: `Error page detected: ${label}`,
            expectedOutcome: "Page should load without errors",
            observedOutcome: `Error page detected: ${label}`,
            actionChain: currentActionChain.map(a => a.id),
          },
        ];
      }
    }

    return [];
  },
};
