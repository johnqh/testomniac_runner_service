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
  TestElementResponse,
  CreateTestRunRequest,
  TestRunResponse,
  CreateTestElementRunRequest,
  TestElementRunResponse,
  CompleteTestElementRunRequest,
  CreateTestSurfaceRunRequest,
  CompleteTestSurfaceRunRequest,
  TestSurfaceRunResponse,
  CreateTestSurfaceBundleRunRequest,
  CompleteTestSurfaceBundleRunRequest,
  TestSurfaceBundleRunResponse,
  CreateTestSurfaceBundleRequest,
  TestSurfaceBundleResponse,
  TestSurfaceBundleSurfaceLinkResponse,
  CreateReportEmailRequest,
  HtmlElementResponse,
  ScaffoldResponse,
  FindOrCreateScaffoldRequest,
  PageHashes,
  DecomposedPageHashes,
  ActionableItem,
  TestElement,
  LegacyTestElement,
  FormInfo,
  CreateElementIdentityRequest,
  UpdateElementIdentityRequest,
  ElementIdentityResponse,
  InsertPageStatePatternsRequest,
  PageStatePatternResponse,
  UiPattern,
  CreateTestActionRequest,
  TestActionResponse,
  CreateTestRunFindingRequest,
  TestRunFindingResponse,
  ExpertiseResponse,
  CreateExpertiseRequest,
  ExpertiseRuleResponse,
  CreateExpertiseRuleRequest,
  TestSurface,
  TestSurfaceResponse,
  InsertTestSurfaceRequest,
  InsertTestElementRequest,
} from "@sudobility/testomniac_types";

