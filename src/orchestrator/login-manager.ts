import type { BrowserAdapter } from "../adapter";
import type { FormInfo } from "../domain/types";
import {
  detectLoginPage,
  isLoginUrl,
  type LoginDetectionResult,
  type SSOButtonInfo,
  type AuthProviderType,
} from "../scanner/login-detector";
import { extractForms } from "../extractors/form-extractor";
import { executeSSOFlow } from "./sso-handler";

// =============================================================================
// Types
// =============================================================================

export interface LoginConfig {
  /** Explicit login page URL (optional) */
  loginUrl?: string;
  /** Credentials for email/password login */
  email?: string;
  username?: string;
  password?: string;
  twoFactorCode?: string;
  /** Auth provider type (email_password, google, etc.) */
  authProvider?: string;
}

interface LoginState {
  isLoggedIn: boolean;
  isInLoginFlow: boolean;
  loginAttempts: number;
  lastLoginUrl: string | null;
}

// =============================================================================
// LoginManager
// =============================================================================

function logLogin(step: string, details?: Record<string, unknown>): void {
  console.info("[LoginManager]", step, details ?? {});
}

const MAX_LOGIN_ATTEMPTS = 3;

export class LoginManager {
  private state: LoginState;
  private adapter: BrowserAdapter;
  private config: LoginConfig;
  private baseOrigin: string;

  constructor(
    adapter: BrowserAdapter,
    config: LoginConfig,
    baseOrigin: string
  ) {
    this.adapter = adapter;
    this.config = config;
    this.baseOrigin = baseOrigin;
    this.state = {
      isLoggedIn: false,
      isInLoginFlow: false,
      loginAttempts: 0,
      lastLoginUrl: null,
    };
  }

  /** Check if currently in a login flow (scope boundary should be suspended) */
  isInLoginFlow(): boolean {
    return this.state.isInLoginFlow;
  }

  /** Check if successfully logged in */
  isLoggedIn(): boolean {
    return this.state.isLoggedIn;
  }

  /** Get the login configuration */
  getConfig(): LoginConfig {
    return this.config;
  }

  /** Mark login flow as started (suspends scope boundary) */
  beginLoginFlow(): void {
    this.state.isInLoginFlow = true;
    logLogin("flow:begin");
  }

  /** Mark login flow as ended (re-enables scope boundary) */
  endLoginFlow(): void {
    this.state.isInLoginFlow = false;
    logLogin("flow:end");
  }

  /**
   * Perform initial login before scanning begins.
   * Navigates to login URL if configured, detects the login page, and authenticates.
   */
  async performInitialLogin(): Promise<boolean> {
    logLogin("initial-login:start", {
      loginUrl: this.config.loginUrl,
      authProvider: this.config.authProvider,
    });

    this.beginLoginFlow();
    try {
      // Navigate to login URL if provided
      if (this.config.loginUrl) {
        await this.adapter.goto(this.config.loginUrl, { timeout: 15000 });
      }

      const currentUrl = await this.adapter.getUrl();
      const forms = await extractForms(this.adapter);
      const detection = await detectLoginPage(this.adapter, currentUrl, forms);

      if (!detection.isLoginPage) {
        logLogin("initial-login:not-a-login-page", { url: currentUrl });
        return false;
      }

      return await this.executeLogin(detection);
    } finally {
      this.endLoginFlow();
    }
  }

  /**
   * Execute the login based on auth provider type and detected page elements.
   */
  private async executeLogin(
    detection: LoginDetectionResult
  ): Promise<boolean> {
    const provider = this.config.authProvider ?? "email_password";

    if (provider === "email_password") {
      return this.executeEmailPasswordLogin(detection.loginForm);
    }

    // SSO login: find the matching SSO button
    const ssoButton = detection.ssoButtons.find(
      btn => btn.provider === provider
    );

    if (ssoButton) {
      return this.executeSSOLogin(ssoButton);
    }

    // If no matching SSO button found, try clicking any SSO button
    if (detection.ssoButtons.length > 0) {
      logLogin("sso:no-exact-match, trying first button", {
        provider,
        available: detection.ssoButtons.map(b => b.provider),
      });
      return this.executeSSOLogin(detection.ssoButtons[0]);
    }

    // Fallback to email/password if form exists
    if (detection.loginForm) {
      logLogin("sso:fallback-to-email-password");
      return this.executeEmailPasswordLogin(detection.loginForm);
    }

    logLogin("login:no-method-available");
    return false;
  }

