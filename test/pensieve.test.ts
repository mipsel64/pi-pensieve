import { mock, test } from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pensieve, { appendJournal, buildSnapshot, formatRecall, isNone, journalDelta, journalEntries, localDate, newJournal, openItems, resolveConfig } from "../index.ts";

const agentDir = process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-pensieve-test-"));
// Mocked once: Node does not re-sync the ESM binding of spawn after a second mock of it.
const spawned: { args: string[]; options: { cwd: string; detached: boolean; env: NodeJS.ProcessEnv } }[] = [];
mock.method(childProcess, "spawn", (_command: string, args: string[], options: never) => {
  spawned.push({ args, options });
  return { on() {}, unref() {} };
});
syncBuiltinESMExports();
const appended: { customType: string; data: unknown }[] = [];
const load = () => {
  const on: Record<string, Function> = {};
  pensieve({ on: (name: string, handler: Function) => { on[name] = handler; }, registerCommand() {}, appendEntry: (customType: string, data: unknown) => { appended.push({ customType, data }); } } as never);
  return on;
};
const writeSettings = (settings: object) => {
  mkdirSync(join(agentDir, "extensions"), { recursive: true });
  writeFileSync(join(agentDir, "extensions/pensieve.json"), JSON.stringify(settings));
};

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
  const entry = (time: string, project: string, text: string) => `\n## ${time} ${project} (abcdefgh)\n\n${text}\n`;
  const snapshot = buildSnapshot("guide", "---\ntype: journal\n---\n- [x] closed\n- [ ] open", `---\ntype: journal\n---\n# Journal 2026-01-01\n${entry("08:00", "repo", "today entry")}`, `# Journal 2025-12-31\n${entry("22:00", "repo", "old entry")}`, now, "repo");
  assert.ok(snapshot.includes("guide\n\nShort-term memory"));
  assert.ok(snapshot.includes("Scratchpad (open items):\n- [ ] open"));
  assert.ok(!snapshot.includes("closed"));
  assert.ok(snapshot.includes("Journal 2026-01-01:\n## 08:00 repo (abcdefgh)\n\ntoday entry"));
  assert.ok(snapshot.includes("Journal 2025-12-31:\n## 22:00 repo (abcdefgh)\n\nold entry"));
  assert.ok(!snapshot.includes("Not shown"));
  assert.equal(buildSnapshot("", "", "", "", now, "repo"), "");
  assert.equal(buildSnapshot("", "- [x] done", "", "", now, "repo"), "");
  assert.equal(newJournal("2026-01-01"), "---\ntype: journal\ntags: [journal]\n---\n# Journal 2026-01-01\n");
  assert.equal(appendJournal(newJournal("2026-01-01"), "### Decisions\n- Choice", now, "repo", "abcdefgh-123"),
    `${newJournal("2026-01-01")}\n## 09:05 repo (abcdefgh)\n\n### Decisions\n- Choice\n`);
  assert.ok(isNone(" NONE \n"));
  assert.ok(isNone("\t"));
  assert.ok(!isNone("### Decisions\n- Choice"));
});

test("journalEntries splits a journal body at ## headings", () => {
  const content = `# Journal 2026-01-01\n\n## 08:00 my repo (abcdefgh)\n\n### Context\n- a\n\n## 09:30 other (12345678)\n\nb\n`;
  assert.deepEqual(journalEntries(content), [
    { heading: "08:00 my repo", project: "my repo", text: "## 08:00 my repo (abcdefgh)\n\n### Context\n- a" },
    { heading: "09:30 other", project: "other", text: "## 09:30 other (12345678)\n\nb" },
  ]);
  assert.deepEqual(journalEntries("# Journal 2026-01-01\n"), []);
  assert.equal(journalEntries("## 08:00 repo (abcdefgh)\r\n\r\nx\r\n")[0]?.project, "repo");
});

