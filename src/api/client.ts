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
  CreateActionRequest,
  ActionResponse,
  CompleteActionRequest,
  CreatePersonaRequest,
  PersonaResponse,
  CreateUseCaseRequest,
  UseCaseResponse,
  CreateInputValueRequest,
  InputValueResponse,
  InsertFormRequest,
  FormResponse,
  InsertTestCaseRequest,
  TestCaseResponse,
  CreateTestRunRequest,
  TestRunResponse,
  CompleteTestRunRequest,
  CreateIssueRequest,
  IssueResponse,
  RecordAiUsageRequest,
  CreateReportEmailRequest,
  SaveComponentRequest,
  HtmlElementResponse,
  ReusableHtmlElementResponse,
  FindOrCreateReusableHtmlElementRequest,
  PageHashes,
  ActionableItem,
  TestCase,
  FormInfo,
} from "@sudobility/testomniac_types";

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
    return this.get("/runs/pending");
  }

  updateRunPhase(runId: number, phase: string): Promise<void> {
    const body: UpdateRunPhaseRequest = { phase };
    return this.patch(`/runs/${runId}/phase`, body);
  }

  updateRunStats(runId: number, stats: UpdateRunStatsRequest): Promise<void> {
    return this.patch(`/runs/${runId}/stats`, stats);
  }

  updatePhaseDuration(
    runId: number,
    field: string,
    durationMs: number
  ): Promise<void> {
    const body: UpdatePhaseDurationRequest = { field, durationMs };
    return this.patch(`/runs/${runId}/phase-duration`, body);
  }

  completeRun(
    runId: number,
    aiSummary?: string,
    totalDurationMs?: number
  ): Promise<void> {
    const body: CompleteRunRequest = { aiSummary, totalDurationMs };
    return this.patch(`/runs/${runId}/complete`, body);
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

  findOrCreatePage(appId: number, url: string): Promise<PageResponse> {
    const body: FindOrCreatePageRequest = { appId, url };
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
    pageStateId: number,
    items: ActionableItem[]
  ): Promise<ActionableItemResponse[]> {
    const body: InsertActionableItemsRequest = { pageStateId, items };
    return this.post("/actionable-items", body);
  }

  getItemsByPageState(pageStateId: number): Promise<ActionableItemResponse[]> {
    return this.get(`/actionable-items?pageStateId=${pageStateId}`);
  }

  // ===========================================================================
  // Actions
  // ===========================================================================

  createAction(params: CreateActionRequest): Promise<ActionResponse> {
    return this.post("/actions", params);
  }

  getNextOpenAction(
    runId: number,
    sizeClass: string
  ): Promise<ActionResponse | null> {
    return this.get(`/actions/next?runId=${runId}&sizeClass=${sizeClass}`);
  }

  startAction(actionId: number): Promise<void> {
    return this.patch(`/actions/${actionId}/start`);
  }

  completeAction(
    actionId: number,
    params: CompleteActionRequest
  ): Promise<void> {
    return this.patch(`/actions/${actionId}/complete`, params);
  }

  getOpenActionCount(runId: number, sizeClass: string): Promise<number> {
    return this.get<{ count: number }>(
      `/actions/open-count?runId=${runId}&sizeClass=${sizeClass}`
    ).then(r => r.count);
  }

  getActionChain(actionId: number): Promise<ActionResponse[]> {
    return this.get(`/actions/chain/${actionId}`);
  }

  // ===========================================================================
  // Personas / Use Cases / Input Values
  // ===========================================================================

  createPersona(
    appId: number,
    name: string,
    description: string
  ): Promise<PersonaResponse> {
    const body: CreatePersonaRequest = { appId, name, description };
    return this.post("/personas", body);
  }

  getPersonasByApp(appId: number): Promise<PersonaResponse[]> {
    return this.get(`/personas?appId=${appId}`);
  }

  createUseCase(
    personaId: number,
    name: string,
    description: string
  ): Promise<UseCaseResponse> {
    const body: CreateUseCaseRequest = { personaId, name, description };
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

  insertTestCase(runId: number, testCase: TestCase): Promise<TestCaseResponse> {
    const body: InsertTestCaseRequest = { runId, testCase };
    return this.post("/test-cases", body);
  }

  getTestCasesByRun(runId: number): Promise<TestCaseResponse[]> {
    return this.get(`/test-cases?runId=${runId}`);
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
  // Issues
  // ===========================================================================

  createIssue(params: CreateIssueRequest): Promise<IssueResponse> {
    return this.post("/issues", params);
  }

  getIssuesByRun(runId: number): Promise<IssueResponse[]> {
    return this.get(`/issues?runId=${runId}`);
  }

  // ===========================================================================
  // AI Usage
  // ===========================================================================

  recordAiUsage(params: RecordAiUsageRequest): Promise<void> {
    return this.post("/ai-usage", params);
  }

  // ===========================================================================
  // Report Emails
  // ===========================================================================

  createReportEmail(params: CreateReportEmailRequest): Promise<void> {
    return this.post("/report-emails", params);
  }

  // ===========================================================================
  // Components (deprecated)
  // ===========================================================================

  /** @deprecated Use findOrCreateReusableHtmlElement instead */
  saveComponent(params: SaveComponentRequest): Promise<void> {
    return this.post("/components", params);
  }

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
