import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createApp } from "./app.mjs";

describe("POST /api/triage", () => {
  let server;
  let port;

  before(async () => {
    server = createApp();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = server.address().port;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  async function postTriage(rawBody) {
    const reply = await fetch(`http://127.0.0.1:${port}/api/triage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rawBody,
    });

    return { status: reply.status, body: await reply.json() };
  }

  for (const label of ["[timeout]", "[error]", "[bad-json]", "[bad-topic]", "[empty-draft]"]) {
    it(`returns manual_review for ${label}`, async () => {
      const startedAt = performance.now();
      const { status, body } = await postTriage(JSON.stringify({ text: `Где доставка? ${label}` }));
      const elapsed = performance.now() - startedAt;

      assert.equal(status, 200);
      assert.deepEqual(body, { status: "manual_review", topic: null, draft: null });

      if (label === "[timeout]") assert.ok(elapsed < 1000);
    });
  }

  it("returns ready with exactly three fields for a normal request", async () => {
    const { status, body } = await postTriage(JSON.stringify({ text: "Когда будет доставка?" }));

    assert.equal(status, 200);
    assert.equal(body.status, "ready");
    assert.equal(body.topic, "delivery");
    assert.equal(typeof body.draft, "string");
    assert.ok(body.draft.trim() !== "");
    assert.deepEqual(Object.keys(body).sort(), ["draft", "status", "topic"]);
  });

  for (const rawBody of ["{", "{}", '{"text":"   "}', '{"text":42}']) {
    it(`returns invalid_input for ${rawBody}`, async () => {
      const { status, body } = await postTriage(rawBody);

      assert.equal(status, 400);
      assert.deepEqual(body, { status: "invalid_input" });
    });
  }
});
