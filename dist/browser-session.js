import { spawn } from "node:child_process";
import { chromium } from "playwright-core";
import { compileForms } from "./form-compiler.js";
export class LightpandaSession {
    lightpandaBin;
    proc = null;
    browser = null;
    context = null;
    page = null;
    cdp = null;
    port;
    compiled = [];
    currentUrl = "";
    constructor(lightpandaBin, port) {
        this.lightpandaBin = lightpandaBin;
        this.port = port ?? 9222;
    }
    getFormTools() {
        return this.compiled;
    }
    getPageUrl() {
        return this.currentUrl;
    }
    async attach(url, timeoutMs = 30_000) {
        await this.ensureBrowser();
        const page = this.page;
        await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
        this.currentUrl = page.url();
        const title = await page.title();
        const forms = await this.detectForms();
        this.compiled = compileForms(forms, this.currentUrl);
        return { url: this.currentUrl, title, tools: this.compiled };
    }
    async invokeForm(toolName, args) {
        const tool = this.compiled.find((t) => t.toolName === toolName);
        if (!tool) {
            throw new Error(`Unknown form tool "${toolName}". Call web_attach first.`);
        }
        const page = this.page;
        const formRoot = page.locator("form").nth(tool.formIndex);
        const autoSubmit = args.autoSubmit !== false;
        for (const field of tool.fields) {
            const value = args[field.name];
            if (value === undefined || value === null)
                continue;
            if (field.kind === "enum") {
                await formRoot.locator(`input[type="radio"][name="${cssEscape(field.name)}"][value="${cssEscape(String(value))}"]`).check();
                continue;
            }
            if (field.kind === "checkboxes") {
                const selected = Array.isArray(value) ? value.map(String) : [String(value)];
                for (const opt of field.values) {
                    const box = formRoot.locator(`input[type="checkbox"][name="${cssEscape(field.name)}"][value="${cssEscape(opt)}"]`);
                    const shouldCheck = selected.includes(opt);
                    if (shouldCheck)
                        await box.check();
                    else
                        await box.uncheck().catch(() => undefined);
                }
                continue;
            }
            const selector = `textarea[name="${cssEscape(field.name)}"], input[name="${cssEscape(field.name)}"]`;
            await formRoot.locator(selector).first().fill(String(value));
        }
        if (!autoSubmit) {
            return JSON.stringify({
                status: "filled",
                message: "Form filled; autoSubmit was false. Submit manually or call again with autoSubmit: true.",
                url: page.url(),
                title: await page.title(),
            }, null, 2);
        }
        const submit = formRoot.locator('button[type="submit"], input[type="submit"], button:not([type="button"])').first();
        await submit.click();
        await page.waitForLoadState("load", { timeout: 15_000 }).catch(() => undefined);
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
        this.currentUrl = page.url();
        let markdown = "";
        try {
            const md = await this.cdp.send("LP.getMarkdown", {});
            markdown = md.markdown ?? "";
        }
        catch {
            markdown = (await page.locator("body").innerText()).slice(0, 8000);
        }
        return JSON.stringify({
            status: "submitted",
            url: this.currentUrl,
            title: await page.title(),
            markdown: markdown.slice(0, 12_000),
        }, null, 2);
    }
    async close() {
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
    async ensureBrowser() {
        if (this.browser && this.page)
            return;
        if (!this.proc) {
            this.proc = spawn(this.lightpandaBin, ["serve", "--host", "127.0.0.1", "--port", String(this.port)], { stdio: ["ignore", "pipe", "pipe"] });
            await waitForCdp(`http://127.0.0.1:${this.port}`, 15_000);
        }
        this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.port}`);
        this.context = await this.browser.newContext();
        this.page = await this.context.newPage();
        this.cdp = await this.context.newCDPSession(this.page);
    }
    async detectForms() {
        const result = await this.cdp.send("LP.detectForms", {});
        const forms = result.forms ?? [];
        return forms;
    }
}
function cssEscape(value) {
    return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
async function waitForCdp(endpoint, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(`${endpoint}/json/version`);
            if (res.ok)
                return;
        }
        catch {
            /* retry */
        }
        await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(`Lightpanda CDP not ready at ${endpoint} after ${timeoutMs}ms`);
}
