# AI-Chess

A React chess game with a Node/Express backend that requests AI moves from OpenRouter.

## Setup

Open this `AI-Chess` folder in your editor. `package.json`, `index.html`,
`vite.config.js`, and `server.js` belong together in this folder.

Use Node.js 24 (tested), or another version supported by the `engines` field in
`package.json`. npm comes with Node.js.

Install the project's existing dependencies:

```powershell
npm ci
```

This is already a Vite project. You do not need to run `npm create vite@latest`.

## Configure the AI

The backend needs `OPENROUTER_API_KEY` and `OPENROUTER_MODEL`. If they are already
set as Windows environment variables, open a new terminal so it can read them.

Otherwise, copy `.env.example` to `.env` in this folder and fill in the key and
your OpenRouter model ID. Keep `.env` private; Git ignores it. Existing environment
variables take priority over `.env`. Restart the backend after changing settings.

The board and development servers can run without these settings, but AI moves
require both values.

## Run locally

Open two terminals in this `AI-Chess` folder and keep both running.

Start the backend in the first terminal:

```powershell
npm run server
```

Start Vite in the second terminal:

```powershell
npm run dev
```

Open the local URL Vite prints, normally `http://localhost:5173`.
Vite forwards `/api` requests to the backend at `http://localhost:3001`.
Leave the backend on port 3001 unless you also update `vite.config.js`.
Press Ctrl+C in each terminal to stop the servers.

## Thinking time

Use the **AI thinking time** slider to choose a maximum of 5 seconds–5 minutes per
move (30 seconds by default). Your choice is saved in this browser. The AI can
answer sooner; longer limits allow a more detailed comparison. A countdown
shows the time remaining while it works.

The system prompt changes with the available time:

- **5–15 seconds:** choose a sensible move immediately, with one safety check.
- **20–45 seconds:** compare up to two moves for immediate threats.
- **50–90 seconds:** compare up to three moves and one opponent reply each.
- **95–180 seconds:** check three candidates, a reply, and a follow-up.
- **185–300 seconds:** compare up to four candidates and explore forcing tactics.

Every mode prioritizes delivering a move and asks for the `MOVE` line first.
Retries use quick correction instructions and the remaining time, without
replaying unfinished reasoning. Only the recent move history is sent alongside
the current position, so long games do not invite reconstruction of every move.

For `openai/gpt-5.6-luna`, quick turns use no extended reasoning, then low,
medium, or high effort as the time budget grows. `deepseek/deepseek-v4.1-flash`
uses its supported disabled/low/high settings. Output caps also stay smaller
than the previous linear token scaling.
Other models retain token-budget controls. Model/provider support varies; these
instructions do not replace the enforced deadline. See the
[OpenRouter reasoning controls](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

All retries share the selected deadline. If time runs out, the response is
unusable, or the AI service is unavailable, the game plays a clearly labelled
legal backup move. The browser has its own fallback if the backend cannot be
reached, with a 1.5-second allowance for the server response to arrive. Checkmate
and draws end the game instead of inventing a move. **New game** cancels any
pending move so an old reply cannot change the new board.

Restart `npm run server` after changing backend code.

## Check and build

```powershell
npm test
npm run lint
npm run build
```

The build goes into `dist/`. Keep source files and `package-lock.json` in Git;
`node_modules/`, `dist/`, and `.env` are generated or local files and are ignored.

`npm run preview` previews the built frontend only. Use the two development
commands above when playing locally with the AI backend.
