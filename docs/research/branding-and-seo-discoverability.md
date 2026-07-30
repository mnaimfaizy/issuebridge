# Research: Branding and SEO / discoverability

**Date:** 2026-07-30  
**Question:** What do primary sources say about GitHub repository discoverability, Tauri v2 Windows icon/installer branding, npm/Cargo description fields, and GitHub App / Marketplace listing surfaces — and where does Issuebridge already expose branding today?  
**Repo:** [mnaimfaizy/issuebridge](https://github.com/mnaimfaizy/issuebridge)

## Scope of this note

Primary sources only:

- GitHub Docs (README, topics, social preview, repository search, GitHub Apps, Marketplace listing requirements / listing copy & images)
- GitHub REST API (repository `description` / `homepage`, topics)
- Tauri v2 first-party docs (App Icons, Windows installer, config reference: `BundleConfig`, `NsisConfig`, `TrayIconConfig`)
- npm CLI `package.json` docs (`description`, `keywords`, `private`)
- Cargo Book (`description` field)

Secondary blogs are not used as evidence.

---

## 1. GitHub repository SEO / discoverability

### README

GitHub surfaces a README from `.github/`, repository root, or `docs/` (priority in that order). A README is often the first item visitors see and typically covers what the project does, why it is useful, how to get started, where to get help, and who maintains it. Content beyond **500 KiB** is truncated. Relative image paths in Markdown are rewritten for the current branch. ([About READMEs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes))

Default repository search (no `in:` qualifier) searches **name, description, and topics** — not full repository contents. README text is searchable only with `in:readme`. ([Searching for repositories](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories))

**Implication:** A strong About description + topics matter for default search; a keyword-rich README still helps via `in:readme` and human conversion once someone lands on the page.

### About description

The repository About “description” is a **short description of the repository** on create/update APIs. Docs call it short; they do **not** publish a hard character limit in the public REST parameter docs (contrast with repository **name**, which must not exceed 100 characters). ([Repositories REST](https://docs.github.com/en/rest/repos/repos?apiVersion=2022-11-28#update-a-repository); [Creating a new repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository))

`homepage` is an optional URL with more information about the repository. ([same REST update endpoint](https://docs.github.com/en/rest/repos/repos?apiVersion=2022-11-28#update-a-repository))

### Topics

Topics classify purpose / subject / language so people can discover related repos. Rules when creating a topic:

- lowercase letters, numbers, and hyphens
- ≤ **50** characters each
- ≤ **20** topics per repository

Topics appear on the repo main page; `topic:NAME` search finds repos with that topic. Topic names are always public. ([Classifying your repository with topics](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics); [Search by topic](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories#search-by-topic))

### Social preview (Open Graph-style)

Until a custom image is added, shared repo links expand with basic repo info and the owner’s avatar. Custom image rules:

- PNG, JPG, or GIF
- under **1 MB**
- recommended size at least **640×320** (best display **1280×640**)
- PNG transparency is supported; solid backgrounds are safer across platforms that ignore transparency

Uploaded under Settings → Social preview. ([Customizing your repository’s social media preview](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview))

---

## 2. Tauri v2 icon / branding (Windows-first)

### Where icons live and how they are generated

Tauri ships a default icon set; shipping that logo is explicitly **not** what you want for a real product. The CLI command `tauri icon` takes a **squared PNG or SVG with transparency** (default input `./app-icon.png`) and writes platform icons into `src-tauri/icons` by default. Those paths are referenced from `tauri.conf.json` → `bundle.icon`. ([App Icons](https://v2.tauri.app/develop/icons/))

Documented desktop outputs / manual requirements:

| Asset | Requirement (Tauri) |
|-------|---------------------|
| Source for `tauri icon` | Squared PNG **or SVG** with transparency |
| `png` desktop set | Square, RGBA, 32-bit; recommend matching CLI output: `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png` (commonly also 256 / 512) |
| `icon.ico` | Layers for **16, 24, 32, 48, 64, and 256** px; for optimal ICO display in development, the **32px layer should be first** |
| `icon.icns` | Required macOS layer sizes/names (less relevant for Windows-first) |

([App Icons — Creating icons manually](https://v2.tauri.app/develop/icons/))

Config array example (matches Issuebridge today):

```json
"icon": [
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.icns",
  "icons/icon.ico"
]
```

([App Icons](https://v2.tauri.app/develop/icons/); [BundleConfig.icon](https://v2.tauri.app/reference/config/#icon))

### Window / taskbar icon

Bundled icons feed the default window icon used by the OS chrome (title bar / taskbar). Issuebridge’s tray code clones `app.default_window_icon()` for the tray (see §4).

### Tray icon

Two mechanisms:

1. **Runtime API** (`TrayIconBuilder`) — Issuebridge uses this and passes the default window icon.
2. **Config** `app.trayIcon` (`TrayIconConfig`) — requires `iconPath`; docs warn the image is stored as **raw pixels in the final binary**, so keep width/height **small** or the executable bloats. Optional tooltip (Windows/macOS), menu click behavior, etc. ([TrayIconConfig](https://v2.tauri.app/reference/config/#trayiconconfig); config overview mentions tray icon in the root config object — [Config](https://v2.tauri.app/reference/config/))

### Bundle metadata that shows in installers / OS metadata

`BundleConfig` supports:

- `shortDescription`, `longDescription`
- `publisher` (defaults to the second element of `identifier`; maps to Windows Installer Manufacturer / deb Maintainer when Cargo `authors` is absent)
- `copyright`, `homepage`, `category`, `license` / `licenseFile`
- `icon` array

([BundleConfig](https://v2.tauri.app/reference/config/#bundleconfig))

`productName` is the human-facing application name at the root of the Tauri config. ([productName](https://v2.tauri.app/reference/config/#productname))

### NSIS installer branding (Windows)

Issuebridge targets NSIS (`bundle.targets: ["nsis"]`). Tauri brands the NSIS script from `tauri.conf.json`. Customization reference: [Windows Installer](https://v2.tauri.app/distribute/windows-installer/) → points at `NsisConfig`.

`NsisConfig` branding-related fields ([NsisConfig](https://v2.tauri.app/reference/config/#nsisconfig)):

| Field | Role | Recommended format / size |
|-------|------|---------------------------|
| `installerIcon` | Icon for the setup `.exe` | Icon file path (typically `.ico`) |
| `uninstallerIcon` | Uninstaller icon | Icon file path |
| `headerImage` | Bitmap on installer page headers | **BMP**, recommended **150×57** |
| `uninstallerHeaderImage` | Uninstaller header BMP; defaults to `headerImage` | **BMP**, **150×57** |
| `sidebarImage` | Welcome / Finish sidebar | **BMP**, recommended **164×314** |
| `startMenuFolder` | Groups Start Menu shortcuts | string |
| `installMode` | `currentUser` / `perMachine` / `both` | Issuebridge uses `currentUser` |

NSIS also supports custom hooks / full `.nsi` template replacement for deeper branding. ([Windows Installer — Customizing the NSIS Installer](https://v2.tauri.app/distribute/windows-installer/))

There is **no** first-party Tauri “splash screen” config called out in these pages; splash would be a custom window/UI concern.

---

## 3. npm `package.json` and Cargo.toml

### npm

- `description` — string listed in `npm search` discovery.
- `keywords` — string array; also aids `npm search`.
- `private: true` — npm **refuses to publish**; used to prevent accidental publication.

([package.json — description / keywords / private](https://docs.npmjs.com/cli/v10/configuring-npm/package-json))

For a **private, unpublished** Tauri frontend package (Issuebridge’s case), npm SEO is largely irrelevant: the package will not appear on the public registry. Still useful as internal documentation if someone opens `package.json`.

### Cargo

`description` is a short plain-text blurb; crates.io displays it and **requires** it for published crates. ([The description field](https://doc.rust-lang.org/cargo/reference/manifest.html#the-description-field))

If the Rust crate is not published to crates.io, the field still documents the crate and can feed tooling; Tauri’s `publisher` fallback interacts with Cargo `authors` as noted above.

---

## 4. GitHub App / Marketplace considerations

Issuebridge authenticates via a **GitHub App** (OAuth + PKCE; Install App on first-run — see root README / `CONTEXT.md`).

### App registration surfaces (always relevant)

When registering/editing a GitHub App:

- **GitHub App name** — clear, short; ≤ **34** characters; must be unique on GitHub.
- Optional **Description** — shown to users when they install the app.
- **Homepage URL** — full URL to the app’s website; if none, public repo URL (or owning account URL) is acceptable.

([Registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app))

Public apps can be shared via the app’s **public page** / installation URL (`https://github.com/apps/APP-NAME/installations/new`). Marketplace listing is optional. ([Sharing your GitHub App](https://docs.github.com/en/apps/sharing-github-apps/sharing-your-github-app))

### Marketplace listing (optional product channel)

Marketplace is a separate discovery surface from the GitHub **repository**. Anyone can list **free** apps if general requirements are met; paid plans need verified org publishers and additional thresholds. ([About GitHub Marketplace for apps](https://docs.github.com/en/apps/github-marketplace/github-marketplace-overview/about-github-marketplace-for-apps); [Requirements for listing an app](https://docs.github.com/en/apps/github-marketplace/creating-apps-for-github-marketplace/requirements-for-listing-an-app))

Listing brand / copy requirements include:

- Relevant description, privacy policy URL, support contact, pricing plan, Marketplace webhook handling for plan changes, etc.
- Logo, feature card, and screenshots per [Writing a listing description](https://docs.github.com/en/apps/github-marketplace/listing-an-app-on-github-marketplace/writing-a-listing-description-for-your-app)
- GitHub logo usage must follow [GitHub Logos and Usage](https://github.com/logos)

Marketplace image / copy guidelines (primary):

| Asset / field | Guidance |
|---------------|----------|
| Very short description | Prefer **40–80** characters; sentence case; no trailing punctuation; don’t repeat the app name; describe functionality (not a CTA) |
| Introductory description | Prefer **150–250** characters; begin with app name |
| Detailed description | Up to **1,000** characters; 3–5 value props |
| Logo | ≥ **200×200**; square; preferably transparent; avoid text in logo; badge background color chosen separately |
| Feature card background | **965×482** |
| Screenshots | Up to 5; ≥ **1200px** wide; same aspect ratio |

([Writing a listing description for your app](https://docs.github.com/en/apps/github-marketplace/listing-an-app-on-github-marketplace/writing-a-listing-description-for-your-app))

**Note:** A Windows desktop companion that installs a GitHub App for API access is **not** automatically a Marketplace listing. Marketplace listing is a deliberate publishing step with UX/privacy/support obligations. For v0.1, repository SEO + App install-page description/logo are the practical discoverability levers; Marketplace is later if desired.

---

## 5. Existing Issuebridge branding inventory (2026-07-30)

Observed via local tree + `gh` / REST against `mnaimfaizy/issuebridge`.

### GitHub remote About

| Field | Current value |
|-------|----------------|
| `description` | `"Issuebridge"` only |
| `homepage` | empty / null |
| `topics` | **none** (`[]`) |
| Visibility | public |
| Social preview | Not detectable via the topics/description API; no `.github` social asset in-repo. Treat as **unset** until Settings → Social preview is configured. |

### README.md

One-line product pitch (good seed for About):

> Windows-first Tauri app for capturing GitHub issues while testing (hotkey + voice), keeping local Drafts, then publishing them on GitHub.

No hero logo / screenshot banner at the top; content is developer-oriented (dev, voice, release, architecture). No Open Graph meta tags (expected for a GitHub-hosted README — social preview is the Settings image, not HTML meta in README).

### package.json

- `name`: `issuebridge`
- `private`: **true**
- `version`: `0.1.0-rc.1`
- **No** `description` or `keywords`

### Cargo.toml

- `description = "Issuebridge — capture-first GitHub issue inbox for Windows"` (aligned with domain language)

### tauri.conf.json

- `productName`: `Issuebridge`
- `identifier`: `com.issuebridge.app`
- Main window `title`: `Issuebridge`
- `bundle.targets`: `["nsis"]`
- `bundle.icon`: standard PNG/ICNS/ICO set under `icons/`
- NSIS: only `installMode: currentUser` and `compression: lzma` — **no** `headerImage`, `sidebarImage`, `installerIcon`, `shortDescription`, `longDescription`, `publisher`, `category`, or `copyright`

### Icons on disk (`src-tauri/icons/`)

Present (not gitignored): `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.png` (**512×512**), `icon.ico`, `icon.icns`, plus Windows Store-oriented `Square*Logo.png` / `StoreLogo.png`. Visual mark is a custom interlocking two-tone ring mark on black (product logo), not the stock Tauri logo.

### Frontend / other assets

- `src/assets/`: Vite/Tauri/TypeScript SVGs only (scaffold leftovers) — **not** used as product brand in shell UI.
- No `public/` favicon set for web SEO (desktop webviews load `index.html` / `capture.html`).
- `index.html` `<title>Issuebridge</title>`; `capture.html` `<title>Capture</title>` (matches window titles).

### In-app brand surfaces

| Surface | Current branding |
|---------|------------------|
| Main window title | `Issuebridge` (`tauri.conf.json`) |
| Capture window title | `Capture` (`capture_window.rs`) |
| System tray icon | `default_window_icon()` clone (`tray.rs`) |
| Tray tooltip | `"Issuebridge"` |
| Tray menu | Capture… / Show Issuebridge / Hide / Quit |
| Sidebar brand | Text **“IB”** mark + “Issuebridge” wordmark (`Sidebar.tsx`) — **not** the PNG/SVG logo |
| Help → About | Product name + `package.json` version + repo/feedback links — **no** logo image |
| Splash | **None** |
| First-run copy | Product name in Sign-in / Install App steps |
| Installer UI art | Default Tauri/NSIS chrome (no custom header/sidebar BMPs) |

---

## 6. Recommendations

### 6.1 Optimal logo formats by placement

| Placement | Preferred master | Deliverable format | Notes |
|-----------|------------------|--------------------|-------|
| Design master | SVG (or large square PNG) with transparency | SVG **and** ≥1024 PNG | Feed `npm run tauri icon` with squared PNG/SVG ([App Icons](https://v2.tauri.app/develop/icons/)) |
| App / window / taskbar | Generated set | `icon.ico` + PNGs in `bundle.icon` | ICO must include 16–256 layers; 32px first ([App Icons](https://v2.tauri.app/develop/icons/)) |
| System tray | Simplified mark at small size | Small PNG/ICO (or reuse window icon) | Prefer a **simplified** glyph at 16–32 px; if using config `trayIcon.iconPath`, keep dimensions small to avoid binary bloat ([TrayIconConfig](https://v2.tauri.app/reference/config/#trayiconconfig)) |
| README / docs | SVG or PNG | SVG preferred for crispness; PNG OK | Relative path in Markdown ([About READMEs](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes)) |
| GitHub social preview | Full-bleed brand card | PNG/JPG/GIF &lt;1 MB; **1280×640** ideal | Not the same as the app icon; include wordmark + short value prop ([Social media preview](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview)) |
| NSIS `installerIcon` / `uninstallerIcon` | Same family as app | `.ico` | [NsisConfig](https://v2.tauri.app/reference/config/#nsisconfig) |
| NSIS `headerImage` | Wide lockup | **BMP 150×57** | [NsisConfig](https://v2.tauri.app/reference/config/#nsisconfig) |
| NSIS `sidebarImage` | Tall brand panel | **BMP 164×314** | [NsisConfig](https://v2.tauri.app/reference/config/#nsisconfig) |
| In-app sidebar / About | Logo mark | SVG or PNG in `src/assets/` | Replace text “IB” chip with the real mark |
| GitHub App / Marketplace logo | Square mark | ≥**200×200** PNG, transparent preferred, no text | [Listing description images](https://docs.github.com/en/apps/github-marketplace/listing-an-app-on-github-marketplace/writing-a-listing-description-for-your-app) |

**Do not** rely on a single ICO everywhere: tray and NSIS BMPs have different constraints than social OG images.

### 6.2 Suggested GitHub About description and topics

**Suggested About description** (short, keyword-bearing, matches domain language):

> Windows app to Capture GitHub issues while testing—hotkey and voice, local Drafts, then Publish.

(~95 characters; includes Capture / Drafts / Publish / Windows / voice / hotkey.)

Alternate if preferring README parity:

> Windows-first Tauri app: Capture GitHub issues while testing (hotkey + voice), keep local Drafts, then Publish.

**Homepage:** set to the public repo URL (or a future product site) so About shows a clickable link ([REST `homepage`](https://docs.github.com/en/rest/repos/repos?apiVersion=2022-11-28#update-a-repository)).

**Suggested topics** (≤20; lowercase/hyphen; discoverability for this category):

```text
tauri
rust
windows
desktop-app
github
github-app
github-issues
productivity
typescript
react
whisper
voice-dictation
hotkeys
nsis
webview2
```

Rationale: stack terms (`tauri`, `rust`, `windows`) + problem terms (`github-issues`, `productivity`, `voice-dictation`, `hotkeys`) align with how topics and default search work ([topics](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics); [repo search](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories)).

**README tip:** Keep the opening paragraph user-facing (what / why), then Develop. Optionally add a logo + screenshot so humans convert after search; `in:readme` can match keywords in that intro ([search `in:readme`](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories)).

### 6.3 Where the logo should appear (exhaustive for this repo + Tauri defaults)

**Already present / wired (replace or keep consistent with master logo):**

1. `src-tauri/icons/*` — window, taskbar, and (today) tray via `default_window_icon()`
2. Bundled NSIS setup executable identity (via `icon.ico` / future `installerIcon`)
3. Installed app Start Menu / desktop shortcut icons (bundler defaults from app icons)

**Configured Tauri / Windows defaults available but unused or underused in this repo:**

4. `bundle.shortDescription` / `longDescription` / `publisher` / `copyright` / `category` / `homepage` in `tauri.conf.json`
5. NSIS `headerImage`, `sidebarImage`, `installerIcon`, `uninstallerIcon`, `uninstallerHeaderImage`, `startMenuFolder`
6. Optional `app.trayIcon` in config (dedicated small tray asset) instead of only the window icon
7. Capture window could use an explicit icon if ever diverging from default (currently inherits app default)

**In-repo UI / docs surfaces that should show the mark but currently do not (or use a placeholder):**

8. Sidebar brand mark (replace “IB” text chip)
9. Help → About section
10. README hero / badge
11. GitHub repository social preview image (Settings)
12. GitHub App registration logo + description + homepage (Developer settings — not in git)
13. Optional GitHub Marketplace listing logo / feature card / screenshots (if/when listing)
14. Release asset / download marketing (GitHub Releases page inherits repo social preview when links are shared)

**Not present today (no change required unless product adds them):**

15. Splash / boot screen
16. Website / landing page favicon and OG tags (no product site in-repo)
17. npm registry listing (blocked by `"private": true` — correct for this app)

### 6.4 npm / Cargo

- Keep `"private": true`. Optionally add `description` + `keywords` for local clarity; they will **not** drive public npm SEO while private ([package.json private](https://docs.npmjs.com/cli/v10/configuring-npm/package-json)).
- Keep/refine Cargo `description`; it is already stronger than the GitHub About string ([Cargo description](https://doc.rust-lang.org/cargo/reference/manifest.html#the-description-field)).

### 6.5 GitHub App listing priority

Near-term (high leverage, primary-doc backed):

1. Expand repository About description + topics + social preview.
2. Align GitHub App **Description** / **Homepage URL** / logo with the same copy and mark ([Registering a GitHub App](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app)).
3. Wire custom NSIS header/sidebar BMPs and installer ICO before marketing the `-setup.exe`.

Defer Marketplace until privacy policy URL, support URL, Marketplace webhooks, and listing assets exist ([Requirements for listing an app](https://docs.github.com/en/apps/github-marketplace/creating-apps-for-github-marketplace/requirements-for-listing-an-app)).

---

## 7. Source index

| Topic | Primary URL |
|-------|-------------|
| README behavior | https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-readmes |
| Topics | https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/classifying-your-repository-with-topics |
| Social preview | https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview |
| Repository search | https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories |
| Create repository (name length) | https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository |
| REST update repository | https://docs.github.com/en/rest/repos/repos?apiVersion=2022-11-28#update-a-repository |
| Tauri App Icons | https://v2.tauri.app/develop/icons/ |
| Tauri Windows installer | https://v2.tauri.app/distribute/windows-installer/ |
| Tauri config (Bundle / NSIS / Tray) | https://v2.tauri.app/reference/config/ |
| npm package.json | https://docs.npmjs.com/cli/v10/configuring-npm/package-json |
| Cargo description | https://doc.rust-lang.org/cargo/reference/manifest.html#the-description-field |
| Register GitHub App | https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/registering-a-github-app |
| Share GitHub App | https://docs.github.com/en/apps/sharing-github-apps/sharing-your-github-app |
| Marketplace overview | https://docs.github.com/en/apps/github-marketplace/github-marketplace-overview/about-github-marketplace-for-apps |
| Marketplace listing requirements | https://docs.github.com/en/apps/github-marketplace/creating-apps-for-github-marketplace/requirements-for-listing-an-app |
| Marketplace listing copy & images | https://docs.github.com/en/apps/github-marketplace/listing-an-app-on-github-marketplace/writing-a-listing-description-for-your-app |
| GitHub logos policy | https://github.com/logos |
