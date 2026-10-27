# Handover: run the phase 0 spikes in After Effects

**Update, 27 Oct 2026.** Phase 0 has run in AE 26.5 on Dickon's machine: a Claude session ran most of it, and Dickon did the hands-on checks. The results, three harness fixes and AE findings are in SPIKES.md. Dickon signed off phase 0 the same day. Phase 1 (core engine) is built and its round-trip tests pass in AE; see PHASE1.md. It waits for his sign-off. The rest of this file is the original handover, kept for reference; the risk table below is answered in SPIKES.md.

This is for a Claude Code session on Dickon's Windows 11 machine, where After Effects is installed. The previous session ran in a cloud container with no AE. It built phase 0 but could not run any of it in AE. Your job is to run the phase 0 spikes, record the results, and stop at the gate.

## Read first

1. `SPEC.md`: the full build spec. Phase 0 is described under "Build phases".
2. `SPIKES.md`: how to run each spike, the results tables to fill in, the decisions made so far, and Dickon's answers to the spec's open questions.
3. This file: what is already done, what is untested, and how to work.

Branch: `claude/artifact-session-4xlfh3`. Commit and push your results to the same branch.

## Where things stand

**Done and verified in the cloud session:**

- CEP bundle `com.afterease` (`CSXS/manifest.xml`). It has two extensions: the panel `com.afterease.panel`, and `com.afterease.popup`, a modeless window used only by spike 2.
- Host layer in ES3 ExtendScript (`host/`). Every panel call goes through `AfterEase.call(name, json)`, which returns `{ok, result | error}`. The five adapter functions from the spec are stubs for now.
- Easing maths in `core/` (bezier, AE ease conversion, spatial arc length).
- Spike harnesses, driven from buttons in the panel.
- `scripts/install-dev.ps1`.
- 15 Node tests pass (`npm test`). They cover the maths, the spike 3 analysis against fake hosts, an ES3 parse of every `.jsx` file, and the JSON polyfill.
- A headless browser test with a faked CEP ran the whole panel flow with no errors.

**Never run, so expect to debug these:**

| Item | Risk |
| --- | --- |
| Loading the extension in real AE | The manifest uses `ExtensionManifest Version="7.0"`. A July 2026 report says new CEP 12 installs fail with "Unsupported Manifest version" (seen on macOS; Windows unconfirmed). |
| `install-dev.ps1` | Never executed. |
| `client/lib/cursor.js`, Windows branch | A long-lived `powershell.exe` reading `System.Windows.Forms.Cursor.Position`. Never executed. |
| `host/spikes/popup.jsx` | A ScriptUI palette kept alive in `$.global`. It assumes CEP's evalScript runs in AE's persistent main engine. |
| `client/popup.js` | `window.moveTo` in a CEP modeless window. It may well do nothing; finding that out is part of the spike. |
| `host/spikes/easeModel.jsx` | Real AE calls. Scale needs 3 ease entries even on a 2D layer, and the plan already sends 3. Influence and negative speed may be clamped; that is a finding, not a bug. |
| CEP event data format | `client/lib/cep.js` accepts event data as either a JSON string or an object. Check the launcher events actually arrive. |

## Dickon's answers (already recorded in SPIKES.md)

- **In-house only.** No signing, no ZXP.
- **Latest AE on Windows 11 only.** That is the only setup to test.
- **Cursor popup: would be good, not essential.** A floating panel plus hotkeys is an acceptable fallback, so don't build the C++ helper.
- **No studio presets.**
- **Name:** not decided. Keep "AfterEase".

## Rules

These rules carry over from the spec's kickoff prompt:

- **Phase 0 only.** Do not start phase 1. Stop at the gate and report to Dickon.
- **If AE behaves differently from the spec, stop and tell Dickon.** Do not work around it silently. This matters most for spike 3: if the "model" error fails, the conversion formula in SPEC.md is wrong.
- Keep all easing maths in `core/`, as pure functions with Node tests. Host code only reads and writes AE data.
- `host/` and `launchers/` must stay ES3. `npm test` enforces this.
- One undo group per user action.
- Do not copy QuickEase's UI, text, icons or expressions.
- Use UK English in all UI text.
- Fixing a harness bug so a spike can run is fine. Keep each fix small, add or adjust a Node test where the fix touches pure JS, and note it in SPIKES.md under "Decisions made in phase 0".

## What needs Dickon and what you can do alone

