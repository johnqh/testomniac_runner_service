import type { DetectedReusableRegion } from "./component-detector";

export interface DecomposedHtml {
  bodyHtml: string;
  contentHtml: string;
  regions: DetectedReusableRegion[];
}

export function decomposeHtml(
  bodyHtml: string,
  regions: DetectedReusableRegion[]
): DecomposedHtml {
  let contentHtml = bodyHtml;
  for (const region of regions) {
    contentHtml = contentHtml.replace(
      region.outerHtml,
      `<!-- reusable: ${region.type} -->`
    );
  }
  return { bodyHtml, contentHtml, regions };
}
