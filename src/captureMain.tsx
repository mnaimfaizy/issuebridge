import { createRoot } from "react-dom/client";
import { CaptureApp } from "./capture/CaptureApp";

const root = document.querySelector("#root");
if (!root) {
  throw new Error("Issuebridge Capture popup root element is missing.");
}

createRoot(root).render(<CaptureApp />);
