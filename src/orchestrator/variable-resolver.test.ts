import { describe, it, expect } from "vitest";
import {
  resolveVariables,
  findVariablePaths,
  UnresolvedVariableError,
} from "./variable-resolver";
import type { UserData } from "@sudobility/testomniac_types";

const data: UserData = {
  credential: { email: "me@example.com", password: "secret" },
  profile: { name: "Ada" },
  count: 3,
};

describe("findVariablePaths", () => {
  it("returns referenced dotted paths", () => {
    expect(findVariablePaths("Enter {credential.email} now")).toEqual([
      "credential.email",
    ]);
    expect(findVariablePaths("{a.b} and {c}")).toEqual(["a.b", "c"]);
    expect(findVariablePaths("no tokens")).toEqual([]);
  });
});

describe("resolveVariables", () => {
  it("replaces a single token", () => {
    expect(resolveVariables("{credential.email}", data)).toBe("me@example.com");
  });
  it("replaces tokens embedded in surrounding text and multiple tokens", () => {
    expect(resolveVariables("Hi {profile.name}, code {count}", data)).toBe(
      "Hi Ada, code 3"
    );
  });
  it("coerces non-string leaves with String()", () => {
    expect(resolveVariables("{count}", data)).toBe("3");
  });
  it("leaves strings without tokens unchanged", () => {
    expect(resolveVariables("plain text", data)).toBe("plain text");
  });
  it("leaves stray non-matching braces literal", () => {
    expect(resolveVariables("a { b } {not-a-path!}", data)).toBe(
      "a { b } {not-a-path!}"
    );
  });
  it("throws UnresolvedVariableError for a missing path", () => {
    expect(() => resolveVariables("{credential.username}", data)).toThrowError(
      UnresolvedVariableError
    );
    try {
      resolveVariables("{nope.here}", data);
    } catch (e) {
      expect((e as UnresolvedVariableError).variablePath).toBe("nope.here");
    }
  });
  it("throws when userData is undefined but a token is present", () => {
    expect(() =>
      resolveVariables("{credential.email}", undefined)
    ).toThrowError(UnresolvedVariableError);
  });
});
