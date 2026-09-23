// Express keeps the OpenRouter key on the server. Vite proxies /api here.
import "dotenv/config";
import express from "express";
import { Chess } from "chess.js";
import { pathToFileURL } from "node:url";
import { thinkingPolicy } from "./ai-policy.js";
import {
  backupMove, DEFAULT_THINKING_SECONDS, MAX_THINKING_SECONDS,
  MIN_THINKING_SECONDS, isUsableAiMove, normalizeThinkingSeconds, withinDeadline,
} from "./shared/ai.js";

function blackPieceSquares(game) {
  return game.board().flat().filter((piece) => piece?.color === "b").map((piece) => piece.square);
}

function formatMoves(history) {
  if (!history.length) return "(no moves yet)";
  const parts = [];
  const start = Math.max(0, Math.ceil((history.length - 12) / 2) * 2);
  for (let i = start; i < history.length; i += 2) {
    parts.push(`${i / 2 + 1}. ${history[i]}${history[i + 1] ? " " + history[i + 1] : ""}`);
  }
  return (start > 0 ? "... " : "") + parts.join(" ");
}

function extractMove(text) {
  const marked = text.match(/\bMOVE\s*:?\s*([a-h][1-8][a-h][1-8][qrbn]?)\b/i);
  const all = text.match(/\b[a-h][1-8][a-h][1-8][qrbn]?\b/gi);
  return (marked?.[1] || all?.at(-1) || "").toLowerCase();
}

// Inject the transport/configuration so tests never spend credits or need a key.
export function createApp({ fetchImpl = fetch, config = process.env } = {}) {
  const app = express();
  app.use(express.json());

  app.get("/api/ai-model", (req, res) => {
    res.json({
      model: config.OPENROUTER_MODEL || "(not configured)",
      thinkingSeconds: DEFAULT_THINKING_SECONDS,
      minThinkingSeconds: MIN_THINKING_SECONDS,
      maxThinkingSeconds: MAX_THINKING_SECONDS,
    });
  });

  app.post("/api/ai-move", async (req, res) => {
    const started = Date.now();
    const { fen, history = [], thinkingSeconds } = req.body || {};
    if (typeof fen !== "string" || !fen) return res.status(400).json({ error: "Missing FEN" });
    if (!Array.isArray(history) || history.some((move) => typeof move !== "string")) {
      return res.status(400).json({ error: "History must be an array of moves" });
    }

    // Forced illegal AI moves can produce unusual positions; keep supporting them.
    let game;
    try {
      game = new Chess(fen, { skipValidation: true });
      if (fen.split(" ").length !== 6 || game.findPiece({ type: "k", color: "w" }).length !== 1 ||
          game.findPiece({ type: "k", color: "b" }).length !== 1) throw new Error("Invalid position");
    } catch {
      return res.status(400).json({ error: "Invalid FEN" });
    }
    if (game.turn() !== "b") return res.status(400).json({ error: "It must be Black's turn" });

    const seconds = normalizeThinkingSeconds(thinkingSeconds);
    const model = config.OPENROUTER_MODEL || "(not configured)";
    let attempts = 0;
    let lastContent = "";
    let lastReasoning = "";
    const metadata = () => ({
      thought: lastContent, reasoning: lastReasoning, attempts,
      ms: Date.now() - started, model, thinkingSeconds: seconds,
    });
    const fallback = (reason) => ({ ...metadata(), ...backupMove(game, reason) });
    const initialResult = backupMove(game, "");
    if (initialResult.gameOver) return res.json({ ...metadata(), ...initialResult });
    if (!config.OPENROUTER_API_KEY || !config.OPENROUTER_MODEL) {
      return res.json(fallback("AI settings are missing. A legal backup move was played."));
    }

    const blackSquares = blackPieceSquares(game).join(", ");
    const messages = [
      {
        role: "system",
        content: "", // Filled from the remaining time immediately before each attempt.
      },
      {
        role: "user",
        content: `Recent moves (context only): ${formatMoves(history)}
Current position — Black to move. FEN: ${fen}
Board (uppercase = White, lowercase = Black):
${game.ascii()}
Your black pieces stand on: ${blackSquares}
Start your final answer with: MOVE <from><to>`,
      },
    ];

    const disconnected = new AbortController();
    const onClose = () => disconnected.abort();
    res.once("close", onClose);

    try {
      const result = await withinDeadline(async (signal) => {
        for (let attempt = 1; attempt <= 3; attempt++) {
          signal.throwIfAborted();
          attempts = attempt;
          const policy = thinkingPolicy({
            seconds,
            remainingSeconds: Math.ceil((seconds * 1000 - (Date.now() - started)) / 1000),
            model,
            reasoningTokenBase: config.OPENROUTER_REASONING_TOKENS,
            repair: attempt > 1,
          });
          messages[0].content = policy.systemPrompt;
          const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            signal,
            headers: {
              Authorization: `Bearer ${config.OPENROUTER_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model, messages, temperature: policy.temperature,
              max_tokens: policy.maxTokens,
              reasoning: policy.reasoning,
            }),
          });
          const data = await response.json();
          signal.throwIfAborted();
          if (!response.ok || data.error) throw new Error("AI service unavailable");
          const reply = data.choices?.[0]?.message || {};
          lastContent = typeof reply.content === "string" ? reply.content : "";
          lastReasoning = typeof reply.reasoning === "string" ? reply.reasoning : "";

          // Prefer a usable finished answer, then try the reasoning channel.
          for (const [source, text] of [["content", lastContent], ["reasoning", lastReasoning]]) {
            const move = extractMove(text);
            if (isUsableAiMove(game, move)) return { ...metadata(), move, source };
          }
          // Do not feed a long unfinished analysis back into another attempt.
          messages.push({ role: "assistant", content: (lastContent || "(no finished answer)").slice(0, 200) });
          messages.push({
            role: "user",
            content: `Choose a move now from one of your black pieces: ${blackSquares}. Do not capture a king or choose the same square. Output only a line like MOVE e7e5.`,
          });
        }
        return fallback("The AI did not return a usable move. A legal backup move was played.");
      }, {
        // All attempts and response-body reads share this ONE deadline.
        timeoutMs: Math.max(1, seconds * 1000 - (Date.now() - started)),
        signal: disconnected.signal,
      });
      if (!res.destroyed) res.json(result);
    } catch (error) {
      if (!res.destroyed) res.json(fallback(error.name === "TimeoutError"
        ? "The time limit was reached. A legal backup move was played."
        : "The AI service is unavailable. A legal backup move was played."));
    } finally {
      res.off("close", onClose);
    }
  });

  return app;
}

// Importing createApp in a test does not start a real server.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = process.env.PORT || 3001;
  createApp().listen(port, () => console.log(`Server: http://localhost:${port}`));
}
