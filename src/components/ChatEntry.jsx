// ============================================================
// ChatEntry.jsx — one finished entry in the "AI thinking" log.
// ============================================================
// Each entry shows the move with its badges (duration, attempts,
// source), optional notes, the AI's short "thought", and the raw
// hidden reasoning inside an expandable <details>.

export default function ChatEntry({ entry }) {
  return (
    <div
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
  );
}