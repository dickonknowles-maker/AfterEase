# AfterEase

An easing panel for Adobe After Effects 2024 to 2026, built as a CEP extension. The full plan is in [SPEC.md](SPEC.md).

**Current state: phase 0 (scaffold and spikes).** The panel is a diagnostics page for the three phase 0 spikes. How to run them, and space for the results, is in [SPIKES.md](SPIKES.md).

## Layout

| Folder | Contents |
| --- | --- |
| `CSXS/` | CEP manifest |
| `client/` | Panel UI (HTML, CSS, JS). `lib/cep.js` and `lib/host.js` are the only CEP-specific client code |
| `core/` | Easing maths as pure functions with no host calls, tested in Node |
| `host/` | ExtendScript (ES3): JSON polyfill, the adapter, and the spike scripts |
| `launchers/` | Scripts for AE's Scripts folder, for hotkeys |
| `tests/unit/` | Node tests |
| `scripts/` | `install-dev.ps1` for Windows |

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
