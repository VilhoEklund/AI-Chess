import { Chess } from "chess.js";
import { backupMove, isUsableAiMove, normalizeThinkingSeconds, withinDeadline } from "../shared/ai.js";

export async function requestAiMove({ fen, history, thinkingSeconds, signal }, fetchImpl = fetch) {
  const started = Date.now();
  const game = new Chess(fen, { skipValidation: true });
  const seconds = normalizeThinkingSeconds(thinkingSeconds);
  try {
    return await withinDeadline(async (requestSignal) => {
      const response = await fetchImpl("/api/ai-move", {
        method: "POST",
        signal: requestSignal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fen, history, thinkingSeconds: seconds }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "AI request failed");
      if (data.gameOver) {
        const localResult = backupMove(game, "");
        if (!localResult.gameOver) throw new Error("Unexpected game-over response");
        return localResult;
      }
      data.move = typeof data.move === "string" ? data.move.toLowerCase() : "";
      if (!isUsableAiMove(game, data.move)) throw new Error("AI returned an unusable move");
      return data;
    }, {
      // Allow a short round trip for the server's deadline response.
      timeoutMs: seconds * 1000 + 1500,
      signal,
    });
  } catch (error) {
    // Reset/unmount cancellation must never place a move on a new board.
    if (signal?.aborted) throw error;
    return {
      ...backupMove(game, error.name === "TimeoutError"
        ? "The time limit was reached. A legal backup move was played."
        : "The AI could not answer. A legal backup move was played."),
      attempts: 0,
      ms: Date.now() - started,
    };
  }
}
