# Phase 0 spikes

**Status (27 Oct 2026): run in After Effects 26.5 on Dickon's Windows 11 machine. The gate's conditions are met:** the panel loads on a fresh install, and the results of all three spikes are in. Only the optional 150% scaling check was skipped.

A Claude session ran most of it, driving AE through the panel's DevTools port with `scripts/ae.mjs`. Dickon then ran the hands-on checks: the installer, binding and pressing the shortcuts, the panel closed, and the popup's keyboard behaviour. Running the spikes found three harness bugs, fixed under "Decisions made in phase 0", and several AE behaviours worth knowing, listed under "Findings for phase 1 onwards". The logs and raw spike 3 data are in `tests/ae/phase0/`: the 09-41 files are the automated run, the 09-59 file is Dickon's.

| Item | Value |
| --- | --- |
| After Effects | 26.5 (build 26.5x89) |
| CEP | 12.0.1 (Chromium 99, Node 17.7.2) |
| ExtendScript | 4.5.6, engine `main` |
| OS | Windows 11 Home 10.0.26200 |
| Display | One monitor, 5120×2160, 100% scaling |

## What was checked in the cloud session

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
| Dickon's PC | Windows 11 | 26.5 (26.5x89) | Yes | Yes | OK, 6 to 7 ms | Fresh plain copy. Round trip failed until fix 1 (the host layer was not global). |

**Verdict.** The fresh install works on Windows. CEP 12.0.1 accepts `ExtensionManifest Version="7.0"`: its log says the manifest "contains '2' valid extensions for this host", with no "Unsupported Manifest version". The July 2026 report does not apply to AE 26.5 on Windows. The Copy to Points panel on the same machine uses manifest 7.0 too.

- **Panel listed:** `app.findMenuCommandId('AfterEase')` returned 5023, and running that command opened the panel.
- **`install-dev.ps1` works.** The Claude session's permission checker blocked it from running the script, because it sets `PlayerDebugMode` and runs with `-ExecutionPolicy Bypass`, so the session made the same plain copy by hand. Dickon then ran the script himself. It recopied the extension and created the `CSXS.11` key, and the panel loaded afterwards with the round trip OK in 5.2 ms. `PlayerDebugMode` had already been `"1"` under `CSXS.12`, the key AE 26.5 reads.
- CEP logging was raised from `LogLevel` 1 to 6 for the run, then put back to 1.

If the panel is missing or blank, the CEP logs say why: `%TEMP%\CEP*.log` on Windows, `~/Library/Logs/CSXS/` on macOS. Look for "Unsupported Manifest version". The manifest uses `ExtensionManifest Version="7.0"`, the usual value for CEP 9 to 12. If CEP 12 rejects it, that is the reported bug and I need to know before phase 1.

## Spike 1: hotkey

**Verdict.** Hotkeys work. The Keyboard Shortcuts editor lists scripts from the per-user Scripts folder, so the launchers need no admin rights. With a real shortcut, the panel gets the event 3 to 8 ms after the script starts, including with the pointer over the Timeline. If the panel is closed, nothing happens and no error appears; the event is simply lost.

The catch is how AE stores the binding: by the script's position in File > Scripts, not by its name. Phase 6 should plan around three consequences:

- **Bindings can move.** File > Scripts lists AE's own 14 scripts from the install folder first, then the per-user folder, alphabetically. Dickon's shortcuts were saved as `ExecuteScriptMenuItem15` and `16` in a new set, `aeks\Custom.txt`. Adding or removing a script in either folder renumbers the menu, so a shortcut can silently move to a different script.
- **Few slots.** The shortcuts file has slots 01 to 20 only, and AE's own scripts fill 01 to 14. That probably leaves 6 for AfterEase, not enough for the spec's "apply last curve" plus "preset 1 to 9" as separate scripts. Phase 6 should use one or two launchers (open the popup, apply last curve) and choose presets with number keys inside the popup.
- **Closed panel.** If hotkeys must work with the panel closed, phase 6 needs a hidden background extension that starts with AE and listens instead.

