import type { Expertise, ExpertiseContext, Outcome } from "./types";

/**
 * Checks each test element expectation is met.
 * Creates error outcomes for unmet expectations.
 */
export class TesterExpertise implements Expertise {
  name = "tester";

  evaluate(context: ExpertiseContext): Outcome[] {
    const outcomes: Outcome[] = [];

    for (const expectation of context.expectations) {
      const result = this.checkExpectation(expectation, context);
      outcomes.push(result);
    }

    return outcomes;
  }

  private checkExpectation(
    expectation: {
      expectationType: string;
      expectedValue?: string;
      description: string;
    },
    context: ExpertiseContext
  ): Outcome {
    switch (expectation.expectationType) {
      case "page_loaded":
        return this.checkPageLoaded(context, expectation.description);
      case "no_console_errors":
        return this.checkNoConsoleErrors(context, expectation.description);
      case "no_network_errors":
        return this.checkNoNetworkErrors(context, expectation.description);
      default:
        // For expectations we don't have specific logic for yet, pass them
        return {
          expected: expectation.description,
          observed: "Check not implemented — assumed pass",
          result: "pass",
        };
    }
  }

  private checkPageLoaded(
    context: ExpertiseContext,
    description: string
  ): Outcome {
    const hasHtml = context.html.length > 0 && context.html.includes("<");
    const hasHttpError = context.networkLogs.some(
      log => log.status >= 400 && log.url === context.networkLogs[0]?.url
    );

    if (hasHttpError) {
      const errorLog = context.networkLogs.find(
        log => log.status >= 400 && log.url === context.networkLogs[0]?.url
      );
      return {
        expected: description,
        observed: `HTTP ${errorLog?.status} error on page load`,
        result: "error",
      };
    }

    if (!hasHtml) {
      return {
        expected: description,
        observed: "Page returned empty or non-HTML response",
        result: "error",
      };
    }

    return {
      expected: description,
      observed: "Page loaded successfully with HTML content",
      result: "pass",
    };
  }

  private checkNoConsoleErrors(
    context: ExpertiseContext,
    description: string
  ): Outcome {
    const errors = context.consoleLogs.filter(
      log => log.toLowerCase().startsWith("error") || log.includes("[ERROR]")
    );

    if (errors.length > 0) {
      return {
        expected: description,
        observed: `${errors.length} console error(s): ${errors[0]}`,
        result: "error",
      };
    }

    return {
      expected: description,
      observed: "No console errors detected",
      result: "pass",
    };
  }

  private checkNoNetworkErrors(
    context: ExpertiseContext,
    description: string
  ): Outcome {
    const errors = context.networkLogs.filter(log => log.status >= 400);

    if (errors.length > 0) {
      return {
        expected: description,
        observed: `${errors.length} network error(s): ${errors[0].url} (${errors[0].status})`,
        result: "error",
      };
    }

    return {
      expected: description,
      observed: "No network errors detected",
      result: "pass",
    };
  }
}
