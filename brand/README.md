# Issuebridge brand assets

| Path | Role |
|------|------|
| `source/issuebridge-logo-ai.png` | Original checkerboard AI export (provenance; not shipped) |
| `source/issuebridge-logo-ai-v2.png` | Replacement black-background AI export used for the exact mark |
| `mark.png` | Transparent square **mark** (no wordmark) — feed this to `tauri icon` |
| `lockup-dark.*` | Mark + **Issuebridge** (dark wordmark for light backgrounds) |
| `lockup-light.*` | Mark + **Issuebridge** (light wordmark for dark backgrounds) |

Runtime copies used by the UI live under `src/assets/brand/`.

The supplied v2 PNG is RGB (it has no alpha channel), despite visually
appearing background-free. `extract-mark.py` crops the exact mark, excludes
the original wordmark and AI badge, and converts the black background to
transparency. No approximate vector mark is shipped.

Regenerate:

```powershell
python brand/scripts/extract-mark.py
python brand/scripts/build-lockups.py
npm run tauri icon brand/mark.png
```
