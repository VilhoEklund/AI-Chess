// ============================================================
// Board.jsx — the 8×8 chess board grid.
// ============================================================
// Pure presentation: it receives the current position and what is
// selected/possible, and renders 64 clickable square <button>s.
// All game logic (selecting, moving, AI turns) stays in App.jsx;
// every click simply reports the square name back up.

import Piece from "./Piece.jsx";

/**
 * The 64 squares are rendered from the `board` array that chess.js
 * produces: board is 8 rows; flatMap + row.map produce 64 <button>s.
 * Square names: "abcdefgh"[column] + (8 - row), e.g. "e2" — row 0 is
 * rank 8 (black's back row), so the row number is inverted.
 */
const FILES = "abcdefgh";

export default function Board({ board, selected, legalTargets, onSquareClick }) {
  return (
    <div className="board">
      {board.flatMap((row, rowIndex) =>
        row.map((piece, columnIndex) => {
          const square = `${FILES[columnIndex]}${8 - rowIndex}`;
          const light = (rowIndex + columnIndex) % 2 === 0;

          return (
            <button
              key={square}
              aria-label={square}
              className={`square ${light ? "light" : "dark"} ${
                selected === square ? "selected" : ""
              } ${
                legalTargets.has(square)
                  ? piece
                    ? "legal-capture" // enemy piece stands there -> ring
                    : "legal-move"    // empty square -> dot
                  : ""
              }`}
              onClick={() => onSquareClick(square)}
            >
              {/* PNG piece (glyph only if the file is missing) */}
              <Piece piece={piece} />
            </button>
          );
        })
      )}
    </div>
  );
}