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
  TestInteractionResponse,
  CreateTestRunRequest,
  TestRunResponse,
  CreateTestInteractionRunRequest,
  TestInteractionRunResponse,
  CompleteTestInteractionRunRequest,
  CreateTestSurfaceRunRequest,
  CompleteTestSurfaceRunRequest,
  TestSurfaceRunResponse,
  CreateTestSurfaceBundleRunRequest,
  CompleteTestSurfaceBundleRunRequest,
  TestSurfaceBundleRunResponse,
  CreateTestSurfaceBundleRequest,
  TestSurfaceBundleResponse,
  TestSurfaceBundleSurfaceLinkResponse,
  TestSurfaceBundleInteractionLinkResponse,
  TestSurfaceBundleScenarioLinkResponse,
  TestScenarioResponse,
  CreateReportEmailRequest,
  HtmlElementResponse,
  ScaffoldResponse,
  FindOrCreateScaffoldRequest,
  PageHashes,
  DecomposedPageHashes,
  ActionableItem,
  TestInteraction,
  LegacyTestInteraction,
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
  EnsureTestRunFindingRequest,
  TestRunFindingResponse,
  ExpertiseResponse,
  CreateExpertiseRequest,
  ExpertiseRuleResponse,
  CreateExpertiseRuleRequest,
  TestSurface,
  TestSurfaceResponse,
  InsertTestSurfaceRequest,
  InsertTestInteractionRequest,
  BatchTestInteractionRunsResponse,
  BatchTestInteractionItem,
  BatchTestInteractionResult,
  CombinedStartRequest,
  CombinedNextRequest,
  CombinedNextResponse,
  CombinedEndRequest,
  CombinedEndResponse,
} from "@sudobility/testomniac_types";

type StatusUpdatePayload = {
  status_update?: string;
};
type CompleteRunPayload = CompleteTestRunRequest & StatusUpdatePayload;
type InsertTestInteractionRequestCompat = InsertTestInteractionRequest & {
  isGenerated?: boolean;
  existingTestInteractionId?: number;
};

function logApi(step: string, details?: Record<string, unknown>): void {
  console.info("[ApiClient]", step, details ?? {});
}

