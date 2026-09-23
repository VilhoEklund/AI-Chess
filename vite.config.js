import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Plugins extend the dev server and the build. plugin-react teaches
  // Vite to understand JSX (<button>...</button> in .jsx files) and adds
  // React Fast Refresh (instant UI updates while editing, keeping state).
  plugins: [react()],
  server: {
    // Dev-server proxy: while developing, any browser request whose path
    // starts with "/api" is FORWARDED to the Express backend on port 3001
    // instead of being answered by Vite itself.
    //
    // Without this, the frontend's fetch("/api/ai-move") would hit Vite,
    // which has no such route and answers with an empty/HTML body — the
    // browser then fails with "Unexpected end of JSON input".
    //
    // The proxy also sidesteps CORS: the browser believes it is talking
    // to its own origin (localhost:5173), so no cross-origin rules apply.
    proxy: {
      "/api": "http://localhost:3001"
    }
  }
})
