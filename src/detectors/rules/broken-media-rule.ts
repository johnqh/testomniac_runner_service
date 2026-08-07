import type {
  DetectionRule,
  DetectionContext,
  DetectedIssue,
} from "../detection-rule.js";

export const brokenMediaRule: DetectionRule = {
  name: "broken_media",
  severity: "bug",

  async detect(context: DetectionContext): Promise<DetectedIssue[]> {
    const { adapter, currentActionChain } = context;

    const mediaIssues = (await adapter.evaluate(() => {
      const results: Array<{ type: string; description: string }> = [];
      const media = document.querySelectorAll("video, audio");

      media.forEach((element, index) => {
        const mediaEl = element as HTMLMediaElement;
        const tag = element.tagName.toLowerCase();
        const hasSource =
          Boolean(mediaEl.getAttribute("src")) ||
          element.querySelector("source[src]") !== null;

        if (!hasSource) {
          results.push({
            type: "missing_media_source",
            description: `${tag} #${index + 1} has no source`,
          });
          return;
        }

        if (mediaEl.error) {
          results.push({
            type: "broken_media",
            description: `${tag} #${index + 1} has media error code ${mediaEl.error.code}`,
          });
        } else if (
          mediaEl.networkState === HTMLMediaElement.NETWORK_NO_SOURCE
        ) {
          results.push({
            type: "broken_media",
            description: `${tag} #${index + 1} has no playable source`,
          });
        }
      });

      return results;
    })) as Array<{ type: string; description: string }>;

    return mediaIssues.map(m => ({
      severity: "bug" as const,
      ruleName: "broken_media",
      title: `Broken media: ${m.description}`,
      expectedOutcome: "Media elements should load and play correctly",
      observedOutcome: m.description,
      actionChain: currentActionChain.map(a => a.id),
    }));
  },
};
