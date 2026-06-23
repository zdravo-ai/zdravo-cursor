import { spawn } from "node:child_process";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const API_KEY = process.env.ZDRAVO_API_KEY;

if (!API_KEY) {
  console.error("Missing ZDRAVO_API_KEY");
  process.exit(1);
}

const server = new Server(
  {
    name: "zdravo",
    version: "2.2.3",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler("tools/list", async () => ({
  tools: [
    {
      name: "zdravo_save",
      description: "Save a memory to your Zdravo AI persistent memory",
      inputSchema: {
        type: "object",
        properties: {
          content: { type: "string", description: "The memory content to save" },
          tags: { type: "array", items: { type: "string" } },
        },
        required: ["content"],
      },
    },
    {
      name: "zdravo_search",
      description: "Search your Zdravo AI memory",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Max results (default 10)" },
        },
        required: ["query"],
      },
    },
  ],
}));

server.setRequestHandler("tools/call", async (params) => {
  const { name, arguments: args } = params.params;

  if (name === "zdravo_save") {
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: true, memory: args }) }],
    };
  }

  if (name === "zdravo_search") {
    return {
      content: [{ type: "text", text: JSON.stringify({ ok: true, results: [] }) }],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
