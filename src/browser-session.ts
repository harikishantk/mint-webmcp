import { spawn, type ChildProcess } from "node:child_process";
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from "playwright-core";
import type { CompiledField, CompiledFormTool, DetectedForm } from "./types.js";
import { compileForms } from "./form-compiler.js";
import { generatePandaScript } from "./pandascript.js";
import { shouldSubmitForm, stripSubmitFlags } from "./submit.js";

export type AttachResult = {
  url: string;
  title: string;
  tools: CompiledFormTool[];
};

export class LightpandaSession {
  private proc: ChildProcess | null = null;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private cdp: CDPSession | null = null;
  private port: number;
  private compiled: CompiledFormTool[] = [];
  private currentUrl = "";
  private attachUrl = "";
  private lastFillByTool = new Map<string, { values: Record<string, unknown>; autoSubmit: boolean }>();

  constructor(
    private readonly lightpandaBin: string,
    port?: number,
  ) {
    this.port = port ?? 9222;
  }

  getFormTools(): CompiledFormTool[] {
    return this.compiled;
  }

  getPageUrl(): string {
    return this.currentUrl;
  }

  getLastFill(toolName: string): { values: Record<string, unknown>; autoSubmit: boolean } | undefined {
    return this.lastFillByTool.get(toolName);
  }

  async attach(url: string, timeoutMs = 30_000): Promise<AttachResult> {
    await this.ensureBrowser();
    const page = this.page!;
    await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
    this.currentUrl = page.url();
    this.attachUrl = this.currentUrl;
    const title = await page.title();

    const forms = await this.detectForms();
    this.compiled = compileForms(forms, this.currentUrl);
    this.lastFillByTool.clear();

    return { url: this.currentUrl, title, tools: this.compiled };
  }

  exportPandaScript(
    toolName: string,
    overrides?: { values?: Record<string, unknown>; autoSubmit?: boolean },
  ): string {
    const tool = this.compiled.find((t) => t.toolName === toolName);
    if (!tool) {
      throw new Error(`Unknown form tool "${toolName}". Call web_attach first.`);
    }
    if (!this.currentUrl) {
      throw new Error("No page attached.");
    }
    const last = this.lastFillByTool.get(toolName);
    const values = overrides?.values ?? last?.values ?? {};
    const autoSubmit = overrides?.autoSubmit ?? last?.autoSubmit ?? false;
    return generatePandaScript({
      pageUrl: this.attachUrl || this.currentUrl,
      tool,
      values,
      autoSubmit,
    });
  }

  async invokeForm(toolName: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.compiled.find((t) => t.toolName === toolName);
    if (!tool) {
      throw new Error(`Unknown form tool "${toolName}". Call web_attach first.`);
    }

    const page = this.page!;
    const formRoot = page.locator("form").nth(tool.formIndex);
    const autoSubmit = shouldSubmitForm(args);
    const fieldArgs = stripSubmitFlags(args);
    this.lastFillByTool.set(toolName, {
      values: fieldArgs,
      autoSubmit,
    });

    for (const field of tool.fields) {
      const value = fieldArgs[field.name];
      if (value === undefined || value === null) continue;

      if (field.kind === "enum") {
        const radio = formRoot.locator(
          `input[type="radio"][name="${cssEscape(field.name)}"][value="${cssEscape(String(value))}"]`,
        );
        if ((await radio.count()) > 0) {
          await radio.check();
        } else {
          await formRoot.locator(`select[name="${cssEscape(field.name)}"]`).selectOption(String(value));
        }
        continue;
      }

      if (field.kind === "boolean") {
        const box = formRoot.locator(`input[type="checkbox"][name="${cssEscape(field.name)}"]`).first();
        if (value === true || value === "true" || value === 1 || value === "1") {
          await box.check();
        } else {
          await box.uncheck().catch(() => undefined);
        }
        continue;
      }

      if (field.kind === "checkboxes") {
        const selected = Array.isArray(value) ? value.map(String) : [String(value)];
        for (const opt of field.values) {
          const box = formRoot.locator(
            `input[type="checkbox"][name="${cssEscape(field.name)}"][value="${cssEscape(opt)}"]`,
          );
          const shouldCheck = selected.includes(opt);
          if (shouldCheck) await box.check();
          else await box.uncheck().catch(() => undefined);
        }
        continue;
      }

      const selector = `textarea[name="${cssEscape(field.name)}"], input[name="${cssEscape(field.name)}"]`;
      await formRoot.locator(selector).first().fill(String(value));
    }

    let validationErrors = await collectValidationErrors(formRoot, tool.fields);

    if (!autoSubmit) {
      const status = validationErrors.length ? "validation_error" : "filled";
      return JSON.stringify(
        {
          status,
          validationErrors,
          message:
            status === "filled"
              ? "Form filled; pass autoSubmit: true or confirmSubmit: true to submit."
              : "Form filled but validation errors were detected on the page.",
          url: page.url(),
          title: await page.title(),
        },
        null,
        2,
      );
    }

    const submit = formRoot.locator(
      'button[type="submit"], input[type="submit"], button:not([type="button"])',
    ).first();

    const beforeSubmitUrl = page.url();
    await submit.click();
    await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);

