// ============================================================
// server.js — Express app wiring + startup.
// ============================================================
// Express keeps the OpenRouter key on the server; Vite proxies /api
// here. The actual route handlers live in server/:
//   server/model-route.js — GET  /api/ai-model  (model name for the label)
//   server/move-route.js  — POST /api/ai-move   (the AI turn, with fallbacks)
// This file only creates the app, injects dependencies, and mounts them.

import "dotenv/config";
import express from "express";
import { pathToFileURL } from "node:url";
import { createModelRoute } from "./server/model-route.js";
import { createMoveRoute } from "./server/move-route.js";

// Inject the transport/configuration so tests never spend credits or need a key.
export function createApp({ fetchImpl = fetch, config = process.env } = {}) {
  const app = express();
  app.use(express.json());

  app.get("/api/ai-model", createModelRoute({ config }));
  app.post("/api/ai-move", createMoveRoute({ fetchImpl, config }));

  return app;
}

// Importing createApp in a test does not start a real server.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = process.env.PORT || 3001;
  createApp().listen(port, () => console.log(`Server: http://localhost:${port}`));
}