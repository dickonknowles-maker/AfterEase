# AfterEase

An easing panel for Adobe After Effects 2024 to 2026, built as a CEP extension. The full plan is in [SPEC.md](SPEC.md).

**Current state: phase 2 (panel UI) built, waiting for Dickon to use it on a real shot.** The panel has a curve editor with value and speed views, presets, Read keys, and In / Both / Out scopes; see [PHASE2.md](PHASE2.md). The engine underneath is in [PHASE1.md](PHASE1.md), and the phase 0 spike results are in [SPIKES.md](SPIKES.md).

## Layout

| Folder | Contents |
| --- | --- |
| `CSXS/` | CEP manifest |
| `client/` | Panel UI (HTML, CSS, JS): `editor/` (curve editor, thumbnails), `state/` (presets and settings). `lib/cep.js` and `lib/host.js` are the only CEP-specific client code. `spikes.html` is the phase 0 diagnostics page |
| `core/` | Easing maths as pure functions with no host calls, tested in Node |
| `host/` | ExtendScript (ES3): JSON polyfill, the adapter, and the spike scripts |
| `launchers/` | Scripts for AE's Scripts folder, for hotkeys |
| `tests/unit/` | Node tests |
| `tests/ae/` | Tests in After Effects: the engine round trip (`roundtrip.mjs`, reports in `phase1/`) and the panel check (`panel.mjs`, report and screenshots in `phase2/`); phase 0 logs in `phase0/` |
| `tests/ui/` | A fake CEP and After Effects for working on the panel in a browser |
| `scripts/` | `install-dev.ps1` for Windows; `ae.mjs` drives AE and the panel for tests (Node 22 or later); `serve.mjs` serves the panel with the fake AE |

## Develop

```sh
npm install    # only acorn, for the ES3 check
npm test
```

Install into After Effects on Windows:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-dev.ps1        # copy
powershell -ExecutionPolicy Bypass -File scripts\install-dev.ps1 -Link  # junction to this repo
```

Then restart AE and open **Window > Extensions (Legacy) > AfterEase**. While the panel is open, its debugger is at http://localhost:8088.

To work on the panel without After Effects: `node scripts/serve.mjs`, then open http://localhost:8090/client/index.html. CEP 12 runs Chromium 99, so keep to what Chrome 99 supports.
