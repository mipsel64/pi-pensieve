import { test } from "node:test";
import assert from "node:assert/strict";
import { appendJournal, buildSnapshot, isNone, localDate, newJournal, openItems, resolveConfig } from "../index.ts";

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
