// ============================================================
// server.js — the backend ("middleman") between the chess UI
// and the OpenRouter AI service.
//
// How the whole app talks:
//   Browser (React) --HTTP POST--> this server (Express) --HTTPS--> OpenRouter
//
// The browser never talks to OpenRouter directly, because:
//   1. the API key must stay secret (browser code is visible to everyone),
//   2. browsers block cross-site API calls unless the API allows CORS.
// Run this with:  node server.js   (from THIS folder!)
// ============================================================

// "import ... from" is ESM (modern JavaScript module) syntax — the older
// style would be `const express = require("express")` (CommonJS).
// ESM works here because package.json contains "type": "module".

// Importing "dotenv/config" imports no value — importing it has a SIDE
// EFFECT: it reads the .env file in this folder and copies every line
// into process.env (this process's environment variables). After this
// line, a line like  OPENROUTER_MODEL=deepseek/...  in .env is available
// as process.env.OPENROUTER_MODEL everywhere below.
// NOTE: dotenv does NOT overwrite variables that are already set in the
// environment — that's why a key stored as a Windows environment
// variable keeps working even when .env has it empty.
import "dotenv/config";
import express from "express";    // web server framework: routing + HTTP handling
import { Chess } from "chess.js"; // chess library: parses FEN, answers board queries

// Create the Express application object. All middleware and routes get
// attached to this object.
const app = express();

// MIDDLEWARE: express.json() intercepts every incoming request whose
// Content-Type is application/json, parses the JSON text of the request
// body, and exposes the resulting object as `req.body`.
// Without this line, req.body would be undefined and req.body.fen would
// throw "Cannot read properties of undefined".
app.use(express.json());

/**
 * Collects the squares where Black's pieces currently stand.
 * Used to (a) tell the AI exactly where its pieces are, and
 *         (b) build the correction message when it guesses wrong.
 *
 * @param {Chess} game - a loaded chess.js position
 * @returns {string[]} e.g. ["a8", "b8", "c8", ..., "e7"]
 */
function blackPieceSquares(game) {
  const squares = [];

  // game.board() returns the position as an 8x8 array, row by row,
  // starting from rank 8 down to rank 1. Each cell is either `null`
  // (empty square) or a piece object like { color: "b", type: "p", square: "e7" }.
  for (const row of game.board()) {
    for (const piece of row) {
      // `piece?.color` uses OPTIONAL CHAINING (?.): if piece is null the
      // expression short-circuits to undefined instead of crashing with
      // "Cannot read properties of null".
      if (piece?.color === "b") squares.push(piece.square);
    }
  }
  return squares;
}

/**
 * Formats the move history into standard algebraic (PGN-style) text:
 *   ["e4", "e5", "Nf3", "Nc6"]  ->  "1. e4 e5 2. Nf3 Nc6"
 *
 * WHY THIS IS THE MOST IMPORTANT INPUT: LLMs learned chess from millions
 * of games written exactly like this. A list of SAN moves is far easier
 * for a model to "understand" than an ASCII board drawing. The array is
 * white/black/white/black..., so index i and i+1 form one full move.
 * Forced (illegal) moves arrive as UCI strings tagged "(forced)" —
 * they are NOT legal SAN, but we still print them so the model sees
 * what actually happened on the board.
 *
 * @param {string[]} [history] - moves in order, starting with White's first
 * @returns {string} e.g. "1. e4 e5 2. Nf3 g8f6 (forced)"
 */
function formatMoves(history) {
  if (!history?.length) return "(no moves yet)";
  const parts = [];
  for (let i = 0; i < history.length; i += 2) {
    const number = i / 2 + 1;      // index 0,2,4... are move 1,2,3...
    const white = history[i];
    const black = history[i + 1] || ""; // may be missing if array length is odd
    parts.push(`${number}. ${white}${black ? " " + black : ""}`);
  }
  return parts.join(" ");
}

/**
 * Pulls the chosen move out of the model's reply text.
 *
 * The AI is asked to reason FIRST and end with a strict marker line
 * ("MOVE e7e5"). Two extraction strategies, in order of trust:
 *   1. The marked line — unambiguous, the model's declared final answer.
 *   2. The LAST uci-looking token anywhere in the text. When a model
 *      reasons about candidates ("I could play e7e5 or g8f6..."), the
 *      final answer comes last, so LAST beats FIRST here.
 *
 * @param {string} text - the model's full reply
 * @returns {string|null} e.g. "e7e5", or null if no move found
 */
