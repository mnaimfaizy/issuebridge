import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";

type RepoIdDto = { owner: string; name: string };

type VoiceKind =
  | "permission_denied"
  | "no_device"
  | "sidecar_failed"
  | "empty_transcript";

const VOICE_MESSAGES: Record<VoiceKind, string> = {
  permission_denied:
    "Voice needs microphone access. Allow Issuebridge in Windows privacy settings, or type instead.",
  no_device: "No microphone found. Plug one in or type instead.",
  sidecar_failed: "Voice ran into a problem. Try again or type instead.",
  empty_transcript: "Didn’t catch that. Try again or type.",
};

let testingSet: RepoIdDto[] = [];
let visibleRepos: RepoIdDto[] = [];
let selectedRepo: RepoIdDto | null = null;

let mediaStream: MediaStream | null = null;
let mediaRecorder: MediaRecorder | null = null;
let recordedChunks: Blob[] = [];
let recording = false;
let pttBusy = false;

window.addEventListener("DOMContentLoaded", () => {
  document
    .querySelector("#capture-save")
    ?.addEventListener("click", () => void saveDraft());
  document
    .querySelector("#capture-cancel")
    ?.addEventListener("click", () => void closeCapture());
  document
    .querySelector("#capture-repo")
    ?.addEventListener("input", () => {
      const input = document.querySelector<HTMLInputElement>("#capture-repo");
      const value = input?.value.trim() ?? "";
      const parsed = parseRepo(value);
      if (parsed) selectedRepo = parsed;
      renderTypeahead();
    });

  const ptt = document.querySelector<HTMLButtonElement>("#capture-ptt");
  ptt?.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    void startPtt();
  });
  ptt?.addEventListener("pointerup", () => void stopPtt());
  ptt?.addEventListener("pointerleave", () => void stopPtt());
  ptt?.addEventListener("pointercancel", () => void stopPtt());

  window.addEventListener("focus", () => {
    void bootstrap();
  });

  void listen("ptt-pressed", () => {
    void startPtt();
  });
  void listen("ptt-released", () => {
    void stopPtt();
  });

  void bootstrap();
});

async function bootstrap() {
  try {
    testingSet = await invoke<RepoIdDto[]>("testing_set");
    visibleRepos = await invoke<RepoIdDto[]>("app_visible_repos");
    const last = await invoke<RepoIdDto | null>("last_used_repo");
    const hotkey = await invoke<string>("ptt_hotkey").catch(() => "Ctrl+Alt+Shift+V");

    selectedRepo = last ?? testingSet[0] ?? null;

    const title = document.querySelector<HTMLInputElement>("#capture-title");
    const body = document.querySelector<HTMLTextAreaElement>("#capture-body");
    if (title) title.value = "";
    if (body) body.value = "";

    const hint = document.querySelector<HTMLElement>("#capture-ptt-hint");
    if (hint) hint.textContent = hotkey;

    syncRepoInput();
    renderChips();
    renderTypeahead();
    clearStatus();
    clearVoiceStatus();
    title?.focus();
  } catch (error) {
    showStatus(String(error));
  }
}

function renderChips() {
  const chips = document.querySelector("#capture-chips");
  if (!chips) return;
  chips.replaceChildren();

  for (const repo of testingSet) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    if (selectedRepo && repoKey(repo) === repoKey(selectedRepo)) {
      chip.classList.add("chip-selected");
    }
    chip.textContent = `${repo.owner}/${repo.name}`;
    chip.addEventListener("click", () => {
      selectedRepo = repo;
      syncRepoInput();
      renderChips();
      renderTypeahead();
    });
    chips.appendChild(chip);
  }
}

function renderTypeahead() {
  const list = document.querySelector<HTMLElement>("#capture-repo-results");
  const filter =
    document.querySelector<HTMLInputElement>("#capture-repo")?.value.trim().toLowerCase() ??
    "";
  if (!list) return;

  list.replaceChildren();

  const beyondSet = visibleRepos.filter(
    (repo) => !testingSet.some((t) => repoKey(t) === repoKey(repo)),
  );

  const matches = beyondSet.filter((repo) => {
    const label = `${repo.owner}/${repo.name}`.toLowerCase();
    return !filter || label.includes(filter);
  });

  if (!filter || matches.length === 0) {
    list.hidden = true;
    return;
  }

  list.hidden = false;
  for (const repo of matches.slice(0, 8)) {
    const li = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "repo-pick";
    button.textContent = `${repo.owner}/${repo.name}`;
    button.addEventListener("click", () => {
      selectedRepo = repo;
      syncRepoInput();
      renderChips();
      list.hidden = true;
    });
    li.appendChild(button);
    list.appendChild(li);
  }
}

async function startPtt() {
  if (recording || pttBusy) return;
  clearVoiceStatus();

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (error) {
    showVoiceKind(mapMicError(error));
    return;
  }

  recordedChunks = [];
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  mediaRecorder = new MediaRecorder(mediaStream, { mimeType: mime });
  mediaRecorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) recordedChunks.push(event.data);
  });
  mediaRecorder.start();
  recording = true;
  setPttRecording(true);
}

