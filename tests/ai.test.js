import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { Chess } from "chess.js";
import { createApp } from "../server.js";
import { requestAiMove } from "../src/ai-client.js";
import { backupMove, withinDeadline } from "../shared/ai.js";
import { thinkingPolicy } from "../ai-policy.js";

const position = new Chess();
position.move("e4");
const turn = { fen: position.fen(), history: ["e4"], thinkingSeconds: 5 };
const config = { OPENROUTER_API_KEY: "test-only", OPENROUTER_MODEL: "test-model" };
const reply = (content, reasoning = "") => Response.json({ choices: [{ message: { content, reasoning } }] });
const never = () => new Promise(() => {});

function assertLegalBackup(data, fen = turn.fen) {
  assert.equal(data.fallback, true);
  assert.equal(data.source, "fallback");
  assert.ok(data.fallbackReason);
  const game = new Chess(fen);
  assert.ok(game.move({ from: data.move.slice(0, 2), to: data.move.slice(2, 4), promotion: data.move[4] || "q" }));
  assert.equal(game.turn(), "w");
}

async function api(t, fetchImpl, settings = config) {
  const server = createApp({ fetchImpl, config: settings }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  }));
  const url = `http://127.0.0.1:${server.address().port}/api/ai-move`;
  return {
    url,
    async post(body = turn) {
      const response = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      return { status: response.status, data: await response.json() };
    },
  };
}

test("slider changes the reasoning budget and reserves tokens for the answer", async (t) => {
  const requests = [];
  const server = await api(t, async (_, options) => {
    requests.push(JSON.parse(options.body));
    return reply("Center control. MOVE E7E5");
  });
  for (const seconds of [5, 300]) {
    const { status, data } = await server.post({ ...turn, thinkingSeconds: seconds });
    assert.equal(status, 200);
    assert.equal(data.move, "e7e5");
    assert.equal(data.fallback, undefined);
    assert.equal(data.thinkingSeconds, seconds);
  }
  assert.ok(requests[1].reasoning.max_tokens > requests[0].reasoning.max_tokens);
  for (const request of requests) assert.ok(request.max_tokens >= request.reasoning.max_tokens + 1024);
});

test("one deadline covers every retry and even a stalled response body", async (t) => {
  let calls = 0;
  const signals = [];
  const server = await api(t, async (_, options) => {
    signals.push(options.signal);
    if (++calls === 1) {
      await delay(350);
      return reply("Still considering it...");
    }
    return { ok: true, json: never };
  });
  const started = Date.now();
  const { status, data } = await server.post();
  const elapsed = Date.now() - started;
  assert.equal(status, 200);
  assertLegalBackup(data);
  assert.match(data.fallbackReason, /time limit/);
  assert.equal(calls, 2);
  assert.equal(signals[0], signals[1]);
  assert.equal(signals[1].aborted, true);
  assert.ok(elapsed >= 4800 && elapsed < 6500, `Expected one 5-second limit, took ${elapsed} ms`);
});

test("empty and unusable moves are retried, then replaced with a legal backup", async (t) => {
  for (const text of ["", "MOVE e7e7", "MOVE e7e1", "MOVE e4e5"]) {
    await t.test(text || "empty", async (t) => {
      let calls = 0;
      const server = await api(t, async () => { calls++; return reply(text); });
      const { data } = await server.post();
      assertLegalBackup(data);
      assert.equal(calls, 3);
    });
  }
});

test("usable reasoning replies and the game's intentional illegal moves still work", async (t) => {
  const reasoningServer = await api(t, async () => reply("Let me think.", "MOVE g8f6"));
  const reasoning = (await reasoningServer.post()).data;
  assert.equal(reasoning.move, "g8f6");
  assert.equal(reasoning.source, "reasoning");
  const illegalServer = await api(t, async () => reply("MOVE a8a5"));
  const illegal = (await illegalServer.post()).data;
  assert.equal(illegal.move, "a8a5");
  assert.equal(illegal.fallback, undefined);
});

