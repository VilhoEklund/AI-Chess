export const MIN_THINKING_SECONDS = 5;
export const MAX_THINKING_SECONDS = 300;
export const DEFAULT_THINKING_SECONDS = 30;

export function normalizeThinkingSeconds(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_THINKING_SECONDS;
  return Math.min(MAX_THINKING_SECONDS, Math.max(MIN_THINKING_SECONDS, Math.round(value)));
}

export function gameOverMessage(game) {
  if (game.isCheckmate()) return `${game.turn() === "b" ? "White" : "Black"} wins by checkmate.`;
  if (game.isStalemate()) return "Draw by stalemate.";
  if (game.isDraw()) return "Game drawn.";
  return null;
}

// Illegal AI moves are part of this game, but these moves cannot be applied safely.
export function isUsableAiMove(game, move) {
  if (typeof move !== "string" || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) return false;
  const from = move.slice(0, 2);
  const to = move.slice(2, 4);
  return from !== to && game.get(from)?.color === "b" && game.get(to)?.type !== "k";
}

export function backupMove(game, reason) {
  const message = gameOverMessage(game);
  if (message) return { gameOver: true, message };
  const legal = game.moves({ verbose: true });
  if (!legal.length) return { gameOver: true, message: "Game over: no legal moves remain." };
  const move = legal[Math.floor(Math.random() * legal.length)];
  return {
    move: `${move.from}${move.to}${move.promotion || ""}`,
    fallback: true,
    fallbackReason: reason,
    source: "fallback",
  };
}

// Bound the entire operation, including retries and reading the response body.
// The race also handles an unresponsive transport that ignores cancellation.
export async function withinDeadline(run, { timeoutMs, signal }) {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => {
    controller.abort(new DOMException("Thinking time is up", "TimeoutError"));
  }, timeoutMs);
  let onAbort;
  try {
    controller.signal.throwIfAborted();
    const aborted = new Promise((_, reject) => {
      onAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    return await Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted();
        return run(controller.signal);
      }),
      aborted,
    ]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
    controller.abort();
  }
}
