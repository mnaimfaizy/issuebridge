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
  sidecar_failed:
    "Voice could not run (Whisper sidecar). Check the terminal for [issuebridge] whisper logs, or type instead.",
  empty_transcript: "Didn’t catch that. Hold a bit longer, speak clearly, then release — or type.",
};

const MAX_PTT_MS = 60_000;
const MIN_PTT_MS = 350;
const WAV_RATE = 16_000;

type PttField = "title" | "body";

let testingSet: RepoIdDto[] = [];
let visibleRepos: RepoIdDto[] = [];
let selectedRepo: RepoIdDto | null = null;

/** Last focused text field — PTT button steals focus, so we snapshot this on press. */
let lastTextField: PttField = "body";
let pttTarget: PttField = "body";

let mediaStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let scriptProcessor: ScriptProcessorNode | null = null;
let pcmChunks: Float32Array[] = [];
let recording = false;
let pttBusy = false;
let recordStartedAt = 0;
let timerInterval: number | null = null;
let maxHoldTimeout: number | null = null;
let activePointerId: number | null = null;

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

  document
    .querySelector("#capture-title")
    ?.addEventListener("focus", () => {
      lastTextField = "title";
    });
  document
    .querySelector("#capture-body")
    ?.addEventListener("focus", () => {
      lastTextField = "body";
    });

  const ptt = document.querySelector<HTMLButtonElement>("#capture-ptt");
  ptt?.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    activePointerId = event.pointerId;
    ptt.setPointerCapture(event.pointerId);
    void startPtt();
  });
  ptt?.addEventListener("pointerup", (event) => {
    if (activePointerId !== null && event.pointerId !== activePointerId) return;
    activePointerId = null;
    void stopPtt();
  });
  ptt?.addEventListener("pointercancel", (event) => {
    if (activePointerId !== null && event.pointerId !== activePointerId) return;
    activePointerId = null;
    void stopPtt();
  });
  // Do not stop on pointerleave — setPointerCapture keeps the hold until release.

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
    if (hint) {
      hint.textContent = `Hotkey: hold ${hotkey}, release to stop`;
    }

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
  pttTarget = lastTextField;

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
  } catch (error) {
    console.error("[issuebridge] mic error", error);
    showVoiceKind(mapMicError(error));
    return;
  }

  try {
    audioContext = new AudioContext();
    await audioContext.resume();
    const source = audioContext.createMediaStreamSource(mediaStream);
    // ScriptProcessor is deprecated but reliable in WebView2; avoids WebM decode failures.
    scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
    pcmChunks = [];
    scriptProcessor.onaudioprocess = (event) => {
      if (!recording) return;
      const input = event.inputBuffer.getChannelData(0);
      pcmChunks.push(new Float32Array(input));
    };
    const mute = audioContext.createGain();
    mute.gain.value = 0;
    source.connect(scriptProcessor);
    scriptProcessor.connect(mute);
    mute.connect(audioContext.destination);
  } catch (error) {
    console.error("[issuebridge] audio graph error", error);
    await teardownAudio();
    showVoiceKind("sidecar_failed");
    return;
  }

  recording = true;
  recordStartedAt = Date.now();
  setPttRecording(true);
  startTimerUi();
  maxHoldTimeout = window.setTimeout(() => {
    void stopPtt();
  }, MAX_PTT_MS);
}

