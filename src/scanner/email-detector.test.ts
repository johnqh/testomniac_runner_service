import { describe, it, expect } from "vitest";
import { detectEmailHint, detectEmailConfirmation } from "./email-detector.js";

describe("email-detector", () => {
  it("detects email hint when form has email field and hint text", () => {
    expect(
      detectEmailHint(
        true,
        "Enter your email and we'll send you a verification link"
      )
    ).toBe(true);
  });
  it("does not detect hint without email field", () => {
    expect(detectEmailHint(false, "We'll send you an email")).toBe(false);
  });
  it("does not detect hint without matching text", () => {
    expect(detectEmailHint(true, "Enter your email address")).toBe(false);
  });
  it("detects email confirmation text after submission", () => {
    expect(detectEmailConfirmation("Please check your inbox")).toBe(true);
    expect(detectEmailConfirmation("We've sent a confirmation email")).toBe(
      true
    );
    expect(detectEmailConfirmation("Welcome to our site")).toBe(false);
  });
});
