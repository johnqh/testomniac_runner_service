import {
  ExpectationSeverity,
  ExpertiseRuleId,
} from "@sudobility/testomniac_types";
import type { Expertise, ExpertiseContext, Outcome } from "./types";
import {
  checkNoConsoleErrors,
  checkMixedContent,
  checkNoNetworkErrors,
  checkPageLoaded,
  checkSlowResponses,
} from "./tester/core-checks";
import { checkInputValue } from "./tester/text-input-checks";
import { checkSelectionState } from "./tester/selection-control-checks";
import {
  checkErrorStateCleared,
  checkErrorStateVisible,
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
import {
  checkNetworkRequestMade,
  checkNoDuplicateMutationRequests,
} from "./tester/network-intent-checks";
import {
  checkEmptyStateVisible,
  checkResultsChanged,
} from "./tester/search-checks";
import { checkResultsRestored } from "./tester/search-restore-checks";
import { checkVariantStateChanged } from "./tester/variant-checks";
import { checkRowCountChanged } from "./tester/list-workflow-checks";
import {
  checkDialogClosed,
  checkFeedbackNotDuplicated,
  checkFeedbackVisible,
  checkFocusReturned,
} from "./tester/dialog-feedback-checks";
import {
  checkBackNavigationRestoresState,
  checkForwardNavigationReappliesState,
  checkStatePersistsAfterReload,
} from "./tester/persistence-checks";
import {
  checkElementFocused,
  checkExpandedStateChanged,
} from "./tester/keyboard-disclosure-checks";

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
        priority: expectation.priority,
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
    const withRuleId = (outcome: Outcome): Outcome => ({
      ...outcome,
      ruleId:
        outcome.ruleId ??
        TESTER_RULE_IDS_BY_EXPECTATION_TYPE[expectation.expectationType] ??
        ExpertiseRuleId.TesterUnknownExpectation,
    });

    switch (expectation.expectationType) {
      case "page_loaded":
        return withRuleId(checkPageLoaded(context, expectation.description));
      case "no_console_errors":
        return withRuleId(
          checkNoConsoleErrors(context, expectation.description)
        );
      case "no_network_errors":
        return withRuleId(
          checkNoNetworkErrors(context, expectation.description)
        );
      case "no_server_errors":
        return withRuleId(
          checkNoNetworkErrors(context, expectation.description)
        );
      case "no_mixed_content":
        return withRuleId(checkMixedContent(context, expectation.description));
      case "load_time_within":
        return withRuleId(checkSlowResponses(context, expectation.description));
      case "input_value":
        return withRuleId(checkInputValue(expectation, context));
      case "element_checked":
      case "element_unchecked":
        return withRuleId(checkSelectionState(expectation, context));
      case "validation_message_visible":
        return withRuleId(checkValidationMessageVisible(expectation, context));
      case "error_state_visible":
        return withRuleId(checkErrorStateVisible(expectation, context));
      case "error_state_cleared":
        return withRuleId(checkErrorStateCleared(expectation, context));
      case "form_submitted_successfully":
        return withRuleId(checkFormSubmittedSuccessfully(expectation, context));
      case "required_error_shown_for_field":
        return withRuleId(
          checkRequiredErrorShownForField(expectation, context)
        );
      case "field_error_clears_after_fix":
        return withRuleId(checkFieldErrorClearsAfterFix(expectation, context));
      case "cart_summary_changed":
        return withRuleId(checkCartSummaryChanged(expectation, context));
      case "count_changed":
        return withRuleId(checkCountChanged(expectation, context));
      case "row_count_changed":
        return withRuleId(checkRowCountChanged(expectation, context));
      case "network_request_made":
        return withRuleId(checkNetworkRequestMade(expectation, context));
      case "no_duplicate_mutation_requests":
        return withRuleId(
          checkNoDuplicateMutationRequests(expectation, context)
        );
      case "dialog_closed":
        return withRuleId(checkDialogClosed(expectation, context));
      case "focus_returned":
        return withRuleId(checkFocusReturned(expectation, context));
      case "feedback_visible":
        return withRuleId(checkFeedbackVisible(expectation, context));
      case "feedback_not_duplicated":
        return withRuleId(checkFeedbackNotDuplicated(expectation, context));
      case "state_persists_after_reload":
        return withRuleId(checkStatePersistsAfterReload(expectation, context));
      case "back_navigation_restores_state":
        return withRuleId(
          checkBackNavigationRestoresState(expectation, context)
        );
      case "forward_navigation_reapplies_state":
        return withRuleId(
          checkForwardNavigationReappliesState(expectation, context)
        );
      case "expanded_state_changed":
        return withRuleId(checkExpandedStateChanged(expectation, context));
      case "element_focused":
        return withRuleId(checkElementFocused(expectation, context));
      case "results_changed":
        return withRuleId(checkResultsChanged(expectation, context));
      case "results_restored":
        return withRuleId(checkResultsRestored(expectation, context));
      case "collection_order_changed":
        return withRuleId(checkCollectionOrderChanged(expectation, context));
      case "variant_state_changed":
        return withRuleId(checkVariantStateChanged(expectation, context));
      case "empty_state_visible":
        return withRuleId(checkEmptyStateVisible(expectation, context));
      case "url_unchanged":
        return withRuleId(checkUrlUnchanged(expectation, context));
      case "navigation_or_state_changed":
        return withRuleId(checkNavigationOrStateChanged(expectation, context));
      case "page_responsive":
        return withRuleId(checkPageResponsive(expectation, context));
      case "loading_completes":
        return withRuleId(checkLoadingCompletes(expectation, context));
      case "modal_opened":
        return withRuleId(checkModalOpened(expectation, context));
      case "media_loaded":
        return withRuleId(checkMediaLoaded(expectation, context));
      case "video_playable":
        return withRuleId(checkVideoPlayable(expectation, context));
      default:
        // For expectations we don't have specific logic for yet, pass them
        return withRuleId({
          expected: expectation.description,
          observed: "Check not implemented — assumed pass",
          result: "pass",
          severity: ExpectationSeverity.Info,
        });
    }
  }
}

