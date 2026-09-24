// ============================================================
// ChatPanel.jsx — the "AI thinking" log (right-hand panel).
// ============================================================
// Shows which model is being played against, a live "Thinking…"
// placeholder while waiting for the server, and one ChatEntry per
// finished AI turn. The panel keeps itself scrolled to the bottom
// whenever its content grows.

import { useEffect, useRef } from "react";
import ChatEntry from "./ChatEntry.jsx";

export default function ChatPanel({ chat, thinking, model }) {
  // The chat panel scrolls itself to the bottom whenever it grows.
  const chatRef = useRef(null);
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [chat, thinking]);

  return (
    <aside className="chat" ref={chatRef}>
      <h2>AI thinking</h2>
      <p className="model-label">Model: {model}</p>

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
        <ChatEntry key={i} entry={entry} />
      ))}
    </aside>
  );
}