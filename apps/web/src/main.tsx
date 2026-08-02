import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { HttpInstanceRepository } from "./adapters/http-instance-repository";
import { App } from "./app";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing");

const repository = new HttpInstanceRepository();

createRoot(root).render(
  <StrictMode>
    <App repository={repository} />
  </StrictMode>,
);
