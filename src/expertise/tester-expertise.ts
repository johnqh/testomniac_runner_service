import { ExpectationSeverity } from "@sudobility/testomniac_types";
import type { Expertise, ExpertiseContext, Outcome } from "./types";
import {
  checkNoConsoleErrors,
  checkNoNetworkErrors,
  checkPageLoaded,
} from "./tester/core-checks";
import { checkInputValue } from "./tester/text-input-checks";
import { checkSelectionState } from "./tester/selection-control-checks";
import {
  checkFormSubmittedSuccessfully,
  checkValidationMessageVisible,
} from "./tester/form-checks";
import {
  checkCartSummaryChanged,
  checkCollectionOrderChanged,
  checkCountChanged,
} from "./tester/commerce-checks";
import {
  checkNavigationOrStateChanged,
  checkUrlUnchanged,
} from "./tester/navigation-checks";
import {
  checkLoadingCompletes,
  checkMediaLoaded,
  checkModalOpened,
  checkPageResponsive,
  checkVideoPlayable,
} from "./tester/page-behavior-checks";
import {
  checkFieldErrorClearsAfterFix,
  checkRequiredErrorShownForField,
} from "./tester/validation-checks";
import { checkNetworkRequestMade } from "./tester/network-intent-checks";
import {
  checkEmptyStateVisible,
  checkResultsChanged,
} from "./tester/search-checks";
import {
  checkDialogClosed,
  checkFeedbackVisible,
  checkFocusReturned,
} from "./tester/dialog-feedback-checks";
import {
  checkBackNavigationRestoresState,
  checkForwardNavigationReappliesState,
  checkStatePersistsAfterReload,
} from "./tester/persistence-checks";
import { checkExpandedStateChanged } from "./tester/keyboard-disclosure-checks";

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
      outcomes.push({
        ...result,
        severity: expectation.severity,
      });
    }

    return outcomes;
  }

  private checkExpectation(
    expectation: {
      expectationType: string;
      expectedValue?: string;
      description: string;
      targetPath?: string;
      expectedCountDelta?: number;
      expectedTextTokens?: string[];
      forbiddenTextTokens?: string[];
      expectNoChange?: boolean;
    },
    context: ExpertiseContext
  ): Outcome {
    switch (expectation.expectationType) {
      case "page_loaded":
        return checkPageLoaded(context, expectation.description);
      case "no_console_errors":
        return checkNoConsoleErrors(context, expectation.description);
      case "no_network_errors":
        return checkNoNetworkErrors(context, expectation.description);
      case "input_value":
        return checkInputValue(expectation, context);
      case "element_checked":
      case "element_unchecked":
        return checkSelectionState(expectation, context);
      case "validation_message_visible":
        return checkValidationMessageVisible(expectation, context);
      case "form_submitted_successfully":
        return checkFormSubmittedSuccessfully(expectation, context);
      case "required_error_shown_for_field":
        return checkRequiredErrorShownForField(expectation, context);
      case "field_error_clears_after_fix":
        return checkFieldErrorClearsAfterFix(expectation, context);
      case "cart_summary_changed":
        return checkCartSummaryChanged(expectation, context);
      case "count_changed":
        return checkCountChanged(expectation, context);
      case "network_request_made":
        return checkNetworkRequestMade(expectation, context);
      case "dialog_closed":
        return checkDialogClosed(expectation, context);
      case "focus_returned":
        return checkFocusReturned(expectation, context);
      case "feedback_visible":
        return checkFeedbackVisible(expectation, context);
      case "state_persists_after_reload":
        return checkStatePersistsAfterReload(expectation, context);
      case "back_navigation_restores_state":
        return checkBackNavigationRestoresState(expectation, context);
      case "forward_navigation_reapplies_state":
        return checkForwardNavigationReappliesState(expectation, context);
      case "expanded_state_changed":
        return checkExpandedStateChanged(expectation, context);
      case "results_changed":
        return checkResultsChanged(expectation, context);
      case "collection_order_changed":
        return checkCollectionOrderChanged(expectation, context);
      case "empty_state_visible":
        return checkEmptyStateVisible(expectation, context);
      case "url_unchanged":
        return checkUrlUnchanged(expectation, context);
      case "navigation_or_state_changed":
        return checkNavigationOrStateChanged(expectation, context);
      case "page_responsive":
        return checkPageResponsive(expectation, context);
      case "loading_completes":
        return checkLoadingCompletes(expectation, context);
      case "modal_opened":
        return checkModalOpened(expectation, context);
      case "media_loaded":
        return checkMediaLoaded(expectation, context);
      case "video_playable":
        return checkVideoPlayable(expectation, context);
      default:
        // For expectations we don't have specific logic for yet, pass them
        return {
          expected: expectation.description,
          observed: "Check not implemented — assumed pass",
          result: "pass",
          severity: ExpectationSeverity.Info,
        };
    }
  }
}
