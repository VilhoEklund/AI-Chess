// Entry point: this is the script that the HTML page (index.html) loads.
// Everything the app shows is drawn from here.

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'              // side-effect import: injects the global CSS, imports nothing
import App from './App.jsx'

// React 18+ bootstrapping:
// 1. find the empty <div id="root"> in the HTML page,
// 2. hand it to React as the place to draw into,
// 3. render the <App /> component tree inside it.
createRoot(document.getElementById('root')).render(
  // StrictMode is a development-only wrapper that helps catch bugs:
  // it double-invokes components/effects on purpose so unsafe side
  // effects reveal themselves. It renders nothing and does nothing in
  // the production build.
  <StrictMode>
    <App />
  </StrictMode>,
)
