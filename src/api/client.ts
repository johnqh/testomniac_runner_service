import type {
  BaseResponse,
  PendingRunResponse,
  UpdateRunPhaseRequest,
  UpdateRunStatsRequest,
  UpdatePhaseDurationRequest,
  CompleteRunRequest,
  AppResponse,
  FindOrCreatePageRequest,
  PageResponse,
  CreatePageStateRequest,
  PageStateResponse,
  InsertActionableItemsRequest,
  ActionableItemResponse,
  CreatePersonaRequest,
  PersonaResponse,
  CreateUseCaseRequest,
  UseCaseResponse,
  CreateInputValueRequest,
  InputValueResponse,
  InsertFormRequest,
  FormResponse,
  TestCaseResponse,
  CreateTestRunRequest,
  TestRunResponse,
  CompleteTestRunRequest,
  CreateReportEmailRequest,
  HtmlElementResponse,
  ReusableHtmlElementResponse,
  FindOrCreateReusableHtmlElementRequest,
  PageHashes,
  DecomposedPageHashes,
  ActionableItem,
  TestCase,
  LegacyTestCase,
  FormInfo,
  CreateElementIdentityRequest,
  UpdateElementIdentityRequest,
  ElementIdentityResponse,
  InsertPageStatePatternsRequest,
  PageStatePatternResponse,
  UiPattern,
  CreateDecompositionJobRequest,
  DecompositionJobResponse,
  CreateTestSuiteSuiteLinkRequest,
  TestSuiteSuiteLinkResponse,
  CreateTestSuiteCaseLinkRequest,
  TestSuiteCaseLinkResponse,
  CreateTestActionRequest,
  TestActionResponse,
  CreateTestRunFindingRequest,
  TestRunFindingResponse,
  ExpertiseResponse,
  CreateExpertiseRequest,
  ExpertiseRuleResponse,
  CreateExpertiseRuleRequest,
  TestSuite,
  TestSuiteResponse,
  InsertTestSuiteRequest,
} from "@sudobility/testomniac_types";

type CompleteRunPayload = CompleteRunRequest & {
  status?: "completed" | "failed";
};

