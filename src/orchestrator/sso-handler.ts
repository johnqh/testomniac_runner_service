import type { BrowserAdapter } from "../adapter";
import type { AuthProviderType } from "../scanner/login-detector";

// =============================================================================
// Types
// =============================================================================

export interface SSOFlowStep {
  /** CSS selector to wait for before performing the action */
  waitFor: string;
  /** Action to perform */
  action: "type" | "click" | "wait";
  /** CSS selector to interact with (for type/click) */
  selector?: string;
  /** Value to type (for "type" action). "{{email}}" and "{{password}}" are placeholders */
  value?: string;
  /** Timeout in ms for waiting */
  timeout?: number;
}

export interface SSOCredentials {
  email: string;
  password: string;
}

// =============================================================================
// Provider-specific flow definitions
// =============================================================================

const GOOGLE_FLOW: SSOFlowStep[] = [
  {
    waitFor: 'input[type="email"], input[name="identifier"]',
    action: "type",
    selector: 'input[type="email"], input[name="identifier"]',
    value: "{{email}}",
  },
  {
    waitFor: '#identifierNext, button[type="submit"]',
    action: "click",
    selector: '#identifierNext, button[type="submit"]',
  },
  {
    waitFor: 'input[type="password"], input[name="Passwd"]',
    action: "type",
    selector: 'input[type="password"], input[name="Passwd"]',
    value: "{{password}}",
    timeout: 5000,
  },
  {
    waitFor: '#passwordNext, button[type="submit"]',
    action: "click",
    selector: '#passwordNext, button[type="submit"]',
  },
];

const MICROSOFT_FLOW: SSOFlowStep[] = [
  {
    waitFor: 'input[type="email"], input[name="loginfmt"]',
    action: "type",
    selector: 'input[type="email"], input[name="loginfmt"]',
    value: "{{email}}",
  },
  {
    waitFor: 'input[type="submit"], button[type="submit"]',
    action: "click",
    selector: 'input[type="submit"], button[type="submit"]',
  },
  {
    waitFor: 'input[type="password"], input[name="passwd"]',
    action: "type",
    selector: 'input[type="password"], input[name="passwd"]',
    value: "{{password}}",
    timeout: 5000,
  },
  {
    waitFor: 'input[type="submit"], button[type="submit"]',
    action: "click",
    selector: 'input[type="submit"], button[type="submit"]',
  },
];

const GITHUB_FLOW: SSOFlowStep[] = [
  {
    waitFor: 'input[name="login"], #login_field',
    action: "type",
    selector: 'input[name="login"], #login_field',
    value: "{{email}}",
  },
  {
    waitFor: 'input[name="password"], #password',
    action: "type",
    selector: 'input[name="password"], #password',
    value: "{{password}}",
  },
  {
    waitFor: 'input[type="submit"], button[type="submit"]',
    action: "click",
    selector: 'input[type="submit"], button[type="submit"]',
  },
];

const FACEBOOK_FLOW: SSOFlowStep[] = [
  {
    waitFor: 'input[name="email"], #email',
    action: "type",
    selector: 'input[name="email"], #email',
    value: "{{email}}",
  },
  {
    waitFor: 'input[name="pass"], #pass',
    action: "type",
    selector: 'input[name="pass"], #pass',
    value: "{{password}}",
  },
  {
    waitFor: 'button[name="login"], #loginbutton, button[type="submit"]',
    action: "click",
    selector: 'button[name="login"], #loginbutton, button[type="submit"]',
  },
];

const GENERIC_SSO_FLOW: SSOFlowStep[] = [
  {
    waitFor:
      'input[type="email"], input[name="email"], input[name="username"], input[name="login"]',
    action: "type",
    selector:
      'input[type="email"], input[name="email"], input[name="username"], input[name="login"]',
    value: "{{email}}",
  },
  {
    waitFor: 'input[type="password"], input[name="password"]',
    action: "type",
    selector: 'input[type="password"], input[name="password"]',
    value: "{{password}}",
  },
  {
    waitFor: 'button[type="submit"], input[type="submit"]',
    action: "click",
    selector: 'button[type="submit"], input[type="submit"]',
  },
];

const SSO_FLOWS: Partial<Record<AuthProviderType, SSOFlowStep[]>> = {
  google: GOOGLE_FLOW,
  microsoft: MICROSOFT_FLOW,
  github: GITHUB_FLOW,
  facebook: FACEBOOK_FLOW,
  apple: GENERIC_SSO_FLOW,
  twitter: GENERIC_SSO_FLOW,
  linkedin: GENERIC_SSO_FLOW,
  okta: GENERIC_SSO_FLOW,
  saml: GENERIC_SSO_FLOW,
  unknown: GENERIC_SSO_FLOW,
};

// =============================================================================
// Execution
// =============================================================================

function logSSO(step: string, details?: Record<string, unknown>): void {
  console.info("[SSO]", step, details ?? {});
}

function resolveValue(
  template: string | undefined,
  credentials: SSOCredentials
): string {
  if (!template) return "";
  return template
    .replace("{{email}}", credentials.email)
    .replace("{{password}}", credentials.password);
}

/**
 * Wait for the current tab URL to change from `startUrl`.
 * Returns true if the URL changed, false on timeout.
 */