| Step | Who | Notes |
| --- | --- | --- |
| `git checkout`, `npm install`, `npm test` | You | Needs Node 21 or later. |
| Run `install-dev.ps1` (plain copy, no `-Link`) | You | Writes to `%APPDATA%` and `HKCU`; no admin needed. |
| Turn on CEP logging | You | Set `LogLevel` (string) to `6` under `HKCU\Software\Adobe\CSXS.12`. Logs go to `%TEMP%\CEP12-AEFT*.log` and `%TEMP%\CEPHtmlEngine12-AEFT*.log`. |
| Restart AE, open Window > Extensions (Legacy) > AfterEase | Dickon, unless you can launch AE yourself | Find AE under `C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\AfterFX.exe`, or whatever the latest version folder is. |
| Copy `launchers/*.jsx` to AE's `Support Files\Scripts\` | Dickon | Needs admin. |
| Bind shortcuts in Edit > Keyboard Shortcuts, press them | Dickon | Spike 1. |
| Move the mouse and judge where the popup lands | Dickon | Spike 2. He records it with the Yes / Offset / Did not open buttons. Test at 100% and 150% display scaling. |
| Spike 3 | You, or Dickon presses **Run all rates** | See below. |
| Read the saved log and raw JSON, fill in SPIKES.md | You | Files go to `%USERPROFILE%\Documents\AfterEase spike reports\`. |

Give Dickon one short, numbered list of what to click. Don't spread instructions across several messages.

### Ways to drive AE yourself

These options are untested, so check them before relying on them:

- **Panel debugger.** While the panel is open, `.debug` exposes Chrome DevTools at `http://localhost:8088`, and the popup at port 8089. You may be able to attach with Playwright's `chromium.connectOverCDP` or another DevTools Protocol client, then click buttons and read `#log`. If that works, you can run spike 3 and the round trip without Dickon.
- **Running a script.** `AfterFX.exe -r <path to .jsx>` runs a script in AE. For spike 3 you could write a small Node runner. It would build the plan with `client/spikes/easeModelSpike.js`, write a `.jsx` that `$.evalFile`s `host/json2.jsx`, `host/adapter.jsx` and `host/spikes/easeModel.jsx`, call `AfterEase.functions.spikeEaseModel(plan)` and write the result to a file. The runner would then analyse it with `analyse()` and `formatReport()`. Writing files from ExtendScript needs **Edit > Preferences > Scripting & Expressions > Allow Scripts to Write Files and Access Network** turned on. If you build this runner, put it in `scripts/` and keep it.

## Order of work

1. Run `npm test`. All 15 tests should pass.
2. **Fresh install check.** Run `install-dev.ps1` without `-Link`, turn on logging, and ask Dickon to restart AE and open the panel. Success means the Connection box shows "OK" next to Round trip. If the panel is missing or blank, read the CEP logs before changing anything. If the cause is the manifest version, tell Dickon before trying fixes.
3. **Spike 3** (ease model). It is the most self-contained spike and answers the riskiest maths question. Run it at all four frame rates. If any case fails, work out whether the harness or AE is responsible. Report AE-side differences to Dickon and don't patch around them.
4. **Spike 1** (hotkey). Record whether the Scripts-folder scripts appear in the Keyboard Shortcuts editor. If they don't, check the shortcuts text file for `ExecuteScriptMenuItemNN` entries. That entry name comes from memory, so verify it.
5. **Spike 2** (popup at cursor). Try the ScriptUI route first, because it is the one most likely to work. Record cursor read times, placement accuracy at 100% and 150% scaling, keyboard focus, and Esc behaviour.
6. Fill in every results table in SPIKES.md. Add a short **Verdict** at the top of each spike: what works, what doesn't, and what phase 6 should build.
7. Run `npm test` again, then commit and push.
8. Report to Dickon. Say whether the gate passed (the panel loads on a fresh install, and the spike results are in), with a few lines per spike and any questions. Then stop.

## Quick reference

| Thing | Where |
| --- | --- |
| Installed extension | `%APPDATA%\Adobe\CEP\extensions\com.afterease` |
| Debug mode | `HKCU\Software\Adobe\CSXS.11` and `CSXS.12`: `PlayerDebugMode` = `"1"` |
| Panel debugger | `http://localhost:8088` (popup: 8089) |
| Saved spike logs | `%USERPROFILE%\Documents\AfterEase spike reports\` |
| CSXS event types | `com.afterease.launcher`, `com.afterease.popup.ready`, `com.afterease.popup.place`, `com.afterease.popup.report` |
| Host functions | `ping`, `spikeEaseModel`, `spikeScriptUIPopup` (plus stubs for the five adapter functions) |
| Spike 3 tolerance | 0.1% of segment change; 0.001 on read-back curves (`client/spikes/easeModelSpike.js`) |