- **Where the launchers went.** They were copied to `%APPDATA%\Adobe\After Effects\26.5\Scripts\`, not `Program Files`. AE lists that folder under File > Scripts.
- **How the event was tested.** The Claude session first ran the launchers in AE's main script engine through `$.evalFile` (20 to 27 ms to the panel). Dickon then pressed the real shortcuts (3 to 8 ms). His Timeline and Composition viewer presses (step 4) aren't in the saved log, because closing the panel in step 5 cleared it; his step 6 presses are.
- **`ExecuteScriptMenuItem01` to `20`** exist in AE 26.5's shortcuts file (`aeks\After Effects Default.txt`), so that name, cited from memory, is right.
- **`-ro` is unreliable here.** Handing a script to the running AE with `AfterFX.exe -ro` worked once, straight after launch. Later hand-offs, made while AE sat behind another app, did not run within a minute. One ran at some point afterwards.

**Question.** Can a .jsx in AE's Scripts folder, bound in the Keyboard Shortcuts editor, reach the panel through a CSXS event?

**Harness.** `launchers/AfterEase Spike Ping.jsx` loads `PlugPlugExternalObject` and dispatches a `com.afterease.launcher` event with a timestamp. The panel listens for it and logs the delay.

**Run it.**

1. Copy both files in `launchers/` to the per-user Scripts folder, `%APPDATA%\Adobe\After Effects\26.5\Scripts\`. This needs no admin rights. The install folder, `<AE install>\Support Files\Scripts\`, needs admin and has not been tried.
2. Restart AE. Check that they appear under **File > Scripts**.
3. Open **Edit > Keyboard Shortcuts** and search for "AfterEase". Bind **AfterEase Spike Ping** to a free key.
4. Open the AfterEase panel, press the key, and watch the "1. Hotkey" box.
5. Repeat with the panel closed, then with a different panel focused (the Timeline, the Composition viewer).

**What I'm unsure of.** I don't know for certain that the Keyboard Shortcuts editor lists Scripts-folder scripts in AE 2024 to 2026. If they don't show up, look in the shortcuts text file (Edit > Keyboard Shortcuts > "Reveal in Explorer"/"Finder") for entries named like `ExecuteScriptMenuItem01`. That is how older AE versions bound scripts. I'm citing it from memory, so check it. Also, a closed panel can't receive the event. If that matters, phase 6 can add a hidden background extension that starts with AE and listens instead.

**Results.**

| Check | Result |
| --- | --- |
| Scripts appear under File > Scripts | Yes, from the per-user Scripts folder: `findMenuCommandId` gives 8115 for "AfterEase Spike Ping.jsx" and 8116 for "AfterEase Spike Popup.jsx" (the name needs the `.jsx`). `Program Files` not tried. |
| Scripts appear in the Keyboard Shortcuts editor | Yes (Dickon). Saved by menu position: `ExecuteScriptMenuItem15` = Ctrl+Alt+Shift+1, `ExecuteScriptMenuItem16` = Ctrl+Alt+Shift+2 |
| Shortcut runs the script | Yes (Dickon) |
| Panel receives the event, delay in ms | Yes: 3 to 8 ms from a real shortcut. 20 to 27 ms when run through `$.evalFile` from the panel. Needed fix 3: event data arrives base64-encoded. |
| Works while the Timeline has focus | Yes (Dickon), and with the Composition viewer focused |
| Behaviour with the panel closed | Nothing happens, no error (Dickon). The event is lost. |

## Spike 2: popup at the cursor

**Verdict.** Route B, the ScriptUI palette, places itself exactly at the pointer at 100% scaling. Route A, the CEP modeless window, can't be placed: `window.moveTo` and `moveBy` do nothing, it opened in the middle of the screen each time, and it takes about half a second to load. Reading the cursor through a long-lived PowerShell process costs about 200 ms once, then about 0.1 ms per read. Phase 6 should build the popup as a ScriptUI palette, with the cursor helper started with the panel. No C++ helper is needed.

Keyboard focus is the one weak point. The first time Dickon opened the palette from the shortcut, Esc did not close it; the second time it did. The spike palette neither takes focus explicitly nor handles Esc, so phase 6 should make the palette active when it opens (`active = true`) and close it on Esc with its own key handler.

- **Where the palette lands.** ScriptUI's `location` places the palette's content area, not its frame. The content's top-left corner lands exactly on the pointer, and Windows' own rectangle for the window (`GetWindowRect`) matched ScriptUI's `frameBounds`. The title bar and border sit 31 px above and 8 px left of that point. Phase 6 should use a borderless palette, or offset it, so the curve sits under the pointer.
- **Route A details.** A CEP window opens wherever CEP chooses (here the screen centre: 2450, 1005, size 236×189). Its "ready" event and the panel's messages do get through once fix 3 is in.

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
| Opens at all | Yes | Yes |
| Lands at the pointer (100% scaling) | No: `moveTo` is ignored, so it opens at the screen centre (confirmed by Dickon) | Yes, exactly: content top-left at the pointer, title bar above it (confirmed by Dickon) |
| Lands at the pointer (150% scaling) | Not tested | Not tested (optional, skipped) |
| Second monitor | Not applicable: one monitor | Not applicable: one monitor |
| Shortcut to visible, in ms | About 440 from a real shortcut: 3 for the event, then 439 from cursor read to placed (still at the screen centre) | About 30 from a real shortcut with the cursor helper running: 5 to 8 for the event, about 1 for the cursor, about 20 for the palette. Add about 200 on the first read. Key press to script start not measured. |
| Takes keyboard focus / Esc closes it | No problem reported (Dickon) | Not reliably: Esc did not close it the first time, did the second (Dickon) |

| Cursor read | First read, ms | Later reads, ms |
| --- | --- | --- |
| Windows (PowerShell) | 190 to 207 | 0.1 average (0.1 to 0.7 for single reads) |

## Spike 3: ease model

**Verdict.** The handle formula in SPEC.md is right. In every case at every frame rate, AE's `valueAtTime` matches the analytic cubic to within 0.0024% of the segment's change, against a tolerance of 0.1%. The curve we asked for comes back within 4e-7, against a tolerance of 0.001. AE stores negative speeds and crossing handles exactly as written, which answers the spec's two open questions: overshoot works on 1D properties, and x1 > x2 needs no clamping. Spatial properties move along the path by arc length, as the spec assumes.

At 23.976 and 29.97 fps the harness marks each case FAIL, but only for key times: every curve check passes. AE's 23.976 and 29.97 comps step exactly 1/23.976 s and 1/29.97 s per frame, not 1001/24000 s and 1001/30000 s. The harness placed keys on 1001-based frames, and AE moved them onto its own grid, by 2.5 µs at most. This run can't tell whether that grid is whole frames or a finer time base. Following the rules, the harness is unchanged. Phase 1 should take all frame maths from `comp.frameDuration`, as AE reports it.

The first run also failed both 2D Position cases on a harness bug, fix 2: AE wants 3-value spatial tangents even on a 2D layer. The table below is from the run after that fix, `tests/ae/phase0/`.

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

**Results.** "Curve pass" means model, pipeline and read-back all pass, and only the key-time check failed.

| Case | 23.976 | 25 | 29.97 | 50 | Worst model error | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Opacity, ease in-out | Curve pass | Pass | Curve pass | Pass | 0.0023% | Read-back within 1e-7 |
| Rotation, strong ease | Curve pass | Pass | Curve pass | Pass | 0.0000% | Influences 90 and 95 kept |
| Rotation, overshoot | Curve pass | Pass | Curve pass | Pass | 0.0000% | Negative speeds kept as written |
| Rotation, handles crossing | Curve pass | Pass | Curve pass | Pass | 0.0000% | x1 > x2 kept as written |
| Scale | Curve pass | Pass | Curve pass | Pass | 0.0000% | Z (no change) drifts 0 |
| Position 2D, straight path | Curve pass | Pass | Curve pass | Pass | 0.0024% | Moving by curve parameter would have been off by 9.6% |
| Position 2D, curved path | Curve pass | Pass | Curve pass | Pass | 0.0012% | Moving by curve parameter would have been off by 2.3% to 6.6% |
| Position 3D, curved path | Curve pass | Pass | Curve pass | Pass | 0.0008% | Moving by curve parameter would have been off by 4.3% |

Each rate took 70 to 90 ms in AE for all 8 cases, including writing the keys and taking 20 samples per segment.

## Decisions made in phase 0

These are small calls I made that go beyond the spec. Each is easy to change.

- **Name.** I used **AfterEase** (from the repo name) in place of the EaseKit placeholder. The bundle id is `com.afterease`, the panel is `com.afterease.panel`, and the spike popup is `com.afterease.popup`.
- **Layout.** The spec's `easekit/` tree sits at the repo root rather than in a subfolder. Folders that phase 0 doesn't use yet hold a `.gitkeep`.
- **No vendored CSInterface.js.** `client/lib/cep.js` wraps the six CEP calls the panel uses. Together with `client/lib/host.js`, it is the only client code a UXP port has to replace.
- **Core loading.** `core/` is CommonJS. The panel loads it through CEP's Node `require` (`--enable-nodejs --mixed-context`), and Node tests load it directly.
- **Host loading.** The panel loads `host/` with `$.evalFile` at start-up rather than through the manifest's `ScriptPath`. That way a load failure shows up in the panel log.
- **Host calls.** Everything goes through `AfterEase.call(name, json)`, which returns `{ok, result | error}`. The five adapter functions from the spec exist as stubs that throw "not implemented yet (phase 1)".
- **AE version range.** The manifest uses `[24.0,26.99]`, which covers AE 2024 to 2026.

Harness fixes made while running the spikes on 27 Oct 2026, each small:

1. **Host layer made global** (`host/adapter.jsx`). `main.jsx` loads the host files with `$.evalFile` inside `AfterEaseLoad()`, and ExtendScript then keeps their `var`s local to that function. The load reported "ok", but the panel's next call found no `AfterEase`, and the round trip failed with an empty reply. `adapter.jsx` now puts `AfterEase` on `$.global`. New Node test: "host layer is global when loaded inside a function".
2. **Spatial tangents padded to the property's dimensions** (`host/spikes/easeModel.jsx`). AE keeps Position as 3 values even on a 2D layer (`[x, y, 0]`), and `setSpatialTangentsAtKey` rejects 2-value tangents. The plan and `core/` stay 2D; the host pads with zeros, because the 3-value rule belongs to AE's API.
3. **CSXS event data decoded from base64** (`client/lib/cep.js`). CEP 12 delivers event `data` base64-encoded, with a line break every 76 characters, whether a panel or ExtendScript sent it. Without decoding, the hotkey event showed raw base64, and the popup ignored its placement message. `parseData` now decodes base64 of UTF-8, and keeps anything else as it came. New Node test: `tests/unit/cep.test.js`.

Tooling added: `scripts/ae.mjs` takes the shared lock `D:\Plugins\AE\ae-in-use.txt`, launches AE, opens the panel from its menu item, evaluates JavaScript in the panel or the popup through their DevTools ports, and quits AE without saving the untitled project. Phase 1 can reuse it for the in-AE round-trip tests.

## Findings for phase 1 onwards

- **Script shortcuts are bound by menu position** (`ExecuteScriptMenuItem01` to `20`), and AE's own 14 scripts come first. See the spike 1 verdict before designing phase 6 hotkeys or the phase 7 install script.
- **Frame grid.** AE's 23.976 and 29.97 fps comps step exactly 1/23.976 s and 1/29.97 s per frame, and AE moves key times onto its grid. Take frame maths from `comp.frameDuration`, never from 1001-based rates.
- **2D Position is 3D to the API.** On a 2D layer, `keyValue`, `valueAtTime` and the spatial tangents all have three values, with z = 0. `readSelection` and `writeKeys` must expect that.
- **AE keeps eases as written.** Negative speeds and influences that put x1 past x2 are stored and played back unchanged. `core/` needs no clamping for them.
- **Spatial easing is by arc length**, confirmed: the arc-length model matches AE within 0.0024%, while moving by curve parameter would be off by 2.3% to 9.6%.
- **CSXS events.** A panel's event with an empty `extensionId` is dropped. ExtendScript's `CSXSEvent` arrives with empty `extensionId` and `appId`, and is delivered anyway. `CSXSEvent` is already defined in AE's main engine, and loading `PlugPlugExternalObject` again does no harm.
- **Script errors can freeze the engine.** A syntax error in a script sent with `evalScript` opens a modal "Unable to execute script at line N" alert in AE, and every host call stalls until someone dismisses it. A runtime error inside `evalScript` comes back as an empty string instead. A standalone script that throws (File > Scripts, `-ro`) shows the same alert, as usual. Host code must never let an error escape: `AfterEase.call` already catches everything, and phase 1 code should keep to that.
- **Some objects can't be turned into text.** Converting a loaded `ExternalObject` to a string throws. In a probe script, converting the resulting Error to a string threw again ("Object of type Error found where a Number, Array, or Property is needed"). The launchers' `alert(... + e)` fallback could hit this, so phase 6 launchers shouldn't build messages from caught errors that way.
- **One shared engine.** `evalScript` runs in AE's `main` engine, the one File > Scripts uses, so state kept in `$.global` (the ScriptUI palette) lasts between calls. Other extensions share it too: JSON already existed there when the host loaded, possibly native, possibly from another extension such as CC Libraries, and `json2.jsx` left it alone.

## Answers to the open questions in SPEC.md

| Question | Answer | What it changes |
| --- | --- | --- |
| In-house, distributed or sold? | In-house | Phase 7 is a studio install script only: no signed ZXP, no licensing. The feature set doesn't need to track QuickEase. |
| AE versions and OS | Latest AE on Windows 11 | Testing targets the latest AE on Windows 11 only. AE 2024 and 2025 and macOS drop out of the acceptance checks. The manifest still accepts AE 2024 to 2026, which costs nothing. The macOS cursor helper stays, but nobody will test it. |
| Is the cursor popup essential for v1? | Would be good | Phase 6 builds it if spike 2 finds a working route. If not, the fallback (a compact floating panel plus hotkeys) is acceptable, and the C++ helper is not worth building for it. |
| Studio-standard presets? | No | Built-ins are the generic set from SPEC.md: linear, and ease in, out and in-out at a few strengths. |
| Name | Not answered yet | Still **AfterEase**. |