type CompleteRunPayload = CompleteTestRunRequest;
type InsertTestElementRequestCompat = InsertTestElementRequest & {
  isGenerated?: boolean;
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
  // Test Element Runs
  // ===========================================================================

  createTestElementRun(
    request: CreateTestElementRunRequest
  ): Promise<TestElementRunResponse> {
    return this.post("/test-element-runs", request);
  }

  completeTestElementRun(
    testElementRunId: number,
    payload: CompleteTestElementRunRequest
  ): Promise<void> {
    return this.put(`/test-element-runs/${testElementRunId}/complete`, payload);
  }

  clearSupersededFindings(testElementRunId: number): Promise<void> {
    return this.request<void>(
      "DELETE",
      `/test-element-runs/${testElementRunId}/superseded-findings`
    );
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
    relativePath: string,
    testEnvironmentId?: number
  ): Promise<PageResponse> {
    const body: FindOrCreatePageRequest = {
      runnerId,
      relativePath,
      testEnvironmentId,
    };
    return this.post("/pages", body);
  }

  markRequiresLogin(pageId: number): Promise<void> {
    return this.put(`/pages/${pageId}/requires-login`);
  }

  getPagesByRunner(runnerId: number): Promise<PageResponse[]> {
    return this.get(`/pages?runnerId=${runnerId}`);
  }

  createDiscoveredPages(request: {
    testEnvironmentId: number;
    pages: Array<{
      relativePath: string;
      sourcePagePath?: string;
      sourceLabel?: string;
      isPublic?: boolean;
    }>;
  }): Promise<
    Array<{
      id: number;
      testEnvironmentId: number;
      relativePath: string;
      sourcePagePath: string | null;
      sourceLabel: string | null;
      isPublic: boolean;
      createdAt: string | null;
      updatedAt: string | null;
    }>
  > {
    return this.post("/discovered-pages", request);
  }

  getDiscoveredPages(testEnvironmentId: number): Promise<
    Array<{
      id: number;
      testEnvironmentId: number;
      relativePath: string;
      sourcePagePath: string | null;
      sourceLabel: string | null;
      isPublic: boolean;
      createdAt: string | null;
      updatedAt: string | null;
    }>
  > {
    return this.get(`/discovered-pages?testEnvironmentId=${testEnvironmentId}`);
  }

  createPageVisit(request: {
    testRunId: number;
    testEnvironmentId: number;
    relativePath: string;
    status: string;
    redirectPath?: string;
    requiresLogin?: boolean;
    errorMessage?: string;
  }): Promise<{
    id: number;
    testRunId: number;
    testEnvironmentId: number;
    relativePath: string;
    status: string;
    redirectPath: string | null;
    requiresLogin: boolean | null;
    errorMessage: string | null;
    createdAt: string | null;
  }> {
    return this.post("/page-visits", request);
  }

  getPageVisits(testRunId: number): Promise<
    Array<{
      id: number;
      testRunId: number;
      testEnvironmentId: number;
      relativePath: string;
      status: string;
      redirectPath: string | null;
      requiresLogin: boolean | null;
      errorMessage: string | null;
      createdAt: string | null;
    }>
  > {
    return this.get(`/page-visits?testRunId=${testRunId}`);
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

  updatePageStateDecomposedHashes(
    pageStateId: number,
    decomposedHashes: DecomposedPageHashes
  ): Promise<void> {
    return this.put(`/page-states/${pageStateId}/decomposed-hashes`, {
      fixedBodyHash: decomposedHashes.fixedBodyHash,
      scaffoldsHash: decomposedHashes.scaffoldsHash,
      patternsHash: decomposedHashes.patternsHash,
    });
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
  // Test Elements
  // ===========================================================================

  insertTestElement(
    runnerId: number,
    testElement: TestElement | LegacyTestElement,
    testSurfaceId?: number,
    testEnvironmentId?: number
  ): Promise<TestElementResponse> {
    const body = { runnerId, testSurfaceId, testEnvironmentId, testElement };
    return this.post("/test-elements", body);
  }

  getTestElementsByRunner(runnerId: number): Promise<TestElementResponse[]> {
    return this.get(`/test-elements?runnerId=${runnerId}`);
  }

  // ===========================================================================
  // Test Actions (persisted)
  // ===========================================================================

  createTestAction(
    params: CreateTestActionRequest
  ): Promise<TestActionResponse> {
    return this.post("/test-actions", params);
  }

  getTestActionsByCase(testElementId: number): Promise<TestActionResponse[]> {
    return this.get(`/test-actions?testElementId=${testElementId}`);
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
  // Test Surfaces
  // ===========================================================================

  insertTestSurface(
    runnerId: number,
    testSurface: TestSurface,
    testEnvironmentId?: number
  ): Promise<TestSurfaceResponse> {
    const body: InsertTestSurfaceRequest = {
      runnerId,
      testEnvironmentId,
      testSurface,
    };
    return this.post("/test-surfaces", body);
  }

  getTestSurfacesByRunner(runnerId: number): Promise<TestSurfaceResponse[]> {
    return this.get(`/test-surfaces?runnerId=${runnerId}`);
  }

  getTestSurface(id: number): Promise<TestSurfaceResponse | null> {
    return this.get(`/test-surfaces/${id}`);
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

  ensureTestSurfaceBundle(
    runnerId: number,
    title: string,
    uid?: string
  ): Promise<TestSurfaceBundleResponse> {
    const body: CreateTestSurfaceBundleRequest = { runnerId, title, uid };
    return this.post("/test-surface-bundles", body);
  }

  ensureTestSurface(
    runnerId: number,
    testSurface: TestSurface,
    testEnvironmentId?: number
  ): Promise<TestSurfaceResponse> {
    const body: InsertTestSurfaceRequest = {
      runnerId,
      testEnvironmentId,
      testSurface,
    };
    return this.post("/test-surfaces", body);
  }

  ensureTestElement(
    runnerId: number,
    testSurfaceId: number,
    testElement: TestElement,
    testEnvironmentId?: number
  ): Promise<TestElementResponse> {
    const body: InsertTestElementRequestCompat = {
      runnerId,
      testSurfaceId,
      testEnvironmentId,
      testElement,
      isGenerated: true,
    };
    return this.post("/test-elements", body);
  }

  retireTestElements(testElementIds: number[]): Promise<void> {
    return this.put("/test-elements/retire", { testElementIds });
  }

  ensureBundleSurfaceLink(
    testSurfaceBundleId: number,
    testSurfaceId: number
  ): Promise<TestSurfaceBundleSurfaceLinkResponse> {
    return this.post("/test-surface-bundle-surfaces", {
      testSurfaceBundleId,
      testSurfaceId,
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
  // Test Surface Runs
  // ===========================================================================

  createTestSurfaceRun(
    request: CreateTestSurfaceRunRequest
  ): Promise<TestSurfaceRunResponse> {
    return this.post("/test-surface-runs", request);
  }

  completeTestSurfaceRun(
    id: number,
    payload: CompleteTestSurfaceRunRequest
  ): Promise<void> {
    return this.put(`/test-surface-runs/${id}/complete`, payload);
  }

  // ===========================================================================
  // Test Surface Bundle Runs
  // ===========================================================================

  createTestSurfaceBundleRun(
    request: CreateTestSurfaceBundleRunRequest
  ): Promise<TestSurfaceBundleRunResponse> {
    return this.post("/test-surface-bundle-runs", request);
  }

  getTestSurfaceBundleRun(
    id: number
  ): Promise<TestSurfaceBundleRunResponse | null> {
    return this.get(`/test-surface-bundle-runs/${id}`);
  }

  completeTestSurfaceBundleRun(
    id: number,
    payload: CompleteTestSurfaceBundleRunRequest
  ): Promise<void> {
    return this.put(`/test-surface-bundle-runs/${id}/complete`, payload);
  }

  // ===========================================================================
  // Queries for execution loop
  // ===========================================================================

  getTestElementsByTestSurface(
    testSurfaceId: number,
    includeInactive = false
  ): Promise<TestElementResponse[]> {
    return this.get(
      `/test-elements?testSurfaceId=${testSurfaceId}&includeInactive=${includeInactive ? "true" : "false"}`
    );
  }

  getTestSurfacesByBundle(bundleId: number): Promise<TestSurfaceResponse[]> {
    return this.get(`/test-surface-bundle-surfaces?bundleId=${bundleId}`);
  }

  getOpenTestElementRuns(
    testSurfaceRunId: number
  ): Promise<TestElementRunResponse[]> {
    return this.get(
      `/test-element-runs?testSurfaceRunId=${testSurfaceRunId}&status=pending`
    );
  }

  getOpenTestSurfaceRuns(
    bundleRunId: number
  ): Promise<TestSurfaceRunResponse[]> {
    return this.get(
      `/test-surface-runs?bundleRunId=${bundleRunId}&status=pending`
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
