import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./theme.css";
import { initKitTheme } from "./shared/kitTheme";

// The service worker is registered by `useAppUpdate` inside App, so the app
// can react to a waiting update (banner + one-tap reload) instead of silently
// running a stale bundle. Registering here as well would double-register.

// BEFORE the first render, so the first paint is already the right kit and a
// light-preference phone never sees a dark flash. See kitTheme.ts.
initKitTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
