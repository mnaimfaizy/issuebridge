import { Button, Input, Textarea } from "@fluentui/react-components";
import { DismissRegular, MicRegular, SaveRegular } from "@fluentui/react-icons";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  bytesToBase64,
  downsample,
  encodeWav,
  formatMs,
  MAX_PTT_MS,
  MIN_PTT_MS,
  mergeFloat32,
  WAV_RATE,
} from "./pttAudio";
import {
  defaultRepo,
  parseRepo,
  type RepoIdDto,
  repoKey,
} from "./repoSelection";
import {
  mapMicError,
  parseVoiceKind,
  VOICE_MESSAGES,
  type VoiceKind,
} from "./voiceMessages";
import "./capture.css";

type PttField = "title" | "body";
type VoiceUi = "idle" | "recording" | "transcribing";

type VoiceStatus =
  | { kind: "none" }
  | { kind: "soft"; message: string }
  | { kind: "error"; voiceKind: VoiceKind; message: string };

type LoadedRepos = {
  testingSet: RepoIdDto[];
  lastUsed: RepoIdDto | null;
};

export function CapturePopup() {
  const [testingSet, setTestingSet] = useState<RepoIdDto[]>([]);
  const [visibleRepos, setVisibleRepos] = useState<RepoIdDto[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<RepoIdDto | null>(null);
  const [repoFilter, setRepoFilter] = useState("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [pttHotkey, setPttHotkey] = useState("Ctrl+Alt+Shift+V");
  const [voiceUi, setVoiceUi] = useState<VoiceUi>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>({ kind: "none" });
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);

  const titleRef = useRef<HTMLInputElement | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const lastTextFieldRef = useRef<PttField>("body");
  const pttTargetRef = useRef<PttField>("body");
  const [voiceTarget, setVoiceTarget] = useState<PttField>("body");
  const resetFieldsOnShowRef = useRef(true);
  // Advanced whenever a Capture ends, so a transcript that lands after Esc or
  // Save is recognised as belonging to the earlier Capture and dropped.
  const captureIdRef = useRef(0);
  // Raised by the two user repo handlers, cleared when a Capture begins: a
  // pick made while the opening reload is in flight is this Capture's own
  // choice and outranks the default applied after that reload.
  const repoPickedRef = useRef(false);

  const recordingRef = useRef(false);
  const pttBusyRef = useRef(false);
  const recordStartedAtRef = useRef(0);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const maxHoldTimeoutRef = useRef<number | null>(null);
  const timerIntervalRef = useRef<number | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const titleStateRef = useRef(title);
  const bodyStateRef = useRef(body);
  const selectedRepoRef = useRef(selectedRepo);

  titleStateRef.current = title;
  bodyStateRef.current = body;
  selectedRepoRef.current = selectedRepo;

  const clearVoiceStatus = useCallback(() => {
    setVoiceStatus({ kind: "none" });
  }, []);

  const showVoiceKind = useCallback((kind: VoiceKind) => {
    setVoiceStatus({
      kind: "error",
      voiceKind: kind,
      message: VOICE_MESSAGES[kind],
    });
  }, []);

  const showVoiceSoft = useCallback((message: string) => {
    setVoiceStatus({ kind: "soft", message });
  }, []);

  const stopTimerUi = useCallback(() => {
    if (timerIntervalRef.current !== null) {
      window.clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    setElapsedMs(0);
  }, []);

  const clearMaxHold = useCallback(() => {
    if (maxHoldTimeoutRef.current !== null) {
      window.clearTimeout(maxHoldTimeoutRef.current);
      maxHoldTimeoutRef.current = null;
    }
  }, []);

  const stopMicTracks = useCallback(() => {
    mediaStreamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });
    mediaStreamRef.current = null;
  }, []);

  const teardownAudio = useCallback(async () => {
    try {
      scriptProcessorRef.current?.disconnect();
    } catch {
      // Ignore.
    }
    scriptProcessorRef.current = null;
    if (audioContextRef.current) {
      try {
        await audioContextRef.current.close();
      } catch {
        // Ignore.
      }
    }
    audioContextRef.current = null;
    stopMicTracks();
  }, [stopMicTracks]);

  const hideCapture = useCallback(async () => {
    clearVoiceStatus();
    clearMaxHold();
    stopTimerUi();
    recordingRef.current = false;
    pcmChunksRef.current = [];
    setVoiceUi("idle");
    await teardownAudio();
    // Next show should open a clean Capture form.
    captureIdRef.current += 1;
    // The in-flight transcript now belongs to an ended Capture, so stopPtt()
    // drops it. Release the busy flag with it, or the next Capture's PTT
    // silently no-ops until the orphaned apply_ptt settles.
    pttBusyRef.current = false;
    resetFieldsOnShowRef.current = true;
    try {
      // Hide only — do not focus the main window.
      await getCurrentWindow().hide();
    } catch {
      // Ignore hide failures in non-Tauri preview.
    }
  }, [clearMaxHold, clearVoiceStatus, stopTimerUi, teardownAudio]);

  const focusField = useCallback((target: PttField) => {
    window.requestAnimationFrame(() => {
      const field = target === "title" ? titleRef.current : bodyRef.current;
      if (!field) return;
      field.focus();
      const len = field.value.length;
      field.setSelectionRange(len, len);
    });
  }, []);

  // Reload the Testing set, visible repos and hotkey. Safe to repeat at any
  // time: it never changes the target repo or anything being composed (#197).
  const refresh = useCallback(async (): Promise<LoadedRepos | null> => {
    try {
      const [loadedTestingSet, visible, lastUsed, hotkey] = await Promise.all([
        invoke<RepoIdDto[]>("testing_set"),
        invoke<RepoIdDto[]>("app_visible_repos"),
        invoke<RepoIdDto | null>("last_used_repo"),
        invoke<string>("ptt_hotkey").catch(() => "Ctrl+Alt+Shift+V"),
      ]);
      setTestingSet(loadedTestingSet);
      setVisibleRepos(visible);
      setPttHotkey(hotkey);
      return { testingSet: loadedTestingSet, lastUsed };
    } catch (error) {
      setSaveStatus(String(error));
      return null;
    }
  }, []);

  // Adopt the default repo when this Capture has none. A refresh never
  // *changes* the target repo (#197), but having none is a dead end: Save
  // Draft refuses until something picks one, and only a new Capture applies
  // the default — so a failed opening reload, or an empty Testing set that
  // Settings has since filled, would never recover. Filling a null selection
  // cannot overrule a pick, and a part-typed filter is left alone.
  const adoptDefaultRepo = useCallback((repos: LoadedRepos) => {
    if (selectedRepoRef.current) return;
    const next = defaultRepo(repos.lastUsed, repos.testingSet);
    if (!next) return;
    setSelectedRepo(next);
    setRepoFilter((current) => (current.trim() ? current : repoKey(next)));
  }, []);

  // Begin a new Capture: default repo, empty fields, caret in Title.
  const startCapture = useCallback(async () => {
    // Lowered before the reload, so a focus event arriving while it is in
    // flight refreshes instead of starting a second Capture over typed text.
    resetFieldsOnShowRef.current = false;
    repoPickedRef.current = false;
    setTitle("");
    setBody("");
    setSaveStatus(null);
    clearVoiceStatus();
    setVoiceUi("idle");
    window.requestAnimationFrame(() => {
      titleRef.current?.focus();
    });
    const repos = await refresh();
    // The chips stay clickable while the reload is in flight; a pick made
    // there is deliberate and must not be overwritten by the default.
    if (repoPickedRef.current) return;
    // A failed reload has no default to offer; never carry the previous
    // Capture's pick into this one. The next refresh adopts one (#197).
    const next = repos ? defaultRepo(repos.lastUsed, repos.testingSet) : null;
    setSelectedRepo(next);
    setRepoFilter(next ? repoKey(next) : "");
  }, [clearVoiceStatus, refresh]);

  useEffect(() => {
    const onFocus = () => {
      // Checked first: a transcript still in flight belongs to the Capture
      // that hideCapture() ended, and stopPtt() drops it.
      if (resetFieldsOnShowRef.current) {
        void startCapture();
        return;
      }
      // A refocus mid-hold must not perturb recorder-backed state.
      if (recordingRef.current || pttBusyRef.current) return;
      void refresh().then((repos) => {
        if (repos) adoptDefaultRepo(repos);
      });
    };
    onFocus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [adoptDefaultRepo, refresh, startCapture]);

  // The window-X path is hidden by Rust, which the webview cannot observe;
  // the event lets it end the Capture like Esc does, so the next show opens
  // clean instead of keeping this one's status line and caret (#197).
  useEffect(() => {
    let unlistenHidden: (() => void) | undefined;
    void listen("capture-hidden", () => {
      void hideCapture();
    }).then((fn) => {
      unlistenHidden = fn;
    });
    return () => {
      unlistenHidden?.();
    };
  }, [hideCapture]);

  const stopPtt = useCallback(async () => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    // Busy from release until the transcript lands, so a refocus cannot slip
    // in between the end of recording and the start of transcription.
    pttBusyRef.current = true;
    const captureId = captureIdRef.current;
    const isCurrentCapture = () => captureIdRef.current === captureId;
    clearMaxHold();
    stopTimerUi();
    setVoiceUi("idle");

    const elapsed = Date.now() - recordStartedAtRef.current;
    const sampleRate = audioContextRef.current?.sampleRate ?? 48000;
    const chunks = pcmChunksRef.current;
    pcmChunksRef.current = [];
    const target = pttTargetRef.current;
    try {
      await teardownAudio();
      if (!isCurrentCapture()) return;
      // Restore the snapshotted field as soon as hold ends (before transcription).
      focusField(target);

      if (elapsed < MIN_PTT_MS || chunks.length === 0) {
        showVoiceKind("empty_transcript");
        return;
      }

      setVoiceUi("transcribing");
      try {
        const merged = mergeFloat32(chunks);
        const pcm16k = downsample(merged, sampleRate, WAV_RATE);
        const wavBase64 = bytesToBase64(encodeWav(pcm16k, WAV_RATE));
        const currentText =
          target === "title" ? titleStateRef.current : bodyStateRef.current;

        console.info("[issuebridge] PTT transcribing…", {
          elapsedMs: elapsed,
          samples: pcm16k.length,
          target,
        });

        const result = await invoke<{ text: string }>("apply_ptt", {
          input: {
            text: currentText,
            wavBase64,
          },
        });

        // Esc or Save ended that Capture while Whisper ran; its transcript
        // must not land in the new one.
        if (!isCurrentCapture()) return;
        if (target === "title") {
          setTitle(result.text);
        } else {
          setBody(result.text);
        }
        focusField(target);
        clearVoiceStatus();
        showVoiceSoft(
          `Added to the ${target === "title" ? "title" : "body"}. Edit freely, then Save Draft.`,
        );
      } catch (error) {
        console.error("[issuebridge] apply_ptt failed", error);
        if (!isCurrentCapture()) return;
        showVoiceKind(parseVoiceKind(error));
        focusField(target);
      }
    } finally {
      pttBusyRef.current = false;
      setVoiceUi("idle");
    }
  }, [
    clearMaxHold,
    clearVoiceStatus,
    focusField,
    showVoiceKind,
    showVoiceSoft,
    stopTimerUi,
    teardownAudio,
  ]);

  const startPtt = useCallback(async () => {
    if (recordingRef.current || pttBusyRef.current) return;
    clearVoiceStatus();
    pttTargetRef.current = lastTextFieldRef.current;
    setVoiceTarget(lastTextFieldRef.current);

    try {
      mediaStreamRef.current = await navigator.mediaDevices.getUserMedia({
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
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      await audioContext.resume();
      const source = audioContext.createMediaStreamSource(
        mediaStreamRef.current,
      );
      // ScriptProcessor is deprecated but reliable in WebView2; avoids WebM decode failures.
      const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
      scriptProcessorRef.current = scriptProcessor;
      pcmChunksRef.current = [];
      scriptProcessor.onaudioprocess = (event) => {
        if (!recordingRef.current) return;
        const input = event.inputBuffer.getChannelData(0);
        pcmChunksRef.current.push(new Float32Array(input));
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

    recordingRef.current = true;
    recordStartedAtRef.current = Date.now();
    setVoiceUi("recording");
    setElapsedMs(0);
    timerIntervalRef.current = window.setInterval(() => {
      const elapsed = Math.min(
        MAX_PTT_MS,
        Date.now() - recordStartedAtRef.current,
      );
      setElapsedMs(elapsed);
    }, 200);
    maxHoldTimeoutRef.current = window.setTimeout(() => {
      void stopPtt();
    }, MAX_PTT_MS);
  }, [clearVoiceStatus, showVoiceKind, stopPtt, teardownAudio]);

  useEffect(() => {
    let unlistenPressed: (() => void) | undefined;
    let unlistenReleased: (() => void) | undefined;
    void listen("ptt-pressed", () => {
      void startPtt();
    }).then((fn) => {
      unlistenPressed = fn;
    });
    void listen("ptt-released", () => {
      void stopPtt();
    }).then((fn) => {
      unlistenReleased = fn;
    });
    return () => {
      unlistenPressed?.();
      unlistenReleased?.();
    };
  }, [startPtt, stopPtt]);

  const saveDraft = useCallback(async () => {
    if (!selectedRepo) {
      setSaveStatus("Pick a repository.");
      return;
    }
    setSaveBusy(true);
    try {
      await invoke("save_capture", {
        input: {
          owner: selectedRepo.owner,
          name: selectedRepo.name,
          title,
          body,
        },
      });
      setSaveStatus(null);
      setTitle("");
      setBody("");
      await hideCapture();
    } catch (error) {
      setSaveStatus(String(error));
    } finally {
      setSaveBusy(false);
    }
  }, [body, hideCapture, selectedRepo, title]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void hideCapture();
        return;
      }
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveDraft();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [hideCapture, saveDraft]);

  function selectRepo(repo: RepoIdDto) {
    repoPickedRef.current = true;
    setSelectedRepo(repo);
    setRepoFilter(repoKey(repo));
  }

  function onRepoFilterChange(value: string) {
    setRepoFilter(value);
    const parsed = parseRepo(value);
    if (parsed) {
      repoPickedRef.current = true;
      setSelectedRepo(parsed);
    }
  }

  const beyondSet = visibleRepos.filter(
    (repo) => !testingSet.some((item) => repoKey(item) === repoKey(repo)),
  );
  const filter = repoFilter.trim().toLowerCase();
  const matches = beyondSet.filter((repo) => {
    const label = `${repo.owner}/${repo.name}`.toLowerCase();
    return filter && label.includes(filter);
  });
  const showTypeahead =
    Boolean(filter) &&
    matches.length > 0 &&
    !(
      selectedRepo &&
      filter === `${selectedRepo.owner}/${selectedRepo.name}`.toLowerCase()
    );

  const recording = voiceUi === "recording";
  const transcribing = voiceUi === "transcribing";
  const pttLabel = recording
    ? "Release to stop"
    : transcribing
      ? "Transcribing…"
      : "Hold to talk";

  function onPttPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    activePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    void startPtt();
  }

  function onPttPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    if (
      activePointerIdRef.current !== null &&
      event.pointerId !== activePointerIdRef.current
    ) {
      return;
    }
    activePointerIdRef.current = null;
    void stopPtt();
  }

  return (
    <main className="ib-capture">
      <header className="ib-capture-hero">
        <div>
          <span className="ib-capture-eyebrow">Capture</span>
          <h1>Hold to talk</h1>
          <p>Voice fills the focused field. Edit before you save.</p>
        </div>
        <section className="ib-capture-voice" aria-label="Voice capture">
          <Button
            appearance="primary"
            size="large"
            icon={<MicRegular />}
            className={[
              "ib-capture-ptt",
              recording ? "ib-capture-ptt-recording" : "",
              transcribing ? "ib-capture-ptt-busy" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-pressed={recording}
            disabled={transcribing || saveBusy}
            onPointerDown={onPttPointerDown}
            onPointerUp={onPttPointerUp}
            onPointerCancel={onPttPointerUp}
          >
            {pttLabel}
          </Button>
          <div className="ib-capture-voice-meta">
            <span>Hotkey: hold {pttHotkey}, release to stop</span>
            {recording ? (
              <span className="ib-capture-timer" aria-live="polite">
                {formatMs(elapsedMs)} / 1:00 → {voiceTarget}
              </span>
            ) : (
              <span>
                {transcribing ? "Transcribing…" : `Ready for ${voiceTarget}`}
              </span>
            )}
          </div>
          {voiceStatus.kind !== "none" ? (
            <p
              className={
                voiceStatus.kind === "soft"
                  ? "ib-capture-voice-status soft"
                  : "ib-capture-voice-status"
              }
              data-kind={
                voiceStatus.kind === "error" ? voiceStatus.voiceKind : undefined
              }
              role="status"
              aria-live="polite"
            >
              {voiceStatus.message}
            </p>
          ) : null}
        </section>
      </header>

      <div className="ib-capture-compose">
        <div
          className="ib-capture-chips"
          role="listbox"
          aria-label="Testing set"
        >
          {testingSet.map((repo) => {
            const selected =
              selectedRepo !== null && repoKey(repo) === repoKey(selectedRepo);
            return (
              <button
                key={repoKey(repo)}
                type="button"
                role="option"
                aria-selected={selected}
                className={`ib-capture-chip${selected ? " selected" : ""}`}
                onClick={() => selectRepo(repo)}
              >
                <span className="ib-capture-chip-name">{repo.name}</span>
                <span className="ib-capture-chip-owner">{repo.owner}</span>
              </button>
            );
          })}
        </div>

        <Input
          value={repoFilter}
          placeholder="owner/name"
          aria-label="Repository"
          onChange={(_, data) => onRepoFilterChange(data.value)}
        />
        {showTypeahead ? (
          <ul className="ib-capture-repo-list" aria-label="Repository matches">
            {matches.slice(0, 8).map((repo) => (
              <li key={repoKey(repo)}>
                <button
                  type="button"
                  className="ib-capture-repo-pick"
                  onClick={() => selectRepo(repo)}
                >
                  {repo.owner}/{repo.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <Input
          value={title}
          placeholder="Untitled"
          aria-label="Title"
          input={{
            ref: titleRef,
            onFocus: () => {
              lastTextFieldRef.current = "title";
              setVoiceTarget("title");
            },
          }}
          onChange={(_, data) => setTitle(data.value)}
        />
        <Textarea
          value={body}
          placeholder="What happened?"
          resize="vertical"
          aria-label="Body"
          textarea={{
            ref: bodyRef,
            onFocus: () => {
              lastTextFieldRef.current = "body";
              setVoiceTarget("body");
            },
          }}
          onChange={(_, data) => setBody(data.value)}
        />
      </div>

      <footer className="ib-capture-actions sticky">
        <span className="ib-capture-target-cue">
          Voice target: <strong>{voiceTarget}</strong>
        </span>
        <div className="ib-capture-action-buttons">
          <Button
            appearance="primary"
            icon={<SaveRegular />}
            disabled={saveBusy}
            onClick={() => void saveDraft()}
          >
            Save Draft
          </Button>
          <Button
            appearance="subtle"
            icon={<DismissRegular />}
            disabled={saveBusy}
            onClick={() => void hideCapture()}
          >
            Cancel
          </Button>
        </div>
      </footer>

      {saveStatus ? (
        <p className="ib-capture-save-status" role="status" aria-live="polite">
          {saveStatus}
        </p>
      ) : null}
    </main>
  );
}
