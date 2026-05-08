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
    return null;
  }
}

export function isSameOrigin(url: string, baseUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}
