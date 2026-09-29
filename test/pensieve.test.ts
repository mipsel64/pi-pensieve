import { test } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import pensieve, { appendJournal, buildSnapshot, isNone, localDate, newJournal, openItems, resolveConfig } from "../index.ts";

test("Pensieve memory helpers", () => {
  const file = { mcpServers: { pensieve: {
    url: "https://memory.example/mcp/", bearerTokenEnv: "SECRET", headers: { "X-Pensieve-Agent": "custom", "X-Other": "yes" },
  } } };
  assert.deepEqual(resolveConfig({ SECRET: "file-token" }, file), {
    base: "https://memory.example", headers: { "X-Pensieve-Agent": "custom", "X-Other": "yes", Authorization: "Bearer file-token" },
  });
  assert.deepEqual(resolveConfig({ PENSIEVE_URL: "http://localhost:123/mcp", PENSIEVE_TOKEN: "env-token" }, file), {
    base: "http://localhost:123", headers: { "X-Pensieve-Agent": "pi", Authorization: "Bearer env-token" },
  });
  assert.equal(resolveConfig({}, file), undefined);
  assert.equal(resolveConfig({}, undefined), undefined);
  assert.equal(resolveConfig({}, { mcpServers: { pensieve: { url: "http://localhost", bearerToken: "token" } } })?.headers["X-Pensieve-Agent"], "pi");

  const now = new Date(2026, 0, 1, 9, 5);
  assert.equal(localDate(now), "2026-01-01");
  assert.equal(openItems("- [ ] first\n- [x] done\n  - [ ] second\n- [ ] third"), "- [ ] first\n  - [ ] second\n- [ ] third");
  assert.equal(openItems(`- [ ] ${"a".repeat(2100)}`).length, 2000);
  const snapshot = buildSnapshot("guide", "---\ntype: journal\n---\n- [x] closed\n- [ ] open", "---\ntype: journal\n---\n" + "t".repeat(3100), "y".repeat(3200), now);
  assert.ok(snapshot.includes("guide\n\nShort-term memory"));
  assert.ok(snapshot.includes("Scratchpad (open items):\n- [ ] open"));
  assert.ok(!snapshot.includes("closed"));
  assert.ok(snapshot.includes("Journal 2025-12-31:\n"));
  assert.equal(snapshot.split("Journal 2026-01-01:\n")[1]?.split("\n\nJournal 2025")[0]?.length, 3000);
  assert.equal(buildSnapshot("", "", "", "", now), "");
  assert.equal(buildSnapshot("", "- [x] done", "", "", now), "");
  assert.equal(newJournal("2026-01-01"), "---\ntype: journal\ntags: [journal]\n---\n# Journal 2026-01-01\n");
  assert.equal(appendJournal(newJournal("2026-01-01"), "### Decisions\n- Choice", now, "repo", "abcdefgh-123"),
    `${newJournal("2026-01-01")}\n## 09:05 repo (abcdefgh)\n\n### Decisions\n- Choice\n`);
  assert.ok(isNone(" NONE \n"));
  assert.ok(isNone("\t"));
  assert.ok(!isNone("### Decisions\n- Choice"));
});

test("retries a failed snapshot on a later turn, at most once a minute", async t => {
  process.env.PENSIEVE_URL = "http://pensieve.test/mcp";
  process.env.PENSIEVE_TOKEN = "token-0123456789abcdef";
  t.after(() => { delete process.env.PENSIEVE_URL; delete process.env.PENSIEVE_TOKEN; });
  let up = false;
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    if (!up) throw new TypeError("fetch failed");
    return String(url).endsWith("/mcp") ? Response.json({ result: { instructions: "guide" } }) : new Response(null, { status: 404 });
  });
  t.mock.timers.enable({ apis: ["Date"] });
  const on: Record<string, Function> = {};
  pensieve({ on: (name: string, handler: Function) => { on[name] = handler; } } as never);
  const ctx = { hasUI: false };
  const turn = async () => {
    const event = { systemPromptOptions: {} as { sections?: Record<string, string> } };
    await on.before_agent_start(event, ctx);
    return event.systemPromptOptions.sections?.pensieve;
  };
  await on.session_start({}, ctx);
  assert.equal(await turn(), undefined);
  up = true;
  assert.equal(await turn(), undefined);
  t.mock.timers.tick(60_000);
  assert.match(await turn() ?? "", /^guide\n\nShort-term memory/);

  const forced = { systemPrompt: "forced", systemPromptOptions: { forceSystemPrompt: "forced" } as { forceSystemPrompt?: string; sections?: Record<string, string> } };
  const result = await on.before_agent_start(forced, ctx);
  assert.match(result?.systemPrompt ?? "", /^forced\n\n<pensieve>\nguide\n/);
  assert.equal(forced.systemPromptOptions.sections, undefined);
});

