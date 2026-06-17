import { describe, it, expect } from "vitest";
import { buildLoginSteps } from "./login-manager";

describe("buildLoginSteps", () => {
  const form = {
    fields: [
      { type: "email", selector: "#email" },
      { type: "password", selector: "#password" },
    ],
  } as any;

  it("emits {credential.email} and {credential.password} type steps", () => {
    const steps = buildLoginSteps(form, "#submit");
    expect(steps[0]).toMatchObject({
      action: "type",
      selector: "#email",
      value: "{credential.email}",
    });
    expect(steps[1]).toMatchObject({
      action: "type",
      selector: "#password",
      value: "{credential.password}",
    });
  });

  it("hovers then clicks the submit button when given a selector", () => {
    const steps = buildLoginSteps(form, "#submit");
    expect(steps[2]).toMatchObject({ action: "hover", selector: "#submit" });
    expect(steps[3]).toMatchObject({ action: "click", selector: "#submit" });
  });

  it("falls back to pressKey Enter when no submit selector", () => {
    const steps = buildLoginSteps(form, undefined);
    const last = steps[steps.length - 1];
    expect(last).toMatchObject({ action: "pressKey", key: "Enter" });
  });

  it("never embeds a literal secret", () => {
    const steps = buildLoginSteps(form, "#submit");
    expect(JSON.stringify(steps)).not.toContain("hunter2");
  });
});
