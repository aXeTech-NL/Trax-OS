import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";

import { createHttpRepositories } from "./adapters/http-repositories";
import { App } from "./app";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing");

const { instanceRepository, authRepository, journeyRepository } =
  createHttpRepositories();

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
