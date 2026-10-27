# Phase 0 spikes

**Status: the harnesses are built, but the spikes have not been run in After Effects.** I built phase 0 in a Linux container with no After Effects, so nothing below has touched a real AE. The phase 0 gate (the panel loads on a fresh install, and the spike results are in) needs a run on your machine. Each section says how to run its spike and leaves space for the results.

When you have run them, press **Save log and reports** in the panel and send me the two files it writes to `Documents/AfterEase spike reports/`. I'll fill in the results tables from them.

## What was checked here

| Check | How | Result |
| --- | --- | --- |
| Core maths (`core/`) | 9 Node unit tests: solve, split, ease conversion round trips, clamping, arc length | Pass |
| Spike 3 harness | 4 Node tests against fake hosts, including one that fails on purpose (spatial moved by curve parameter, not arc length) | Pass |
| Host and launcher scripts are ES3 | Parsed with acorn at `ecmaVersion: 3` | Pass |
| JSON polyfill | Round trip in a sandbox with no native `JSON` | Pass |
| Panel wiring | Headless Chromium with a fake `__adobe_cep__`: load, round trip, launcher event, spike 3 at all four frame rates, save | Pass, no page errors |

**Not checked here:** `install-dev.ps1` (no Windows), the PowerShell cursor helper (no PowerShell), the macOS cursor helper, and whether a real CEP runtime accepts the manifest.

## Before the spikes: fresh install check

