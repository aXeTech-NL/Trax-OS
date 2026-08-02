import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import { HttpAuthRepository } from "./adapters/http-auth-repository";
import { HttpInstanceRepository } from "./adapters/http-instance-repository";
import { HttpJourneyRepository } from "./adapters/http-journey-repository";
import { App } from "./app";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing");

const instanceRepository = new HttpInstanceRepository();
const authRepository = new HttpAuthRepository();
const journeyRepository = new HttpJourneyRepository();

registerSW({ immediate: true });

createRoot(root).render(
  <StrictMode>
    <App
      repository={instanceRepository}
      journeyRepository={journeyRepository}
      authRepository={authRepository}
    />
  </StrictMode>,
);
