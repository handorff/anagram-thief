import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { UserSettingsProvider } from "./userSettings";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <UserSettingsProvider>
      <App />
    </UserSettingsProvider>
  </React.StrictMode>
);