function extractMove(text) {
  // \s*:?\s* accepts "MOVE e7e5", "MOVE: e7e5", "move e7e5" (the /i flag).
  // The parentheses CAPTURE the move itself -> match[1] is just the move.
  const marked = text.match(/MOVE\s*:?\s*([a-h][1-8][a-h][1-8][qrbn]?)/i);
  if (marked) return marked[1];

  // /g (global) makes match() return an ARRAY OF ALL matches, not just
  // the first. Without a marker we take the last one.
  const all = text.match(/[a-h][1-8][a-h][1-8][qrbn]?/gi);
  return all ? all[all.length - 1] : null;
}

/**
 * Sends ONE chat request to OpenRouter and returns only the model's
 * text reply (or throws an Error with a useful message).
 *
 * @param {Array<{role: string, content: string}>} messages - the whole
 *        conversation so far; the API expects this exact array shape.
 * @returns {Promise<{content: string, reasoning: string}>} both text
 *          channels of the reply (either may be empty)
 */
async function askOpenRouter(messages) {
  // fetch() starts an HTTPS request and returns a Promise, so we `await`
  // it — the function pauses here until the answer arrives.
  // signal: AbortSignal.timeout(...) aborts the request after 90 seconds.
  // Without it a hung OpenRouter would freeze the whole game forever;
  // with it, the request throws, the route retries (or falls back).
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", // we are SENDING data (a GET would only ask for a page)
    signal: AbortSignal.timeout(90000),
    headers: {
      // "Bearer <token>" is the standard authentication scheme for APIs:
      // "here is my secret token, please believe me".
      // If the key is wrong/missing, OpenRouter answers 401 and we throw below.
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json" // we are sending JSON in the body
    },
    // The request body must be a JSON *string*, so we stringify our object.
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL, // which AI to use (from .env / env var)
      messages,          // shorthand for  messages: messages
      temperature: 0.4,  // LOW = consistent, stronger play. Raise towards 1
                         // for a more chaotic/fun opponent.
      max_tokens: 4000,  // reasoning models burn tokens on hidden "thinking"
                         // BEFORE writing the visible answer — a small cap
                         // makes them run out mid-thought and return an
                         // EMPTY reply. 4000 leaves room for both.
      // CAP THE HIDDEN THINKING itself. Reasoning models (like deepseek)
      // can otherwise think for 5+ MINUTES per move — we measured it.
      // 1500 tokens ≈ 30-90 s of thought. Models that don't support this
      // parameter simply ignore it. Override in .env if you want a
      // deeper thinker:  OPENROUTER_REASONING_TOKENS=3000
      reasoning: {
        max_tokens: Number(process.env.OPENROUTER_REASONING_TOKENS) || 1500
      }
    })
  });

  // The response body arrives as JSON text; parse it into a JS object.
  const data = await response.json();

  // response.ok is true for HTTP status 200–299. OpenRouter reports
  // problems (bad key, no credits, unknown model) as HTTP errors WITH a
  // JSON body describing them, so we must check this explicitly.
  if (!response.ok) {
    // Throwing here propagates to the route's try/catch, which turns it
    // into an HTTP 500 response for the browser.
    throw new Error(data?.error?.message || "OpenRouter request failed");
  }

  // Standard chat-completions reply shape:
  // { choices: [ { message: { role: "assistant", content: "...think... MOVE e7e5" } } ] }
  // REASONING MODELS add a second field: message.reasoning — the model's
  // hidden thinking, delivered separately from the final answer. When the
  // content comes back EMPTY (token budget exhausted mid-thought), the
  // reasoning text is the only place a move might exist, so we mine it.
  const msg = data.choices?.[0]?.message || {};
  const content = msg.content || "";
  const reasoning = typeof msg.reasoning === "string" ? msg.reasoning : "";

  // One debug line showing which channel actually carried text —
  // invaluable when the AI "says nothing".
  console.log(
    `reply channels -> content: ${content.length} chars, reasoning: ${reasoning.length} chars`
  );

  // Prefer the finished answer; fall back to the raw thinking text.
  // Both channels are returned so the route can pass them on to the
  // frontend's "AI thinking" panel — seeing the hidden reasoning is the
  // best way to debug slow or silly moves.
  return { content, reasoning };
}