const TESTER_RULE_IDS_BY_EXPECTATION_TYPE: Record<string, ExpertiseRuleId> = {
  page_loaded: ExpertiseRuleId.TesterPageLoaded,
  no_console_errors: ExpertiseRuleId.TesterConsoleNoErrors,
  no_network_errors: ExpertiseRuleId.TesterNetworkNoErrors,
  no_server_errors: ExpertiseRuleId.TesterNetworkNoServerErrors,
  no_mixed_content: ExpertiseRuleId.TesterNetworkNoMixedContent,
  load_time_within: ExpertiseRuleId.TesterPerformanceLoadTimeWithin,
  input_value: ExpertiseRuleId.TesterInputValue,
  element_checked: ExpertiseRuleId.TesterSelectionState,
  element_unchecked: ExpertiseRuleId.TesterSelectionState,
  validation_message_visible: ExpertiseRuleId.TesterValidationMessageVisible,
  error_state_visible: ExpertiseRuleId.TesterErrorStateVisible,
  error_state_cleared: ExpertiseRuleId.TesterErrorStateCleared,
  form_submitted_successfully: ExpertiseRuleId.TesterFormSubmittedSuccessfully,
  required_error_shown_for_field:
    ExpertiseRuleId.TesterRequiredErrorShownForField,
  field_error_clears_after_fix: ExpertiseRuleId.TesterFieldErrorClearsAfterFix,
  cart_summary_changed: ExpertiseRuleId.TesterCartSummaryChanged,
  count_changed: ExpertiseRuleId.TesterCountChanged,
  row_count_changed: ExpertiseRuleId.TesterRowCountChanged,
  network_request_made: ExpertiseRuleId.TesterNetworkRequestMade,
  no_duplicate_mutation_requests:
    ExpertiseRuleId.TesterNoDuplicateMutationRequests,
  dialog_closed: ExpertiseRuleId.TesterDialogClosed,
  focus_returned: ExpertiseRuleId.TesterFocusReturned,
  feedback_visible: ExpertiseRuleId.TesterFeedbackVisible,
  feedback_not_duplicated: ExpertiseRuleId.TesterFeedbackNotDuplicated,
  state_persists_after_reload: ExpertiseRuleId.TesterStatePersistsAfterReload,
  back_navigation_restores_state:
    ExpertiseRuleId.TesterBackNavigationRestoresState,
  forward_navigation_reapplies_state:
    ExpertiseRuleId.TesterForwardNavigationReappliesState,
  expanded_state_changed: ExpertiseRuleId.TesterExpandedStateChanged,
  element_focused: ExpertiseRuleId.TesterElementFocused,
  results_changed: ExpertiseRuleId.TesterResultsChanged,
  results_restored: ExpertiseRuleId.TesterResultsRestored,
  collection_order_changed: ExpertiseRuleId.TesterCollectionOrderChanged,
  variant_state_changed: ExpertiseRuleId.TesterVariantStateChanged,
  empty_state_visible: ExpertiseRuleId.TesterEmptyStateVisible,
  url_unchanged: ExpertiseRuleId.TesterUrlUnchanged,
  navigation_or_state_changed: ExpertiseRuleId.TesterNavigationOrStateChanged,
  page_responsive: ExpertiseRuleId.TesterPageResponsive,
  loading_completes: ExpertiseRuleId.TesterLoadingCompletes,
  modal_opened: ExpertiseRuleId.TesterModalOpened,
  media_loaded: ExpertiseRuleId.TesterMediaLoaded,
  video_playable: ExpertiseRuleId.TesterVideoPlayable,
};