  /**
   * Execute email/password login using form fields.
   */
  async executeEmailPasswordLogin(form: FormInfo | null): Promise<boolean> {
    if (!form) {
      logLogin("email-password:no-form");
      return false;
    }

    if (!this.config.password) {
      logLogin("email-password:no-password");
      return false;
    }

    logLogin("email-password:start", { fieldCount: form.fields.length });
    this.state.loginAttempts++;

    try {
      // Find and fill email/username field
      const emailField = form.fields.find(
        f =>
          f.type === "email" ||
          f.name?.toLowerCase().includes("email") ||
          f.name?.toLowerCase().includes("user") ||
          f.name?.toLowerCase().includes("login") ||
          f.placeholder?.toLowerCase().includes("email") ||
          f.placeholder?.toLowerCase().includes("username")
      );

      const emailValue = this.config.email ?? this.config.username;
      if (emailField && emailValue && emailField.selector) {
        await this.adapter.type(emailField.selector, emailValue);
        logLogin("email-password:typed-email");
      }

      // Find and fill password field
      const passwordField = form.fields.find(f => f.type === "password");
      if (passwordField?.selector) {
        await this.adapter.type(passwordField.selector, this.config.password);
        logLogin("email-password:typed-password");
      }

      // Submit the form
      const submitButton = form.fields.find(f => f.type === "submit");
      if (submitButton?.selector) {
        await this.adapter.click(submitButton.selector, { timeout: 5000 });
      } else if (form.submitSelector) {
        await this.adapter.click(form.submitSelector, { timeout: 5000 });
      } else {
        await this.adapter.pressKey("Enter");
      }

      // Wait for navigation after submit
      await this.adapter.waitForNavigation({ timeout: 10000 }).catch(() => {});

      // Verify login succeeded by checking we're no longer on a login page
      const success = await this.verifyLoginSuccess();
      this.state.isLoggedIn = success;
      logLogin("email-password:result", { success });
      return success;
    } catch (error) {
      logLogin("email-password:error", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Execute SSO login by clicking the provider button and completing the flow.
   */
  async executeSSOLogin(ssoButton: SSOButtonInfo): Promise<boolean> {
    logLogin("sso:start", {
      provider: ssoButton.provider,
      selector: ssoButton.selector,
    });
    this.state.loginAttempts++;

    const email = this.config.email ?? this.config.username ?? "";
    const password = this.config.password ?? "";

    if (!email || !password) {
      logLogin("sso:missing-credentials");
      return false;
    }

    const success = await executeSSOFlow(
      this.adapter,
      ssoButton.selector,
      ssoButton.provider as AuthProviderType,
      { email, password },
      this.baseOrigin
    );

    this.state.isLoggedIn = success;
    logLogin("sso:result", { success, provider: ssoButton.provider });
    return success;
  }

  /**
   * Verify that login was successful by checking the current page
   * is no longer a login page.
   */
  private async verifyLoginSuccess(): Promise<boolean> {
    const currentUrl = await this.adapter.getUrl();

    // If we have an explicit login URL, check we're not still on it
    if (this.config.loginUrl && isLoginUrl(currentUrl, this.config.loginUrl)) {
      return false;
    }

    // Check if current page still looks like a login page
    const forms = await extractForms(this.adapter);
    const detection = await detectLoginPage(this.adapter, currentUrl, forms);
    return !detection.isLoginPage;
  }

  /**
   * Detect if the session has expired (redirected to login page).
   */
  async detectSessionExpiry(): Promise<boolean> {
    if (!this.state.isLoggedIn) return false;

    const currentUrl = await this.adapter.getUrl();

    // Check explicit login URL match
    if (isLoginUrl(currentUrl, this.config.loginUrl)) {
      logLogin("session:expired-explicit-url", { url: currentUrl });
      return true;
    }

    return false;
  }

  /**
   * Re-login after session expiry.
   */
  async reLogin(): Promise<boolean> {
    if (this.state.loginAttempts >= MAX_LOGIN_ATTEMPTS) {
      logLogin("re-login:max-attempts-reached", {
        attempts: this.state.loginAttempts,
      });
      return false;
    }

    logLogin("re-login:start", { attempts: this.state.loginAttempts });

    this.state.isLoggedIn = false;
    this.beginLoginFlow();

    try {
      // Navigate to login URL if configured
      if (this.config.loginUrl) {
        await this.adapter.goto(this.config.loginUrl, { timeout: 15000 });
      }

      const currentUrl = await this.adapter.getUrl();
      const forms = await extractForms(this.adapter);
      const detection = await detectLoginPage(this.adapter, currentUrl, forms);

      if (!detection.isLoginPage) {
        logLogin("re-login:not-on-login-page");
        // Maybe we're already logged in again (cookie still valid)
        this.state.isLoggedIn = true;
        return true;
      }

      return await this.executeLogin(detection);
    } finally {
      this.endLoginFlow();
    }
  }
}
