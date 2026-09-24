// ============================================================
// Piece.jsx — renders ONE chess piece.
// ============================================================
// Shows the PNG from public/pieces/<key>.png, or — only if that
// file is missing — the Unicode glyph as fallback.
//
// It needs its own component (with its own useState) because the
// choice "image vs glyph" is per-piece state: when the <img> fails
// to load we flip `failed` and re-render as the glyph. Keeping the
// glyph out of the successful case also stops it from showing
// through the PNG's transparent areas.

import { useState } from "react";

// Map from "color + piece type" to a Unicode chess glyph.
const symbols = {
  wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔", // white pieces
  bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚"  // black pieces
};

export default function Piece({ piece }) {
  const [failed, setFailed] = useState(false);

  if (!piece) return null; // empty square
  if (failed) return <>{symbols[piece.color + piece.type]}</>; // fallback glyph

  return (
    <img
      className="piece-img"
      src={`/pieces/${piece.color + piece.type}.png`}
      alt=""
      onError={() => setFailed(true)} // missing file -> switch to the glyph
    />
  );
}