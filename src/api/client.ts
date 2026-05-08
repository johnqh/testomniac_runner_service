import type {
  BaseResponse,
  UpdateTestRunStatsRequest,
  CompleteTestRunRequest,
  RunnerResponse,
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
  CreateTestCaseRunRequest,
  TestCaseRunResponse,
  CompleteTestCaseRunRequest,
  CreateTestSuiteRunRequest,
  CompleteTestSuiteRunRequest,
  TestSuiteRunResponse,
  CreateTestSuiteBundleRunRequest,
  CompleteTestSuiteBundleRunRequest,
  TestSuiteBundleRunResponse,
  CreateTestSuiteBundleRequest,
  TestSuiteBundleResponse,
  TestSuiteBundleSuiteLinkResponse,
  CreateReportEmailRequest,
  HtmlElementResponse,
  ScaffoldResponse,
  FindOrCreateScaffoldRequest,
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
  InsertTestCaseRequest,
} from "@sudobility/testomniac_types";

type CompleteRunPayload = CompleteTestRunRequest;

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

  private put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  // ===========================================================================
  // Test Runs
  // ===========================================================================

  getPendingTestRun(): Promise<TestRunResponse | null> {
    return this.get("/test-runs/pending");
  }

  getTestRun(testRunId: number): Promise<TestRunResponse | null> {
    return this.get(`/test-runs/${testRunId}`);
  }

  updateTestRunStats(
    testRunId: number,
    stats: UpdateTestRunStatsRequest
  ): Promise<void> {
    return this.put(`/test-runs/${testRunId}/stats`, stats);
  }

  completeTestRun(
    testRunId: number,
    payload: CompleteRunPayload
  ): Promise<void> {
    return this.put(`/test-runs/${testRunId}/complete`, payload);
  }

  createTestRun(request: CreateTestRunRequest): Promise<TestRunResponse> {
    return this.post("/test-runs", request);
  }

  // ===========================================================================
  // Test Case Runs
  // ===========================================================================

  createTestCaseRun(
    request: CreateTestCaseRunRequest
  ): Promise<TestCaseRunResponse> {
    return this.post("/test-case-runs", request);
  }

  completeTestCaseRun(
    testCaseRunId: number,
    payload: CompleteTestCaseRunRequest
  ): Promise<void> {
    return this.put(`/test-case-runs/${testCaseRunId}/complete`, payload);
  }

  // ===========================================================================
  // Runners
  // ===========================================================================

  getRunner(id: number): Promise<RunnerResponse | null> {
    return this.get(`/runners/${id}`);
  }

  // ===========================================================================
  // Pages
  // ===========================================================================

  getPage(id: number): Promise<PageResponse | null> {
    return this.get(`/pages/${id}`);
  }

  findOrCreatePage(
    runnerId: number,
    relativePath: string
  ): Promise<PageResponse> {
    const body: FindOrCreatePageRequest = { runnerId, relativePath };
    return this.post("/pages", body);
  }

  markRequiresLogin(pageId: number): Promise<void> {
    return this.put(`/pages/${pageId}/requires-login`);
  }

  getPagesByRunner(runnerId: number): Promise<PageResponse[]> {
    return this.get(`/pages?runnerId=${runnerId}`);
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
    productId: number,
    title: string,
    description: string
  ): Promise<PersonaResponse> {
    const body: CreatePersonaRequest = { productId, title, description };
    return this.post("/personas", body);
  }

  getPersonasByProduct(productId: number): Promise<PersonaResponse[]> {
    return this.get(`/personas?productId=${productId}`);
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
    runnerId: number,
    testCase: TestCase | LegacyTestCase
  ): Promise<TestCaseResponse> {
    const body = { runnerId, testCase };
    return this.post("/test-cases", body);
  }

  getTestCasesByRunner(runnerId: number): Promise<TestCaseResponse[]> {
    return this.get(`/test-cases?runnerId=${runnerId}`);
  }

  // ===========================================================================
  // AI Decomposition Jobs
  // ===========================================================================

  createDecompositionJob(
    testRunId: number,
    pageStateId: number,
    personaId?: number
  ): Promise<DecompositionJobResponse> {
    const body: CreateDecompositionJobRequest = {
      testRunId,
      pageStateId,
      personaId,
    };
    return this.post("/ai-decomposition-jobs", body);
  }

  getPendingDecompositionJobs(
    testRunId: number
  ): Promise<DecompositionJobResponse[]> {
    return this.get(`/ai-decomposition-jobs/pending?testRunId=${testRunId}`);
  }

  completeDecompositionJob(jobId: number): Promise<void> {
    return this.put(`/ai-decomposition-jobs/${jobId}/complete`);
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
    runnerId: number,
    testSuite: TestSuite
  ): Promise<TestSuiteResponse> {
    const body: InsertTestSuiteRequest = { runnerId, testSuite };
    return this.post("/test-suites", body);
  }

  getTestSuitesByRunner(runnerId: number): Promise<TestSuiteResponse[]> {
    return this.get(`/test-suites?runnerId=${runnerId}`);
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
  // Components (deprecated — removed, use findOrCreateScaffold)
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
  // Scaffolds
  // ===========================================================================

  findOrCreateScaffold(
    params: FindOrCreateScaffoldRequest
  ): Promise<ScaffoldResponse> {
    return this.post("/scaffolds", params);
  }

  getScaffolds(runnerId: number): Promise<ScaffoldResponse[]> {
    return this.get(`/scaffolds?runnerId=${runnerId}`);
  }

  linkPageStateScaffolds(
    pageStateId: number,
    scaffoldIds: number[]
  ): Promise<void> {
    return this.post("/page-state-scaffolds", {
      pageStateId,
      scaffoldIds,
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
      scaffoldsHash: decomposedHashes.scaffoldsHash,
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

  getElementIdentitiesByRunner(
    runnerId: number
  ): Promise<ElementIdentityResponse[]> {
    return this.get(`/element-identities?runnerId=${runnerId}`);
  }

  updateElementIdentity(
    id: number,
    params: UpdateElementIdentityRequest
  ): Promise<void> {
    return this.put(`/element-identities/${id}`, params);
  }

  // ===========================================================================
  // Ensure (find or create)
  // ===========================================================================

  ensureTestSuiteBundle(
    runnerId: number,
    title: string,
    uid?: string
  ): Promise<TestSuiteBundleResponse> {
    const body: CreateTestSuiteBundleRequest = { runnerId, title, uid };
    return this.post("/test-suite-bundles", body);
  }

  ensureTestSuite(
    runnerId: number,
    testSuite: TestSuite
  ): Promise<TestSuiteResponse> {
    const body: InsertTestSuiteRequest = { runnerId, testSuite };
    return this.post("/test-suites", body);
  }

  ensureTestCase(
    runnerId: number,
    testSuiteId: number,
    testCase: TestCase
  ): Promise<TestCaseResponse> {
    const body: InsertTestCaseRequest = { runnerId, testSuiteId, testCase };
    return this.post("/test-cases", body);
  }

  ensureBundleSuiteLink(
    testSuiteBundleId: number,
    testSuiteId: number
  ): Promise<TestSuiteBundleSuiteLinkResponse> {
    return this.post("/test-suite-bundle-suites", {
      testSuiteBundleId,
      testSuiteId,
    });
  }

  // ===========================================================================
  // Test Run Claiming
  // ===========================================================================

  claimTestRun(
    testRunId: number,
    runnerInstanceId: string,
    runnerInstanceName: string
  ): Promise<boolean> {
    return this.put(`/test-runs/${testRunId}/claim`, {
      runnerInstanceId,
      runnerInstanceName,
    })
      .then(() => true)
      .catch(() => false);
  }

  // ===========================================================================
  // Test Suite Runs
  // ===========================================================================

  createTestSuiteRun(
    request: CreateTestSuiteRunRequest
  ): Promise<TestSuiteRunResponse> {
    return this.post("/test-suite-runs", request);
  }

  completeTestSuiteRun(
    id: number,
    payload: CompleteTestSuiteRunRequest
  ): Promise<void> {
    return this.put(`/test-suite-runs/${id}/complete`, payload);
  }

  // ===========================================================================
  // Test Suite Bundle Runs
  // ===========================================================================

  createTestSuiteBundleRun(
    request: CreateTestSuiteBundleRunRequest
  ): Promise<TestSuiteBundleRunResponse> {
    return this.post("/test-suite-bundle-runs", request);
  }

  completeTestSuiteBundleRun(
    id: number,
    payload: CompleteTestSuiteBundleRunRequest
  ): Promise<void> {
    return this.put(`/test-suite-bundle-runs/${id}/complete`, payload);
  }

  // ===========================================================================
  // Queries for execution loop
  // ===========================================================================

  getTestCasesByTestSuite(testSuiteId: number): Promise<TestCaseResponse[]> {
    return this.get(`/test-cases?testSuiteId=${testSuiteId}`);
  }

  getTestSuitesByBundle(bundleId: number): Promise<TestSuiteResponse[]> {
    return this.get(`/test-suite-bundle-suites?bundleId=${bundleId}`);
  }

  getOpenTestCaseRuns(testSuiteRunId: number): Promise<TestCaseRunResponse[]> {
    return this.get(
      `/test-case-runs?testSuiteRunId=${testSuiteRunId}&status=pending`
    );
  }

  getOpenTestSuiteRuns(bundleRunId: number): Promise<TestSuiteRunResponse[]> {
    return this.get(
      `/test-suite-runs?bundleRunId=${bundleRunId}&status=pending`
    );
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