    this.currentUrl = page.url();

    if (page.url() !== beforeSubmitUrl) {
      let markdown = "";
      try {
        const md = await this.cdp!.send("LP.getMarkdown" as never, {} as never);
        markdown = (md as { markdown?: string }).markdown ?? "";
      } catch {
        markdown = (await page.locator("body").innerText()).slice(0, 8000);
      }

      return JSON.stringify(
        {
          status: "submitted",
          validationErrors: [],
          url: this.currentUrl,
          title: await page.title(),
          markdown: markdown.slice(0, 12_000),
          replay: `web_export_script { "toolName": ${JSON.stringify(toolName)} }`,
        },
        null,
        2,
      );
    }

    const postSubmitErrors = await collectValidationErrors(formRoot, tool.fields);
    if (postSubmitErrors.length > 0) {
      return JSON.stringify(
        {
          status: "validation_error",
          validationErrors: postSubmitErrors,
          url: page.url(),
          title: await page.title(),
          message: "Submit was attempted but validation errors remain on the page.",
        },
        null,
        2,
      );
    }

    let markdown = "";
    try {
      const md = await this.cdp!.send("LP.getMarkdown" as never, {} as never);
      markdown = (md as { markdown?: string }).markdown ?? "";
    } catch {
      markdown = (await page.locator("body").innerText()).slice(0, 8000);
    }

    return JSON.stringify(
      {
        status: "submitted",
        validationErrors: [],
        url: this.currentUrl,
        title: await page.title(),
        markdown: markdown.slice(0, 12_000),
        replay: `web_export_script { "toolName": ${JSON.stringify(toolName)} }`,
      },
      null,
      2,
    );
  }

  async close(): Promise<void> {
    await this.browser?.close().catch(() => undefined);
    this.browser = null;
    this.context = null;
    this.page = null;
    this.cdp = null;
    if (this.proc && !this.proc.killed) {
      this.proc.kill("SIGTERM");
    }
    this.proc = null;
  }

  private async ensureBrowser(): Promise<void> {
    if (this.browser && this.page) return;

    if (!this.proc) {
      this.proc = spawn(
        this.lightpandaBin,
        ["serve", "--host", "127.0.0.1", "--port", String(this.port)],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      await waitForCdp(`http://127.0.0.1:${this.port}`, 15_000);
    }

    this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.port}`);
    this.context = await this.browser.newContext();
    this.page = await this.context.newPage();
    this.cdp = await this.context.newCDPSession(this.page);
  }

  private async detectForms(): Promise<DetectedForm[]> {
    const result = await this.cdp!.send("LP.detectForms" as never, {} as never);
    const forms = (result as { forms?: DetectedForm[] }).forms ?? [];
    return forms;
  }
}

function cssEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export type ValidationError = { field: string; message?: string };

async function collectValidationErrors(
  formRoot: ReturnType<Page["locator"]>,
  fields: CompiledField[],
): Promise<ValidationError[]> {
  const raw = await formRoot.evaluate((form) => {
    const errors: { field: string; message?: string }[] = [];
    const seen = new Set<string>();

    const add = (field: string, message?: string) => {
      if (!field || seen.has(field)) return;
      seen.add(field);
      errors.push({ field, message });
    };

    for (const el of form.querySelectorAll('[aria-invalid="true"]')) {
      const name =
        (el as HTMLInputElement).name ||
        el.getAttribute("id") ||
        el.getAttribute("aria-describedby") ||
        "unknown";
      const described = el.getAttribute("aria-describedby");
      let message: string | undefined;
      if (described) {
        const node = form.querySelector(`#${CSS.escape(described.split(/\s+/)[0] ?? "")}`);
        message = node?.textContent?.trim() || undefined;
      }
      add(name, message);
    }

    for (const el of form.querySelectorAll(".error, .invalid, [role='alert'], .field-error, .form-error")) {
      const text = el.textContent?.trim();
      const labelled =
        el.getAttribute("data-for") ||
        el.getAttribute("for") ||
        el.closest("label")?.querySelector("input, select, textarea")?.getAttribute("name");
      if (labelled) add(labelled, text || undefined);
      else if (text) add("_form", text);
    }

    for (const input of form.querySelectorAll("input, select, textarea")) {
      const inp = input as HTMLInputElement;
      if (!inp.name) continue;
      if (inp.required && !String(inp.value ?? "").trim()) {
        add(inp.name, inp.validationMessage || "Required field is empty");
      } else if (!inp.checkValidity?.() && inp.validationMessage) {
        add(inp.name, inp.validationMessage);
      }
    }

    return errors;
  });

  const knownNames = new Set(fields.map((f) => f.name));
  return raw.filter((e) => e.field === "_form" || knownNames.has(e.field) || e.field !== "unknown");
}

async function waitForCdp(endpoint: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${endpoint}/json/version`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Lightpanda CDP not ready at ${endpoint} after ${timeoutMs}ms`);
}
