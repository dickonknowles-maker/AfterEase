# Phase 2: panel UI

**Status (27 Oct 2026): built, installed on Dickon's machine, and checked in AE 26.5 with real mouse and keyboard input: 11 of 11 checks pass** (`tests/ae/phase2/panel-check.txt`, with screenshots). The gate is Dickon using it on a real shot; that's the only thing left.

## What's in the panel

| SPEC.md asks for | What the panel has |
| --- | --- |
| Canvas editor with two handles | Drag either handle. Handles stay inside AE's influence range (0.1% to 100%); values can go below 0 or above 1 to overshoot. |
| Numeric fields for x1, y1, x2, y2 | Four fields under the graph. Enter or clicking away applies; Esc puts the value back. |
| Value and speed toggle that works mid-drag | **Value** / **Speed** buttons, or **Tab** with the graph focused, including mid-drag. The speed view shows speed over time, with a dashed line at the segment's average. Its handles set influence (sideways) and speed (up and down). |
| Presets grid: built-ins plus user presets that can be renamed, reordered and deleted | Linear, then Slow start, Slow end and Slow both ends at three strengths. **+** saves the current curve; right-click a saved preset to rename, replace or delete it; drag to reorder; double-click to rename. |
| Read from selection | **Read keys** loads the curve of the first selected pair. |
| Scope: both sides, in only, out only | **In / Both / Out** next to Apply. |
| Apply on mouse-up by default; live apply optional | On by default: letting go of a handle, picking a preset or typing a number applies to the selected keys. **Apply while dragging** is off by default, in the ⋯ menu. |
| Presets and settings as JSON in the user's app data folder | `%APPDATA%\AfterEase\presets.json` and `settings.json`. A file that can't be read is kept aside, not overwritten. |

Every apply is one undo step, named after what was applied: "AfterEase: Slow end, medium", or "AfterEase: apply curve" after a drag. The status line under the presets says what happened, for example "Eased 3 segments on 1 property", plus any notes (held segments skipped, overshoot clipped on a path, and so on).

The panel takes its background from AE and follows AE's brightness setting, light or dark.

## Decisions made in phase 2

Each is easy to change.

1. **Preset names say what they do.** "Ease in" means a slow *start* in most curve tools, but AE's Easy Ease In slows *into* a key. With In and Out also used for the scope, the presets are called Slow start, Slow end and Slow both ends instead. Slow both ends, gentle, is AE's Easy Ease (33% influence).
2. **Clicking a preset applies it** to the selected keys straight away, unless "Apply changes straight away" is turned off. With no keys selected, it just loads the curve.
3. **Strengths:** gentle, medium and strong use 33%, 60% and 85% influence. Slow start and slow end finish at full speed with a short handle, like a Linear key in AE.
4. **The phase 0 panel moved** to `client/spikes.html`, reached from ⋯ > Phase 0 diagnostics. The spike launchers in the Scripts folder still talk to it.
5. **The speed view shows up to 8 times the average speed.** Very short influences make the start or end speed huge; the curve is clipped at the edge rather than squashing everything else.

## How it was tested

- **Node:** 38 tests pass (`npm test`), up from 30. The new ones cover the speed view's handle maths, the built-in presets, reading a curve back from keys, and the presets and settings store.
- **In a browser, with a fake AE** (`node scripts/serve.mjs`, then open `http://localhost:8090/client/index.html`). This is for working on the design without tying up After Effects. It was checked at the panel's default 340 px width, its 240 px minimum, and in the light theme.
- **In After Effects** (`node tests/ae/panel.mjs`, with AE started by `node scripts/ae.mjs start`). It clicks, drags, right-clicks and types in the installed panel, then reads what AE stored:

| Check | Result |
| --- | --- |
| Panel loads and reaches After Effects | Pass |
| Clicking a preset eases the selected keys | Pass: curve read back within 1.1e-15 |
| One Edit > Undo puts the keys back | Pass |
| Dragging a handle applies on release | Pass: matches the numbers shown within 1.1e-4 (they show 3 decimals) |
| Tab mid-drag switches to the speed view and keeps the curve | Pass |
| Read keys loads the selected curve | Pass: Linear keys read as a straight line; eased keys as their curve |
| Scope In writes only the ease into each key | Pass |
| A preset on 2D Position, and on a colour | Pass |
| Saving a preset writes the presets file; right-click > Delete removes it | Pass |

The test sets the user's AfterEase files aside and puts them back afterwards.

One thing the tests can't check: AE doesn't let scripts read the Edit menu, so the wording of the undo step ("Undo AfterEase: …") needs a human look.

## For the gate

Dickon uses the panel on a real shot. Things worth watching for:

- Whether the curve shapes and preset strengths feel right.
- Whether clicking a preset should apply immediately (decision 2).
- **Keyboard focus.** After clicking in a CEP panel, AE's own shortcuts (Space to preview, for example) may not work until you click back in the Timeline. That's how CEP panels behave; if it gets in the way, it can be looked at.
- Anything confusing in the wording.

## Not in phase 2

Copy, paste and multikey (phase 3), Curve Repair (4), the toolbox (5), and the popup and hotkeys (6).
