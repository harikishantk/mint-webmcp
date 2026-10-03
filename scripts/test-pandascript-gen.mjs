#!/usr/bin/env node
import { compileForms } from "../dist/form-compiler.js";
import { generatePandaScript } from "../dist/pandascript.js";

const tools = compileForms(
  [
    {
      backendNodeId: 1,
      action: "/post",
      method: "post",
      fields: [
        {
          backendNodeId: 2,
          tagName: "input",
          name: "custname",
          inputType: "text",
          required: false,
          disabled: false,
        },
        {
          backendNodeId: 3,
          tagName: "input",
          name: "custemail",
          inputType: "email",
          required: false,
          disabled: false,
        },
        {
          backendNodeId: 4,
          tagName: "select",
          name: "size",
          required: false,
          disabled: false,
          options: [
            { value: "small", label: "Small" },
            { value: "large", label: "Large" },
          ],
        },
        {
          backendNodeId: 5,
          tagName: "input",
          name: "agree",
          inputType: "checkbox",
          required: false,
          disabled: false,
        },
      ],
    },
  ],
  "https://httpbin.org/forms/post",
);

const script = generatePandaScript({
  pageUrl: "https://httpbin.org/forms/post",
  tool: tools[0],
  values: { custname: "Ada", custemail: "ada@example.com", size: "large", agree: true },
  autoSubmit: true,
});

if (
  !script.includes("page.fill") ||
  !script.includes("page.click") ||
  !script.includes("Ada") ||
  !script.includes("page.selectOption") ||
  !script.includes("page.setChecked")
) {
  console.error("unexpected script:\n", script);
  process.exit(1);
}
console.log(script);
console.log("pandascript-gen ok");