// Small endpoint the frontend calls once on page load so it can show
// WHICH model every move is played against (the "Model: ..." label).
// GET /api/ai-model  ->  { model: "deepseek/...", reasoningTokens: 1500 }
app.get("/api/ai-model", (req, res) => {
  res.json({
    model: process.env.OPENROUTER_MODEL || "(not configured)",
    reasoningTokens: Number(process.env.OPENROUTER_REASONING_TOKENS) || 1500
  });
});

// ROUTE HANDLER: every HTTP POST to /api/ai-move runs this async function.
// Express fills in:
//   req = the incoming request (req.body exists thanks to express.json())
//   res = a helper object used to send the response back
app.post("/api/ai-move", async (req, res) => {
  // The frontend sends:  { fen: "rnbq... w KQkq - 0 1", history: ["e4", ...] }
  // history is the game so far in SAN ("e4", "e5", ...) with forced moves
  // tagged "(forced)" — see formatMoves() above.
  const { fen, history } = req.body;
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;

  // --- Input validation: fail fast with a proper HTTP error code -------
  if (!fen) return res.status(400).json({ error: "Missing FEN" }); // 400 = bad client request
  if (!apiKey || !model) {
    return res.status(500).json({                                  // 500 = our misconfiguration
      error: "Add OPENROUTER_API_KEY and OPENROUTER_MODEL to .env"
    });
  }

  // Parse the FEN into a Chess object so we can inspect the position.
  // skipValidation matters: normally chess.js REFUSES to load impossible
  // positions. But this game intentionally creates weird positions
  // (forced illegal AI moves) and sends them here, so we must not
  // validate strictly or every move after an illegal one would 400.
  let game;
  try {
    game = new Chess(fen, { skipValidation: true });
  } catch {
    return res.status(400).json({ error: "Invalid FEN" });
  }

  // Pre-compute Black's piece squares once — reused in the prompt and in
  // every correction message below. join(", ") makes "a8, b8, ..., e7".
  const blackSquares = blackPieceSquares(game).join(", ");
  const movesLine = formatMoves(history); // "1. e4 e5 2. Nf3 Nc6 ..."

  // SYSTEM PROMPT — the model's permanent role and rules for this game.
  // "Grandmaster" framing raises effort; the numbered checklist forces
  // it to actually reason instead of blurting the first legal-looking
  // square pair. The "illegal moves are allowed" line stops it from
  // refusing/balking when a forced move made the position impossible.
  const systemPrompt = `You are a chess grandmaster playing Black against a human opponent.

This game tolerates illegal moves, so the position may look impossible or contain teleported pieces. Never question the position — always play exactly what the FEN shows.

Before answering, think it through:
1. What did White's last move do, and what does it threaten?
2. Which of your pieces are attacked or undefended?
3. Choose the strongest move: development, center control, king safety, tactics.
4. Verify that the from-square of your chosen move really holds one of YOUR black pieces.

Then reply with 1-3 short sentences of reasoning, and end your reply with the final move as the very LAST line in exactly this format:
MOVE e7e5

The MOVE line uses UCI format: from-square + to-square (e.g. e7e5), plus a 5th letter only for promotions (e7e8q). The from-square must contain one of your black pieces.`;

  // USER PROMPT — the actual position, rebuilt fresh on every turn.
  // Given in three redundant forms on purpose: SAN history (what the
  // model knows chess by), the FEN (precise ground truth), and the ASCII
  // board (the only spatial view of piece placement).
  const userPrompt = `Moves so far:
${movesLine}

Current position — it is Black's turn. FEN:
${fen}

Board (uppercase = White, lowercase = Black, . = empty square):
${game.ascii()}

Your black pieces stand on: ${blackSquares}

Think briefly, then end your reply with the last line:
MOVE <from><to>`;

  // `messages` is the full conversation sent on EVERY attempt.
  // Attempt 1: [system, user]. If the AI answers wrongly we APPEND its
  // wrong answer (role "assistant") plus a correction (a new "user"
  // message) and ask again — the model then sees its own mistake.
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt }
  ];

  // Bookkeeping for the frontend's thinking panel:
  // started  = when this request began (for the "took X s" badge)
  // attempts = how many API calls were actually made
  // lastContent / lastReasoning = the final reply's two text channels
  const started = Date.now();
  let attempts = 0;
  let lastContent = "";
  let lastReasoning = "";

  try {
    // Up to 3 attempts total; each loop iteration = one API call.
    for (let attempt = 1; attempt <= 3; attempt++) {
      attempts = attempt;
      let reply;
      try {
        reply = await askOpenRouter(messages);
      } catch (err) {
        // Network errors and the 90-second timeout land here and simply
        // use up one attempt — the game recovers via the fallback below
        // instead of dying with a 500.
        console.log(`attempt ${attempt} failed: ${err.message}`);
        continue;
      }
      lastContent = reply.content;
      lastReasoning = reply.reasoning;

      // Mine whichever channel actually carries text (finished answer first).
      const text = lastContent || lastReasoning;
      // Log a one-line preview of the reply so debugging is possible
      // from the server terminal. \n + " | " keeps it to ONE line.
      console.log("AI reply:", text.slice(0, 300).replace(/\n+/g, " | "));

      const candidate = extractMove(text);

      if (!candidate) {
        // The reply contained no move at all. Show it its own text and
        // re-state the required format.
        messages.push({ role: "assistant", content: text.slice(0, 400) }); // truncate long rambles
        messages.push({
          role: "user",
          content: "That was not a valid UCI move. Answer again, ending with a last line exactly like: MOVE e7e5"
        });
        continue; // jump to the next loop iteration = retry
      }

      const from = candidate.slice(0, 2).toLowerCase(); // first square, e.g. "e7"

      // SERVER-SIDE GUARD: the from-square must hold a BLACK piece.
      // game.get(square) returns the piece object standing there, or
      // undefined if empty. Without this check the frontend would get a
      // move for a piece that doesn't exist and the game would stall.
      if (game.get(from)?.color !== "b") {
        messages.push({ role: "assistant", content: candidate }); // its wrong answer...
        messages.push({
          role: "user",
          content: `The square ${from} has no black piece. Your pieces are on: ${blackSquares}. Reply again, ending with a last line like: MOVE e7e5` // ...plus our correction
        });
        continue; // retry with the correction visible in the conversation
      }

      // The move passed both checks -> send it to the browser as JSON —
      // along with everything the frontend's thinking panel needs:
      //   thought   = the model's finished, visible answer
      //   reasoning = its hidden thinking channel (can be thousands of chars)
      //   source    = which channel the move was extracted from
      //   attempts  = how many API calls this turn cost
      //   ms        = total think time in milliseconds
      //   model     = which model played this move
      // .toLowerCase() normalizes "E7E5" into "e7e5" for the frontend.
      return res.json({
        move: candidate.toLowerCase(),
        thought: lastContent,
        reasoning: lastReasoning,
        source: lastContent ? "content" : "reasoning",
        attempts,
        ms: Date.now() - started,
        model
      });
    }

    // --- FALLBACK after 3 failed attempts -------------------------------
    // If we returned an error here, the game would DEADLOCK: the FEN
    // says it is Black's turn, so the human (White) cannot click anything
    // and nothing could ever recover. Instead, ask chess.js for Black's
    // LEGAL moves in this position and pick one at random, so the game
    // always continues.
    // { verbose: true } gives objects { from, to, promotion } (the default
    // returns SAN strings like "Nf6", from which from/to are hard to get).
    const legal = game.moves({ verbose: true });
    if (legal.length) {
      // Math.random() is in [0,1); multiplying by length and flooring
      // gives a whole index 0..length-1 — i.e. a uniformly random move.
      const random = legal[Math.floor(Math.random() * legal.length)];
      // Rebuild the UCI string from the fields. `promotion` is undefined
      // for non-promotion moves; `|| ""` turns that into an empty string.
      return res.json({
        move: `${random.from}${random.to}${random.promotion || ""}`,
        fallback: true, // flag so the frontend can tell the user what happened
        thought: lastContent,
        reasoning: lastReasoning,
        source: lastContent ? "content" : "reasoning",
        attempts,
        ms: Date.now() - started,
        model
      });
    }

    // No legal moves at all = Black is checkmated or stalemated.
    return res.status(500).json({ error: "AI could not produce a valid move" });
  } catch (error) {
    // askOpenRouter threw: network down, OpenRouter error, bad key...
    // Forward the message so the frontend can display it to the user.
    res.status(500).json({ error: error.message });
  }
});

// Start the HTTP server. 3001 by default — deliberately NOT Vite's
// default port 5173, so the two servers can run side by side.
// PORT=3002 node server.js  ->  run a second instance for testing.
// vite.config.js forwards every /api/* request from 5173 to this port.
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server: http://localhost:${PORT}`));
