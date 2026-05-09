import { HIGH_PRIORITY_KEYWORDS } from "../config/constants";

/** Priority levels: 1 = high, 2 = normal */
export function assignPriority(route: string, title: string): number {
  const text = (route + " " + title).toLowerCase();
  return HIGH_PRIORITY_KEYWORDS.some(kw => text.includes(kw)) ? 1 : 2;
}

export function assignSurfaceTags(
  testType: string,
  priority: number | string
): string[] {
  const isHigh = priority === 1 || priority === "high";
  const tags = ["regression"];
  if (testType === "render" && isHigh) tags.push("sanity", "smoke");
  if (testType === "form" && isHigh) tags.push("sanity");
  if (testType === "navigation") tags.push("sanity");
  if (testType === "e2e") tags.push("sanity", "smoke");
  return [...new Set(tags)];
}
