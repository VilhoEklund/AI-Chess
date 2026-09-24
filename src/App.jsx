// ============================================================
// App.jsx — the game orchestrator: owns ALL state and game logic.
// ============================================================
// This file decides WHAT happens (clicks, AI turns, resets); the
// components in src/components/ decide HOW it looks. Data flows one
// way: state down as props, events up as callbacks.

import { useEffect, useRef, useState } from "react";
import { Chess } from "chess.js";
import { requestAiMove } from "./ai-client.js";
import { forceIllegalMove } from "./lib/forced-move.js";
import Board from "./components/Board.jsx";
import ThinkingControls from "./components/ThinkingControls.jsx";
import ChatPanel from "./components/ChatPanel.jsx";
import {
  backupMove, DEFAULT_THINKING_SECONDS, gameOverMessage,
  normalizeThinkingSeconds,
} from "../shared/ai.js";

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

  // While the AI is thinking, tick a countdown 10× per second so the
  // progress bar and "time remaining" label stay current.
  useEffect(() => {
    if (!thinking) return;
    const deadline = Date.now() + thinkingSeconds * 1000;
    const timer = setInterval(() => {
      setRemainingSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    }, 100);
    return () => clearInterval(timer);
  }, [thinking, thinkingSeconds]);

  // Unmount safety: cancel an in-flight AI request so a late reply
  // can never land on a board the user has already reset away from.
  useEffect(() => () => activeRequest.current?.abort(), []);

  // ---- Derived values (recomputed each render — derive, don't store twice)
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
          <Board
            board={board}
            selected={selected}
            legalTargets={legalTargets}
            onSquareClick={clickSquare}
          />
          <button className="reset" onClick={reset}>New game</button>
        </div>

        <section className="ai-panel" aria-label="AI controls and moves">
          <ThinkingControls
            thinkingSeconds={thinkingSeconds}
            remainingSeconds={remainingSeconds}
            thinking={thinking}
            onChange={setThinkingSeconds}
          />
          <ChatPanel chat={chat} thinking={thinking} model={model} />
        </section>
      </div>

      <p className="footer-hint">
        Illegal AI moves are forced onto the board — that is the game.
      </p>
    </main>
  );
}