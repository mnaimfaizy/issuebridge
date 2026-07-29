import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.querySelector("#root");
if (!root) {
  throw new Error("Issuebridge main window root element is missing.");
}

createRoot(root).render(<App />);