test("service errors and missing configuration do not leave Black stuck", async (t) => {
  const failures = [
    async () => { throw new Error("Connection failed"); },
    async () => Response.json({ error: { message: "Unavailable" } }, { status: 503 }),
    async () => new Response("not JSON"),
  ];
  for (const failure of failures) {
    const server = await api(t, failure);
    assertLegalBackup((await server.post()).data);
  }
  const unconfigured = await api(t, () => { throw new Error("Must not call provider"); }, {});
  const data = (await unconfigured.post()).data;
  assertLegalBackup(data);
  assert.equal(data.attempts, 0);
});

test("bad input is rejected and thinking limits are bounded", async (t) => {
  const server = await api(t, async () => reply("MOVE e7e5"));
  for (const body of [{}, { ...turn, fen: "garbage" }, { ...turn, history: "e4" }, { ...turn, fen: new Chess().fen() }]) {
    assert.equal((await server.post(body)).status, 400);
  }
  for (const [value, expected] of [[-5, 5], [9999, 300], [null, 30], ["invalid", 30]]) {
    assert.equal((await server.post({ ...turn, thinkingSeconds: value })).data.thinkingSeconds, expected);
  }
});

test("checkmate and stalemate return a game result without calling the AI", async (t) => {
  const server = await api(t, () => { throw new Error("Must not call provider"); });
  for (const [fen, message] of [
    ["7k/6Q1/5K2/8/8/8/8/8 b - - 0 1", /checkmate/],
    ["7k/5Q2/5K2/8/8/8/8/8 b - - 0 1", /stalemate/],
  ]) {
    const { status, data } = await server.post({ ...turn, fen });
    assert.equal(status, 200);
    assert.equal(data.gameOver, true);
    assert.equal(data.move, undefined);
    assert.match(data.message, message);
  }
});

test("disconnecting cancels the outstanding provider request", async (t) => {
  let started;
  let cancelled;
  const ready = new Promise((resolve) => started = resolve);
  const aborted = new Promise((resolve) => cancelled = resolve);
  const server = await api(t, async (_, { signal }) => {
    signal.addEventListener("abort", cancelled, { once: true });
    started();
    return never();
  });
  const controller = new AbortController();
  const pending = fetch(server.url, {
    method: "POST", signal: controller.signal,
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(turn),
  });
  await ready;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  await withinDeadline(() => aborted, { timeoutMs: 1000 });
});

test("browser fallback handles offline, malformed and unusable responses", async () => {
  for (const transport of [
    async () => { throw new Error("Offline"); },
    async () => new Response("<html>proxy error</html>", { status: 502 }),
    async () => Response.json({ move: "e7e7" }),
    async () => Response.json({ gameOver: true, message: "wrong" }),
  ]) assertLegalBackup(await requestAiMove(turn, transport));
});

test("browser timeout supplies a backup even if the server never responds", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let started;
  let requestSignal;
  const ready = new Promise((resolve) => started = resolve);
  const pending = requestAiMove(turn, async (_, { signal }) => {
    requestSignal = signal;
    started();
    return never();
  });
  await ready;
  t.mock.timers.tick(6501);
  const data = await pending;
  assertLegalBackup(data);
  assert.match(data.fallbackReason, /time limit/);
  assert.equal(requestSignal.aborted, true);
});

test("reset cancellation never produces a backup move or accepts a late reply", async () => {
  const controller = new AbortController();
  let started;
  let respond;
  const ready = new Promise((resolve) => started = resolve);
  const pending = requestAiMove({ ...turn, signal: controller.signal }, async () => {
    started();
    return new Promise((resolve) => respond = resolve);
  });
  await ready;
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  respond(Response.json({ move: "e7e5" }));
});

test("backup moves include the promotion suffix when needed", () => {
  const game = new Chess("8/8/8/8/8/5N2/p4K2/7k b - - 0 1");
  const result = backupMove(game, "Test backup");
  assert.match(result.move, /^a2a1[qrbn]$/);
  assertLegalBackup(result, game.fen());
});

