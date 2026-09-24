// ============================================================
// ThinkingControls.jsx — the "AI thinking time" slider block.
// ============================================================
// The right-hand panel's top half: the range slider that sets the
// maximum seconds the AI may spend per move, plus the live countdown
// shown while the AI is thinking. App.jsx owns the values; this
// component only displays them and reports slider changes upward.

import {
  MAX_THINKING_SECONDS, MIN_THINKING_SECONDS,
} from "../../shared/ai.js";

/** Turns seconds into a short label: 45 -> "45 s", 90 -> "1 min 30 s". */
function formatTime(seconds) {
  if (seconds < 60) return `${seconds} s`;
  const remainder = seconds % 60;
  return `${Math.floor(seconds / 60)} min${remainder ? ` ${remainder} s` : ""}`;
}

export default function ThinkingControls({ thinkingSeconds, remainingSeconds, thinking, onChange }) {
  return (
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
        onChange={(event) => onChange(Number(event.target.value))}
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
  );
}