# pi-pensieve

Short-term memory for [Pi](https://pi.dev), kept in [Pensieve](https://github.com/mipsel64/pensieve).

Pensieve is a self-hosted memory server that all of your agents share: a wiki of Markdown pages connected by `[[links]]`, stored in SQLite and served over MCP, with a web UI for reading it. Claude Code, Codex and Pi recall from it and write to it through its MCP tools. This extension adds what those tools don't do on their own in Pi:

- **Memory at the start of every session.** It adds Pensieve's agent guide and memory map, the open items on your `Scratchpad` page, and the end of today's and yesterday's journal pages to Pi's system prompt. The snapshot stays the same until compaction or the next day, so the prompt cache isn't reset every turn.
- **A journal of your sessions.** When you quit Pi, it asks the model for a short summary of the session's decisions, lessons and unfinished work, and appends it to that day's `Journal YYYY-MM-DD` page. Sessions with nothing worth keeping write nothing, and print mode (`pi -p`) and subagent sessions never write.

Journal pages and the Scratchpad have `type: journal`, so Pensieve's `recall` and `search` skip them unless an agent passes `type: "journal"`. Lasting decisions and lessons still belong on regular pages. Pensieve's web UI shows the journal and Scratchpad in its Journal tab. The extension registers no tools; agents edit the Scratchpad with Pensieve's `edit` tool.

It replaces [pi-memory](https://github.com/jayzeng/pi-memory)'s local daily logs and scratchpad, and because the memory lives on the server, every device and agent sees the same journal.

## Setup

1. Run a Pensieve server, 0.2.0 or newer (the first release with journal pages); see [its README](https://github.com/mipsel64/pensieve#server).
2. Connect Pi to it with [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter), as the [Pensieve README](https://github.com/mipsel64/pensieve#agents) describes. pi-pensieve reads the same entry in `~/.config/mcp/mcp.json`:

   ```json
   {
     "mcpServers": {
       "pensieve": {
         "url": "https://my-server.tailnet.ts.net/mcp",
         "auth": "bearer",
         "bearerTokenEnv": "PENSIEVE_TOKEN",
         "headers": { "X-Pensieve-Agent": "pi" },
         "directTools": true
       }
     }
   }
   ```

   `bearerToken` holds a literal token instead. Setting both `PENSIEVE_URL` and `PENSIEVE_TOKEN` overrides the file.
3. Install the extension and restart Pi:

   ```sh
   pi install npm:@mipsel64/pi-pensieve
   ```

`PI_PENSIEVE_SUMMARY_MODEL=provider/model-id` picks a cheaper model for session summaries; otherwise the session's model writes them.

If Pensieve can't be reached, Pi starts without memory, warns once, and retries on a later turn.