async function stopPtt() {
  if (!recording) return;
  recording = false;
  clearMaxHold();
  stopTimerUi();
  setPttRecording(false);

  const elapsed = Date.now() - recordStartedAt;
  const sampleRate = audioContext?.sampleRate ?? 48000;
  const chunks = pcmChunks;
  pcmChunks = [];
  await teardownAudio();

  if (elapsed < MIN_PTT_MS || chunks.length === 0) {
    showVoiceKind("empty_transcript");
    return;
  }

  pttBusy = true;
  setPttBusy(true);
  try {
    const merged = mergeFloat32(chunks);
    const pcm16k = downsample(merged, sampleRate, WAV_RATE);
    const wavBase64 = bytesToBase64(encodeWav(pcm16k, WAV_RATE));
    console.info("[issuebridge] PTT transcribing…", {
      elapsedMs: elapsed,
      samples: pcm16k.length,
      target: pttTarget,
    });

    const field = fieldElement(pttTarget);
    const currentText = field?.value ?? "";
    const result = await invoke<{ text: string }>("apply_ptt", {
      input: {
        text: currentText,
        wavBase64,
      },
    });
    if (field) {
      field.value = result.text;
      field.focus();
      const len = field.value.length;
      field.setSelectionRange(len, len);
    }
    clearVoiceStatus();
    const where = pttTarget === "title" ? "title" : "body";
    showVoiceSoft(`Added to the ${where}. Edit freely, then Save Draft.`);
  } catch (error) {
    console.error("[issuebridge] apply_ptt failed", error);
    showVoiceKind(parseVoiceKind(error));
  } finally {
    pttBusy = false;
    setPttBusy(false);
  }
}

function fieldElement(
  field: PttField,
): HTMLInputElement | HTMLTextAreaElement | null {
  if (field === "title") {
    return document.querySelector<HTMLInputElement>("#capture-title");
  }
  return document.querySelector<HTMLTextAreaElement>("#capture-body");
}

async function teardownAudio() {
  try {
    scriptProcessor?.disconnect();
  } catch {
    // Ignore.
  }
  scriptProcessor = null;
  if (audioContext) {
    try {
      await audioContext.close();
    } catch {
      // Ignore.
    }
  }
  audioContext = null;
  stopMicTracks();
}

function mergeFloat32(chunks: Float32Array[]): Float32Array {
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const out = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function downsample(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const outLength = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const idx = Math.min(input.length - 1, Math.floor(i * ratio));
    out[i] = input[idx] ?? 0;
  }
  return out;
}

function startTimerUi() {
  stopTimerUi();
  const timer = document.querySelector<HTMLElement>("#capture-ptt-timer");
  if (timer) {
    timer.hidden = false;
    timer.textContent = "0:00 / 1:00";
  }
  timerInterval = window.setInterval(() => {
    const elapsed = Math.min(MAX_PTT_MS, Date.now() - recordStartedAt);
    if (timer) timer.textContent = `${formatMs(elapsed)} / 1:00`;
  }, 200);
}

function stopTimerUi() {
  if (timerInterval !== null) {
    window.clearInterval(timerInterval);
    timerInterval = null;
  }
  const timer = document.querySelector<HTMLElement>("#capture-ptt-timer");
  if (timer) {
    timer.hidden = true;
    timer.textContent = "";
  }
}

function clearMaxHold() {
  if (maxHoldTimeout !== null) {
    window.clearTimeout(maxHoldTimeout);
    maxHoldTimeout = null;
  }
}

function formatMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
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
  if (text.includes("EncodingError") || text.includes("decode")) {
    return "empty_transcript";
  }
  if (text.includes("sidecar_failed")) return "sidecar_failed";
  return "sidecar_failed";
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
  clearMaxHold();
  stopTimerUi();
  recording = false;
  pcmChunks = [];
  await teardownAudio();
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
  ptt.setAttribute("aria-pressed", active ? "true" : "false");
  if (!pttBusy) {
    ptt.textContent = active ? "Release to stop" : "Hold to talk";
  }
}

function setPttBusy(busy: boolean) {
  const ptt = document.querySelector<HTMLButtonElement>("#capture-ptt");
  if (!ptt) return;
  ptt.classList.toggle("capture-ptt-busy", busy);
  if (busy) {
    ptt.textContent = "Transcribing…";
  } else if (!recording) {
    ptt.textContent = "Hold to talk";
  }
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

function showVoiceSoft(message: string) {
  const status = document.querySelector<HTMLElement>("#capture-voice-status");
  if (!status) return;
  status.hidden = false;
  status.textContent = message;
  status.classList.add("voice-status-soft");
  status.removeAttribute("data-kind");
}

function clearVoiceStatus() {
  const status = document.querySelector<HTMLElement>("#capture-voice-status");
  if (!status) return;
  status.hidden = true;
  status.textContent = "";
  status.removeAttribute("data-kind");
  status.classList.remove("voice-status-soft");
}