async function stopPtt() {
  if (!recording || !mediaRecorder) return;
  recording = false;
  setPttRecording(false);

  const recorder = mediaRecorder;
  mediaRecorder = null;

  const blob = await new Promise<Blob>((resolve) => {
    recorder.addEventListener("stop", () => {
      resolve(new Blob(recordedChunks, { type: recorder.mimeType }));
    });
    recorder.stop();
  });

  stopMicTracks();

  if (blob.size === 0) {
    showVoiceKind("empty_transcript");
    return;
  }

  pttBusy = true;
  try {
    const wavBase64 = await blobToWavBase64(blob);
    const bodyEl = document.querySelector<HTMLTextAreaElement>("#capture-body");
    const currentBody = bodyEl?.value ?? "";
    const result = await invoke<{ body: string }>("apply_ptt", {
      input: {
        body: currentBody,
        wavBase64,
      },
    });
    if (bodyEl) bodyEl.value = result.body;
    clearVoiceStatus();
  } catch (error) {
    showVoiceKind(parseVoiceKind(error));
  } finally {
    pttBusy = false;
  }
}

function stopMicTracks() {
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;
}

function mapMicError(error: unknown): VoiceKind {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name: string }).name)
      : "";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "no_device";
  }
  if (
    name === "NotAllowedError" ||
    name === "PermissionDeniedError" ||
    name === "SecurityError"
  ) {
    return "permission_denied";
  }
  return "sidecar_failed";
}

function parseVoiceKind(error: unknown): VoiceKind {
  const text = String(error);
  if (text.includes("permission_denied")) return "permission_denied";
  if (text.includes("no_device")) return "no_device";
  if (text.includes("empty_transcript")) return "empty_transcript";
  if (text.includes("sidecar_failed")) return "sidecar_failed";
  return "sidecar_failed";
}

async function blobToWavBase64(blob: Blob): Promise<string> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioCtx = new AudioContext();
  try {
    const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
    const offline = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * 16000),
      16000,
    );
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    const pcm = rendered.getChannelData(0);
    const wav = encodeWav(pcm, 16000);
    return bytesToBase64(wav);
  } finally {
    await audioCtx.close();
  }
}

function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

function writeString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i++) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function saveDraft() {
  if (!selectedRepo) {
    showStatus("Pick a repository.");
    return;
  }

  const title =
    document.querySelector<HTMLInputElement>("#capture-title")?.value ?? "";
  const body =
    document.querySelector<HTMLTextAreaElement>("#capture-body")?.value ?? "";

  setBusy(true);
  try {
    await invoke("save_capture", {
      input: {
        owner: selectedRepo.owner,
        name: selectedRepo.name,
        title,
        body,
      },
    });
    clearStatus();
    await closeCapture();
  } catch (error) {
    showStatus(String(error));
  } finally {
    setBusy(false);
  }
}

async function closeCapture() {
  clearVoiceStatus();
  stopMicTracks();
  try {
    await getCurrentWindow().hide();
  } catch {
    // Ignore hide failures in non-Tauri preview.
  }
}

function syncRepoInput() {
  const input = document.querySelector<HTMLInputElement>("#capture-repo");
  if (!input || !selectedRepo) return;
  input.value = `${selectedRepo.owner}/${selectedRepo.name}`;
}

function parseRepo(value: string): RepoIdDto | null {
  const parts = value.split("/");
  if (parts.length !== 2) return null;
  const owner = parts[0]?.trim() ?? "";
  const name = parts[1]?.trim() ?? "";
  if (!owner || !name) return null;
  return { owner, name };
}

function repoKey(repo: RepoIdDto): string {
  return `${repo.owner}/${repo.name}`;
}

function setBusy(busy: boolean) {
  for (const id of ["capture-save", "capture-cancel"]) {
    const button = document.querySelector<HTMLButtonElement>(`#${id}`);
    if (button) button.disabled = busy;
  }
}

function setPttRecording(active: boolean) {
  const ptt = document.querySelector<HTMLButtonElement>("#capture-ptt");
  if (!ptt) return;
  ptt.classList.toggle("capture-ptt-active", active);
  ptt.textContent = active ? "Listening…" : "Hold to talk";
}

function showStatus(message: string) {
  const status = document.querySelector<HTMLElement>("#capture-status");
  if (!status) return;
  status.hidden = false;
  status.textContent = message;
}

function clearStatus() {
  const status = document.querySelector<HTMLElement>("#capture-status");
  if (!status) return;
  status.hidden = true;
  status.textContent = "";
}

function showVoiceKind(kind: VoiceKind) {
  const status = document.querySelector<HTMLElement>("#capture-voice-status");
  if (!status) return;
  status.hidden = false;
  status.dataset.kind = kind;
  status.textContent = VOICE_MESSAGES[kind];
  status.classList.toggle("voice-status-soft", kind === "empty_transcript");
}

function clearVoiceStatus() {
  const status = document.querySelector<HTMLElement>("#capture-voice-status");
  if (!status) return;
  status.hidden = true;
  status.textContent = "";
  status.removeAttribute("data-kind");
  status.classList.remove("voice-status-soft");
}
