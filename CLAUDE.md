# Mini Keep

Opens Google Keep in a resizable popup window, and remembers where you put it.

Autonomy: **full** — implementation may auto-merge once CI is green.

## Architecture

One file. `background.js` is a classic (non-module) MV3 service worker that
registers every listener at top level.

| Function | Responsibility |
|---|---|
| `openKeep()` | Focus the tracked window, else find an existing Keep window, else create one |
| `findExistingKeepWindow()` | Scans all windows for a tab whose URL contains `mini_keep=1` |
| `focusWindowById()` | Restores a minimized window before focusing it |
| `getSafePopupBounds()` | Clamps remembered bounds to the primary display's work area |
| `scheduleStoreBounds()` | Debounces bounds writes to `storage.sync` by 500 ms |

State lives in three module-scope variables: `keepWindowId`, `storeTimer`,
`currentBounds`.

## Invariants

- **Exactly one Keep popup.** Clicking the action twice focuses, never duplicates.
- **The popup can never open off-screen.** `getSafePopupBounds` is the only thing
  standing between a remembered position and a window the user cannot reach.
  Both recent bug fixes were here; treat it as the highest-risk function.
- **Bounds writes stay debounced.** Dragging a window fires many events; one
  write per gesture, not per pixel.

## Testing

`background.js` is loaded **unmodified** by `tests/helpers/sw-harness.mjs`, which
runs it in a `vm` context with a mocked `chrome` and reads its top-level
functions off the context.

This is deliberate. Converting the file to an ES module to make it importable
would mean a `manifest.json` change and therefore a store release, for no user
benefit. Do not convert it. If you need a `const` that the harness cannot reach,
add it to the `expose` list in `tests/helpers/load.js`.

Install fake timers **before** calling `loadBackground()` — the harness hands the
vm its timers and `Date` at load time.

## Known issues

- `closeKeep()` is dead code; nothing calls it. Leave it unless an issue says otherwise.

## Autonomous agent contract

You are running unattended in GitHub Actions against an approved issue. Nobody
is watching this run. Everything below is enforced by CI as well as stated here,
so working around a rule fails the build rather than shipping.

### Prime directive

Preserve existing behaviour. Change only what the approved issue asks for.

If the issue is ambiguous, or you find that doing it properly requires a
decision that is not yours to make, stop and say so in `.ai/result.json` with
`"status": "blocked"`. A blocked run that explains itself is a good outcome. A
run that guesses and ships is not.

### Hard boundaries

Each of these fails CI, so there is no version of the task that goes better by
crossing one:

- **Never edit `.github/**` or `project.yml`.** Workflows carry the deployment
  credentials' blast radius; `project.yml` holds the permission baseline. The CI
  guard rejects any `ai/*` branch that touches them.
- **Never add a permission or host permission** to `manifest.json`, or an OAuth
  scope to `appsscript.json`, unless the issue body contains the exact line
  `PERMISSION CHANGE APPROVED`. The permission gate diffs every PR against
  `project.yml` and fails on growth.
- **Never edit `.eslint-baseline.json` or `.manifest-baseline.json`.** Those
  record known problems so they cannot grow. Widening one hides a real defect
  instead of fixing it.
- **Never delete or weaken a test to make a build pass.** If a test is genuinely
  wrong, fix the test and explain why in your summary. If you cannot tell
  whether the test or the code is wrong, you are blocked.
- **Never rewrite a file wholesale** when a targeted edit would do.
- **Never commit a credential**, and never write one into a test fixture.

### How to work

1. Read `CLAUDE.md`, `project.yml`, and the issue. Read the files you intend to
   change before changing them.
2. Make the smallest change that fully does what the issue asks.
3. Add or update tests that would have caught the bug, or that pin the new
   behaviour. A fix with no test is not finished.
4. Run `npm run check` (lint, manifest, permission gate, unit tests). Then run
   `npm run e2e` if the change touches anything a browser exercises.
5. When something fails, read the actual error before changing anything. Fix the
   cause. Re-run. Repeat until green or until you are genuinely stuck.
6. Write `.ai/result.json` as the last thing you do.

### Definition of done

`npm run check` passes, and `npm run e2e` passes if you ran it. Not "should
pass" — you have seen it pass.

### Output contract

Write `.ai/result.json` before you finish. The workflow reads this file, not
your prose, so it must be valid JSON and it must be honest. Claiming success
that CI then contradicts is the worst outcome available to you; `blocked` is
always better.

```json
{
  "status": "success",
  "summary": "one or two sentences, in plain past tense",
  "files_changed": ["path/one.js"],
  "tests_added": 3,
  "version_bump": "patch",
  "bump_rationale": "why patch rather than minor or major",
  "permission_changes": [],
  "blocked_reason": null,
  "checks_run": ["npm run check", "npm run e2e"]
}
```

- `status`: `"success"` or `"blocked"`
- `version_bump`: `"patch"` bug fix · `"minor"` backward-compatible feature ·
  `"major"` breaking change · `"none"` no user-visible change.
  Chrome versions are 1–4 dotted integers: `1.2.3-beta` is not a legal version.
- `permission_changes`: every permission or scope added, `[]` if none
- `blocked_reason`: required when blocked — what you needed and could not decide

### Repository conventions

- Node 22+, ES modules in test code.
- Test helpers under `tests/helpers/` are **synced from `ext-automation/tools/`**.
  Do not edit them here; a change would be overwritten on the next sync. If one
  is wrong, say so in your summary.
- Unit tests are Vitest under `tests/unit/`. E2E is Playwright under `tests/e2e/`
  and loads the packed extension into real Chromium.
- Extension source is plain, unbundled MV3. There is no build step and adding
  one is out of scope unless the issue says otherwise.
