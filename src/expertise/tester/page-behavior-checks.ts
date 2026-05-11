import type { ExpertiseContext, Outcome } from "../types";

export function checkPageResponsive(
  expectation: { description: string },
  context: ExpertiseContext
): Outcome {
  if (!context.html || !context.currentUrl) {
    return {
      expected: expectation.description,
      observed: "No stable page snapshot was available after interaction",
      result: "error",
    };
  }

  if (looksLikeFatalPage(context.html)) {
    return {
      expected: expectation.description,
      observed: "Page appears to be in a fatal or crashed state",
      result: "error",
    };
  }

  return {
    expected: expectation.description,
    observed: "Page remained responsive enough to produce a stable snapshot",
    result: "pass",
  };
}

export function checkLoadingCompletes(
  expectation: { description: string },
  context: ExpertiseContext
): Outcome {
  const text = stripHtml(context.html).toLowerCase();
  const loadingMatches = [
    "loading...",
    "adding to cart...",
    "please wait",
    "processing...",
    "submitting...",
  ].filter(token => text.includes(token));

  if (loadingMatches.length > 0 && text.length < 4000) {
    return {
      expected: expectation.description,
      observed: `Page still shows loading state markers: ${loadingMatches.join(", ")}`,
      result: "error",
    };
  }

  return {
    expected: expectation.description,
    observed: "No obvious persistent loading state was detected",
    result: "pass",
  };
}

export function checkModalOpened(
  expectation: { description: string },
  context: ExpertiseContext
): Outcome {
  const initialCount = countModalSignals(context.initialHtml);
  const finalCount = countModalSignals(context.html);

  if (finalCount > initialCount) {
    return {
      expected: expectation.description,
      observed: `Modal/dialog signals increased from ${initialCount} to ${finalCount}`,
      result: "pass",
    };
  }

  return {
    expected: expectation.description,
    observed: "No new modal or dialog signal was detected",
    result: "error",
  };
}

export function checkMediaLoaded(
  expectation: { description: string },
  context: ExpertiseContext
): Outcome {
  const mediaErrors = context.networkLogs.filter(log => {
    const type = (log.contentType ?? "").toLowerCase();
    return (
      log.status >= 400 &&
      (type.startsWith("image/") ||
        type.startsWith("video/") ||
        /\.(png|jpe?g|gif|webp|svg|mp4|webm|mov)(\?|$)/i.test(log.url))
    );
  });

  if (mediaErrors.length > 0) {
    return {
      expected: expectation.description,
      observed: `Media request failed: ${mediaErrors[0].url} (${mediaErrors[0].status})`,
      result: "error",
    };
  }

  const text = stripHtml(context.html).toLowerCase();
  if (
    text.includes("broken image") ||
    text.includes("failed to load image") ||
    text.includes("image not available")
  ) {
    return {
      expected: expectation.description,
      observed: "Page text indicates the media did not load correctly",
      result: "error",
    };
  }

  return {
    expected: expectation.description,
    observed: "No obvious media load failure was detected",
    result: "pass",
  };
}

export function checkVideoPlayable(
  expectation: { description: string },
  context: ExpertiseContext
): Outcome {
  const text = stripHtml(context.html).toLowerCase();
  if (text.includes("your browser does not support the video tag")) {
    return {
      expected: expectation.description,
      observed:
        "Video fallback text indicates the player did not initialize correctly",
      result: "error",
    };
  }

  const videoErrors = context.networkLogs.filter(log => {
    const type = (log.contentType ?? "").toLowerCase();
    return log.status >= 400 && type.startsWith("video/");
  });
  if (videoErrors.length > 0) {
    return {
      expected: expectation.description,
      observed: `Video request failed: ${videoErrors[0].url} (${videoErrors[0].status})`,
      result: "error",
    };
  }

  return {
    expected: expectation.description,
    observed: "No obvious video playback failure was detected",
    result: "pass",
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countModalSignals(html: string): number {
  const patterns = [
    /role=["']dialog["']/gi,
    /role=["']alertdialog["']/gi,
    /aria-modal=["']true["']/gi,
    /\bmodal\b/gi,
    /\blightbox\b/gi,
    /\boverlay\b/gi,
  ];

  return patterns.reduce(
    (count, pattern) => count + (html.match(pattern)?.length ?? 0),
    0
  );
}

function looksLikeFatalPage(html: string): boolean {
  const lower = stripHtml(html).toLowerCase();
  return (
    lower.includes("this page isn’t working") ||
    lower.includes("this page isn't working") ||
    lower.includes("aw, snap") ||
    lower.includes("application error") ||
    lower.includes("something went wrong")
  );
}
