# Linux as a second Platform (Windows stays the reference)

Issuebridge adds Linux (x86_64, Ubuntu 22.04 / Debian 12 / Fedora 36 or newer, built on `ubuntu-22.04`) as a second **Platform**, starting at Alpha maturity in the same tagged Release as Windows. Windows remains the reference Platform. Linux ships as AppImage, `.deb`, and `.rpm` with a `SHA256SUMS` file, unsigned for the Alpha. Global shortcuts use X11 grabs on X11 and the `xdg-desktop-portal` GlobalShortcuts portal on Wayland, requested during first-run setup. Where neither is available, the user binds `issuebridge --capture` / `--ptt-toggle` in their desktop settings, routed to the running app via single-instance; because desktop shortcuts cannot report release, push-to-talk there degrades to visible **Toggle-to-talk** rather than **Hold-to-talk**. Tokens live in the Secret Service (GNOME Keyring / KWallet); when none is running, the app says sign-in won't persist and never falls back to a plaintext file. `whisper-cli` and `llama-cli` are built in CI from pinned upstream tags (CPU for Whisper; Vulkan with CPU fallback for llama), statically linked where possible, with recorded SHA-256s. Data lives under the XDG data dir; Windows paths are unchanged. Linux-specific bundle settings live in a `tauri.linux.conf.json` overlay so the Windows config and its packaging contract stay as they are. The updater is out of scope for both Platforms and is tracked separately.

## Considered Options

- **X11 only** — rejected; Wayland is the default session on the target distros, and hotkeys silently fail under XWayland while a native Wayland window has focus.
- **Wayland portal only** — rejected; leaves X11 sessions and portal-less desktops (older GNOME, XFCE, Sway) with no hotkey at all.
- **Flatpak / Snap** — deferred; sandboxing complicates the mic, global shortcuts, and Secret Service access before the basics are proven.
- **`keyring` `linux-native` (kernel keyutils)** — rejected; tokens vanish on reboot or logout.
- **Plaintext token file as fallback** — rejected; a silent downgrade of secret storage.
- **User-installed `whisper.cpp`** — rejected; breaks the pinned, checksum-verified sidecar model the Windows build already uses.
- **Upstream Linux zips where available** — rejected; upstream Linux builds are patchy, and two sourcing paths are harder to audit than one.
- **Adding the updater with the port** — rejected; it pulls signing keys and update manifests into the port. Better done once, for both Platforms.
