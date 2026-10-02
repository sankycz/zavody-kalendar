import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { registerServiceWorker } from "./offline/client.ts";
import { todayInPrague } from "./offline/plan.ts";
import { getPrefs, pruneFavorites } from "./prefs.ts";
import "./index.css";

// Opening the app (start page without filters in the URL): the list as the visitor left it.
// A shared link with its own filters, or a click on the logo, wins.
if (window.location.pathname === "/" && !window.location.search && getPrefs().lastList) {
  window.history.replaceState(window.history.state, "", `/?${getPrefs().lastList}`);
}
pruneFavorites(todayInPrague());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
