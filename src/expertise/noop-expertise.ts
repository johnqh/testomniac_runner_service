import type { Expertise, ExpertiseContext, Outcome } from "./types";

/**
 * No-op expertise placeholder. Returns an empty outcomes list.
 * Used for Content, UI, and Accessibility expertises until implemented.
 */
export class NoopExpertise implements Expertise {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  evaluate(_context: ExpertiseContext): Outcome[] {
    return [];
  }
}
