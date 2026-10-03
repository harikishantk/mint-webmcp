import type { CompiledFormTool } from "./types.js";
export type AttachResult = {
    url: string;
    title: string;
    tools: CompiledFormTool[];
};
export declare class LightpandaSession {
    private readonly lightpandaBin;
    private proc;
    private browser;
    private context;
    private page;
    private cdp;
    private port;
    private compiled;
    private currentUrl;
    constructor(lightpandaBin: string, port?: number);
    getFormTools(): CompiledFormTool[];
    getPageUrl(): string;
    attach(url: string, timeoutMs?: number): Promise<AttachResult>;
    invokeForm(toolName: string, args: Record<string, unknown>): Promise<string>;
    close(): Promise<void>;
    private ensureBrowser;
    private detectForms;
}
