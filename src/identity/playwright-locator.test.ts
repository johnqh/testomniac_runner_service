import { describe, it, expect } from "vitest";
import { toPlaywrightLocator, buildScopeChain } from "./playwright-locator";
import type { ElementIdentity } from "@sudobility/testomniac_types";

function makeIdentity(overrides: Partial<ElementIdentity>): ElementIdentity {
  return {
    role: "generic",
    computedName: "",
    tagName: "DIV",
    playwrightLocator: "",
    isUniqueOnPage: true,
    cssSelector: "div",
    locators: [],
    ...overrides,
  };
}

describe("toPlaywrightLocator", () => {
  it("prefers data-testid when available", () => {
    const id = makeIdentity({
      testId: "login-btn",
      role: "button",
      computedName: "Login",
    });
    expect(toPlaywrightLocator(id)).toBe("getByTestId('login-btn')");
  });

  it("uses getByLabel for form controls with label", () => {
    const id = makeIdentity({
      role: "textbox",
      labelText: "Email Address",
      tagName: "INPUT",
      inputType: "email",
    });
    expect(toPlaywrightLocator(id)).toBe("getByLabel('Email Address')");
  });

  it("uses getByPlaceholder for inputs with placeholder but no label", () => {
    const id = makeIdentity({
      role: "textbox",
      placeholder: "Search...",
      tagName: "INPUT",
    });
    expect(toPlaywrightLocator(id)).toBe("getByPlaceholder('Search...')");
  });

  it("uses getByRole for buttons", () => {
    const id = makeIdentity({ role: "button", computedName: "Submit" });
    expect(toPlaywrightLocator(id)).toBe(
      "getByRole('button', { name: 'Submit' })"
    );
  });

  it("uses getByRole for links", () => {
    const id = makeIdentity({ role: "link", computedName: "About Us" });
    expect(toPlaywrightLocator(id)).toBe(
      "getByRole('link', { name: 'About Us' })"
    );
  });

  it("uses getByRole for radio buttons", () => {
    const id = makeIdentity({
      role: "radio",
      computedName: "Express (2-3 days)",
    });
    expect(toPlaywrightLocator(id)).toBe(
      "getByRole('radio', { name: 'Express (2-3 days)' })"
    );
  });

  it("uses getByAltText for images", () => {
    const id = makeIdentity({ role: "img", altText: "Company Logo" });
    expect(toPlaywrightLocator(id)).toBe("getByAltText('Company Logo')");
  });

  it("uses getByText as fallback for generic elements with text", () => {
    const id = makeIdentity({ role: "generic", computedName: "Click here" });
    expect(toPlaywrightLocator(id)).toBe("getByText('Click here')");
  });

  it("falls back to locator(css) when nothing else works", () => {
    const id = makeIdentity({ role: "generic", cssSelector: "div.mystery" });
    expect(toPlaywrightLocator(id)).toBe("locator('div.mystery')");
  });

  it("escapes single quotes in names", () => {
    const id = makeIdentity({
      role: "button",
      computedName: "Don't click",
    });
    expect(toPlaywrightLocator(id)).toBe(
      'getByRole(\'button\', { name: "Don\'t click" })'
    );
  });

  it("prefers label over placeholder for form controls", () => {
    const id = makeIdentity({
      role: "textbox",
      labelText: "Email",
      placeholder: "you@example.com",
      tagName: "INPUT",
    });
    expect(toPlaywrightLocator(id)).toBe("getByLabel('Email')");
  });
});

describe("buildScopeChain", () => {
  it("returns group scope for elements with groupName", () => {
    const id = makeIdentity({ groupName: "Shipping Method" });
    expect(buildScopeChain(id)).toBe(
      "getByRole('group', { name: 'Shipping Method' })"
    );
  });

  it("returns form scope for elements with formContext", () => {
    const id = makeIdentity({ formContext: "/login" });
    expect(buildScopeChain(id)).toBe('locator(\'form[action="/login"]\')');
  });

  it("returns landmark scope", () => {
    const id = makeIdentity({ landmarkAncestor: "navigation" });
    expect(buildScopeChain(id)).toBe("getByRole('navigation')");
  });

  it("returns undefined when no scope context", () => {
    const id = makeIdentity({});
    expect(buildScopeChain(id)).toBeUndefined();
  });

  it("prefers group over form over landmark", () => {
    const id = makeIdentity({
      groupName: "Options",
      formContext: "/form",
      landmarkAncestor: "main",
    });
    expect(buildScopeChain(id)).toBe(
      "getByRole('group', { name: 'Options' })"
    );
  });
});
