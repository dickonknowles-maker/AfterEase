# AfterEase

An easing panel for Adobe After Effects 2024 to 2026, built as a CEP extension. The full plan is in [SPEC.md](SPEC.md).

**Current state: phase 1 (core engine) built, waiting for sign-off.** The easing engine reads selected keys, applies a curve in one undo step and checks what AE stored; its results are in [PHASE1.md](PHASE1.md). The panel is still the phase 0 diagnostics page, whose results are in [SPIKES.md](SPIKES.md); the real UI comes in phase 2.

## Layout

| Folder | Contents |
| --- | --- |
| `CSXS/` | CEP manifest |
| `client/` | Panel UI (HTML, CSS, JS). `lib/cep.js` and `lib/host.js` are the only CEP-specific client code |
| `core/` | Easing maths as pure functions with no host calls, tested in Node |
| `host/` | ExtendScript (ES3): JSON polyfill, the adapter, and the spike scripts |
| `launchers/` | Scripts for AE's Scripts folder, for hotkeys |
| `tests/unit/` | Node tests |
| `tests/ae/` | Phase 1 fixture and round-trip runner for AE (`roundtrip.mjs`), with reports in `phase1/`; phase 0 logs in `phase0/` |
| `scripts/` | `install-dev.ps1` for Windows; `ae.mjs` drives AE and the panel for tests (Node 22 or later) |

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
