import { isSameOrigin, toRelativePath } from "./url-normalizer";

/**
 * Checks if a URL is within the scan scope path boundary.
 * Returns true if no scanScopePath is set (no restriction).
 */
export function isWithinScopePath(
  url: string,
  baseUrl: string,
  scanScopePath?: string
): boolean {
  if (!scanScopePath) return true;
  if (!isSameOrigin(url, baseUrl)) return false;
  const relativePath = toRelativePath(url);
  return relativePath.startsWith(scanScopePath);
}
