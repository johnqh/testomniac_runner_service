import type { BrowserAdapter } from "@sudobility/webgraph_parser";

export class StateManager {
  private currentPageStateId: number | undefined;
  private currentUrl: string = "";

  getCurrentPageStateId(): number | undefined {
    return this.currentPageStateId;
  }

  getCurrentUrl(): string {
    return this.currentUrl;
  }

  update(pageStateId: number, url: string): void {
    this.currentPageStateId = pageStateId;
    this.currentUrl = url;
  }

  matches(targetPageStateId: number | null | undefined): boolean {
    if (targetPageStateId === undefined || targetPageStateId === null)
      return true;
    return this.currentPageStateId === targetPageStateId;
  }

  async navigateTo(page: BrowserAdapter, url: string): Promise<void> {
    await page.goto(url, { waitUntil: "networkidle0", timeout: 30_000 });
    this.currentUrl = page.url();
  }
}
