# pi-pensieve

Short-term memory for [Pi](https://pi.dev), kept in [Pensieve](https://github.com/mipsel64/pensieve).

Pensieve is a self-hosted memory server that all of your agents share: a wiki of Markdown pages connected by `[[links]]`, stored in SQLite and served over MCP, with a web UI for reading it. Claude Code, Codex and Pi recall from it and write to it through its MCP tools. This extension adds what those tools don't do on their own in Pi:

- **Memory at the start of every session.** It adds Pensieve's agent guide and memory map, the open items on your `Scratchpad` page, and recent entries of today's and yesterday's journal pages to Pi's system prompt. Entries of the current project come first, then the newest of the others, up to 6000 characters. Entries that don't fit are listed by heading, so the agent can read them. The snapshot stays the same until compaction or the next day, so the prompt cache isn't reset every turn.
- **A journal of your sessions, written while you work.** A background `pi -p` with no tools asks the model for a short summary of the part of the session that isn't journaled yet: key files and how they work, decisions, lessons and unfinished work. It appends the summary to that day's `Journal YYYY-MM-DD` page. This happens 10 minutes after the agent goes idle, before each compaction, and when the session ends (quit, `/new`, resume or fork). Nothing waits for it, so a long session that you never quit still leaves a journal. Parts with nothing worth keeping write nothing, and print mode (`pi -p`) and subagent sessions never write.
- **Recall before the first prompt.** Before the first prompt of a session and after each compaction, the extension asks Pensieve for the passages that match your prompt and adds them to the turn, hidden from the screen. The model does not need to call `recall` first.

Journal pages and the Scratchpad have `type: journal`. Pensieve's `search` skips them unless an agent passes `type: "journal"`, and `recall` includes journal pages from the last 7 days. Only server 0.3.0 or newer returns recent journals in `recall`; older servers skip them. Lasting decisions and lessons still belong on regular pages. Pensieve's web UI shows the journal and Scratchpad in its Journal tab. The extension registers no tools; agents edit the Scratchpad with Pensieve's `edit` tool.

It replaces [pi-memory](https://github.com/jayzeng/pi-memory)'s local daily logs and scratchpad, and because the memory lives on the server, every device and agent sees the same journal.

## Setup

1. Run a Pensieve server, 0.2.0 or newer (the first release with journal pages). Use 0.3.0 or newer for recent journals in `recall`; see [its README](https://github.com/mipsel64/pensieve#server).
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

If Pensieve can't be reached, Pi starts without memory, warns once, and retries on a later turn.

## Settings

`/pensieve:settings` has two sections. "Session journal" turns the journal on or off and chooses the model and thinking level that write the summaries. By default, the session's own model writes them with low thinking. "Recall" turns on or off "Recall on first prompt", which is on by default. As in pi-processes' `/ps:settings`, the Global, Local and Memory tabs apply everywhere, in this project, or only to this session. Ctrl+S saves the Global tab to `~/.pi/agent/extensions/pensieve.json` and the Local tab to `.pi/extensions/pensieve.json`.