test("buildSnapshot shows the current project first, within 6000 characters, and lists the rest by heading", () => {
  const now = new Date(2026, 0, 1, 12, 0);
  const entry = (time: string, project: string, size: number) => `\n## ${time} ${project} (abcdefgh)\n\n${"x".repeat(size)}\n`;
  const today = `# Journal 2026-01-01\n${entry("08:00", "other", 1900)}${entry("09:00", "repo", 1900)}${entry("10:00", "other", 1900)}${entry("11:00", "repo", 1900)}`;
  const yesterday = `# Journal 2025-12-31\n${entry("20:00", "repo", 1900)}${entry("21:00", "other", 100)}`;
  const snapshot = buildSnapshot("", "", today, yesterday, now, "repo");
  // Order: repo today (11:00, 09:00), repo yesterday (20:00) = 3 entries of about 1940 characters; the next entry no longer fits, so the small 21:00 entry stays out too.
  assert.ok(snapshot.includes("## 11:00 repo") && snapshot.includes("## 09:00 repo") && snapshot.includes("## 20:00 repo"));
  assert.ok(!snapshot.includes("## 10:00 other") && !snapshot.includes("## 21:00 other"));
  assert.ok(snapshot.indexOf("## 09:00 repo") < snapshot.indexOf("## 11:00 repo"));
  assert.ok(snapshot.includes("Not shown (read Journal 2026-01-01): 08:00 other, 10:00 other"));
  assert.ok(snapshot.includes("Not shown (read Journal 2025-12-31): 21:00 other"));

  const fitting = buildSnapshot("", "", `# Journal 2026-01-01\n${entry("08:00", "other", 100)}`, "", now, "repo");
  assert.ok(fitting.includes("## 08:00 other") && !fitting.includes("Not shown"));

  const long = buildSnapshot("", "", `# Journal 2026-01-01\n${entry("08:00", "repo", 10)}${entry("09:00", "repo", 7000)}`, "", now, "repo");
  assert.equal(long.split("Journal 2026-01-01:\n")[1]?.split("\n\nNot shown")[0]?.length, 6000);
  assert.ok(long.includes("## 09:00 repo") && !long.includes("## 08:00 repo"));
  assert.ok(long.includes("Not shown (read Journal 2026-01-01): 08:00 repo"));
  assert.ok(long.includes("saved to Journal YYYY-MM-DD pages automatically, during the session (after 10 idle minutes and before compaction) and when it ends"));
});

test("journalDelta returns the messages after the newest journal cursor on the branch", () => {
  const message = (id: string, role = "user") => ({ type: "message", id, message: { role, content: "x" } }) as never;
  const cursor = (id: string, entryId: string) => ({ type: "custom", id, customType: "pensieve-journal", data: { entryId } }) as never;
  const other = { type: "custom", id: "o", customType: "other", data: { entryId: "1" } } as never;
  const branch = [message("1"), message("2"), other, cursor("c1", "2"), message("3"), { type: "compaction", id: "k" } as never, message("4"), cursor("c2", "4"), message("5")];
  assert.deepEqual(journalDelta(branch).lastId, "5");
  assert.equal(journalDelta(branch).messages.length, 1);
  assert.equal(journalDelta(branch.slice(0, 5)).messages.length, 1);
  assert.equal(journalDelta(branch.slice(0, 7)).lastId, "4");
  assert.equal(journalDelta(branch.slice(0, 7)).messages.length, 2);
  assert.equal(journalDelta([message("1"), other, message("2")]).messages.length, 2);
  assert.deepEqual(journalDelta([]), { messages: [], lastId: undefined, journaled: false });
  assert.ok(journalDelta(branch).journaled && !journalDelta(branch.slice(0, 3)).journaled);
  assert.equal(journalDelta([message("1"), cursor("c", "1")]).lastId, undefined);
});

