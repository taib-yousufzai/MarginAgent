import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import IndexPage from "./routes/index";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <IndexPage />
  </StrictMode>,
);