test("DeepSeek gets different instructions and supported reasoning controls for each time budget", async (t) => {
  const requests = [];
  const server = await api(t, async (_, options) => {
    requests.push(JSON.parse(options.body));
    return reply("MOVE e7e5");
  }, { ...config, OPENROUTER_MODEL: "deepseek/deepseek-v4.1-flash" });
  for (const thinkingSeconds of [5, 30, 60, 120, 300]) {
    const { data } = await server.post({ ...turn, thinkingSeconds });
    assert.equal(data.move, "e7e5");
    assert.equal(data.thinkingSeconds, thinkingSeconds);
  }
  assert.equal(new Set(requests.map((request) => request.messages[0].content)).size, 5);
  assert.deepEqual(requests[0].reasoning, { enabled: false });
  assert.equal(requests[0].max_tokens, 256);
  assert.match(requests[0].messages[0].content, /QUICK MOVE/);
  assert.match(requests[0].messages[0].content, /Output only that MOVE line/);
  for (const request of requests.slice(1, 4)) assert.deepEqual(request.reasoning, { effort: "low" });
  assert.deepEqual(requests[4].reasoning, { effort: "high" });
  assert.match(requests[4].messages[0].content, /DEEPER COMPARISON/);
  assert.ok(requests[3].max_tokens < 3000, "Two-minute turns must not allow the old 7000-token ramble");
  for (const request of requests) {
    assert.doesNotMatch(request.messages[0].content, /grandmaster/i);
    assert.match(request.messages[0].content, /FIRST line/);
    assert.ok(request.max_tokens <= 4096);
    assert.equal(request.reasoning.max_tokens, undefined);
  }
});

test("late requests and retries switch to quick selection instead of restarting deep analysis", async (t) => {
  const late = thinkingPolicy({ seconds: 300, remainingSeconds: 5, model: "deepseek/deepseek-v4.1-flash" });
  assert.match(late.systemPrompt, /at most 5 seconds remain/);
  assert.match(late.systemPrompt, /QUICK MOVE/);
  assert.deepEqual(late.reasoning, { enabled: false });
  const requests = [];
  const server = await api(t, async (_, options) => {
    requests.push(JSON.parse(options.body));
    return requests.length === 1 ? reply("", "Long unfinished thought without a move") : reply("MOVE e7e5");
  }, { ...config, OPENROUTER_MODEL: "deepseek/deepseek-v4.1-flash" });
  const { data } = await server.post({ ...turn, thinkingSeconds: 300 });
  assert.equal(data.attempts, 2);
  assert.deepEqual(requests[1].reasoning, { enabled: false });
  assert.match(requests[1].messages[0].content, /REPAIR REQUEST/);
  assert.doesNotMatch(JSON.stringify(requests[1].messages), /Long unfinished thought/);
});

test("the currently configured Luna model gets none/low/medium/high effort without unsupported temperature", async (t) => {
  const requests = [];
  const server = await api(t, async (_, options) => {
    requests.push(JSON.parse(options.body));
    return reply("MOVE e7e5");
  }, { ...config, OPENROUTER_MODEL: "openai/gpt-5.6-luna" });
  for (const thinkingSeconds of [5, 30, 120, 300]) {
    const { data } = await server.post({ ...turn, thinkingSeconds });
    assert.equal(data.move, "e7e5");
  }
  assert.deepEqual(requests.map((request) => request.reasoning.effort), ["none", "low", "medium", "high"]);
  assert.equal(requests[0].max_tokens, 256);
  for (const request of requests) assert.equal(request.temperature, undefined);
});

test("long games send recent context and the current board without replaying the entire history", async (t) => {
  let request;
  const server = await api(t, async (_, options) => {
    request = JSON.parse(options.body);
    return reply("MOVE e7e5");
  });
  const history = Array.from({ length: 201 }, (_, index) => `historicalMove${index}`);
  assert.equal((await server.post({ ...turn, history })).data.move, "e7e5");
  const prompt = request.messages[1].content;
  assert.match(prompt, /historicalMove200/);
  assert.doesNotMatch(prompt, /historicalMove0\b/);
  assert.ok(prompt.includes(turn.fen));
  assert.ok(prompt.length < 1500);
});

test("five-minute browser requests are not cut off by the previous two-minute maximum", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let started;
  let settled = false;
  const ready = new Promise((resolve) => started = resolve);
  const pending = requestAiMove({ ...turn, thinkingSeconds: 300 }, async (_, options) => {
    assert.equal(JSON.parse(options.body).thinkingSeconds, 300);
    started();
    return never();
  });
  pending.then(() => settled = true);
  await ready;
  t.mock.timers.tick(121500);
  await Promise.resolve();
  assert.equal(settled, false);
  t.mock.timers.tick(180001);
  assertLegalBackup(await pending);
});
