// ============================================================
// forced-move.js — the heart of "AI Illegal Chess".
// ============================================================
// When the AI returns a move that breaks the rules of chess, we do
// NOT reject it — that is the gimmick of the game. Instead this
// function teleports the black piece to its destination, ignoring
// every chess rule, and repairs the FEN afterwards so the human can
// keep playing. A normal Chess object cannot represent such moves,
// so we construct the next position by hand.

import { Chess } from "chess.js";

/**
 * Applies an illegal move to a position by brute force.
 * @param {string} fen  - position after the player's move (Black to play)
 * @param {string} from - e.g. "e7" (must hold a black piece)
 * @param {string} to   - e.g. "e5" (must not hold a king)
 * @returns {string} the new FEN, with White handed the turn again
 */
export function forceIllegalMove(fen, from, to) {
  const game = new Chess(fen, { skipValidation: true });
  const piece = game.get(from);
  const target = game.get(to);

  if (!piece || piece.color !== "b") throw new Error("AI chose no black piece.");
  if (from === to) throw new Error("AI chose the same square.");
  if (target?.type === "k") throw new Error("Kings cannot be captured.");

  // Teleport the piece, ignoring every chess rule — that is the gimmick.
  game.remove(from);
  game.remove(to);
  if (!game.put(piece, to)) throw new Error("AI move could not be placed.");

  // FEN surgery: [1] side to move, [2] castling, [3] en passant.
  const parts = game.fen().split(" ");
  parts[1] = "w"; // hand the turn back to White so the human can move
  parts[2] = "-"; // wipe castling rights (a teleported rook/king breaks them)
  parts[3] = "-"; // wipe the en-passant target (same reason)
  return parts.join(" ");
}