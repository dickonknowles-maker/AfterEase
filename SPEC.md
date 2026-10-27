# Easing panel for After Effects: build spec

Oct 27, 2026 · Dickon Edward Knowles

## Summary

Build it as a CEP extension: an HTML/JS panel that drives After Effects through ExtendScript, with all easing maths in a host-agnostic JavaScript core. CEP is the only panel route that runs in release AE 2024 to 2026, and a portable core makes a later UXP port a swap of the host layer.

- **What to build:** a compact easing panel with a value and speed curve editor, presets, copy and paste, Curve Repair and twelve keyframe tools, then the popup at the cursor.
- **Build first:** the easing maths and a keyframe snapshot utility. Most tools depend on both, and AE has no API for moving a key.
- **Riskiest part:** opening the UI at the mouse cursor. I don't know how QuickEase does it, and CEP has no obvious route. Phase 0 spikes it; the fallback is a small floating panel plus hotkeys.
- **Second riskiest:** Curve Repair, which relies on polling and adds extra undo steps.
- **Cost check:** QuickEase is $24 one-time. If the goal is only to have the tool, buying it is far cheaper than building. Building makes sense for studio-owned code, your own workflow on top, or a base for other in-house keyframe tools.

## What QuickEase does

QuickEase is a $24 one-time After Effects extension (macOS and Windows, AE 2024 to 2026) that opens an easing popup at the cursor and adds twelve keyframe tools ([QuickEase](https://suky.design/plugins/quickease)). The table paraphrases each feature and maps it to a build phase in this spec.

| Feature | Behaviour | Phase |
| --- | --- | --- |
| Ease at cursor | Popup at the mouse applies a curve to the selected keys | 0 (spike), 6 |
| Value and speed graph | Edit in either view and switch at any time, even mid-drag | 2 |
| Curve Repair | Watches eased keys and restores the curve shape after a key moves | 4 |
| Copy, paste, multikey | Paste eases only, values with eases kept, or a whole run of keys across a span | 3 |
| Mirror X | Reverses selected keys in time, eases included | 5 |
| Invert | Swaps handle x and y, so an ease-in becomes an ease-out | 5 |
| Mirror Y | Flips values across the selected range, timing unchanged | 5 |
| Align | Lines up layer or key starts or ends with the playhead | 5 |
| Insert key | Adds or removes a key without changing the curve | 5 |
| Continuous | Makes keys continuous, rotating the out handle to match the in | 5 |
| Trim to keys | Sets a layer's in and out points to its first and last keys | 5 |
| Excite | Adds an overshoot expression after each key, with three sliders | 5 |
| Bounce | Adds a bounce expression after each key, with three sliders | 5 |
| Separate dimensions | Separates or rejoins dimensions with the easing kept | 5 |
| Snap frames | Rounds layer and key times to whole frames | 5 |
| Trim at playhead | Trims or extends selected layers to the playhead | 5 |

Their roadmap items (offset along a curve, a larger graph view, multikey presets, single-key editing) are out of scope for v1. Treat QuickEase as a feature reference only: original UI, original expressions, no copied text or icons.

## Platform: CEP now, ready for UXP

CEP with ExtendScript is the route. UXP for After Effects exists only in the AE 27 beta, and a C++ plugin is far more work than easing needs.

| Option | Runs in release AE 2024 to 2026 | Fit for this tool | Verdict |
| --- | --- | --- | --- |
| CEP panel (HTML/JS + ExtendScript) | Yes, under Window > Extensions (Legacy) | Canvas curve editor, timers for Curve Repair, Node for files | Build on this |
| UXP plugin | No, AE 27 beta only | Adobe's long-term route; the AE UXP API already has KeyframeEase (speed, influence) from 27.0 | Port target |
| ScriptUI panel (.jsx) | Yes | Quick to build, but an interactive curve editor in ScriptUI is clumsy | Fallback only |
| C++ AEGP plugin | Yes | Native hotkeys and cursor position; needs the AE SDK and a C++ toolchain per OS | Small helper only, if the popup spike needs it |

**Timing.** Adobe said in September 2026 that each flagship app gets a two-year runway from its own UXP beta, and CEP stops shipping after December 2029 ([Adobe announcement](https://forums.creativeclouddeveloper.com/t/cep-to-uxp-what-developers-need-to-know/12189)). AE's UXP docs are live and flagged as beta ([UXP for After Effects](https://developer.adobe.com/after-effects/uxp/), [KeyframeEase](https://developer.adobe.com/after-effects/uxp/after-effects-api/keyframeease)).

**Check on day one.** A July 2026 user report says newly installed CEP extensions fail to load in AE 25.6.5 to 26.3 on macOS (CEP 12, "Unsupported Manifest version"), while older ones keep working ([bug report](https://community.adobe.com/bug-reports-528/in-recent-versions-of-after-effects-i-m-unable-to-install-or-sign-new-zxp-files-1632227)). It has no replies and no Windows confirmation, so phase 0 tests a fresh install first.

Two rules keep the UXP port cheap:

- All maths and data shaping live in `core/` as pure functions with no host calls.
- Host access goes through one adapter (`readSelection`, `writeKeys`, `moveKeys`, `applyExpression`, `setLayerTimes`), implemented in ExtendScript now and UXP later.

ExtendScript is ES3: no built-in JSON and no modern array methods. Keep the maths in the panel's modern JS and send flat JSON plans to the host.

## Architecture

Three layers: the panel UI, a pure-JS core that does all the maths, and a thin ExtendScript host layer that only reads and writes After Effects data, one undo group per action. Each action costs two host calls: one read, one write.

[embedded content: extension architecture · panel, core, host layer]

Hotkeys, the editor and Curve Repair all go through the same two host calls, so the host stays small and easy to port to UXP.

**Apply flow**

1. The user selects keys and triggers an action (panel click or hotkey launcher).
2. The panel calls `readSelection()`. The host returns JSON per selected property: matchName path, dimension kind (1D, multi-dimensional, spatial), key times, values, current eases, interpolation types and spatial tangents.
3. The core turns the chosen curve into speed and influence for every key pair.
4. The panel calls `writeKeys(plan)`. The host writes inside one undo group and returns the eases as AE stored them.
5. The panel compares the read-back with the plan, reports any clamping, and records the intent for Curve Repair.

**Storage**

- Presets and settings: JSON in the user's app data folder, via CEP's Node `fs`.
- Curve Repair intents: project XMP metadata, so they travel with the .aep. Keyed by comp id, layer id, property matchName path and key times.

**Repo layout** (working name EaseKit; rename freely)

```
easekit/
  CSXS/manifest.xml
  client/              panel UI: HTML, CSS, JS modules
    editor/            curve editor canvas, value and speed views
    toolbox/
    state/             presets, settings, Curve Repair watcher
  core/                pure JS, no host calls, Node-tested
    bezier.js          evaluate, derivative, split, fit
    aeEase.js          normalised curve <-> speed/influence
    spatial.js         arc length of spatial segments
    tools/             invert, mirror, run and paste maths
  host/                ExtendScript (ES3)
    json2.jsx
    adapter.jsx        readSelection, writeKeys, moveKeys, applyExpression, setLayerTimes
    keySnapshot.jsx    capture and restore every key attribute
    expressions/       excite and bounce templates
  launchers/           .jsx files for AE's Scripts folder (hotkeys)
  tests/
    unit/              Node tests for core/
    ae/                fixture builder and in-AE test runner (.jsx)
  scripts/
    install-dev.ps1    copy to CEP extensions folder, set PlayerDebugMode
```

## Easing maths

Store every ease as a normalised cubic-bezier per key pair (x1, y1, x2, y2, as in CSS) and convert it to AE's per-key speed and influence at write time, using that pair's time and value change.

**AE's model.** Each key has an in ease and an out ease, each an array of KeyframeEase objects with speed (property units per second) and influence (0.1 to 100, percent of the segment's duration). The array has one entry per dimension for multi-dimensional non-spatial properties such as Scale, and one entry for 1D, spatial and colour properties such as Position ([ExtendScript KeyframeEase](https://after-effects-scripting-guide.readthedocs.io/other/keyframeease.html)).

**Conversion** for the pair from key A to key B:

```latex
\Delta t = t_B - t_A, \qquad \bar{v} = \frac{v_B - v_A}{\Delta t}
```

```latex
\text{A out: } I = 100\,x_1,\; S = \bar{v}\,\frac{y_1}{x_1} \qquad \text{B in: } I = 100\,(1 - x_2),\; S = \bar{v}\,\frac{1 - y_2}{1 - x_2}
```

Reading existing eases reverses this: x1 = I / 100 and y1 = S × x1 / v̄, and likewise for the in side. It assumes AE's 1D temporal curve is the cubic with handles at influence × Δt in time and speed × influence × Δt in value. That is the standard model, but phase 0 verifies it by sampling `valueAtTime`.

**Cases to handle**

- **1D and separated dimensions:** the formulas apply directly.
- **Multi-dimensional, non-spatial** (Scale and other two- or three-value properties): compute v̄ per dimension; every dimension gets the same normalised curve.
- **Colour:** one ease, not one per channel (AE refuses more). The value change is the straight-line distance between the two RGBA colours in 0–255 units, so speed is 0–255 units per second along that line; for example, 1 second from [1, 0, 0, 1] to [0, 0.5, 1, 1] is 382.5. Like spatial speed, it is a magnitude, so colours can't overshoot. Measured in AE 26.5 in phase 1.
- **Spatial** (Position, Anchor Point, 3D points): one ease. The value change is the arc length of the spatial bezier between the keys, built from the key values plus `keyOutSpatialTangent` of A and `keyInSpatialTangent` of B. Integrate numerically (Gauss-Legendre or dense sampling). Speed is pixels per second along the path.
- **No value change** (v̄ = 0): speeds are 0 whatever the curve, so only influence carries. Keep the intent anyway so Curve Repair can reapply it if the values change.
- **Overshoot** (y outside 0 to 1): 1D and separated properties only. Spatial speed is a magnitude, so Position overshoot needs separated dimensions or the Excite expression. Verify that AE accepts negative speeds on 1D properties.
- **Interpolation:** set both sides to BEZIER with `setInterpolationTypeAtKey` before writing eases. Turn temporal continuous off where a key's in and out curves differ, or AE forces matching speeds.
- **Middle keys:** a key's in ease belongs to the segment before it, its out ease to the segment after. A span is written pair by pair; offer "in only" and "out only" for end keys.
- **Clamping:** influence to 0.1 to 100, so x stays within 0.001 to 0.999. Whether AE accepts x1 greater than x2 (handles crossing in time) is unknown; test it and clamp if not.

**Speed view.** Same data, different plot: the derivative of the cubic scaled by v̄. Dragging in speed view edits the same (x, y) handles through the ratio y / x, so the view can switch mid-drag without changing the curve.

**Insert key without changing the curve.** Solve x(s) = (t − tA) / Δt for the curve parameter s (Newton with a bisection fallback), split the cubic at s with de Casteljau, set the new key's value to vA + y(s) × (vB − vA), then convert both halves to eases. This is exact for 1D and per-dimension properties; spatial properties also need their spatial tangents split.

**Remove key.** Two cubics rarely merge into one exactly. Fit a single cubic to sampled values by least squares and show the error before committing.

## Feature specs

Everything rests on two foundations: the conversion above and a KeySnapshot utility in the host layer.

**KeySnapshot (build first).** AE has no API for moving a key, so a move means capture, remove, re-add and restore. Capture everything a key holds: time, value, in and out interpolation types, temporal eases, temporal continuous and auto-bezier, spatial tangents, spatial continuous and auto-bezier, roving, label and selection state. Mirror X, Align, Snap frames and pasted runs all depend on it. Remove keys from last to first so indices stay valid.

**Curve editor panel**

- Canvas editor with two handles, numeric fields for x1, y1, x2, y2, and a value and speed toggle that works mid-drag.
- Presets grid: built-ins (linear, ease in, ease out, ease in-out at a few strengths) plus user-saved presets that can be renamed, reordered and deleted.
- "Read from selection" loads the first selected pair's curve into the editor.
- Apply to every selected pair across properties and layers, with a scope of both sides, in only or out only.
- Apply on mouse-up by default. Live apply while dragging is optional and throttled, since each write is an undo step.

**Copy, paste and multikey**

- Copy stores the normalised curves of the selected pairs plus their relative times and values.
- Paste ease: one curve goes to every selected pair; several curves go to pairs in order.
- Paste values, keep ease: overwrite the selected key values, then reapply each pair's stored curve.
- Paste run: recreate the copied keys at the playhead with their spacing, values and eases, optionally stretched to the selected span.

**Curve Repair**

- A toggle. When on, every pair the tool eases records its intent in the store.
- The panel polls only watched properties (eased this session or currently selected), reading key times and values. Target interval 250 to 500 ms, paused while AE is busy.
- When a watched pair's time or value change differs from the stored one, recompute speeds from the intent and write them in one undo group named "Curve Repair". Influences don't change, so only speeds move.
- When keys are added or removed, re-associate pairs by order and nearest time, and drop intents whose keys are gone.
- Settings: on or off, polling interval, and a "Repair now" button.

**Toolbox** (in build order, cheapest first)

| Tool | Implementation | Effort |
| --- | --- | --- |
| Invert | Core only: swap each handle's x and y. Disabled when any y is outside 0 to 1 | Low |
| Continuous | Set out speed equal to in speed, then `setTemporalContinuousAtKey(true)` | Low |
| Trim to keys | Walk all animated properties recursively; set in and out points to the first and last key times | Low |
| Trim at playhead | Move the nearer edge of each selected layer to the playhead; a modifier picks the other edge | Low |
| Mirror Y | New value = range min + range max − old value; normalised curves are unchanged, so reapply them | Low |
| Excite | Original overshoot expression after each key, with Amplitude, Frequency and Decay sliders on the layer. Ask before replacing an existing expression | Medium |
| Bounce | Original bounce expression after each key, with three sliders; same expression rule | Medium |
| Snap frames | Round key times (via KeySnapshot) and layer in, out and start times to whole frames | Medium |
| Align | Move layer starts or ends, or the first or last selected key, to the playhead | Medium |
| Mirror X | Reverse keys within their span (t becomes start + end − t); swap in and out eases and spatial tangents | Medium |
| Insert key | De Casteljau split to add a key; least-squares fit to remove one (see Easing maths) | High |
| Separate dimensions | Read curves, toggle `dimensionsSeparated`, reapply per dimension, or by arc length when rejoining; warn when separated dimensions have keys at different times | High |

## Build phases

Eight phases, each ending in a gate Dickon checks before the next starts. Phases 0 to 3 give a usable tool; 4 to 7 add the parts that make it special.

0. **Scaffold and spikes.** CEP bundle (host AEFT, version range covering AE 2024 to 2026, CSXS 11.0 minimum), an ExtendScript round trip, and `install-dev.ps1` (copy to `%APPDATA%\Adobe\CEP\extensions`, set `PlayerDebugMode` to 1 under `HKCU\Software\Adobe\CSXS.11` and `CSXS.12`). Three spikes, each written up:
   1. Hotkey: can a .jsx in AE's Scripts folder, bound in the Keyboard Shortcuts editor, reach the panel through a CSXS event?
   2. Popup at cursor: can any route open UI at the mouse position (CEP window types, a Node helper for cursor position, a small AEGP helper)?
   3. Ease model: does sampling `valueAtTime` match the analytic cubic for 1D, multi-dimensional and spatial properties?
   - Gate: the panel loads on a fresh install in Dickon's AE version, and the spike results are in.
1. **Core engine.** `core/` maths with Node tests, host `readSelection` and `writeKeys`, KeySnapshot. Apply a curve to 1D, then multi-dimensional, then spatial properties.
   - Gate: round-trip tests pass in the AE fixture project.
2. **Panel UI.** Curve editor, value and speed views, presets, read from selection, apply scopes.
   - Gate: Dickon uses it on a real shot.
3. **Copy, paste and multikey.**
   - Gate: pasted eases read back identically on different value ranges.
4. **Curve Repair.**
   - Gate: moving a key restores the shape within one poll, and undo stays usable.
5. **Toolbox**, in the table's order.
   - Gate: each tool passes its acceptance check below.
6. **Popup and hotkeys**, using whatever phase 0 proved. If no route opens UI at the cursor, ship a compact floating panel plus hotkeys for "apply last curve" and "apply preset 1 to 9".
   - Gate: easing a selection takes one shortcut and one click.
7. **Packaging.** Studio install script; a signed ZXP only if it will be distributed. Write UXP port notes listing every adapter call.
   - Gate: a clean install works on a second studio machine.

## Testing and acceptance

Every write is checked by reading it back from AE and sampling the result, because AE can clamp values without raising an error.

- **Unit tests (Node):** conversion round trips, split and fit, invert, mirror, arc length against known curves.
- **Fixture project:** built by a setup .jsx so it is reproducible. Comps at 23.976, 25, 29.97 and 50 fps with keyed Opacity (1D), Scale (multi-dimensional), 2D and 3D Position (spatial), separated Position, colour, hold keys, roving keys, keys under an existing expression, and Time Remap.
- **In-AE runner (.jsx):** applies known curves and samples `valueAtTime` at 20 points per segment against the analytic curve, then prints a pass or fail report.

Acceptance checks (tolerances are starting targets; adjust once phase 0 measures real error):

- [ ] An applied curve reads back as the same (x1, y1, x2, y2) within 0.001 on 1D, multi-dimensional and spatial properties
- [ ] Sampled values match the analytic curve within 0.1% of the segment's value change
- [ ] Every user action is a single undo step
- [ ] Curve Repair restores the shape after a key is moved, with no user action
- [ ] Mirror X applied twice returns the original keys exactly
- [ ] Insert key leaves sampled values unchanged within tolerance
- [ ] Separating then rejoining a straight-path Position keeps the curve
- [ ] Works in AE 2024, 2025 and 2026 on Windows; macOS checked before any distribution

## Risks and open questions

The popup at the cursor and Curve Repair carry most of the risk; everything else is known territory for AE scripting.

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Popup at cursor | CEP has no known way to read the global cursor position or place a window there; QuickEase's method is unknown | Phase 0 spike; fall back to a floating panel plus hotkeys, or a small AEGP helper |
| Hotkey binding | Unconfirmed that AE 2024 to 2026 can bind a Scripts-folder .jsx in the Keyboard Shortcuts editor | Phase 0 spike |
| Curve Repair | Polling costs CPU, and its writes add undo steps between the user's own | Watch only touched properties, one undo group per repair, easy off switch |
| New CEP installs failing | One July 2026 report on macOS AE 25.6.5 to 26.3 | Test a fresh install first in phase 0 |
| AE's curve model | The handle formula and spatial arc length are assumed, not measured | Phase 0 sampling spike |
| ExtendScript speed | Large selections can stall AE | One read and one write per action, flat JSON, no per-key round trips |
| CEP end of life | CEP stops shipping after December 2029; AE's UXP is in beta | Pure-JS core and a single host adapter |
| Path properties | Mask and shape paths have no simple value change for v̄ | Out of scope for v1; skip them with a notice |

**Open questions for Dickon**

- In-house only, or distributed or sold? This decides signing, licensing, and how closely the feature set should track QuickEase.
- Which AE versions run on studio machines, and are any of them Macs?
- Is the cursor popup essential for v1, or is a compact docked panel with hotkeys fine to start?
- Any studio-standard curves to ship as built-in presets?
- A name, to replace the EaseKit placeholder and the bundle id.

## Kickoff prompt for Claude Code

Export this doc as Markdown, save it as `SPEC.md` in an empty repo, then paste the prompt below. It limits the first session to phase 0, so the spike results come back before any real build.

```
Read SPEC.md in full. You are building the After Effects easing extension it describes.

Work through the phases in "Build phases" in order, and stop at each gate for my review. Start with phase 0 only:
1. Scaffold the repo layout from the Architecture section.
2. Create a minimal CEP extension (host AEFT, version range covering AE 2024 to 2026, CSXS 11.0 minimum) with an ExtendScript round trip, plus install-dev.ps1 for Windows as described.
3. Run the three phase 0 spikes and write up the results in SPIKES.md before going further.

Rules:
- All easing maths lives in core/ as pure functions with Node tests. Host code only reads and writes AE data, through the adapter functions named in the spec.
- ExtendScript is ES3: include a JSON polyfill and avoid modern syntax in host/.
- One undo group per user action.
- Do not copy QuickEase's UI, text, icons or expressions. Design original ones.
- If AE behaves differently from the spec, stop and tell me. Do not work around it silently.
- UK English in all UI text.
```

## Sources

- [QuickEase product page](https://suky.design/plugins/quickease)
- [CEP to UXP: What Developers Need to Know (Adobe, Sept 2026)](https://forums.creativeclouddeveloper.com/t/cep-to-uxp-what-developers-need-to-know/12189)
- [UXP for Adobe After Effects](https://developer.adobe.com/after-effects/uxp/)
- [AE UXP API: KeyframeEase](https://developer.adobe.com/after-effects/uxp/after-effects-api/keyframeease)
- [ExtendScript KeyframeEase reference](https://after-effects-scripting-guide.readthedocs.io/other/keyframeease.html)
- [Bug report: new CEP extensions fail to load (July 2026)](https://community.adobe.com/bug-reports-528/in-recent-versions-of-after-effects-i-m-unable-to-install-or-sign-new-zxp-files-1632227)
