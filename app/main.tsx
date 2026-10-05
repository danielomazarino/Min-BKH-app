import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./theme.css";
import { registerSW } from "virtual:pwa-register";
import { initKitTheme } from "./shared/kitTheme";

registerSW({ immediate: true });

// BEFORE the first render, so the first paint is already the right kit and a
// light-preference phone never sees a dark flash. See kitTheme.ts.
initKitTheme();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
