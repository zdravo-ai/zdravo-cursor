# zdravo-mcp

**Persistent memory for Cursor AI.**  
Connects Cursor to [Zdravo AI](https://zdravo.ai) — your personal long-term memory layer.

---

## Setup

1. Get your API key at [zdravo.ai/dashboard/mcp](https://zdravo.ai/dashboard/mcp)
2. Add to your Cursor `mcp.json`:

```json
{
  "mcpServers": {
    "zdravo": {
      "command": "npx",
      "args": ["-y", "zdravo-mcp"],
      "env": {
        "ZDRAVO_API_KEY": "your-api-key"
      }
    }
  }
}
```

3. Restart Cursor.

---

## Available tools

| Tool | Description |
|------|-------------|
| `zdravo_save` | Save a memory to your persistent store |
| `zdravo_search` | Search your memory by semantic query |

---

## Links

- Docs: https://docs.zdravo.ai
- npm: https://www.npmjs.com/package/@zdravoai/mcp
- Website: https://zdravo.ai
