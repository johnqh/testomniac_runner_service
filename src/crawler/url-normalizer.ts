function logModule(step: string, details?: Record<string, unknown>): void {
  console.info("[UrlNormalizer]", step, details ?? {});
}

export function toRelativePath(url: string): string {
  const parsed = new URL(url);
  const path = parsed.pathname || "/";
  return parsed.search ? `${path}${parsed.search}` : path;
}

export function normalizeNavigableUrl(
  href: string,
  baseUrl: string
): string | null {
  try {
    const absolute = new URL(href, baseUrl);
    if (!["http:", "https:"].includes(absolute.protocol)) {
      return null;
    }
    absolute.hash = "";
    return absolute.toString();
  } catch {
    logModule("Invalid navigable URL", { href, baseUrl });
    return null;
  }
}

export function isSameOrigin(url: string, baseUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    logModule("Invalid URL in origin check", { url, baseUrl });
    return false;
  }
}
