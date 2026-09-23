// Keep the amount of work proportional to the time available, even on retries.
const profiles = [
  {
    upTo: 15,
    tokens: 0,
    instruction: "QUICK MOVE: Choose the first reasonable move after one immediate safety check. If in check, get out of check. Otherwise prefer an obvious capture, defending an attacked piece, or simple development. Do not compare candidate lines, calculate variations, or search for the best possible move. Commit immediately.",
  },
  {
    upTo: 45,
    tokens: 512,
    instruction: "BRIEF CHECK: Consider at most two plausible moves. Check each for an immediate threat or obvious lost piece, then choose. Do not calculate a tree of variations or revisit a rejected candidate.",
  },
  {
    upTo: 90,
    tokens: 1024,
    instruction: "FOCUSED COMPARISON: Compare at most three candidates. Consider one likely opponent reply to each, prioritizing checks, captures, threats and king safety. Choose the best candidate after this single comparison; do not restart your analysis.",
  },
  {
    upTo: 180,
    tokens: 1536,
    instruction: "TACTICAL CHECK: Compare at most three candidates, the opponent's strongest reply and one follow-up move. Extend only an immediately forcing check or capture. Prefer a sound move over an exhaustive search, and stop once your choice survives a blunder check.",
  },
  {
    upTo: 300,
    tokens: 3072,
    instruction: "DEEPER COMPARISON: Compare at most four candidates. Examine the opponent's strongest reply and your continuation, extending a forcing tactical line only if it changes the decision. Include king safety, material and pawn structure. Keep the best candidate as you go, make one final blunder check, then commit. Do not enumerate every legal move or keep revisiting the same lines.",
  },
];

export function thinkingPolicy({ seconds, remainingSeconds, model, reasoningTokenBase, repair = false }) {
  const available = Math.max(1, Math.min(seconds, remainingSeconds));
  const profile = repair ? profiles[0] : profiles.find((item) => available <= item.upTo) || profiles.at(-1);
  const configured = Number(reasoningTokenBase);
  const base = Number.isFinite(configured) && configured > 0 ? configured : 1500;
  // The older environment setting may lower these caps, but cannot inflate them.
  const tokens = Math.min(profile.tokens, Math.round(base * available / 30));

  // These options are verified against OpenRouter's public model metadata.
  // Both models support disabling reasoning; DeepSeek has no medium effort.
  const modelId = model.split(":")[0];
  const isDeepSeek = modelId === "deepseek/deepseek-v4.1-flash";
  const isLuna = modelId === "openai/gpt-5.6-luna";
  const supportsEffort = isDeepSeek || isLuna;
  const effort = available > 180 ? "high" : isLuna && available > 45 ? "medium" : "low";
  const reasoning = supportsEffort
    ? (tokens === 0 ? (isLuna ? { effort: "none" } : { enabled: false }) : { effort })
    : { max_tokens: Math.max(1024, tokens) };
  const maxTokens = supportsEffort
    ? (tokens === 0 ? 256 : tokens + 1024)
    : reasoning.max_tokens + 1024;

  return {
    reasoning,
    maxTokens,
    temperature: isLuna ? undefined : 0.4,
    systemPrompt: `You choose a chess move for Black against a human opponent.
The turn's maximum time is ${seconds} seconds; at most ${available} seconds remain for this request, including delivery of your answer. Returning a usable move promptly is more important than finding a perfect move. This is a limit, not a target: answer sooner whenever you have a choice.
${repair ? "REPAIR REQUEST: Your previous reply did not provide a usable move. Correct the move or format immediately; do not begin another deep analysis.\n" : ""}${profile.instruction}
Use the supplied current FEN as the source of truth. The game permits teleported pieces: do not reconstruct the whole game, explain unusual positions, or try to repair them. Do not repeat the board, list every piece, narrate every thought, or reconsider a decision without a concrete new threat.
The from-square must hold a black piece. The destination must differ from it and must not contain either king.
Put the committed move on the FIRST line of your final answer, exactly: MOVE e7e5
Use UCI format (from-square + to-square, with q/r/b/n only for a promotion).${profile.tokens === 0 ? " Output only that MOVE line, with no explanation." : " You may add one short sentence explaining the choice after the MOVE line. Do not include analysis or alternative moves in the final answer."}`,
  };
}
