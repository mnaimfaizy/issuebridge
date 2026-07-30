# Reset first-run for local testing

Sign out **does not** rewind Install App, Testing set, or first-run-complete (locked product rule). After you finish first-run once, Sign out → Sign in only re-authenticates and lands in Inbox. To walk the progress strip again from scratch, reset local state.

## From-scratch checklist

1. **Quit fully** — tray → Quit (or end the process). Do not leave a hung `tauri dev` / Issuebridge instance.
2. **Clear first-run flags** (persisted under app data):

```powershell
Remove-Item "$env:LOCALAPPDATA\Issuebridge\settings.json" -ErrorAction SilentlyContinue
```

Path on this machine: `%LOCALAPPDATA%\Issuebridge\settings.json`.

3. **Optional — clear vaulted credentials** so the next launch opens on **Sign in** (not already signed in):
   - Windows Credential Manager → **Windows Credentials**
   - Remove entries for service / target `com.issuebridge.app`

4. **Restart with the GitHub App client secret** (required for OAuth):

```powershell
$env:ISSUEBRIDGE_GITHUB_CLIENT_SECRET = "<secret from issuebridge-dev App / 1Password>"
npm run tauri dev
```

5. Walk **Sign in → Install App → Testing set → Try capture** (or Skip). Confirm the horizontal progress strip, MessageBars for install hints / All-repositories warning, and that Skip or Save Draft completes into Inbox.

## Partial resets (resume mid-flow)

Edit `%LOCALAPPDATA%\Issuebridge\settings.json` instead of deleting it. Useful fields:

| Goal | Set |
|------|-----|
| Land on Install App (signed in) | Keep credentials; `install_completed: false`, `testing_set_completed: false`, `first_run_completed: false` |
| Land on Testing set | `install_completed: true`, `testing_set_completed: false`, `first_run_completed: false` |
| Land on Try capture | `install_completed: true`, `testing_set_completed: true`, `first_run_completed: false` |
| Confirm Sign out does not rewind | Finish first-run, Sign out, Sign in — wizard must **not** return |

There is no “Replay onboarding” UI in v0.1.

## Harmless quit noise (WebView2)

On Quit / stopping `tauri dev` you may see Chromium lines such as:

```text
[0730/….ERROR:ui\gfx\win\window_impl.cc:…] Failed to unregister class Chrome_WidgetWin_0. Error = 1412
```

**Ignore these** unless the app hangs or crashes on exit. Error `1412` means the window class was already gone during teardown — common WebView2 / Chromium race on Windows, not an Issuebridge first-run bug.
