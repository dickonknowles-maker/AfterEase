# Phase 1: core engine

**Status (27 Oct 2026): built, and the gate's round-trip tests pass in AE 26.5 on Dickon's machine at 23.976, 25, 29.97 and 50 fps: 24 of 24 checks at each rate.** The report is `tests/ae/phase1/roundtrip-2026-10-27T10-28-43.txt`. One item needs Dickon's OK: colour properties work differently from SPEC.md (see "Needs your OK").

There is no new panel UI yet; that is phase 2. Phase 1 is the engine the UI will call: read the selected keys, work out the eases for a curve, write them in one undo step, and check what AE stored.

## What was built

| Part | Where | What it does |
| --- | --- | --- |
| Segment maths | `core/segment.js` | Per kind of property: how much the value changes across a segment, the value AE plays at any time, and the curve read back from stored eases |
| Apply planner | `core/apply.js` | Turns a selection and a curve into the eases to write; reports holds, roving keys, clamping, clipping and expressions; checks what AE stored against the plan |
| Host adapter | `host/adapter.jsx` | `readSelection` and `writeKeys` from SPEC.md, plus finding a property again by comp, layer id and property path |
| KeySnapshot | `host/keySnapshot.jsx` | Captures every attribute of a key and restores it after the key has been removed and added again |
| Fixture | `tests/ae/fixture.jsx` | One comp per frame rate with 22 keyed properties covering SPEC.md's fixture list |
| Round-trip runner | `tests/ae/roundtrip.mjs`, `tests/ae/check.js` | Drives AE through the panel, applies curves through the real `readSelection` and `writeKeys`, and checks the results |

Node tests: 30 pass (`npm test`), up from 17. The new ones cover the planner, the segment maths and the round-trip checks themselves.

To run the AE tests: `node scripts/ae.mjs start`, then `node tests/ae/roundtrip.mjs`, then `node scripts/ae.mjs quit`. The runner loads `host/` from the repo, not the installed extension.

## Results

Every check passed at every rate. The worst errors across all four rates:

| Kind | Example | Sampled vs model | Sampled vs curve asked for | Curve read back |
| --- | --- | --- | --- | --- |
| 1D | Opacity, Rotation, X Position, Time Remap | 0.0119% | 0.0119% | 6.7e-16 |
| Multi-dimensional | Scale | 0.0055% | 0.0055% | 5.6e-16 |
| Spatial | 2D and 3D Position | 0.0067% | 0.0067% | 6.1e-16 |
| Colour | Fill colour | 0.0055% | 0.0055% | 4.4e-16 |

The targets are 0.1% for samples and 0.001 for read-back. Segments that weren't written stayed exactly as they were (0.0000%), apart from the one case in decision 5 below.

The other checks, each at all four rates:

- **Reading a selection** across three layers returns exactly those properties and keys.
- **One undo step** restores every key attribute and every sample after an apply.
- **KeySnapshot**: each of 69 keys on 22 properties was removed and restored, with every attribute and sample back as before. Two documented AE limits apply (see findings).

SPEC.md's acceptance checks this covers:

- [x] An applied curve reads back as the same (x1, y1, x2, y2) within 0.001 on 1D, multi-dimensional and spatial properties
- [x] Sampled values match the analytic curve within 0.1% of the segment's change
- [x] Every user action is a single undo step (for applying a curve, the only action so far)

## Needs your OK: colour

SPEC.md says multi-dimensional properties including colour get "v̄ per dimension; every dimension gets the same normalised curve". AE 26.5 doesn't work that way for colour:

- A colour takes exactly **one** ease, not one per channel. AE refuses four: "Value array does not have 1 elements".
- Its speed is in 0–255 units per second along the straight line between the two colours, alpha included. Measured: a 1-second change from [1, 0, 0, 1] to [0, 0.5, 1, 1] is 382.5 (= 255 × 1.5), and an HDR change to [3, 4, 0] reads correctly too.

So `core/` treats colour as its own kind: one ease, value change = 255 × the RGBA distance, with no overshoot (like a path). It passes the same checks as every other kind. Nothing else in SPEC.md changes. If you're happy with this, I'll correct the line in SPEC.md; if not, colour can be left out of v1.

## Decisions made in phase 1

Behaviour choices beyond the spec. Each is easy to change.

1. **Which keys a curve goes to.** A run of selected keys gets the curve on every pair in it. A selected key with no selected neighbour gets its own sides of the segments either side, so selecting one key and applying "ease in-out" eases into and out of it. "In only" and "out only" keep only those sides.
2. **Held segments and roving keys are left alone**, with a notice. Applying a curve doesn't turn a hold into an ease.
3. **Sides that aren't written keep their type.** Writing an ease makes AE turn both sides of a key Bezier, so the host puts a Linear or Hold side back afterwards. Applying to keys 2 and 3 leaves the segments either side exactly as they were.
4. **Paths and colours can't overshoot.** Their speed is a magnitude along the path, so a curve that goes below 0 or above 1 is clipped at its ends, with a notice. 1D and multi-dimensional properties overshoot normally.
5. **Influence 0 becomes 0.1.** A Bezier side at influence 0 (what AE leaves when a script turns a Linear key Bezier) can't be written back, because 0.1 is AE's minimum. When such a side sits on a key being written, it goes to 0.1. That moved its segment by 0.044% in the fixture, within tolerance.
6. **Continuous and auto-bezier.** A written key stays temporally continuous only if its in and out speeds still match; otherwise AE would force them equal. Auto-bezier is turned off on written keys, or AE would recalculate the eases.
7. **The AE tests run from Node, not as a .jsx runner.** SPEC.md describes an in-AE `.jsx` runner. All the maths lives in `core/` as modern JavaScript, so the runner drives AE through the panel's DevTools port instead (`scripts/ae.mjs`), the same way spike 3 worked. AE still does all the reading, writing and sampling.

## AE findings

New behaviour found in phase 1, all handled in the code:

- **Key times aren't snapped to frames.** AE rounds key times to 1/1024 of a frame: 0.5123 s became 0.5123046875 s at 25 fps. This settles the open question from phase 0.
- **Removing or adding a key changes the keys either side of it.** AE rescales their influences and spatial tangents, and can turn a Linear side Bezier. KeySnapshot therefore captures every key and reapplies the others after a remove and re-add. Phase 5's moves (Mirror X, Align, Snap frames) depend on this.
- **Writing an ease turns both sides of a key Bezier** (decision 3).
- **AE says a colour property is spatial** (`isSpatial` is true) but it has no spatial tangents. The host decides from the value type instead.
- **Layer indices move** as layers are added, so properties are found again by layer id.
- **Time Remap.** Values written by script are rounded to 1/4096 s, while AE's own end key can hold the exact layer duration. Removing every Time Remap key switches Time Remap off.
- **Influence 0 can't be restored** on a re-added key (decision 5). Several ways of getting AE back to 0 were tried; none worked.
- **Undo can be triggered by command 16** (Edit > Undo) from a script, which is how the one-undo-step check works.

## Not in phase 1

- The panel UI, presets and read-from-selection: phase 2.
- `moveKeys`, `applyExpression` and `setLayerTimes` are still stubs; their tools come in phase 5. KeySnapshot, which `moveKeys` will use, is done and tested.
- Mask and shape paths, text and markers are reported as "can't be eased" and left alone, as SPEC.md says for v1.
