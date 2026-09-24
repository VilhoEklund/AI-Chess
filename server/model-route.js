// ============================================================
// model-route.js — GET /api/ai-model
// ============================================================
// A tiny endpoint the frontend calls once on load, just to show the
// player which AI model they are up against (and the slider limits).

import {
  DEFAULT_THINKING_SECONDS, MAX_THINKING_SECONDS, MIN_THINKING_SECONDS,
} from "../shared/ai.js";

/** Factory: injects `config` (environment) so tests need no real env vars. */
export function createModelRoute({ config }) {
  return (req, res) => {
    res.json({
      model: config.OPENROUTER_MODEL || "(not configured)",
      thinkingSeconds: DEFAULT_THINKING_SECONDS,
      minThinkingSeconds: MIN_THINKING_SECONDS,
      maxThinkingSeconds: MAX_THINKING_SECONDS,
    });
  };
}