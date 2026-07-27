import { invoke } from "@tauri-apps/api/core";

type AuthStateDto = "signed_out" | "signed_in";

window.addEventListener("DOMContentLoaded", () => {
  void refreshAuthState();
});

async function refreshAuthState() {
  const el = document.querySelector("#auth-state");
  const status = document.querySelector<HTMLElement>("#status");
  if (!el) return;

  try {
    const state = await invoke<AuthStateDto>("auth_state");
    el.textContent = state === "signed_in" ? "Signed in" : "Signed out";
  } catch (error) {
    el.textContent = "unavailable";
    if (status) {
      status.hidden = false;
      status.textContent = String(error);
    }
  }
}
