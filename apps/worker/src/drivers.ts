import { Sandbox } from "@e2b/code-interpreter";
import { chromium, type Browser, type Page } from "playwright-core";
import type { BrowserDriver } from "./solver/types.js";

/**
 * Browserbase cloud browser over CDP. Watch-only for viewers: the live view is the
 * session's debugger URL, which only the worker holds. Each navigation records a
 * small JPEG frame so traces can be replayed.
 */
export class BrowserbaseDriver implements BrowserDriver {
  #browser: Browser | null = null;
  #page: Page | null = null;
  sessionId: string | null = null;
  lastFrame: string | null = null;

  constructor(private readonly apiKey: string, private readonly projectId: string) {}

  async #open(): Promise<Page> {
    if (this.#page) return this.#page;
    const r = await fetch("https://api.browserbase.com/v1/sessions", {
      method: "POST",
      headers: { "X-BB-API-Key": this.apiKey, "content-type": "application/json" },
      body: JSON.stringify({ projectId: this.projectId }),
    });
    if (!r.ok) throw new Error(`browserbase: ${r.status} ${await r.text()}`);
    const s = (await r.json()) as { id: string; connectUrl: string };
    this.sessionId = s.id;
    this.#browser = await chromium.connectOverCDP(s.connectUrl);
    const ctx = this.#browser.contexts()[0] ?? (await this.#browser.newContext());
    this.#page = ctx.pages()[0] ?? (await ctx.newPage());
    return this.#page;
  }

  async #frame(page: Page) {
    const jpg = await page.screenshot({ type: "jpeg", quality: 40 }).catch(() => null);
    this.lastFrame = jpg ? `data:image/jpeg;base64,${jpg.toString("base64")}` : null;
  }

  async navigate(url: string): Promise<string> {
    const page = await this.#open();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await this.#frame(page);
    return this.read();
  }

  async read(): Promise<string> {
    const page = await this.#open();
    return (await page.innerText("body").catch(() => "")).slice(0, 40_000);
  }

  async close() {
    await this.#browser?.close().catch(() => {});
    this.#browser = null;
    this.#page = null;
  }
}

export interface ExperimentResult {
  stdout: string;
  stderr: string;
  error: string | null;
  seconds: number;
}

/**
 * Sandboxed experiment runner (E2B), networkless like HashSmash's executor.
 * The sandbox is billed per second; callers book `seconds` to the ledger as "sandbox".
 */
export class E2BRunner {
  #sbx: Sandbox | null = null;
  constructor(private readonly apiKey: string, private readonly timeoutMs = 120_000) {}

  async run(code: string): Promise<ExperimentResult> {
    const started = Date.now();
    this.#sbx ??= await Sandbox.create({ apiKey: this.apiKey, allowInternetAccess: false });
    const ex = await this.#sbx.runCode(code, { timeoutMs: this.timeoutMs });
    return {
      stdout: ex.logs.stdout.join("").slice(-20_000),
      stderr: ex.logs.stderr.join("").slice(-5_000),
      error: ex.error ? `${ex.error.name}: ${ex.error.value}` : null,
      seconds: (Date.now() - started) / 1000,
    };
  }

  async close() {
    await this.#sbx?.kill().catch(() => {});
    this.#sbx = null;
  }
}
