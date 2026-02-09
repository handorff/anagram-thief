import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { Agentation } from "agentation";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {import.meta.env.DEV ? <Agentation /> : null}
    <App />
  </React.StrictMode>
);