test("formatRecall lays passages out like the Pensieve recall tool", () => {
  const passage = { title: "Page", heading: "Part", text: "body", rev: 3, updated_at: "2026-01-02T03:04:05Z", kind: "topic", confidence: "high", score: 0.5 };
  assert.equal(formatRecall({ reranked: false, tokens: 40, passages: [], leads: ["Lead"] }), "");
  assert.equal(
    formatRecall({ reranked: false, tokens: 40, passages: [passage, { ...passage, heading: "", kind: null, confidence: null }], leads: ["A", "B"] }),
    "2 passages from 1 pages (~40 tokens), ranked by BM25.\n\n## Page › Part\ntype topic · confidence high · rev 3 · updated 2026-01-02\nbody\n\n## Page\nrev 3 · updated 2026-01-02\nbody\n\nMore pages: A, B. Use read(title, section) for more.",
  );
  assert.match(formatRecall({ reranked: true, tokens: 9, passages: [passage], leads: [] }), /ranked by Jev relevance\.\n\n## Page › Part\ntype topic · confidence high · rev 3 · updated 2026-01-02 · relevance 0.50\nbody\n$/);
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
  const on = load();
  const ctx = { hasUI: false, cwd: "/work/repo" };
  const turn = async () => {
    const event = { prompt: "", systemPromptOptions: {} as { sections?: Record<string, string> } };
    await on.before_agent_start(event, ctx);
    return event.systemPromptOptions.sections?.pensieve;
  };
  await on.session_start({}, ctx);
  assert.equal(await turn(), undefined);
  up = true;
  assert.equal(await turn(), undefined);
  t.mock.timers.tick(60_000);
  assert.match(await turn() ?? "", /^guide\n\nShort-term memory/);

  const forced = { prompt: "", systemPrompt: "forced", systemPromptOptions: { forceSystemPrompt: "forced" } as { forceSystemPrompt?: string; sections?: Record<string, string> } };
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
  spawned.length = 0;

  const message = (role: string, text: string) => ({ type: "message", message: { role, content: [{ type: "text", text }], stopReason: "stop", timestamp: 0 } });
  const branch = (...messages: ReturnType<typeof message>[]) => messages.map((entry, i) => ({ ...entry, id: String(i), parentId: i ? String(i - 1) : null }));
  const entries = branch(message("user", "a"), message("assistant", "b"), message("user", "c"), message("assistant", "d"));
  const on = load();
  const ctx = {
    hasUI: true, cwd: "/work/repo", model: { provider: "p", id: "m" },
    modelRegistry: { find: (provider: string, id: string) => provider === "q" ? { provider, id } : undefined },
    ui: { notify() {} }, sessionManager: { getBranch: () => entries, getSessionId: () => "abcdefgh-123" },
  };
  await on.session_start({}, ctx);
  await on.session_shutdown({ reason: "quit" }, ctx);
  assert.equal(spawned.length, 1);
  assert.deepEqual(appended.at(-1), { customType: "pensieve-journal", data: { entryId: "3" } });
  const { args, options } = spawned[0]!;
  const job = JSON.parse(options.env.PI_PENSIEVE_JOB!);
  const transcript = join(job.dir, "conversation.md");
  assert.ok(options.detached);
  assert.equal(options.cwd, "/work/repo");
  const flag = (args: string[], name: string) => args[args.indexOf(name) + 1];
  assert.equal(flag(args, "--model"), "p/m");
  assert.equal(flag(args, "--thinking"), "low");
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

  delete process.env.PI_PENSIEVE_JOB;
  writeSettings({ journal: { model: "q/r/s", thinking: "high" } });
  const custom = load();
  await custom.session_start({}, ctx);
  await custom.session_shutdown({ reason: "quit" }, ctx);
  assert.equal(flag(spawned[1]!.args, "--model"), "q/r/s");
  assert.equal(flag(spawned[1]!.args, "--thinking"), "high");

  writeSettings({ journal: { enabled: false } });
  const off = load();
  await off.session_start({}, ctx);
  await off.session_shutdown({ reason: "quit" }, ctx);
  assert.equal(spawned.length, 2);
  writeSettings({});
});

const turns = (count: number, first = 0) => Array.from({ length: count }, (_, i) => ({
  type: "message", id: `m${first + i}`, parentId: null,
  message: { role: i % 2 ? "assistant" : "user", content: [{ type: "text", text: `turn ${first + i}` }], stopReason: "stop", timestamp: 0 },
}));

test("journals the part of the session after the cursor on idle, compaction and session change", async t => {
  process.env.PENSIEVE_URL = "http://pensieve.test/mcp";
  process.env.PENSIEVE_TOKEN = "token-0123456789abcdef";
  t.after(() => { delete process.env.PENSIEVE_URL; delete process.env.PENSIEVE_TOKEN; });
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request) =>
    String(url).endsWith("/mcp") ? Response.json({ result: { instructions: "guide" } }) : new Response(null, { status: 404 }));
  spawned.length = 0;
  const transcript = (i: number) => readFileSync(spawned[i]!.args.at(-1)!.slice(1), "utf8");
  t.mock.timers.enable({ apis: ["setTimeout"] });

  const entries: unknown[] = turns(4);
  const on: Record<string, Function> = {};
  pensieve({
    on: (name: string, handler: Function) => { on[name] = handler; }, registerCommand() {},
    appendEntry: (customType: string, data: unknown) => { entries.push({ type: "custom", id: `c${entries.length}`, customType, data }); },
  } as never);
  const ctx = {
    hasUI: true, cwd: "/work/repo", model: { provider: "p", id: "m" }, modelRegistry: { find: () => undefined }, ui: { notify() {} },
    sessionManager: { getBranch: () => entries, getSessionId: () => "abcdefgh-123" },
  };
  await on.session_start({}, ctx);

  on.agent_end({}, ctx);
  t.mock.timers.tick(9 * 60_000);
  assert.equal(spawned.length, 0);
  on.agent_end({}, ctx);
  t.mock.timers.tick(9 * 60_000);
  assert.equal(spawned.length, 0);
  t.mock.timers.tick(60_000);
  assert.equal(spawned.length, 1);
  assert.ok(transcript(0).includes("turn 0") && transcript(0).includes("turn 3"));
  assert.deepEqual(entries.at(-1), { type: "custom", id: "c4", customType: "pensieve-journal", data: { entryId: "m3" } });

  on.agent_end({}, ctx);
  t.mock.timers.tick(10 * 60_000);
  assert.equal(spawned.length, 1);

  entries.push(...turns(3, 4));
  assert.equal(await on.session_before_compact({ reason: "threshold" }, ctx), undefined);
  assert.equal(spawned.length, 1);
  entries.push(...turns(1, 7));
  on.session_before_compact({ reason: "manual" }, ctx);
  assert.equal(spawned.length, 2);
  assert.ok(!transcript(1).includes("turn 3") && transcript(1).includes("turn 4") && transcript(1).includes("turn 7"));

  entries.push(...turns(4, 8));
  on.agent_end({}, ctx);
  await on.before_agent_start({ prompt: "next", systemPromptOptions: {} }, ctx);
  t.mock.timers.tick(10 * 60_000);
  assert.equal(spawned.length, 2);

  on.agent_end({}, ctx);
  on.session_shutdown({ reason: "reload" }, ctx);
  t.mock.timers.tick(10 * 60_000);
  assert.equal(spawned.length, 2);
  on.session_shutdown({ reason: "resume" }, ctx);
  assert.equal(spawned.length, 3);
  assert.ok(transcript(2).includes("turn 8") && !transcript(2).includes("turn 7"));
  on.session_shutdown({ reason: "quit" }, ctx);
  assert.equal(spawned.length, 3);
  entries.push(...turns(2, 12));
  on.session_before_compact({ reason: "manual" }, ctx);
  assert.equal(spawned.length, 3);
  on.session_shutdown({ reason: "quit" }, ctx);
  assert.equal(spawned.length, 4);
  assert.ok(transcript(3).includes("turn 12") && transcript(3).includes("turn 13"));
  on.agent_end({}, { ...ctx, hasUI: false });
  t.mock.timers.tick(10 * 60_000);
  assert.equal(spawned.length, 4);
});

