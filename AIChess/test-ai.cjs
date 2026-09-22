// Temporary live test for the improved AI prompt.
const { Chess } = require("chess.js");

// --- Test 1: normal mid-game position (Ruy Lopez) ---
const g = new Chess();
for (const m of ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4", "Nf6", "O-O", "Be7"]) g.move(m);
console.log("TEST 1 FEN :", g.fen());
console.log("TEST 1 HIST:", JSON.stringify(g.history()));

// --- Test 2: position where a FORCED (illegal) move happened ---
// Real FEN after 1. e4 d5 2. exd5, but the history claims Black's rook
// teleported a8a5. The server must not choke; the AI must still move.
const g2 = new Chess();
for (const m of ["e4", "d5", "exd5"]) g2.move(m);
const fen2 = g2.fen();
const hist2 = [...g2.history(), "a8a5 (forced)"];
console.log("TEST 2 FEN :", fen2);
console.log("TEST 2 HIST:", JSON.stringify(hist2));

async function ask(name, fen, history) {
  const t0 = Date.now();
  const r = await fetch("http://localhost:3002/api/ai-move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fen, history })
  });
  const body = await r.text();
  console.log(`${name} (${Date.now() - t0} ms):`, body);
}

(async () => {
  await ask("TEST 1", g.fen(), g.history());
  await ask("TEST 2", fen2, hist2);
})();