export class ApiClient {
  private baseUrl: string;
  private apiKey: string;
  private surfacesCache: Map<
    number,
    { data: TestSurfaceResponse[]; expiry: number }
  > = new Map();
  private interactionsCache: Map<
    number,
    { data: TestInteractionResponse[]; expiry: number }
  > = new Map();
  private static SURFACES_CACHE_TTL_MS = 5000;
  private static INTERACTIONS_CACHE_TTL_MS = 5000;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  invalidateSurfacesCache(): void {
    this.surfacesCache.clear();
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Scanner-Key": this.apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store" as RequestCache,
    });

    const json = (await res.json()) as BaseResponse<T>;
    if (!json.success) {
      logApi("request:failed", {
        method,
        path,
        status: res.status,
        error: json.error,
      });
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

  private patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
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
    stats: UpdateTestRunStatsRequest & StatusUpdatePayload
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

  createTestInteractionRun(
    request: CreateTestInteractionRunRequest
  ): Promise<TestInteractionRunResponse> {
    return this.post("/test-interaction-runs", request);
  }

  completeTestInteractionRun(
    testInteractionRunId: number,
    payload: CompleteTestInteractionRunRequest & StatusUpdatePayload
  ): Promise<void> {
    return this.put(
      `/test-interaction-runs/${testInteractionRunId}/complete`,
      payload
    );
  }

  completeTestInteractionRunBatch(
    ids: number[],
    payload: { status?: string; errorMessage?: string; status_update?: string }
  ): Promise<void> {
    if (ids.length === 0) return Promise.resolve();
    return this.put("/test-interaction-runs/complete-batch", {
      ids,
      ...payload,
    });
  }

  clearSupersededFindings(testInteractionRunId: number): Promise<void> {
    return this.request<void>(
      "DELETE",
      `/test-interaction-runs/${testInteractionRunId}/superseded-findings`
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

  markIsLoginPage(pageId: number): Promise<void> {
    return this.put(`/pages/${pageId}/is-login-page`);
  }

  getEntityCredential(credentialId: number): Promise<{
    id: number;
    entityId: string;
    authProvider: string;
    loginUrl: string | null;
    email: string | null;
    username: string | null;
    password: string | null;
    twoFactorCode: string | null;
  }> {
    return this.get(`/entity-credentials/${credentialId}`);
  }

  async uploadScreenshot(
    imageBytes: Uint8Array,
    filename: string
  ): Promise<{ path: string; thumbnailPath: string }> {
    const url = `${this.baseUrl}/api/v1/artifacts/upload?path=${encodeURIComponent(filename)}`;
    const blob = new Blob([new Uint8Array(imageBytes)], { type: "image/png" });
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: blob,
    });
    const json = (await res.json()) as BaseResponse<{
      path: string;
      thumbnailPath: string;
    }>;
    if (!json.success) {
      throw new Error(`Upload failed: ${json.error}`);
    }
    return json.data as { path: string; thumbnailPath: string };
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

  getPageStatesBatch(
    pageIds: number[]
  ): Promise<Record<string, PageStateResponse[]>> {
    if (pageIds.length === 0) return Promise.resolve({});
    const ids = pageIds.join(",");
    return this.get(`/page-states?pageIds=${ids}`);
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
    return this.get(`/personas/${personaId}/use-cases`);
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
    return this.get(`/personas/use-cases/${useCaseId}/input-values`);
  }

  // ===========================================================================
  // Test Scenario Sequences
  // ===========================================================================

  getTestScenarioSequence(id: number): Promise<{
    id: number;
    testScenarioId: number;
    testEnvironmentId: number;
  } | null> {
    return this.get(`/test-scenarios/sequences/${id}`);
  }

  getSequenceTestInteractions(sequenceId: number): Promise<
    Array<{
      id: number;
      testScenarioSequenceId: number;
      testInteractionId: number;
      stepOrder: number;
    }>
  > {
    return this.get(
      `/test-scenarios/sequences/${sequenceId}/test-interactions`
    );
  }

  getSequenceRun(id: number): Promise<{
    id: number;
    testScenarioSequenceId: number;
    status: string;
  } | null> {
    return this.get(`/test-scenarios/sequence-runs/${id}`);
  }

  completeSequenceRun(id: number, payload: { status?: string }): Promise<void> {
    return this.put(`/test-scenarios/sequence-runs/${id}/complete`, payload);
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

  insertTestInteraction(
    runnerId: number,
    testInteraction: TestInteraction | LegacyTestInteraction,
    testSurfaceId?: number,
    testEnvironmentId?: number
  ): Promise<TestInteractionResponse> {
    const body = {
      runnerId,
      testSurfaceId,
      testEnvironmentId,
      testInteraction,
    };
    return this.post("/test-interactions", body);
  }

  async getTestInteractionsByRunner(
    runnerId: number
  ): Promise<TestInteractionResponse[]> {
    const cached = this.interactionsCache.get(runnerId);
    if (cached && Date.now() < cached.expiry) {
      return cached.data;
    }
    const data = await this.get<TestInteractionResponse[]>(
      `/test-interactions?runnerId=${runnerId}&slim=true`
    );
    this.interactionsCache.set(runnerId, {
      data,
      expiry: Date.now() + ApiClient.INTERACTIONS_CACHE_TTL_MS,
    });
    return data;
  }

  invalidateInteractionsCache(): void {
    this.interactionsCache.clear();
  }

  // ===========================================================================
  // Test Actions (persisted)
  // ===========================================================================

  createTestAction(
    params: CreateTestActionRequest
  ): Promise<TestActionResponse> {
    return this.post("/test-actions", params);
  }

  getTestActionsByCase(
    testInteractionId: number
  ): Promise<TestActionResponse[]> {
    return this.get(`/test-actions?testInteractionId=${testInteractionId}`);
  }

  // ===========================================================================
  // Test Run Findings
  // ===========================================================================

  createTestRunFinding(
    params: CreateTestRunFindingRequest
  ): Promise<TestRunFindingResponse> {
    return this.post("/test-run-findings", params);
  }

  ensureTestRunFinding(
    params: EnsureTestRunFindingRequest
  ): Promise<TestRunFindingResponse> {
    return this.post("/test-run-findings/ensure", params);
  }

  ensureTestRunFindingBatch(
    items: EnsureTestRunFindingRequest[]
  ): Promise<TestRunFindingResponse[]> {
    if (items.length === 0) return Promise.resolve([]);
    return this.post("/test-run-findings/ensure-batch", { items });
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

  async getTestSurfacesByRunner(
    runnerId: number
  ): Promise<TestSurfaceResponse[]> {
    const cached = this.surfacesCache.get(runnerId);
    if (cached && Date.now() < cached.expiry) {
      return cached.data;
    }
    const data = await this.get<TestSurfaceResponse[]>(
      `/test-surfaces?runnerId=${runnerId}`
    );
    this.surfacesCache.set(runnerId, {
      data,
      expiry: Date.now() + ApiClient.SURFACES_CACHE_TTL_MS,
    });
    return data;
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

  findOrCreateScaffoldBatch(
    items: FindOrCreateScaffoldRequest[]
  ): Promise<ScaffoldResponse[]> {
    if (items.length === 0) return Promise.resolve([]);
    return this.post("/scaffolds/batch", { items });
  }

  getScaffolds(runnerId: number): Promise<ScaffoldResponse[]> {
    return this.get(`/scaffolds?runnerId=${runnerId}`);
  }

  updateScaffoldScreenshot(
    scaffoldId: number,
    screenshotPath: string
  ): Promise<ScaffoldResponse> {
    return this.patch(`/scaffolds/${scaffoldId}/screenshot`, {
      screenshotPath,
    });
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

  findMatchingPageStateByContentBody(
    pageId: number,
    fixedBodyHash: string,
    sizeClass: string
  ): Promise<PageStateResponse | null> {
    const qs = new URLSearchParams({
      pageId: String(pageId),
      sizeClass,
      fixedBodyHash,
    });
    return this.get(`/page-states/match-content-body?${qs}`);
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

  async ensureTestSurface(
    runnerId: number,
    testSurface: TestSurface,
    testEnvironmentId?: number
  ): Promise<TestSurfaceResponse> {
    const body: InsertTestSurfaceRequest = {
      runnerId,
      testEnvironmentId,
      testSurface,
    };
    const result = await this.post<TestSurfaceResponse>("/test-surfaces", body);
    this.invalidateSurfacesCache();
    return result;
  }

  async ensureTestSurfaceWithRun(params: {
    runnerId: number;
    testEnvironmentId?: number;
    testSurface: TestSurface;
    testSurfaceBundleId: number;
    testSurfaceBundleRunId: number;
  }): Promise<{
    surface: TestSurfaceResponse;
    surfaceRun: TestSurfaceRunResponse;
  }> {
    const result = await this.post<{
      surface: TestSurfaceResponse;
      surfaceRun: TestSurfaceRunResponse;
    }>("/test-surfaces/ensure-with-run", params);
    this.invalidateSurfacesCache();
    return result;
  }

  async ensureTestInteraction(
    runnerId: number,
    testSurfaceId: number,
    testInteraction: TestInteraction,
    testEnvironmentId?: number,
    existingTestInteractionId?: number
  ): Promise<TestInteractionResponse> {
    const body: InsertTestInteractionRequestCompat = {
      runnerId,
      testSurfaceId,
      testEnvironmentId,
      testInteraction,
      isGenerated: true,
      existingTestInteractionId,
    };
    const result = await this.post<TestInteractionResponse>(
      "/test-interactions",
      body
    );
    this.invalidateInteractionsCache();
    return result;
  }

  async ensureTestInteractionBatch(
    items: BatchTestInteractionItem[]
  ): Promise<BatchTestInteractionResult[]> {
    if (items.length === 0) return Promise.resolve([]);
    const result = await this.post<BatchTestInteractionResult[]>(
      "/test-interactions/batch",
      {
        items: items.map(item => ({
          ...item,
          isGenerated: true,
        })),
      }
    );
    this.invalidateInteractionsCache();
    return result;
  }

  async retireTestInteractions(testInteractionIds: number[]): Promise<void> {
    await this.put("/test-interactions/retire", { testInteractionIds });
    this.invalidateInteractionsCache();
  }

  async reconcileTestInteractions(params: {
    testSurfaceId: number;
    desiredKeys: string[];
    dependencyTestInteractionId?: number;
  }): Promise<{ retiredIds: number[] }> {
    const result = await this.post<{ retiredIds: number[] }>(
      "/test-interactions/reconcile",
      params
    );
    this.invalidateInteractionsCache();
    return result;
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

  ensureBundleInteractionLink(
    testSurfaceBundleId: number,
    testInteractionId: number
  ): Promise<TestSurfaceBundleInteractionLinkResponse> {
    return this.post("/test-surface-bundle-interactions", {
      testSurfaceBundleId,
      testInteractionId,
    });
  }

  ensureBundleScenarioLink(
    testSurfaceBundleId: number,
    testScenarioId: number
  ): Promise<TestSurfaceBundleScenarioLinkResponse> {
    return this.post("/test-surface-bundle-scenarios", {
      testSurfaceBundleId,
      testScenarioId,
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
      .catch(err => {
        logApi("claim-test-run:failed", {
          testRunId,
          instanceId: runnerInstanceId,
          error: err instanceof Error ? err.message : String(err),
        });
        return false;
      });
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

  completeTestSurfaceRunBatch(
    ids: number[],
    payload: { status?: string }
  ): Promise<void> {
    if (ids.length === 0) return Promise.resolve();
    return this.put("/test-surface-runs/complete-batch", { ids, ...payload });
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

  getTestInteractionsByTestSurface(
    testSurfaceId: number,
    includeInactive = false
  ): Promise<TestInteractionResponse[]> {
    return this.get(
      `/test-interactions?testSurfaceId=${testSurfaceId}&includeInactive=${includeInactive ? "true" : "false"}`
    );
  }

  getTestSurfacesByBundle(bundleId: number): Promise<TestSurfaceResponse[]> {
    return this.get(`/test-surface-bundle-surfaces?bundleId=${bundleId}`);
  }

  getTestInteractionsByBundle(
    bundleId: number
  ): Promise<TestInteractionResponse[]> {
    return this.get(`/test-surface-bundle-interactions?bundleId=${bundleId}`);
  }

  getTestScenariosByBundle(bundleId: number): Promise<TestScenarioResponse[]> {
    return this.get(`/test-surface-bundle-scenarios?bundleId=${bundleId}`);
  }

  getOpenTestInteractionRuns(
    testSurfaceRunId: number,
    includeBlocked = false
  ): Promise<TestInteractionRunResponse[]> {
    return this.get(
      `/test-interaction-runs?testSurfaceRunId=${testSurfaceRunId}&status=pending&includeBlocked=${includeBlocked ? "true" : "false"}`
    );
  }

  getOpenTestInteractionRunsBatch(
    testSurfaceRunIds: number[]
  ): Promise<BatchTestInteractionRunsResponse> {
    const ids = testSurfaceRunIds.join(",");
    return this.get(
      `/test-interaction-runs?testSurfaceRunIds=${ids}&status=pending`
    );
  }

  getOpenTestSurfaceRuns(
    bundleRunId: number
  ): Promise<TestSurfaceRunResponse[]> {
    return this.get(
      `/test-surface-runs?bundleRunId=${bundleRunId}&status=pending`
    );
  }

  getRunnerState(bundleRunId: number): Promise<{
    openSurfaceRuns: TestSurfaceRunResponse[];
    pendingInteractionRuns: BatchTestInteractionRunsResponse;
  }> {
    return this.get(`/runner-state?bundleRunId=${bundleRunId}`);
  }

  // ===========================================================================
  // Combined Endpoints
  // ===========================================================================

  combinedStart(params: CombinedStartRequest): Promise<CombinedNextResponse> {
    return this.post("/combined/start", params);
  }

  combinedNext(params: CombinedNextRequest): Promise<CombinedNextResponse> {
    return this.post("/combined/next", params);
  }

  combinedEnd(params: CombinedEndRequest): Promise<CombinedEndResponse> {
    return this.post("/combined/end", params);
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