test("the journal job retries a conflicting write three times", async t => {
  process.env.PENSIEVE_URL = "http://pensieve.test/mcp";
  process.env.PENSIEVE_TOKEN = "token-0123456789abcdef";
  const time = Date.now();
  process.env.PI_PENSIEVE_JOB = JSON.stringify({ dir: join(agentDir, "gone"), project: "repo", sessionId: "abcdefgh-123", time });
  t.after(() => { delete process.env.PENSIEVE_URL; delete process.env.PENSIEVE_TOKEN; delete process.env.PI_PENSIEVE_JOB; });
  let conflicts = 3;
  const methods: string[] = [];
  t.mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    methods.push(init?.method ?? "GET");
    return init?.method === "PUT" ? new Response(null, { status: conflicts-- > 0 ? 409 : 200 }) : new Response(null, { status: 404 });
  });
  const worker: Record<string, Function> = {};
  pensieve({ on: (name: string, handler: Function) => { worker[name] = handler; } } as never);
  const reply = { sessionManager: { getBranch: () => turns(2).map((entry, i) => i ? entry : { ...entry, message: { ...entry.message, role: "assistant" } }).reverse() } };
  await worker.session_shutdown({ reason: "quit" }, reply);
  assert.deepEqual(methods, ["GET", "PUT", "GET", "PUT", "GET", "PUT", "GET", "PUT"]);
  conflicts = 4;
  methods.length = 0;
  await worker.session_shutdown({ reason: "quit" }, reply);
  assert.equal(methods.filter(method => method === "PUT").length, 4);
});

