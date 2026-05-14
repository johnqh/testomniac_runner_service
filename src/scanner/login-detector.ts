import type { BrowserAdapter } from "../adapter";
import type { FormInfo } from "../domain/types";

// =============================================================================
// Types
// =============================================================================

export type LoginSignal =
  | "url_pattern"
  | "password_field"
  | "email_password_form"
  | "sso_button"
  | "login_heading";

export type AuthProviderType =
  | "google"
  | "apple"
  | "microsoft"
  | "twitter"
  | "facebook"
  | "github"
  | "linkedin"
  | "okta"
  | "saml"
  | "unknown";

export interface SSOButtonInfo {
  provider: AuthProviderType;
  selector: string;
  label: string;
}

export interface LoginDetectionResult {
  isLoginPage: boolean;
  confidence: "high" | "medium" | "low";
  signals: LoginSignal[];
  loginForm: FormInfo | null;
  ssoButtons: SSOButtonInfo[];
}

// =============================================================================
// Constants
// =============================================================================

const LOGIN_URL_PATTERNS = [
  /\/login\b/i,
  /\/signin\b/i,
  /\/sign-in\b/i,
  /\/auth\b/i,
  /\/sso\b/i,
  /\/authenticate\b/i,
  /\/log-in\b/i,
  /\/account\/login/i,
];

const SSO_PROVIDER_PATTERNS: Array<{
  provider: AuthProviderType;
  textPatterns: RegExp[];
  hrefPatterns: RegExp[];
}> = [
  {
    provider: "google",
    textPatterns: [
      /sign\s*in\s*with\s*google/i,
      /continue\s*with\s*google/i,
      /log\s*in\s*with\s*google/i,
      /google\s*sign[\s-]*in/i,
    ],
    hrefPatterns: [/accounts\.google\.com/i, /googleapis\.com\/auth/i],
  },
  {
    provider: "apple",
    textPatterns: [/sign\s*in\s*with\s*apple/i, /continue\s*with\s*apple/i],
    hrefPatterns: [/appleid\.apple\.com/i],
  },
  {
    provider: "microsoft",
    textPatterns: [
      /sign\s*in\s*with\s*microsoft/i,
      /continue\s*with\s*microsoft/i,
    ],
    hrefPatterns: [/login\.microsoftonline\.com/i, /login\.live\.com/i],
  },
  {
    provider: "twitter",
    textPatterns: [
      /sign\s*in\s*with\s*twitter/i,
      /continue\s*with\s*twitter/i,
      /sign\s*in\s*with\s*x\b/i,
    ],
    hrefPatterns: [/api\.twitter\.com\/oauth/i, /twitter\.com\/i\/oauth/i],
  },
  {
    provider: "facebook",
    textPatterns: [
      /sign\s*in\s*with\s*facebook/i,
      /continue\s*with\s*facebook/i,
      /log\s*in\s*with\s*facebook/i,
    ],
    hrefPatterns: [/facebook\.com\/v\d+.*\/dialog\/oauth/i],
  },
  {
    provider: "github",
    textPatterns: [/sign\s*in\s*with\s*github/i, /continue\s*with\s*github/i],
    hrefPatterns: [/github\.com\/login\/oauth/i],
  },
  {
    provider: "linkedin",
    textPatterns: [
      /sign\s*in\s*with\s*linkedin/i,
      /continue\s*with\s*linkedin/i,
    ],
    hrefPatterns: [/linkedin\.com\/oauth/i],
  },
  {
    provider: "okta",
    textPatterns: [/sign\s*in\s*with\s*okta/i],
    hrefPatterns: [/\.okta\.com/i, /\.oktapreview\.com/i],
  },
];

// =============================================================================
// Detection
// =============================================================================

function matchesUrlPattern(url: string): boolean {
  return LOGIN_URL_PATTERNS.some(pattern => pattern.test(url));
}

function isLoginForm(form: FormInfo): boolean {
  const hasPassword = form.fields.some(f => f.type === "password");
  const hasEmailOrUsername = form.fields.some(
    f =>
      f.type === "email" ||
      f.name?.toLowerCase().includes("email") ||
      f.name?.toLowerCase().includes("user") ||
      f.name?.toLowerCase().includes("login") ||
      f.placeholder?.toLowerCase().includes("email") ||
      f.placeholder?.toLowerCase().includes("username")
  );
  const fieldCount = form.fields.filter(
    f => f.type !== "hidden" && f.type !== "submit"
  ).length;
  return hasPassword && hasEmailOrUsername && fieldCount <= 4;
}

/**
 * Detect SSO buttons on the current page by evaluating the DOM.
 */
