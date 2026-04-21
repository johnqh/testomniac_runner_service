export const SCAN_TIMEOUT_MS = 300_000;
export const ACTION_TIMEOUT_MS = 10_000;
export const TEST_TIMEOUT_MS = 30_000;
export const NETWORK_IDLE_TIMEOUT_MS = 5_000;
export const DEFAULT_WORKERS = 3;
export const MAX_PAGE_LIMIT = 100;
export const MAX_E2E_PATHS = 20;
export const MAX_E2E_DEPTH = 6;
export const SCREENSHOT_QUALITY = 72;
export const HOVER_DELAY_MS = 500;
export const POST_ACTION_SETTLE_MS = 2000;

export const AUTH_URL_PATTERNS = [
  "/login",
  "/log-in",
  "/signin",
  "/sign-in",
  "/auth",
];

export const SIGNUP_URL_PATTERNS = [
  "/signup",
  "/sign-up",
  "/register",
  "/create-account",
  "/join",
  "/get-started",
];

export const SIGNUP_TEXT_PATTERNS = [
  "sign up",
  "signup",
  "register",
  "create account",
  "join",
  "get started",
];

export const LOGIN_TEXT_PATTERNS = ["log in", "login", "sign in", "signin"];

export const HIGH_PRIORITY_KEYWORDS = [
  "login",
  "signin",
  "signup",
  "register",
  "checkout",
  "payment",
  "cart",
  "settings",
  "admin",
  "dashboard",
  "account",
  "profile",
  "auth",
];

export const ERROR_TEXT_PATTERNS = [
  "error",
  "failed",
  "something went wrong",
  "not found",
  "500",
  "404",
  "oops",
  "unexpected",
  "try again",
];

export const ERROR_SELECTORS = [
  '[role="alert"]',
  ".error",
  ".alert-danger",
  ".alert-error",
  "[data-error]",
  ".error-message",
  ".toast-error",
];

export const CONSOLE_NOISE_PATTERNS = [
  /favicon\.ico/i,
  /deprecated/i,
  /third.party/i,
];

export const EMAIL_HINT_PATTERNS = [
  "we'll send you",
  "check your email",
  "verification email",
  "confirm your email",
  "we'll email you",
  "you'll receive an email",
  "enter your email to receive",
];

export const EMAIL_CONFIRMATION_PATTERNS = [
  "email sent",
  "check your inbox",
  "we've sent",
  "verification link sent",
  "please check your email",
  "confirmation email",
];

export const EMAIL_CHECK_TIMEOUT_MS = 60_000;
export const EMAIL_CHECK_INTERVAL_MS = 2_000;

export const AI_REQUEST_DELAY_MS = 500;
export const MAX_ACTIONS_PER_PAGE_STATE = 200;
export const MAX_TOTAL_ACTIONS = 5_000;
export const MAX_PAGES_PER_RUN = 100;
