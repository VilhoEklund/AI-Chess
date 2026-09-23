// ============================================================
// App.jsx — the entire chess frontend, one React component.
// ============================================================

import { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { requestAiMove } from "./ai-client.js";
import {
  backupMove, DEFAULT_THINKING_SECONDS, gameOverMessage,
  MAX_THINKING_SECONDS, MIN_THINKING_SECONDS, normalizeThinkingSeconds,
} from "../shared/ai.js";

// Map from "color + piece type" to a Unicode chess glyph.
const symbols = {
  wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔", // white pieces
  bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚"  // black pieces
};

function formatTime(seconds) {
  if (seconds < 60) return `${seconds} s`;
  const remainder = seconds % 60;
  return `${Math.floor(seconds / 60)} min${remainder ? ` ${remainder} s` : ""}`;
}

/**
 * Renders ONE piece: the PNG from public/pieces/<key>.png, or — only if
 * that file is missing — the Unicode glyph as fallback.
 *
 * It needs its own component (with its own useState) because the choice
 * "image vs glyph" is per-piece state: when the <img> fails to load we
 * flip `failed` and re-render as the glyph. Keeping the glyph out of the
 * successful case also stops it from showing through the PNG's
 * transparent areas.
 */
function Piece({ piece }) {
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

function forceIllegalMove(fen, from, to) {
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

export default function App() {
  // ---- React state -----------------------------------------------------
  // useState(initial) returns [value, setter]. Calling a setter re-runs
  // App (a re-render) and the UI updates. fen is the single source of truth.
  const [fen, setFen] = useState(new Chess().fen());
  const [history, setHistory] = useState([]);        // SAN moves so far
  const [selected, setSelected] = useState(null);    // clicked square or null
  const [thinking, setThinking] = useState(false);   // true while waiting for the AI
  const [message, setMessage] = useState("White to move");
  const [model, setModel] = useState("(loading…)");  // which AI we play against
  const [chat, setChat] = useState([]);              // one entry per AI turn
  const [thinkingSeconds, setThinkingSeconds] = useState(() => {
    try {
      const saved = localStorage.getItem("ai-thinking-seconds");
      return saved === null ? DEFAULT_THINKING_SECONDS : normalizeThinkingSeconds(Number(saved));
    } catch {
      return DEFAULT_THINKING_SECONDS;
    }
  });
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const activeRequest = useRef(null);

  useEffect(() => {
    try { localStorage.setItem("ai-thinking-seconds", String(thinkingSeconds)); } catch { /* Storage is optional. */ }
  }, [thinkingSeconds]);

  useEffect(() => {
    if (!thinking) return;
    const deadline = Date.now() + thinkingSeconds * 1000;
    const timer = setInterval(() => {
      setRemainingSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 100);
    return () => clearInterval(timer);
  }, [thinking, thinkingSeconds]);

  useEffect(() => () => activeRequest.current?.abort(), []);

  // Re-parse the FEN every render — derive, don't store twice.
  const game = new Chess(fen, { skipValidation: true });
  const board = game.board(); // 8x8 array for rendering (row 0 = rank 8)

  // Legal destinations of the selected piece, as a Set of square names.
  // game.moves({ square }) enumerates just that piece's legal moves; the
  // Set makes the render loop's lookup O(1). try/catch: after forced AI
  // moves the position can be nonsense, and chess.js may throw while
  // enumerating — then we simply show no hints.
  let legalTargets = new Set();
  if (selected) {
    try {
      legalTargets = new Set(
        game.moves({ square: selected, verbose: true }).map((m) => m.to)
      );
    } catch {
      legalTargets = new Set();
    }
  }

  // The chat panel scrolls itself to the bottom whenever it grows.
  const chatRef = useRef(null);
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chat, thinking]);

  // On first load: ask the server which model is in use, for the label.
  useEffect(() => {
    fetch("/api/ai-model")
      .then((r) => r.json())
      .then((data) => setModel(data.model))
      .catch(() => setModel("(server offline)"));
  }, []);

  /**
   * Asks the server for the AI's move and applies it to the game state.
   * positionFen = position after the player's move (Black to play).
   * historySoFar = ALL moves incl. the player's last, sent to the AI.
   */
  async function askAi(positionFen, historySoFar) {
    activeRequest.current?.abort();
    const controller = new AbortController();
    activeRequest.current = controller;
    setRemainingSeconds(thinkingSeconds);
    setThinking(true);
    setMessage("AI is thinking...");

    function finishTurn(data) {
      if (data.gameOver) {
        setMessage(data.message);
        return;
      }
      const aiMove = data.move;
      const from = aiMove.slice(0, 2);
      const to = aiMove.slice(2, 4);
      const normal = new Chess(positionFen, { skipValidation: true });
      let nextFen;
      let aiSan;
      let moveMessage;
      try {
        const result = normal.move({ from, to, promotion: aiMove[4] || "q" });
        aiSan = result.san;
        nextFen = normal.fen();
        moveMessage = data.fallback
          ? `Backup move played: ${aiMove} — your turn`
          : `AI played ${aiMove} — legal`;
      } catch {
        nextFen = forceIllegalMove(positionFen, from, to);
        moveMessage = `AI played ${aiMove} — ILLEGAL, but accepted`;
        aiSan = `${aiMove} (forced)`;
      }
      setFen(nextFen);
      setMessage(gameOverMessage(new Chess(nextFen, { skipValidation: true })) || moveMessage);
      setHistory([...historySoFar, aiSan]);
      setChat((prev) => [...prev, {
        move: aiMove,
        fallback: data.fallback || false,
        fallbackReason: data.fallbackReason || "",
        thought: data.thought || "",
        reasoning: data.reasoning || "",
        source: data.source || "?",
        attempts: data.attempts ?? 1,
        ms: data.ms ?? 0,
        moveNumber: Math.ceil(historySoFar.length / 2),
      }]);
    }

    try {
      const data = await requestAiMove({
        fen: positionFen, history: historySoFar, thinkingSeconds, signal: controller.signal,
      });
      if (controller.signal.aborted || activeRequest.current !== controller) return;
      finishTurn(data);
    } catch {
      if (controller.signal.aborted || activeRequest.current !== controller) return;
      // Last line of defence if a reply cannot actually be placed on the board.
      finishTurn({
        ...backupMove(new Chess(positionFen, { skipValidation: true }),
          "The AI move could not be used. A legal backup move was played."),
        attempts: 0,
      });
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setThinking(false);
        setRemainingSeconds(0);
      }
    }
  }

  /**
   * Handles one click on a board square (each square is a <button>).
   * Two-click flow: click your piece, then click the destination.
   * @param {string} square - e.g. "e2"
   */
  async function clickSquare(square) {
    // Ignore clicks while the AI thinks, or when it is not White's turn.
    if (thinking || game.turn() !== "w" || gameOverMessage(game)) return;

    if (!selected) {
      // First click: remember the square IF it holds one of our pieces.
      const piece = game.get(square);
      if (piece?.color === "w") setSelected(square);
      return;
    }

    // Second click: try the move on a SCRATCH copy so the real game
    // stays untouched if the move is illegal.
    const next = new Chess(fen, { skipValidation: true });

    try {
      // Player promotions auto-queen; move() returns the move object.
      const result = next.move({ from: selected, to: square, promotion: "q" });
      // The player's move completes the history the AI will be shown,
      // so append it BEFORE askAi sends anything.
      const newHistory = [...history, result.san];
      setSelected(null);
      setFen(next.fen());
      setHistory(newHistory);
      const resultMessage = gameOverMessage(next);
      if (resultMessage) {
        setMessage(resultMessage);
        return;
      }
      await askAi(next.fen(), newHistory);
    } catch {
      // move() threw: the attempted move breaks the chess rules.
      const piece = game.get(square);
      if (piece?.color === "w") {
        setSelected(square); // clicked another own piece -> change selection
      } else {
        setSelected(null);
        setMessage("Illegal player move");
      }
    }
  }

  function reset() {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setThinking(false);
    setRemainingSeconds(0);
    setFen(new Chess().fen());
    setHistory([]);
    setChat([]); // fresh game = fresh thinking log
    setSelected(null);
    setMessage("White to move");
  }

  // ---- JSX ---------------------------------------------------------------
  // Curly braces { } embed JavaScript values/expressions into the markup.
  return (
    <main>
      <h1>AI Illegal Chess</h1>
      <p>{message}</p>

      <div className="layout">
        <div className="board-column">
          <div className="board">
            {/* `board` is 8 rows; flatMap + row.map produce 64 <button>s.
                Square names: "abcdefgh"[column] + (8 - row), e.g. "e2". */}
            {board.flatMap((row, rowIndex) =>
              row.map((piece, columnIndex) => {
                const square = `${"abcdefgh"[columnIndex]}${8 - rowIndex}`;
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
                    onClick={() => clickSquare(square)}
                  >
                    {/* PNG piece (glyph only if the file is missing) */}
                    <Piece piece={piece} />
                  </button>
                );
              })
            )}
          </div>

          <button className="reset" onClick={reset}>New game</button>
        </div>

        <section className="ai-panel" aria-label="AI controls and moves">
          <div className="thinking-controls">
            <div className="thinking-label">
              <label htmlFor="thinking-time">AI thinking time</label>
              <output htmlFor="thinking-time">{formatTime(thinkingSeconds)}</output>
            </div>
            <input
              id="thinking-time"
              className="thinking-slider"
              type="range"
              min={MIN_THINKING_SECONDS}
              max={MAX_THINKING_SECONDS}
              step="5"
              value={thinkingSeconds}
              disabled={thinking}
              aria-valuetext={`${thinkingSeconds} seconds maximum per move`}
              aria-describedby="thinking-help"
              style={{ "--slider-fill": `${(thinkingSeconds - MIN_THINKING_SECONDS) / (MAX_THINKING_SECONDS - MIN_THINKING_SECONDS) * 100}%` }}
              onChange={(event) => setThinkingSeconds(Number(event.target.value))}
            />
            <div className="thinking-scale" aria-hidden="true">
              <span>Quick · 5 s</span><span>More time · 5 min</span>
            </div>
            <p id="thinking-help">
              Maximum time per move. If the AI cannot answer in time, a legal backup move keeps the game going.
            </p>
            {thinking && (
              <div className="thinking-timer">
                <div className="thinking-scale">
                  <span>{remainingSeconds > 0 ? "Time remaining" : "Finishing move…"}</span>
                  <span>{formatTime(remainingSeconds)}</span>
                </div>
                <progress aria-label="AI thinking time remaining" max={thinkingSeconds} value={remainingSeconds} />
              </div>
            )}
          </div>

          <aside className="chat" ref={chatRef}>
            <h2>AI thinking</h2>
            <p className="model-label">Model: {model}</p>

            {/* While waiting for the server, show a live "thinking" entry. */}
            {/* While waiting for the server: ChatGPT-style "Thinking" —
                a shimmer sweeping across the word plus three bouncing
                dots. Pure CSS (see .shimmer / .dot in index.css). */}
            {thinking && (
              <div className="chat-entry pending">
                <span className="shimmer">Thinking</span>
                <span className="dots">
                  <span className="dot" />
                  <span className="dot" />
                  <span className="dot" />
                </span>
              </div>
            )}

            {chat.map((entry, i) => (
              <div
                key={i}
                className={`chat-entry ${entry.fallback ? "fallback" : ""} ${
                  entry.error ? "error" : ""
                }`}
              >
                {entry.error ? (
                  <p className="chat-error">✗ {entry.text}</p>
                ) : (
                  <>
                    <p className="chat-move">
                      {`#${entry.moveNumber} ${entry.move}`}
                      <span className="badge">{(entry.ms / 1000).toFixed(1)} s</span>
                      {entry.attempts > 0 && <span className="badge">{entry.attempts} {entry.attempts === 1 ? "try" : "tries"}</span>}
                      <span className="badge">{entry.fallback ? "Backup move" : entry.source}</span>
                    </p>
                    {entry.fallbackReason && <p className="chat-note">{entry.fallbackReason}</p>}
                    {!entry.thought && entry.source === "reasoning" && (
                      <p className="chat-note">
                        no finished answer — the move was mined from the raw
                        thinking below
                      </p>
                    )}
                    {entry.thought && <p className="chat-thought">{entry.thought}</p>}
                    {entry.reasoning && (
                      <details
                        onToggle={(e) => {
                          // When expanded, scroll the panel so the text is
                          // actually ON SCREEN — otherwise it opens below
                          // the fold and looks like nothing happened.
                          if (e.target.open) {
                            e.target.scrollIntoView({
                              block: "start",
                              behavior: "smooth"
                            });
                          }
                        }}
                      >
                        <summary>
                          hidden reasoning ({entry.reasoning.length} chars)
                        </summary>
                        <pre className="chat-reasoning">{entry.reasoning}</pre>
                      </details>
                    )}
                  </>
                )}
              </div>
            ))}
          </aside>
        </section>
      </div>

      <p className="footer-hint">
        Illegal AI moves are forced onto the board — that is the game.
      </p>
    </main>
  );
}
