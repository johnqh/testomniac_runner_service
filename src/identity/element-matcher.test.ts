import { describe, it, expect } from "vitest";
import {
  matchElementIdentity,
  type ElementFingerprint,
} from "./element-matcher";
import type { ElementIdentityResponse } from "@sudobility/testomniac_types";

function makeResponse(
  overrides: Partial<ElementIdentityResponse>
): ElementIdentityResponse {
  return {
    id: 1,
    appId: 1,
    role: "generic",
    computedName: null,
    tagName: "DIV",
    labelText: null,
    groupName: null,
    placeholder: null,
    altText: null,
    testId: null,
    inputType: null,
    nthInGroup: null,
    formContext: null,
    headingContext: null,
    landmarkAncestor: null,
    playwrightLocator: "locator('div')",
    playwrightScopeChain: null,
    isUniqueOnPage: true,
    cssSelector: "div",
    locators: [],
    firstSeenScanId: 1,
    lastSeenScanId: 1,
    timesSeen: 1,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function makeFP(overrides: Partial<ElementFingerprint>): ElementFingerprint {
  return {
    role: "generic",
    computedName: "",
    tagName: "DIV",
    cssSelector: "div",
    ...overrides,
  };
}

describe("matchElementIdentity", () => {
  it("matches by testId with score 1.0", () => {
    const existing = [
      makeResponse({ id: 1, testId: "submit-btn", role: "button" }),
    ];
    const fp = makeFP({ testId: "submit-btn", role: "button" });
    const result = matchElementIdentity(fp, existing);
    expect(result).not.toBeNull();
    expect(result!.identity.id).toBe(1);
    expect(result!.score).toBe(1.0);
  });

  it("matches by role + computedName + groupName with score 0.95", () => {
    const existing = [
      makeResponse({
        id: 2,
        role: "radio",
        computedName: "Express",
        groupName: "Shipping",
      }),
    ];
    const fp = makeFP({
      role: "radio",
      computedName: "Express",
      groupName: "Shipping",
    });
    const result = matchElementIdentity(fp, existing);
    expect(result).not.toBeNull();
    expect(result!.score).toBe(0.95);
  });

  it("matches by role + computedName with score 0.9", () => {
    const existing = [
      makeResponse({ id: 3, role: "button", computedName: "Submit" }),
    ];
    const fp = makeFP({ role: "button", computedName: "Submit" });
    const result = matchElementIdentity(fp, existing);
    expect(result!.score).toBe(0.9);
  });

  it("matches by labelText with score 0.85", () => {
    const existing = [
      makeResponse({ id: 4, role: "textbox", labelText: "Email" }),
    ];
    const fp = makeFP({ role: "textbox", labelText: "Email" });
    const result = matchElementIdentity(fp, existing);
    expect(result!.score).toBe(0.85);
  });

  it("matches by placeholder with score 0.75", () => {
    const existing = [
      makeResponse({ id: 5, role: "textbox", placeholder: "Search..." }),
    ];
    const fp = makeFP({ role: "textbox", placeholder: "Search..." });
    const result = matchElementIdentity(fp, existing);
    expect(result!.score).toBe(0.75);
  });

  it("returns null when no match above threshold", () => {
    const existing = [
      makeResponse({ id: 6, role: "button", computedName: "Submit" }),
    ];
    const fp = makeFP({ role: "link", computedName: "About" });
    const result = matchElementIdentity(fp, existing);
    expect(result).toBeNull();
  });

  it("returns best match when multiple candidates", () => {
    const existing = [
      makeResponse({ id: 10, role: "button", computedName: "Save" }),
      makeResponse({
        id: 11,
        role: "button",
        computedName: "Save",
        testId: "save-btn",
      }),
    ];
    const fp = makeFP({
      role: "button",
      computedName: "Save",
      testId: "save-btn",
    });
    const result = matchElementIdentity(fp, existing);
    expect(result!.identity.id).toBe(11);
    expect(result!.score).toBe(1.0);
  });

  it("returns null for empty existing list", () => {
    const fp = makeFP({ role: "button", computedName: "Submit" });
    expect(matchElementIdentity(fp, [])).toBeNull();
  });
});
