import { describe, it, expect } from "vitest";
import { interpolateAction } from "./interpolate-action";
import { UnresolvedVariableError } from "./variable-resolver";
import type { UserData } from "@sudobility/testomniac_types";

const userData: UserData = {
  credential: { email: "me@example.com", password: "secret" },
};

describe("interpolateAction", () => {
  it("resolves value and path, leaving other fields intact", () => {
    const out = interpolateAction(
      { value: "{credential.email}", path: "#email", description: "d" },
      userData
    );
    expect(out.value).toBe("me@example.com");
    expect(out.path).toBe("#email");
    expect(out.description).toBe("d");
  });
  it("resolves a variable inside the selector path", () => {
    const out = interpolateAction(
      { path: "[data-user='{credential.email}']" },
      userData
    );
    expect(out.path).toBe("[data-user='me@example.com']");
  });
  it("passes through actions with no tokens unchanged", () => {
    const out = interpolateAction({ value: "literal", path: "#x" }, userData);
    expect(out.value).toBe("literal");
  });
  it("does not mutate the input action", () => {
    const input = { value: "{credential.email}", path: "#email" };
    interpolateAction(input, userData);
    expect(input.value).toBe("{credential.email}"); // original untouched
  });
  it("throws UnresolvedVariableError on a missing variable", () => {
    expect(() =>
      interpolateAction({ value: "{credential.username}" }, userData)
    ).toThrowError(UnresolvedVariableError);
  });
});
