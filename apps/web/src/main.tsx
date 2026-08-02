import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import { HttpInstanceRepository } from "./adapters/http-instance-repository";
import { IndexedDbJourneyRepository } from "./adapters/indexeddb-journey-repository";
import { App } from "./app";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing");

const instanceRepository = new HttpInstanceRepository();
const journeyRepository = new IndexedDbJourneyRepository();

registerSW({ immediate: true });

createRoot(root).render(
  <StrictMode>
    <App
      repository={instanceRepository}
      journeyRepository={journeyRepository}
    />
  </StrictMode>,
);
