# pi-pensieve

Pi extension for short-term memory backed by Pensieve. It loads the agent guide, open Scratchpad items and recent journal entries into a stable prompt snapshot; on quit, it summarizes meaningful sessions into today's journal. No new tools are registered: use your Pensieve MCP tools to edit pages.

Requires a Pensieve server with the `journal` page type (journals are excluded from default recall/search).

Install with `pi install ~/projects/pi-pensieve` or `pi install npm:@mipsel64/pi-pensieve`.

Configure `~/.config/mcp/mcp.json`:

```json
{
  "mcpServers": {
    "pensieve": {
      "url": "https://your-pensieve.example/mcp",
      "bearerTokenEnv": "PENSIEVE_TOKEN",
      "headers": { "X-Pensieve-Agent": "pi" }
    }
  }
}
```

Use `bearerToken` instead of `bearerTokenEnv` for a literal token, or override the connection with both `PENSIEVE_URL` and `PENSIEVE_TOKEN`. `PI_PENSIEVE_SUMMARY_MODEL=provider/model-id` optionally selects a different model for exit summaries; otherwise the active Pi model is used.
