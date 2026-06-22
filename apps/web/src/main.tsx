import { BeastApp } from "@beast/ui";
import "@beast/ui/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <BeastApp />
  </StrictMode>,
);
