// ============================================================
// ThinkingControls.jsx — the "AI thinking time" slider block.
// ============================================================
// Sits in the top header row, next to the title and the New game
// button. The slider sets the maximum seconds the AI may spend per
// move. While the AI is thinking, the SAME slider becomes the
// countdown meter: the label switches to "Time remaining", the value
// counts down and the colored fill drains away. One element doing
// both jobs means the block never changes size, so nothing on the
// page jumps when the AI's turn starts. App.jsx owns the values;
// this component only displays them and reports slider changes up.

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
  // In meter mode the slider's range is 0..thinkingSeconds, so the
  // fill position is simply "seconds left / budget".
  const seconds = thinking ? remainingSeconds : thinkingSeconds;
  const fillPercent = thinking
    ? (remainingSeconds / thinkingSeconds) * 100
    : (thinkingSeconds - MIN_THINKING_SECONDS) / (MAX_THINKING_SECONDS - MIN_THINKING_SECONDS) * 100;

  return (
    <div className="thinking-controls">
      <div className="thinking-label">
        <label htmlFor="thinking-time">
          {thinking ? (remainingSeconds > 0 ? "AI time remaining" : "Finishing move…") : "AI thinking time"}
        </label>
        <output htmlFor="thinking-time">{formatTime(seconds)}</output>
      </div>
      <input
        id="thinking-time"
        className="thinking-slider"
        type="range"
        min={thinking ? 0 : MIN_THINKING_SECONDS}
        max={thinking ? thinkingSeconds : MAX_THINKING_SECONDS}
        step={thinking ? "1" : "5"}
        value={seconds}
        disabled={thinking}
        aria-valuetext={thinking
          ? `${seconds} seconds remaining`
          : `${seconds} seconds maximum per move`}
        aria-describedby="thinking-help"
        style={{ "--slider-fill": `${fillPercent}%` }}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <div className="thinking-scale" aria-hidden="true">
        {thinking
          ? <><span>0 s</span><span>{formatTime(thinkingSeconds)} budget</span></>
          : <><span>Quick · 5 s</span><span>More time · 5 min</span></>}
      </div>
      <p id="thinking-help">
        {thinking
          ? "The move arrives when the AI answers; if the meter empties first, a legal backup move is played."
          : "Maximum time per move. If the AI cannot answer in time, a legal backup move keeps the game going."}
      </p>
    </div>
  );
}
