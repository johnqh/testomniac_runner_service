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
 * Execute an SSO login flow for a specific provider.
 *
 * 1. Clicks the SSO button on the app's login page
 * 2. Waits for navigation to the provider
 * 3. Walks through the provider-specific steps
 * 4. Waits for redirect back to the app
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
    // Click SSO button on the app login page
    await adapter.click(ssoButtonSelector, { timeout: 5000 });
    logSSO("button:clicked");

    // Wait for navigation to the provider
    await adapter.waitForNavigation({ timeout: 10000 });
    logSSO("navigated:to-provider");

    // Get the flow steps for this provider
    const steps = SSO_FLOWS[provider] ?? GENERIC_SSO_FLOW;

    for (const step of steps) {
      const timeout = step.timeout ?? 10000;

      // Wait for the expected element
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
          // Wait for potential navigation after click
          await adapter.waitForNavigation({ timeout: 10000 }).catch(() => {});
          break;
        }
        case "wait": {
          // Just wait for the selector (already done above)
          break;
        }
      }
    }

    // Wait for redirect back to the app
    logSSO("waiting:redirect-back", { appOrigin });
    const startTime = Date.now();
    const maxWait = 30000;

    while (Date.now() - startTime < maxWait) {
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
    logSSO("flow:error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export function getSSOFlow(provider: AuthProviderType): SSOFlowStep[] {
  return SSO_FLOWS[provider] ?? GENERIC_SSO_FLOW;
}
