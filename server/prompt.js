// ============================================================
// prompt.js — building the conversation we send to the AI model.
// ============================================================
// Small helpers that turn the game state into the user message and
// pull the chosen move back out of the model's free-text reply.

/** Squares where Black currently has pieces, e.g. "e7, d7, c8". */
export function blackPieceSquares(game) {
  return game.board().flat().filter((piece) => piece?.color === "b").map((piece) => piece.square);
}

/**
 * The move history, trimmed to the last few turns so the prompt stays
 * small even in long games. Rendered as "1. e4 e5"-style pairs; older
 * moves are replaced by a leading "...".
 */
export function formatMoves(history) {
  if (!history.length) return "(no moves yet)";
  const parts = [];
  const start = Math.max(0, Math.ceil((history.length - 12) / 2) * 2);
  for (let i = start; i < history.length; i += 2) {
    parts.push(`${i / 2 + 1}. ${history[i]}${history[i + 1] ? " " + history[i + 1] : ""}`);
  }
  return (start > 0 ? "... " : "") + parts.join(" ");
}

/**
 * Finds the AI's chosen move in its reply text. Prefers an explicit
 * "MOVE e7e5" marker; otherwise falls back to the LAST coordinate-like
 * token in the text (models often end with their final choice).
 * @returns {string} lowercase UCI move, e.g. "e7e5", or "" if none found
 */
export function extractMove(text) {
  const marked = text.match(/\bMOVE\s*:?\s*([a-h][1-8][a-h][1-8][qrbn]?)\b/i);
  const all = text.match(/\b[a-h][1-8][a-h][1-8][qrbn]?\b/gi);
  return (marked?.[1] || all?.at(-1) || "").toLowerCase();
}

/**
 * Builds the message skeleton sent to the AI on EVERY attempt.
 * The system message is a placeholder — move-route.js fills it with
 * the time-budget prompt immediately before each attempt (retries
 * get a different, stricter prompt).
 */
export function buildMessages({ fen, history, game }) {
  const blackSquares = blackPieceSquares(game).join(", ");
  return [
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
}