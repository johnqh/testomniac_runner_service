import { describe, expect, it } from "vitest";
import { __test__ } from "./form-extractor";

describe("form-extractor heuristics", () => {
  it("treats multi-field account widgets as forms", () => {
    const result = __test__.shouldCreatePseudoFormDescriptor({
      fieldTypes: ["email", "password"],
      hasSubmitCandidate: true,
    });

    expect(result).toBe(true);
  });

  it("treats search widgets with a submit action as forms and uses GET", () => {
    const result = __test__.shouldCreatePseudoFormDescriptor({
      fieldTypes: ["search"],
      hasSubmitCandidate: true,
    });

    expect(result).toBe(true);
    expect(
      __test__.inferMethod([
        {
          selector: "#search",
          name: "s",
          type: "search",
          label: "Search",
          required: false,
        },
      ])
    ).toBe("GET");
  });

  it("does not treat a bare single text field as a form", () => {
    const result = __test__.shouldCreatePseudoFormDescriptor({
      fieldTypes: ["text"],
      hasSubmitCandidate: false,
    });

    expect(result).toBe(false);
  });

  it("recognizes AcademyBugs-style container and submit signals", () => {
    expect(__test__.matchesFormSignalText("widget account login")).toBe(true);
    expect(__test__.isSubmitLikeText("sign in register send")).toBe(true);
    expect(__test__.isSubmitLikeText("read more details")).toBe(false);
  });
});