async function detectSSOButtons(
  adapter: BrowserAdapter
): Promise<SSOButtonInfo[]> {
  const buttonData = await adapter.evaluate(() => {
    const results: Array<{ text: string; href: string; selector: string }> = [];
    const candidates = document.querySelectorAll(
      'a, button, [role="button"], [type="submit"]'
    );

    candidates.forEach((el, idx) => {
      const text = el.textContent?.trim().replace(/\s+/g, " ").slice(0, 200);
      const href = el.getAttribute("href") || "";
      const id = el.id ? `#${el.id}` : "";
      const cls = el.className
        ? `.${String(el.className).split(" ").filter(Boolean).slice(0, 2).join(".")}`
        : "";
      const tag = el.tagName.toLowerCase();
      const selector =
        id || cls ? `${tag}${id}${cls}` : `${tag}:nth-of-type(${idx + 1})`;

      if (text || href) {
        results.push({ text: text || "", href, selector });
      }
    });

    return results;
  });

  const ssoButtons: SSOButtonInfo[] = [];

  for (const btn of buttonData) {
    for (const providerDef of SSO_PROVIDER_PATTERNS) {
      const textMatch = providerDef.textPatterns.some(p => p.test(btn.text));
      const hrefMatch = providerDef.hrefPatterns.some(p => p.test(btn.href));

      if (textMatch || hrefMatch) {
        ssoButtons.push({
          provider: providerDef.provider,
          selector: btn.selector,
          label: btn.text.slice(0, 100),
        });
        break;
      }
    }
  }

  return ssoButtons;
}

async function detectLoginHeadings(adapter: BrowserAdapter): Promise<boolean> {
  return adapter.evaluate(() => {
    const headings = Array.from(document.querySelectorAll("h1, h2, h3"));
    const patterns = [
      /^sign\s*in$/i,
      /^log\s*in$/i,
      /^login$/i,
      /^welcome\s*back$/i,
      /^sign\s*in\s*to/i,
      /^log\s*in\s*to/i,
    ];
    for (const h of headings) {
      const text = h.textContent?.trim() ?? "";
      if (patterns.some(p => p.test(text))) return true;
    }
    return false;
  });
}

/**
 * Detect whether the current page is a login page using multiple heuristics.
 */
export async function detectLoginPage(
  adapter: BrowserAdapter,
  currentUrl: string,
  forms: FormInfo[]
): Promise<LoginDetectionResult> {
  const signals: LoginSignal[] = [];
  let loginForm: FormInfo | null = null;
  const ssoButtons: SSOButtonInfo[] = [];

  // 1. URL pattern check
  if (matchesUrlPattern(currentUrl)) {
    signals.push("url_pattern");
  }

  // 2. Password field check
  const hasPasswordField = await adapter.evaluate(() => {
    const fields = Array.from(
      document.querySelectorAll('input[type="password"]')
    );
    for (const f of fields) {
      const el = f as HTMLInputElement;
      if (el.offsetParent !== null || el.offsetWidth > 0) return true;
    }
    return false;
  });
  if (hasPasswordField) {
    signals.push("password_field");
  }

  // 3. Email + password form check
  for (const form of forms) {
    if (isLoginForm(form)) {
      signals.push("email_password_form");
      loginForm = form;
      break;
    }
  }

  // 4. SSO button check
  const detectedSSO = await detectSSOButtons(adapter);
  if (detectedSSO.length > 0) {
    signals.push("sso_button");
    ssoButtons.push(...detectedSSO);
  }

  // 5. Login heading check
  const hasLoginHeading = await detectLoginHeadings(adapter);
  if (hasLoginHeading) {
    signals.push("login_heading");
  }

  // Determine confidence
  let confidence: "high" | "medium" | "low" = "low";
  const hasFormSignal =
    signals.includes("email_password_form") ||
    signals.includes("password_field");
  const hasUrlSignal = signals.includes("url_pattern");
  const hasSSOSignal = signals.includes("sso_button");

  if (hasFormSignal && hasUrlSignal) {
    confidence = "high";
  } else if (hasFormSignal || (hasUrlSignal && hasSSOSignal)) {
    confidence = "medium";
  }

  const isLoginPage =
    confidence === "high" ||
    confidence === "medium" ||
    (signals.length >= 2 && confidence === "low");

  return {
    isLoginPage,
    confidence,
    signals,
    loginForm,
    ssoButtons,
  };
}

/**
 * Check if a URL matches the explicit login URL or known auth URL patterns.
 */
export function isLoginUrl(url: string, explicitLoginUrl?: string): boolean {
  if (explicitLoginUrl) {
    try {
      const current = new URL(url);
      const login = new URL(explicitLoginUrl, url);
      return (
        current.origin === login.origin && current.pathname === login.pathname
      );
    } catch {
      return url.includes(explicitLoginUrl);
    }
  }
  return matchesUrlPattern(url);
}
