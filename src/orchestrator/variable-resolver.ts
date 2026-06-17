import type { UserData } from "@sudobility/testomniac_types";

export class UnresolvedVariableError extends Error {
  constructor(public readonly variablePath: string) {
    super(`Unresolved variable: {${variablePath}}`);
    this.name = "UnresolvedVariableError";
  }
}

// Only `{identifier(.identifier)*}` is treated as a variable token.
const VARIABLE_RE = /\{([a-zA-Z_][\w]*(?:\.[\w]+)*)\}/g;

/** Variable paths referenced in `input` (in order of appearance). */
export function findVariablePaths(input: string): string[] {
  const paths: string[] = [];
  for (const match of input.matchAll(VARIABLE_RE)) {
    paths.push(match[1]);
  }
  return paths;
}

function lookup(userData: UserData | undefined, path: string): unknown {
  if (userData == null) return undefined;
  let cursor: unknown = userData;
  for (const key of path.split(".")) {
    if (cursor == null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return cursor;
}

/**
 * Replace every {dotted.path} token in `input` with its value from `userData`.
 * Strings with no token are returned unchanged. A missing/undefined leaf throws
 * UnresolvedVariableError. Non-string leaves are coerced with String().
 */
export function resolveVariables(
  input: string,
  userData: UserData | undefined
): string {
  return input.replace(VARIABLE_RE, (_full, path: string) => {
    const value = lookup(userData, path);
    if (value === undefined || value === null) {
      throw new UnresolvedVariableError(path);
    }
    return String(value);
  });
}
