import type { CompiledField, CompiledFormTool, DetectedForm } from "./types.js";

const SKIP_INPUT_TYPES = new Set(["hidden", "submit", "button", "image", "reset", "file"]);

function slugify(part: string): string {
  const s = part
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);
  return s || "form";
}

function guessFormPurpose(fields: CompiledField[], action: string): string {
  const names = fields.map((f) => f.name.toLowerCase()).join(" ");
  if (/password/.test(names) && /(user|email|login)/.test(names)) return "Sign in";
  if (/password/.test(names) && /(register|signup|sign.up)/.test(names + action)) return "Register";
  if (/search|query|q\b/.test(names)) return "Search";
  if (/email|message|comment|contact/.test(names)) return "Contact";
  return `Submit form (${action || "same page"})`;
}

function compileFields(raw: DetectedForm["fields"]): CompiledField[] {
  const byName = new Map<string, DetectedForm["fields"]>();
  for (const f of raw) {
    if (f.disabled || !f.name) continue;
    const t = (f.inputType ?? "text").toLowerCase();
    if (SKIP_INPUT_TYPES.has(t)) continue;
    const list = byName.get(f.name) ?? [];
    list.push(f);
    byName.set(f.name, list);
  }

  const out: CompiledField[] = [];
  for (const [name, group] of byName) {
    const required = group.some((f) => f.required);
    const desc = group.find((f) => f.placeholder)?.placeholder;

    if (group.length > 1 && group.every((f) => (f.inputType ?? "").toLowerCase() === "radio")) {
      out.push({
        kind: "enum",
        name,
        required,
        values: group.map((f) => f.value ?? "").filter(Boolean),
        description: desc,
      });
      continue;
    }

    if (group.every((f) => (f.inputType ?? "").toLowerCase() === "checkbox")) {
      out.push({
        kind: "checkboxes",
        name,
        required,
        values: group.map((f) => f.value ?? "on").filter(Boolean),
        description: desc,
      });
      continue;
    }

    const first = group[0];
    out.push({
      kind: "text",
      name,
      required,
      inputType: (first.inputType ?? "text").toLowerCase(),
      description: desc,
    });
  }
  return out;
}

function fieldToJsonSchema(f: CompiledField): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  if (f.description) base.description = f.description;

  if (f.kind === "enum") {
    return {
      ...base,
      type: "string",
      enum: f.values.length ? f.values : undefined,
    };
  }
  if (f.kind === "checkboxes") {
    return {
      ...base,
      type: "array",
      items: { type: "string", enum: f.values.length ? f.values : undefined },
      uniqueItems: true,
    };
  }
  return { ...base, type: "string" };
}

export function compileForms(forms: DetectedForm[], pageUrl: string): CompiledFormTool[] {
  return forms.map((form, index) => {
    const fields = compileFields(form.fields);
    const actionSlug = slugify(form.action || new URL(pageUrl).pathname);
    const toolName = `form_${index}_${actionSlug}`.replace(/_+/g, "_");

    const properties: Record<string, unknown> = {};
    for (const f of fields) {
      properties[f.name] = fieldToJsonSchema(f);
    }

    const purpose = guessFormPurpose(fields, form.action);
    const description = `${purpose} — ${form.method.toUpperCase()} ${form.action || pageUrl}`;

    const inputSchema: Record<string, unknown> = {
      type: "object",
      properties: {
        ...properties,
        autoSubmit: {
          type: "boolean",
          description: "Submit after filling (WebMCP toolautosubmit). Default true.",
          default: true,
        },
      },
      additionalProperties: false,
    };
    const requiredFields = fields.filter((f) => f.required).map((f) => f.name);
    if (requiredFields.length) {
      inputSchema.required = requiredFields;
    }

    return {
      toolName,
      description,
      formIndex: index,
      action: form.action,
      method: form.method,
      fields,
      inputSchema,
    };
  });
}