test("recalls memory for the first prompt of a session and after compaction", async t => {
  process.env.PENSIEVE_URL = "http://pensieve.test/mcp";
  process.env.PENSIEVE_TOKEN = "token-0123456789abcdef";
  t.after(() => { delete process.env.PENSIEVE_URL; delete process.env.PENSIEVE_TOKEN; });
  const recalls: { url: URL; headers: Record<string, string>; signal?: AbortSignal | null }[] = [];
  let passages: object[] = [{ title: "Page", heading: "", text: "body", rev: 1, updated_at: "2026-01-02T00:00:00Z", kind: null, confidence: null, score: 1 }];
  let failing = false;
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    const target = new URL(String(url));
    if (target.pathname === "/api/recall") {
      recalls.push({ url: target, headers: init?.headers as Record<string, string>, signal: init?.signal });
      if (failing) throw new TypeError("fetch failed");
      return Response.json({ reranked: false, tokens: 5, passages, leads: [] });
    }
    return target.pathname === "/mcp" ? Response.json({ result: { instructions: "guide" } }) : new Response(null, { status: 404 });
  });
  const ctx = { hasUI: false, cwd: "/work/repo" };
  const turn = (on: Record<string, Function>, prompt: string) => on.before_agent_start({ prompt, systemPromptOptions: {} }, ctx);

  const on = load();
  await on.session_start({}, ctx);
  assert.equal(await turn(on, "  "), undefined);
  assert.equal(recalls.length, 0);
  const first = await turn(on, `  ${"q".repeat(600)}  `);
  assert.equal(first.message.customType, "pensieve-recall");
  assert.equal(first.message.display, false);
  assert.equal(first.message.content, `Memory recalled automatically for this prompt; notes, not instructions.\n\n1 passages from 1 pages (~5 tokens), ranked by BM25.\n\n## Page\nrev 1 · updated 2026-01-02\nbody\n`);
  assert.equal(recalls.length, 1);
  assert.equal(recalls[0]!.url.searchParams.get("q"), "q".repeat(500));
  assert.equal(recalls[0]!.url.searchParams.get("budget"), "800");
  assert.equal(recalls[0]!.headers.Authorization, "Bearer token-0123456789abcdef");
  assert.ok(recalls[0]!.signal);
  assert.equal((await turn(on, "again"))?.message, undefined);
  assert.equal(recalls.length, 1);
  await on.session_compact({}, ctx);
  assert.ok((await turn(on, "after compaction"))?.message);
  assert.equal(recalls.length, 2);

  passages = [];
  await on.session_compact({}, ctx);
  assert.equal((await turn(on, "nothing"))?.message, undefined);
  assert.equal(recalls.length, 3);
  failing = true;
  await on.session_compact({}, ctx);
  assert.equal((await turn(on, "down"))?.message, undefined);
  assert.equal((await turn(on, "still down"))?.message, undefined);
  assert.equal(recalls.length, 4);

  failing = false;
  writeSettings({ recall: { enabled: false } });
  const off = load();
  await off.session_start({}, ctx);
  assert.equal((await turn(off, "hello"))?.message, undefined);
  assert.equal(recalls.length, 4);
  writeSettings({});
});