The July 2026 report says newly installed CEP extensions fail in AE 25.6.5 to 26.3 on macOS. So do the first install as a plain copy, not a link:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-dev.ps1
```

Restart AE, then open **Window > Extensions (Legacy) > AfterEase**. The Connection box should say "OK" next to **Round trip**.

| Machine | OS | AE version | Panel listed? | Panel loads? | Round trip | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| | Windows 11 | | | | | |

If the panel is missing or blank, the CEP logs say why: `%TEMP%\CEP*.log` on Windows, `~/Library/Logs/CSXS/` on macOS. Look for "Unsupported Manifest version". The manifest uses `ExtensionManifest Version="7.0"`, the usual value for CEP 9 to 12. If CEP 12 rejects it, that is the reported bug and I need to know before phase 1.

## Spike 1: hotkey

**Question.** Can a .jsx in AE's Scripts folder, bound in the Keyboard Shortcuts editor, reach the panel through a CSXS event?

**Harness.** `launchers/AfterEase Spike Ping.jsx` loads `PlugPlugExternalObject` and dispatches a `com.afterease.launcher` event with a timestamp. The panel listens for it and logs the delay.

**Run it.**

1. Copy both files in `launchers/` to `<AE install>\Support Files\Scripts\`. This needs admin rights.
2. Restart AE. Check that they appear under **File > Scripts**.
3. Open **Edit > Keyboard Shortcuts** and search for "AfterEase". Bind **AfterEase Spike Ping** to a free key.
4. Open the AfterEase panel, press the key, and watch the "1. Hotkey" box.
5. Repeat with the panel closed, then with a different panel focused (the Timeline, the Composition viewer).

**What I'm unsure of.** I don't know for certain that the Keyboard Shortcuts editor lists Scripts-folder scripts in AE 2024 to 2026. If they don't show up, look in the shortcuts text file (Edit > Keyboard Shortcuts > "Reveal in Explorer"/"Finder") for entries named like `ExecuteScriptMenuItem01`. That is how older AE versions bound scripts. I'm citing it from memory, so check it. Also, a closed panel can't receive the event. If that matters, phase 6 can add a hidden background extension that starts with AE and listens instead.

**Results.**

| Check | Result |
| --- | --- |
| Scripts appear under File > Scripts | |
| Scripts appear in the Keyboard Shortcuts editor | |
| Shortcut runs the script | |
| Panel receives the event, delay in ms | |
| Works while the Timeline has focus | |
| Behaviour with the panel closed | |

## Spike 2: popup at the cursor

**Question.** Can any route open UI at the mouse position?

CEP only sees the pointer while it is over the panel, so the spike has two parts: reading the global cursor position, and placing a window there.

**Reading the cursor** (`client/lib/cursor.js`, through CEP's Node):

- **Windows:** one long-lived PowerShell process that answers each request with `System.Windows.Forms.Cursor.Position`. Only the first read pays PowerShell's start-up time.
- **macOS:** one `osascript` (JXA) call per read, using `NSEvent.mouseLocation`, converted to top-left coordinates.

**Placing the window.** Pick a route in the panel:

- **A. CEP modeless window** (`com.afterease.popup`, a second extension in the same bundle). CEP has no API for placing a window, so it tries `window.moveTo` and reports where it actually ended up.
- **B. ScriptUI palette** (`host/spikes/popup.jsx`). ScriptUI windows take a `location`, so this is the route I expect to work. Its drawback: the popup UI would be ScriptUI, not HTML.
- **C. Small AEGP helper (C++).** Not built. It is worth building only if A and B both fail, because it needs the AE SDK and a toolchain for each OS.

**Run it.**

1. Press **Read cursor ×10** and note the timings in the log.
2. For each route, press **Open at cursor in 2 s**, then move the pointer over the Timeline. Press **Yes**, **Offset** or **Did not open** to record the outcome in the log.
3. Bind `launchers/AfterEase Spike Popup.jsx` to a key and try it with the pointer over the Timeline. This is the real flow: one shortcut and the popup appears.
4. Repeat at 100% and 150% Windows 11 display scaling, and on a second monitor if the studio uses them.

**Results.**

| Check | Route A: CEP window | Route B: ScriptUI palette |
| --- | --- | --- |
| Opens at all | | |
| Lands at the pointer (100% scaling) | | |
| Lands at the pointer (150% scaling) | | |
| Second monitor | | |
| Shortcut to visible, in ms | | |
| Takes keyboard focus / Esc closes it | | |

| Cursor read | First read, ms | Later reads, ms |
| --- | --- | --- |
| Windows (PowerShell) | | |

## Spike 3: ease model

**Question.** Does `valueAtTime` match the analytic cubic for 1D, multi-dimensional and spatial properties?

**Harness.** The panel builds a plan with `core/aeEase.js` and sends it to `host/spikes/easeModel.jsx`. The host creates a throwaway comp (one undo step), writes keys and eases exactly as given, reads back what AE stored, and samples `valueAtTime` at 20 points per segment. The panel then compares three things:

- **model:** AE's samples against the analytic cubic built from the eases AE *stored*. This tests the handle formula in SPEC.md.
- **pipeline:** AE's samples against the curve we *asked for*. This tests the whole conversion.
- **read-back:** the curve recovered from the stored eases, compared with the requested (x1, y1, x2, y2).

The tolerance is 0.1% of the segment's value change, and 0.001 on read-back curves, as in the acceptance checks.

Cases, with keys on whole frames at 23.976, 25, 29.97 and 50 fps:

| Case | What it tests |
| --- | --- |
| Opacity, ease in-out | 1D, two segments, middle key with different in and out curves |
| Rotation, strong ease | 1D, influences near the extremes |
| Rotation, overshoot | 1D, negative speeds on both sides (does AE accept them?) |
| Rotation, handles crossing | x1 > x2 (does AE accept it?) |
| Scale | Multi-dimensional, 3 ease entries, one dimension with no change |
| Position 2D, straight path | Spatial with zero tangents |
| Position 2D, curved path | Spatial with tangents, two segments |
| Position 3D, curved path | Spatial in 3D |

Rotation is used for the overshoot cases because AE clamps Opacity to 0 to 100.

**Reading the report.**

- **Model fails but read-back passes:** AE's curve differs from the handle formula. Stop: the conversion in SPEC.md is wrong.
- **"AE changed … speed/influence":** AE clamped or rejected a value. The overshoot and crossing cases may do this. Either way it answers the spec's two open questions.
- **Spatial cases:** each segment also reports the error *if* AE moved along the path by curve parameter instead of arc length. If that number is small and the model error is large, AE doesn't use arc length, and the spatial maths needs rethinking.

**Run it.** Press **Run all rates**. Each rate adds a comp named "AfterEase spike - ease model …".

**Results.**

| Case | 23.976 | 25 | 29.97 | 50 | Worst model error | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Opacity, ease in-out | | | | | | |
| Rotation, strong ease | | | | | | |
| Rotation, overshoot | | | | | | |
| Rotation, handles crossing | | | | | | |
| Scale | | | | | | |
| Position 2D, straight path | | | | | | |
| Position 2D, curved path | | | | | | |
| Position 3D, curved path | | | | | | |

## Decisions made in phase 0

These are small calls I made that go beyond the spec. Each is easy to change.

- **Name.** I used **AfterEase** (from the repo name) in place of the EaseKit placeholder. The bundle id is `com.afterease`, the panel is `com.afterease.panel`, and the spike popup is `com.afterease.popup`.
- **Layout.** The spec's `easekit/` tree sits at the repo root rather than in a subfolder. Folders that phase 0 doesn't use yet hold a `.gitkeep`.
- **No vendored CSInterface.js.** `client/lib/cep.js` wraps the six CEP calls the panel uses. Together with `client/lib/host.js`, it is the only client code a UXP port has to replace.
- **Core loading.** `core/` is CommonJS. The panel loads it through CEP's Node `require` (`--enable-nodejs --mixed-context`), and Node tests load it directly.
- **Host loading.** The panel loads `host/` with `$.evalFile` at start-up rather than through the manifest's `ScriptPath`. That way a load failure shows up in the panel log.
- **Host calls.** Everything goes through `AfterEase.call(name, json)`, which returns `{ok, result | error}`. The five adapter functions from the spec exist as stubs that throw "not implemented yet (phase 1)".
- **AE version range.** The manifest uses `[24.0,26.99]`, which covers AE 2024 to 2026.

## Answers to the open questions in SPEC.md

| Question | Answer | What it changes |
| --- | --- | --- |
| In-house, distributed or sold? | In-house | Phase 7 is a studio install script only: no signed ZXP, no licensing. The feature set doesn't need to track QuickEase. |
| AE versions and OS | Latest AE on Windows 11 | Testing targets the latest AE on Windows 11 only. AE 2024 and 2025 and macOS drop out of the acceptance checks. The manifest still accepts AE 2024 to 2026, which costs nothing. The macOS cursor helper stays, but nobody will test it. |
| Is the cursor popup essential for v1? | Would be good | Phase 6 builds it if spike 2 finds a working route. If not, the fallback (a compact floating panel plus hotkeys) is acceptable, and the C++ helper is not worth building for it. |
| Studio-standard presets? | No | Built-ins are the generic set from SPEC.md: linear, and ease in, out and in-out at a few strengths. |
| Name | Not answered yet | Still **AfterEase**. |