async function waitForUrlChange(
  adapter: BrowserAdapter,
  startUrl: string,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const currentUrl = await adapter.getUrl();
    if (currentUrl !== startUrl) return true;
    await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

/**
 * Execute the provider-specific SSO steps (type email, password, click
 * submit, etc.) on whatever page the adapter is currently pointed at.
 */
async function executeProviderSteps(
  adapter: BrowserAdapter,
  provider: AuthProviderType,
  credentials: SSOCredentials
): Promise<void> {
  const steps = SSO_FLOWS[provider] ?? GENERIC_SSO_FLOW;

  for (const step of steps) {
    const timeout = step.timeout ?? 10000;

    const found = await adapter.waitForSelector(step.waitFor, {
      visible: true,
      timeout,
    });

    if (!found) {
      logSSO("step:element-not-found", {
        waitFor: step.waitFor,
        action: step.action,
      });
      continue;
    }

    switch (step.action) {
      case "type": {
        const value = resolveValue(step.value, credentials);
        if (step.selector) {
          await adapter.type(step.selector, value);
        }
        logSSO("step:typed", { selector: step.selector });
        break;
      }
      case "click": {
        if (step.selector) {
          await adapter.click(step.selector, { timeout: 5000 });
        }
        logSSO("step:clicked", { selector: step.selector });
        await adapter.waitForNavigation({ timeout: 10000 }).catch(err =>
          logSSO("navigation-wait:timeout", {
            error: err instanceof Error ? err.message : String(err),
          })
        );
        break;
      }
      case "wait": {
        break;
      }
    }
  }
}

/**
 * Execute an SSO login flow for a specific provider.
 *
 * After clicking the SSO button the function races two signals:
 *   - **Redirect:** the current tab navigates to the provider (same-window OAuth)
 *   - **Popup:** a new tab/window opens (popup-based OAuth)
 *
 * Whichever fires first determines the execution path. The provider-
 * specific steps (type email → next → password → submit) are the same
 * in both cases — only the tab context differs.
 */
export async function executeSSOFlow(
  adapter: BrowserAdapter,
  ssoButtonSelector: string,
  provider: AuthProviderType,
  credentials: SSOCredentials,
  appOrigin: string
): Promise<boolean> {
  logSSO("flow:start", { provider, ssoButtonSelector });

  try {
    const startUrl = await adapter.getUrl();
    const originalTabId = adapter.getCurrentTabId?.();

    // Click SSO button on the app login page
    await adapter.click(ssoButtonSelector, { timeout: 5000 });
    logSSO("button:clicked");

    // Race: popup vs redirect
    const supportsPopup = !!(adapter.waitForNewTab && adapter.switchToTab);
    let popupTabId: number | null = null;

    if (supportsPopup) {
      // Race popup detection against URL change (redirect)
      const [newTabId, urlChanged] = await Promise.all([
        adapter.waitForNewTab!(10000),
        waitForUrlChange(adapter, startUrl, 10000),
      ]);

      if (newTabId != null) {
        popupTabId = newTabId;
        logSSO("popup:detected", { popupTabId });
      } else if (urlChanged) {
        logSSO("redirect:detected");
      } else {
        logSSO("flow:no-navigation-or-popup");
        return false;
      }
    } else {
      // Adapter doesn't support popup detection — assume redirect
      await adapter.waitForNavigation({ timeout: 10000 });
      logSSO("navigated:to-provider");
    }

    // If popup, switch to it
    if (popupTabId != null) {
      await adapter.switchToTab!(popupTabId);
      // Wait for the popup page to finish loading
      await adapter.waitForNavigation({ timeout: 10000 }).catch(() => {
        /* popup may already be loaded */
      });
      logSSO("popup:switched", { url: await adapter.getUrl() });
    }

    // Execute provider-specific steps (same logic for both paths)
    await executeProviderSteps(adapter, provider, credentials);

    // Return to original tab if we used a popup
    if (popupTabId != null && originalTabId != null) {
      // Wait for the popup to close or the original tab to receive
      // the auth callback (URL change)
      logSSO("popup:waiting-for-completion");
      const deadline = Date.now() + 15000;
      let returned = false;

      while (Date.now() < deadline) {
        // Check if original tab URL changed (auth callback received)
        await adapter.switchToTab!(originalTabId);
        const origUrl = await adapter.getUrl();
        try {
          if (origUrl !== startUrl && new URL(origUrl).origin === appOrigin) {
            returned = true;
            break;
          }
        } catch {
          // Invalid URL, keep waiting
        }

        // Brief pause before checking again
        await new Promise(r => setTimeout(r, 1000));
      }

      // Try to close the popup tab
      if (popupTabId != null) {
        try {
          await adapter.switchToTab!(popupTabId);
          await adapter.close();
        } catch {
          // Popup may already be closed
        }
        // Ensure we're back on the original tab
        try {
          await adapter.switchToTab!(originalTabId);
        } catch {
          // Best effort
        }
      }

      if (returned) {
        logSSO("flow:success:popup", { returnUrl: await adapter.getUrl() });
        return true;
      }
    }

    // Wait for redirect back to the app (redirect flow, or popup
    // fallback if we didn't detect the callback above)
    logSSO("waiting:redirect-back", { appOrigin });
    const redirectStart = Date.now();
    const maxWait = 30000;

    while (Date.now() - redirectStart < maxWait) {
      const currentUrl = await adapter.getUrl();
      try {
        if (new URL(currentUrl).origin === appOrigin) {
          logSSO("flow:success", { returnUrl: currentUrl });
          return true;
        }
      } catch {
        // Invalid URL, keep waiting
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    logSSO("flow:timeout-waiting-for-redirect");
    return false;
  } catch (error) {
    let currentUrl: string | undefined;
    try {
      currentUrl = await adapter.getUrl();
    } catch {
      // ignore – we're already in an error path
    }
    logSSO("flow:error", {
      error: error instanceof Error ? error.message : String(error),
      provider,
      currentUrl,
    });
    return false;
  }
}

export function getSSOFlow(provider: AuthProviderType): SSOFlowStep[] {
  return SSO_FLOWS[provider] ?? GENERIC_SSO_FLOW;
}
