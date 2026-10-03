export type FormField = {
  backendNodeId: number;
  tagName: string;
  name: string;
  inputType?: string;
  required: boolean;
  disabled: boolean;
  value?: string;
  placeholder?: string;
  options?: { value: string; label?: string }[];
};

export type DetectedForm = {
  backendNodeId: number;
  action: string;
  method: string;
  fields: FormField[];
};

export type CompiledField =
  | {
      kind: "text";
      name: string;
      required: boolean;
      inputType: string;
      description?: string;
    }
  | {
      kind: "enum";
      name: string;
      required: boolean;
      values: string[];
      description?: string;
      widget?: "select" | "radio";
    }
  | {
      kind: "checkboxes";
      name: string;
      required: boolean;
      values: string[];
      description?: string;
    }
  | {
      kind: "boolean";
      name: string;
      required: boolean;
      description?: string;
    };

export type CompiledFormTool = {
  toolName: string;
  description: string;
  formIndex: number;
  action: string;
  method: string;
  fields: CompiledField[];
  inputSchema: Record<string, unknown>;
};