export class ApiClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v1/scanner${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Scanner-Key": this.apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const json = (await res.json()) as BaseResponse<T>;
    if (!json.success) {
      throw new Error(`API error [${method} ${path}]: ${json.error}`);
    }
    return json.data as T;
  }

  private get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  private patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }

  // ===========================================================================
  // Runs
  // ===========================================================================

  getPendingRun(): Promise<PendingRunResponse | null> {
    return this.get("/scans/pending");
  }

  getRun(runId: number): Promise<PendingRunResponse | null> {
    return this.get(`/scans/${runId}`);
  }

  updateRunPhase(runId: number, phase: string): Promise<void> {
    const body: UpdateRunPhaseRequest = { phase };
    return this.patch(`/runs/${runId}/phase`, body);
  }

  updateRunStats(runId: number, stats: UpdateRunStatsRequest): Promise<void> {
    return this.patch(`/scans/${runId}/stats`, stats);
  }

  updatePhaseDuration(
    runId: number,
    field: string,
    durationMs: number
  ): Promise<void> {
    const body: UpdatePhaseDurationRequest = { field, durationMs };
    return this.patch(`/scans/${runId}/phase-duration`, body);
  }

  completeRun(
    runId: number,
    aiSummary?: string,
    totalDurationMs?: number,
    status?: "completed" | "failed"
  ): Promise<void> {
    const body: CompleteRunPayload = { aiSummary, totalDurationMs, status };
    return this.patch(`/scans/${runId}/complete`, body);
  }

  // ===========================================================================
  // Apps
  // ===========================================================================

  getApp(id: number): Promise<AppResponse | null> {
    return this.get(`/apps/${id}`);
  }

  // ===========================================================================
  // Pages
  // ===========================================================================

  getPage(id: number): Promise<PageResponse | null> {
    return this.get(`/pages/${id}`);
  }

  findOrCreatePage(appId: number, relativePath: string): Promise<PageResponse> {
    const body: FindOrCreatePageRequest = { appId, relativePath };
    return this.post("/pages", body);
  }

  markRequiresLogin(pageId: number): Promise<void> {
    return this.patch(`/pages/${pageId}/requires-login`);
  }

  getPagesByApp(appId: number): Promise<PageResponse[]> {
    return this.get(`/pages?appId=${appId}`);
  }

  // ===========================================================================
  // Page States
  // ===========================================================================

  getPageState(id: number): Promise<PageStateResponse | null> {
    return this.get(`/page-states/${id}`);
  }

  getPageStates(pageId: number): Promise<PageStateResponse[]> {
    return this.get(`/page-states?pageId=${pageId}`);
  }

  createPageState(params: CreatePageStateRequest): Promise<PageStateResponse> {
    return this.post("/page-states", params);
  }

  findMatchingPageState(
    pageId: number,
    hashes: PageHashes,
    sizeClass: string
  ): Promise<PageStateResponse | null> {
    const qs = new URLSearchParams({
      pageId: String(pageId),
      sizeClass,
      htmlHash: hashes.htmlHash,
      normalizedHtmlHash: hashes.normalizedHtmlHash,
      textHash: hashes.textHash,
      actionableHash: hashes.actionableHash,
    });
    return this.get(`/page-states/match?${qs}`);
  }

  // ===========================================================================
  // Actionable Items
  // ===========================================================================

  insertActionableItems(
    htmlElementId: number,
    items: ActionableItem[]
  ): Promise<ActionableItemResponse[]> {
    const body: InsertActionableItemsRequest = { htmlElementId, items };
    return this.post("/actionable-items", body);
  }

  getItemsByPageState(pageStateId: number): Promise<ActionableItemResponse[]> {
    return this.get(`/actionable-items?pageStateId=${pageStateId}`);
  }

  getItemsByHtmlElement(
    htmlElementId: number
  ): Promise<ActionableItemResponse[]> {
    return this.get(`/actionable-items?htmlElementId=${htmlElementId}`);
  }

  getActionableItem(id: number): Promise<ActionableItemResponse | null> {
    return this.get(`/actionable-items/${id}`);
  }

  // ===========================================================================
  // Personas / Use Cases / Input Values
  // ===========================================================================

  createPersona(
    appId: number,
    title: string,
    description: string
  ): Promise<PersonaResponse> {
    const body: CreatePersonaRequest = { appId, title, description };
    return this.post("/personas", body);
  }

  getPersonasByApp(appId: number): Promise<PersonaResponse[]> {
    return this.get(`/personas?appId=${appId}`);
  }

  createUseCase(
    personaId: number,
    title: string,
    description: string
  ): Promise<UseCaseResponse> {
    const body: CreateUseCaseRequest = { personaId, title, description };
    return this.post("/use-cases", body);
  }

  getUseCasesByPersona(personaId: number): Promise<UseCaseResponse[]> {
    return this.get(`/use-cases?personaId=${personaId}`);
  }

  createInputValue(
    useCaseId: number,
    fieldSelector: string,
    fieldName: string,
    value: string
  ): Promise<InputValueResponse> {
    const body: CreateInputValueRequest = {
      useCaseId,
      fieldSelector,
      fieldName,
      value,
    };
    return this.post("/input-values", body);
  }

  getInputValuesByUseCase(useCaseId: number): Promise<InputValueResponse[]> {
    return this.get(`/input-values?useCaseId=${useCaseId}`);
  }

  // ===========================================================================
  // Forms
  // ===========================================================================

  insertForm(
    pageStateId: number,
    form: FormInfo,
    formType?: string
  ): Promise<FormResponse> {
    const body: InsertFormRequest = { pageStateId, form, formType };
    return this.post("/forms", body);
  }

  getFormsByPageState(pageStateId: number): Promise<FormResponse[]> {
    return this.get(`/forms?pageStateId=${pageStateId}`);
  }

  // ===========================================================================
  // Test Cases
  // ===========================================================================

  insertTestCase(
    appId: number,
    testCase: TestCase | LegacyTestCase
  ): Promise<TestCaseResponse> {
    const body = { appId, testCase };
    return this.post("/test-cases", body);
  }

  getTestCasesByApp(appId: number): Promise<TestCaseResponse[]> {
    return this.get(`/test-cases?appId=${appId}`);
  }

  // ===========================================================================
  // Test Runs
  // ===========================================================================

  createTestRun(params: CreateTestRunRequest): Promise<TestRunResponse> {
    return this.post("/test-runs", params);
  }

  completeTestRun(
    testRunId: number,
    result: CompleteTestRunRequest
  ): Promise<void> {
    return this.patch(`/test-runs/${testRunId}/complete`, result);
  }

  // ===========================================================================
  // AI Decomposition Jobs
  // ===========================================================================

  createDecompositionJob(
    scanId: number,
    pageStateId: number,
    personaId?: number
  ): Promise<DecompositionJobResponse> {
    const body: CreateDecompositionJobRequest = {
      scanId,
      pageStateId,
      personaId,
    };
    return this.post("/ai-decomposition-jobs", body);
  }

  getPendingDecompositionJobs(
    scanId: number
  ): Promise<DecompositionJobResponse[]> {
    return this.get(`/ai-decomposition-jobs/pending?scanId=${scanId}`);
  }

  completeDecompositionJob(jobId: number): Promise<void> {
    return this.patch(`/ai-decomposition-jobs/${jobId}/complete`);
  }

  // ===========================================================================
  // Test Suite Junction Tables
  // ===========================================================================

  linkSuiteToSuite(
    parentSuiteId: number,
    childSuiteId: number
  ): Promise<TestSuiteSuiteLinkResponse> {
    const body: CreateTestSuiteSuiteLinkRequest = {
      parentSuiteId,
      childSuiteId,
    };
    return this.post("/test-suite-suites", body);
  }

  linkSuiteToCase(
    testSuiteId: number,
    testCaseId: number
  ): Promise<TestSuiteCaseLinkResponse> {
    const body: CreateTestSuiteCaseLinkRequest = { testSuiteId, testCaseId };
    return this.post("/test-suite-cases", body);
  }

  // ===========================================================================
  // Test Actions (persisted)
  // ===========================================================================

  createTestAction(
    params: CreateTestActionRequest
  ): Promise<TestActionResponse> {
    return this.post("/test-actions", params);
  }

  getTestActionsByCase(testCaseId: number): Promise<TestActionResponse[]> {
    return this.get(`/test-actions?testCaseId=${testCaseId}`);
  }

  // ===========================================================================
  // Test Run Findings
  // ===========================================================================

  createTestRunFinding(
    params: CreateTestRunFindingRequest
  ): Promise<TestRunFindingResponse> {
    return this.post("/test-run-findings", params);
  }

  // ===========================================================================
  // Expertise
  // ===========================================================================

  getExpertises(): Promise<ExpertiseResponse[]> {
    return this.get("/expertises");
  }

  getExpertiseRules(expertiseId: number): Promise<ExpertiseRuleResponse[]> {
    return this.get(`/expertise-rules?expertiseId=${expertiseId}`);
  }

  createExpertise(params: CreateExpertiseRequest): Promise<ExpertiseResponse> {
    return this.post("/expertises", params);
  }

  createExpertiseRule(
    params: CreateExpertiseRuleRequest
  ): Promise<ExpertiseRuleResponse> {
    return this.post("/expertise-rules", params);
  }

  // ===========================================================================
  // Test Suites
  // ===========================================================================

  insertTestSuite(
    appId: number,
    testSuite: TestSuite
  ): Promise<TestSuiteResponse> {
    const body: InsertTestSuiteRequest = { appId, testSuite };
    return this.post("/test-suites", body);
  }

  getTestSuitesByApp(appId: number): Promise<TestSuiteResponse[]> {
    return this.get(`/test-suites?appId=${appId}`);
  }

  getTestSuite(id: number): Promise<TestSuiteResponse | null> {
    return this.get(`/test-suites/${id}`);
  }

  // ===========================================================================
  // Report Emails
  // ===========================================================================

  createReportEmail(params: CreateReportEmailRequest): Promise<void> {
    return this.post("/report-emails", params);
  }

  // ===========================================================================
  // Components (deprecated — removed, use findOrCreateReusableHtmlElement)
  // ===========================================================================

  // ===========================================================================
  // Html Elements
  // ===========================================================================

  findOrCreateHtmlElement(
    html: string,
    hash: string
  ): Promise<HtmlElementResponse> {
    return this.post("/html-elements", { html, hash });
  }

  // ===========================================================================
  // Reusable Html Elements
  // ===========================================================================

  findOrCreateReusableHtmlElement(
    params: FindOrCreateReusableHtmlElementRequest
  ): Promise<ReusableHtmlElementResponse> {
    return this.post("/reusable-html-elements/find-or-create", params);
  }

  getReusableHtmlElements(
    appId: number
  ): Promise<ReusableHtmlElementResponse[]> {
    return this.get(`/reusable-html-elements?appId=${appId}`);
  }

  linkPageStateReusableElements(
    pageStateId: number,
    reusableHtmlElementIds: number[]
  ): Promise<void> {
    return this.post("/page-state-reusable-elements", {
      pageStateId,
      reusableHtmlElementIds,
    });
  }
  // ===========================================================================
  // Page State — Decomposed Matching
  // ===========================================================================

  findMatchingPageStateDecomposed(
    pageId: number,
    decomposedHashes: DecomposedPageHashes,
    sizeClass: string
  ): Promise<PageStateResponse | null> {
    const qs = new URLSearchParams({
      pageId: String(pageId),
      sizeClass,
      fixedBodyHash: decomposedHashes.fixedBodyHash,
      reusableElementsHash: decomposedHashes.reusableElementsHash,
      patternsHash: decomposedHashes.patternsHash,
    });
    return this.get(`/page-states/match-decomposed?${qs}`);
  }

  // ===========================================================================
  // Page State Patterns
  // ===========================================================================

  insertPageStatePatterns(
    pageStateId: number,
    patterns: UiPattern[]
  ): Promise<PageStatePatternResponse[]> {
    const body: InsertPageStatePatternsRequest = { pageStateId, patterns };
    return this.post("/page-state-patterns", body);
  }

  getPageStatePatterns(
    pageStateId: number
  ): Promise<PageStatePatternResponse[]> {
    return this.get(`/page-state-patterns?pageStateId=${pageStateId}`);
  }

  // ===========================================================================
  // Element Identities
  // ===========================================================================

  findOrCreateElementIdentity(
    params: CreateElementIdentityRequest
  ): Promise<ElementIdentityResponse> {
    return this.post("/element-identities", params);
  }

  getElementIdentitiesByApp(appId: number): Promise<ElementIdentityResponse[]> {
    return this.get(`/element-identities?appId=${appId}`);
  }

  updateElementIdentity(
    id: number,
    params: UpdateElementIdentityRequest
  ): Promise<void> {
    return this.patch(`/element-identities/${id}`, params);
  }
}

// Singleton instance
let _client: ApiClient | null = null;

export function getApiClient(baseUrl?: string, apiKey?: string): ApiClient {
  if (!_client) {
    if (!baseUrl || !apiKey) {
      throw new Error(
        "ApiClient not initialized. Call getApiClient(baseUrl, apiKey) first."
      );
    }
    _client = new ApiClient(baseUrl, apiKey);
  }
  return _client;
}