test("quitting hands the summary to a detached pi that appends it to the journal", async t => {
  process.env.PENSIEVE_URL = "http://pensieve.test/mcp";
  process.env.PENSIEVE_TOKEN = "token-0123456789abcdef";
  t.after(() => { delete process.env.PENSIEVE_URL; delete process.env.PENSIEVE_TOKEN; delete process.env.PI_PENSIEVE_JOB; });
  const puts: { url: string; body: { content: string; base_rev: number } }[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "PUT") puts.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return String(url).endsWith("/mcp") ? Response.json({ result: { instructions: "guide" } }) : new Response(null, { status: 404 });
  });
  const spawned: { args: string[]; options: { cwd: string; detached: boolean; env: NodeJS.ProcessEnv } }[] = [];
  t.mock.method(childProcess, "spawn", (_command: string, args: string[], options: never) => {
    spawned.push({ args, options });
    return { on() {}, unref() {} };
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });

  const message = (role: string, text: string) => ({ type: "message", message: { role, content: [{ type: "text", text }], stopReason: "stop", timestamp: 0 } });
  const branch = (...messages: ReturnType<typeof message>[]) => messages.map((entry, i) => ({ ...entry, id: String(i), parentId: i ? String(i - 1) : null }));
  const entries = branch(message("user", "a"), message("assistant", "b"), message("user", "c"), message("assistant", "d"));
  const on: Record<string, Function> = {};
  pensieve({ on: (name: string, handler: Function) => { on[name] = handler; } } as never);
  const ctx = {
    hasUI: true, cwd: "/work/repo", model: { provider: "p", id: "m" }, modelRegistry: { find: () => undefined },
    ui: { notify() {} }, sessionManager: { getBranch: () => entries, getSessionId: () => "abcdefgh-123" },
  };
  await on.session_start({}, ctx);
  await on.session_shutdown({ reason: "quit" }, ctx);
  assert.equal(spawned.length, 1);
  const { args, options } = spawned[0]!;
  const job = JSON.parse(options.env.PI_PENSIEVE_JOB!);
  const transcript = join(job.dir, "conversation.md");
  assert.ok(options.detached);
  assert.equal(options.cwd, "/work/repo");
  assert.deepEqual(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2), ["--model", "p/m"]);
  assert.ok(args.includes("-nt") && args.includes("--no-session") && args.at(-1) === `@${transcript}`);
  assert.match(readFileSync(transcript, "utf8"), /^<conversation>\n[\s\S]*d\n<\/conversation>\n$/);

  process.env.PI_PENSIEVE_JOB = options.env.PI_PENSIEVE_JOB;
  const worker: Record<string, Function> = {};
  pensieve({ on: (name: string, handler: Function) => { worker[name] = handler; } } as never);
  assert.deepEqual(Object.keys(worker), ["session_start", "session_shutdown"]);
  worker.session_start({}, {});
  assert.ok(!existsSync(job.dir));
  const time = new Date(job.time);
  await worker.session_shutdown({ reason: "quit" }, { sessionManager: { getBranch: () => branch(message("user", "x"), message("assistant", "### Decisions\n- Choice")) } });
  assert.equal(puts.length, 1);
  assert.equal(puts[0]!.url, `http://pensieve.test/api/pages/${encodeURIComponent(`Journal ${localDate(time)}`)}`);
  assert.equal(puts[0]!.body.content, appendJournal(newJournal(localDate(time)), "### Decisions\n- Choice", time, "repo", "abcdefgh-123"));
});
