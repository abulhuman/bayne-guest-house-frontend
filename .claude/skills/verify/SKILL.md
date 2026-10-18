---
name: verify
description: Launch the Almis Hotel admin frontend (Next.js Pages Router) against the real NestJS backend and a throwaway Postgres, then drive it in headless Chromium from JSON specs that print one fixed-format line per step. Use to prove a UI change works (login, roles and nav, bookings, guests, rooms, page layout) before calling it done, to reproduce a UI bug, or to rerun the UI health suite.
---

# Verify the Almis Hotel frontend

The surface is a browser admin app. One script does everything. Each subcommand prints fixed-format lines and exits `0` on success and `1` on failure. Branch on the exit code and the first word of each line, never on prose or screenshots.

```bash
S=.claude/skills/verify/scripts/control.sh   # run from the repo root
```

## Launch

```bash
$S up
```

`up` installs `node_modules` if `next` is missing and puts `playwright-core` in `.verify/tools/`. It then starts the backend through the backend repo's own verify skill, with CORS opened for the web origin. The backend id is `fe-$VERIFY_ID`, or `frontend` when `VERIFY_ID` is unset, so no frontend run shares a backend with another frontend run or with a standalone backend run. Last, it starts `next dev --turbopack` on `127.0.0.1` with `NEXT_PUBLIC_API_BASE` pointed at that backend, the one variable `utils/axiosInstance.ts` reads. The first run takes about 20 seconds, and later runs reuse the backend build. The backend build writes one shared `dist/`, so `up` takes a lock in `$BACKEND_DIR/.verify/` around the backend start. Concurrent `up`s from other worktrees wait their turn, up to `VERIFY_LOCK_WAIT` seconds (default 900).

| First line | Meaning | Do this |
| --- | --- | --- |
| `READY web=<url> api=<url> rev=<sha> evidence=<dir>` | Up and checked. | Drive. Use no other URL. |
| `FAIL backend-missing want=<path>` | The backend repo isn't next to this one. | Set `BACKEND_DIR=<path to bayne-guest-house-backend>` and rerun `up`. |
| `FAIL web-busy pids=<pids>` | Another `next dev` runs in this checkout and shares `.next`. | Stop it if you started it. Otherwise ask the user. Never kill it by name. |
| `FAIL backend-up lock-timeout lock=<path>` | Another `up` held the backend lock longer than `VERIFY_LOCK_WAIT` seconds. | Check what holds it with `fuser <path>`, then rerun `up`. |
| `FAIL backend-up <line>` | The backend skill failed. | Read the step and log named in `<line>`. |
| `FAIL bad-verify-id …` | `VERIFY_ID` has a character outside `A-Za-z0-9_-`. | Pick an id such as `owner-ux-1`. |
| `FAIL cors …` | The reused backend allows a different origin. | `$S down && $S up` |
| `FAIL npm-ci`, `install-playwright`, `web-exited`, `web-timeout`, `no-chromium` | A local setup step failed. | Read the `log=` file it names, or set `CHROMIUM=<binary>`. |

`up` is idempotent. A healthy instance prints `READY` again. The web port is kept in `.verify/web-port` so the backend's CORS origin stays valid across restarts. Give each worktree its own `VERIFY_ID`, such as `VERIFY_ID=owner-ux-1`, so instances in separate worktrees get separate backends, databases and ports. Every subcommand reads it, so export it once per shell. A set id keys the state as `.verify/run-$VERIFY_ID/` and `.verify/web-port-$VERIFY_ID`. Unset, the paths stay `.verify/run/` and `.verify/web-port`. `next dev` hot-reloads, so code edits need no restart. Only one web instance can run per checkout, because `.next` can't be shared.

## Doctor

```bash
$S doctor
```

It's read-only. It prints `OK|FAIL` for `web-pid`, `web-port-owner` (the listener belongs to our process group), `web-login`, `backend` (the backend's own doctor), `cors` and `browser`. Then it prints an `OK rev` line and `DOCTOR PASS web=… api=…` or `DOCTOR FAIL`. Run it first whenever anything looks off. On `DOCTOR FAIL`, run `$S down && $S up`.

## Drive

```bash
$S suite                      # every spec in specs/, one SPEC line each, then SUITE pass= fail= xfail= xpass=
$S suite 'bookings-*'         # a glob over spec names
$S drive bookings-create      # one spec by name, by path, or as inline JSON
$S api call --expect 200 reception GET /bookings   # passthrough to the backend skill: call, last, sql, token
```

A spec is a JSON file in [`specs/`](specs/). Copy the closest one and change it. Don't write ad-hoc Playwright.

```json
{
  "name": "rooms-edit-price",
  "role": "manager",
  "viewport": "desktop",
  "knownBug": "optional; present only while the defect is unfixed",
  "failApi": ["GET /bookings"],
  "setup": [{ "as": "manager", "method": "POST", "path": "/rooms", "body": {"number": "E${RUN}", "type": "single", "price": 900}, "expect": 201, "save": "ROOM" }],
  "steps": [{ "goto": "/rooms" }, { "click": "tr:has-text('E${RUN}') >> role=button[name='Edit']" }]
}
```

- **`role`** is any backend role, or `anon`. The driver gets the role's JWT from the backend skill and puts it in `localStorage.token` before the first page loads, so the app starts signed in. Only `login-*` specs go through the real login form.
- **`viewport`** is `desktop` (1280x800), `tablet` (768x1024) or `phone` (390x844).
- **`setup`** creates data through the real API before the browser opens. Each entry runs `api call --expect`. `save` stores `api last .id`, or the `pick` jq path, in a variable.
- **Variables.** `${RUN}` is unique per drive, so names never collide across reruns. `${DATE+N}` is today plus N days as `yyyy-mm-dd`. `${NAME}` is a saved setup value or an environment variable. A string that is exactly one placeholder, such as `"guestId": "${GUEST}"`, takes the saved value's JSON type, so a numeric id goes out as a number. A placeholder inside other text, such as `"G${GUEST}"`, gives a string, and so do `${RUN}`, `${DATE+N}` and environment variables. `fill`, `select` and `expectValue` turn their `value` back into a string.
- **`failApi`** answers matching browser requests with HTTP 500. Each entry is a method and a path prefix. Use it only to verify error states. Every other request reaches the real backend.
- **Targets.** A string is a Playwright selector. An object is `{"label": "Full name"}`, `{"role": "button", "name": "Add Room"}`, `{"placeholder": "Number"}` or `{"text": "…"}`, all exact matches. Object targets search inside the open modal first, so a page button and a modal button with the same name resolve correctly. `label` works with or without `htmlFor`.
- **Steps.** `goto`, `click` (add `"at": [x, y]` to click at that offset inside the target, for a backdrop partly covered by a panel), `fill` + `value`, `upload` + `value` (a file path set on an `<input type=file>`, hidden or not), `select` + `value` (option value or label), `press`, `wait`, `screenshot`. `failApi` and `unfailApi` take a list like the spec-level `failApi` and add or remove failing routes from that step on, so a spec can fail a load, lift the failure, and prove the retry. Assertions are `expectText`, `expectNoText`, `expectVisible`, `expectHidden`, `expectValue` + `value`, `expectUrl` (exact pathname), `expectTitle`, `expectApi` (`"POST /bookings 201"`, query ignored), `expectNoApi` (fails if any request matches the method and path prefix, the way `failApi` matches, so `"PATCH /rooms"` catches `PATCH /rooms/12`; it first waits until no request has been in flight for 500ms, up to 5 seconds), `expectNoVisit` (the tab never showed that pathname, even for a moment before a redirect), `expectRequest` (some browser request URL contains the string, query included), `expectNoRequest` (no browser request URL contains the string), `expectNoPageErrors`, `expectFits` (no horizontal page scroll, and every visible control outside a table lies inside the viewport), and `apiCheck` (`{"as", "path", "jq", "expect"}`, an independent backend read).

Output of `drive`, one line each:

| Line | Meaning |
| --- | --- |
| `SETUP NN OK …` / `SETUP FAIL …` | A setup call and its result. A failed setup stops before the browser opens. |
| `STEP NN OK …` / `STEP NN FAIL … :: <reason>` | Each step. The first failure stops the run. |
| `API <METHOD> <path> <status>` | Every request the page sent to the backend, in the order sent. `pending` means no response came before the drive ended. |
| `BYTES <n> requests=<m>` | Total response bytes (headers and body) across every browser request. `result.json` lists each under `requests`. |
| `PAGEERRORS <n>` | Uncaught exceptions on the page. |
| `EVIDENCE <dir>` | Screenshots and `result.json` for this drive. |
| `RESULT PASS` (exit 0) | Every step held. |
| `RESULT FAIL` (exit 1) | A step or setup failed. Read the `FAIL` line. |
| `RESULT XFAIL` (exit 0) | A `knownBug` spec still fails. The defect is unfixed, as expected. A `KNOWN_BUG` line names it. |
| `RESULT XPASS` (exit 1) | A `knownBug` spec passed. Do what the `NEXT` line says: delete `knownBug` so the spec guards the fix. |

When you fix a defect that has a `knownBug` spec, the fix is proven only when that spec reports `XPASS` and then `PASS` once `knownBug` is removed. When you change a flow, run its feature's specs. Before you call UI work done, run `$S suite` and require `fail=0 xpass=0`.

The [feature map](features/README.md) lists every spec by feature and the paths no spec covers yet. Start there.

## Evidence

Each drive writes `.verify/evidence/<up-timestamp>/<NNN>-<spec>/`. It holds `final.png` or `failure.png`, any named screenshots, and `result.json`. That file records the spec, role, every step, every API request with status and request body, console errors, page errors and the result. `setup` and `apiCheck` calls also land in the backend's evidence directory. `down` copies `web.log` next to them. `.verify/` is gitignored.

A proof needs all of these.

- The user path in the browser, as the role that would use it. Never create the thing under test in `setup`. Setup is only for preconditions.
- The action's request (`expectApi`) plus an independent read of the result (`apiCheck`, or text that only the saved data can produce).
- A `failApi` spec when the change touches loading or error states, and a disallowed `role` when it touches role gates.
- The `EVIDENCE` paths cited in your report.

## Demos

```bash
$S down && $S up              # demos use fixed room numbers, so record on a fresh database
$S demo                       # every spec in demos/, one DEMO PASS|FAIL line each, then DEMOS pass= fail= index=
$S demo 'store-*'             # a glob over demo names
```

A demo is a spec in [`demos/`](demos/) captured through Chromium CDP at device scale 2 and encoded with libx264 CRF 20. The default output width is 1920. A separate caption band below the recorded viewport keeps captions readable during whole-dialog zoom without hiding table rows. Set `DEMO_WIDTH` to an even output width of at least 320, or `DEMO_NO_ZOOM=1` for the capture-and-pacing performance baseline. `DEMO_DIR` selects the output directory, including one on another filesystem. Recording needs `ffmpeg` with libx264, zoompan and drawtext, Python 3, Fontconfig (`fc-match`) and a sans font.

`demo` exports `DEMO_NAMES=1` before it starts or checks the stack. The backend must include the demo-name seed mode. If the current stack uses verification names, the command restarts it with a fresh database. For a clean recording set, export `DEMO_NAMES=1` before `up` and keep it set for later commands. All demo employee and guest display names, setup data, captions and matching assertions use common Somali Muslim names. Seeded login credentials stay unchanged.

```bash
export DEMO_NAMES=1
$S down && $S up
$S doctor
$S demo 'reception-*'
```

Each successful demo writes `<name>.mp4`, `<name>.jpg`, `<name>.src.mkv` and `<name>.events.json`. The source and event log are kept for independent rendering and performance comparisons. The source holds only the frames the screencast sent, at their real timestamps, and `demo-render.py` resamples it to 30 fps. `scripts/demo-render.py` owns whole-dialog framing and the caption band. Dialog changes are observed while actions run, so close events start a short zoom-out immediately rather than waiting for a later step. The camera fits the whole dialog with padding and never follows individual fields. The gallery groups videos by `demo.group`.

Give a demo a `demo` block, `{"group": "reception", "title": "Create a booking", "summary": "One plain sentence."}`. Its first step must be `goto`. The driver loads that page before capture and paints the title card over it, then fades the card away. A sign-in demo can use `demo.as` to name the role it signs in as. The arrow is visible in the first frame and glides to clicks, offset clicks, inputs, selects, uploads and focused keyboard targets. Text uses 70 ms per key. Date fields receive their value after the cursor reaches them.

A `caption` step holds its text for a short reading interval and clears it when the step ends. Outside recordings it does nothing. Put `{"poster": true}` at the page or dialog to use for the poster; otherwise the driver uses the final action state. Tours mark a page before logout so their posters never show the login form. While recording, an action waits for network idle or for 500 ms with no backend request in flight, whichever comes first. After an iframe such as the ID card PDF preview, Playwright can leave network idle unset for its whole 5 s timeout, and the video would hold one frame for that long. Assertions run with capture paused, and independent `apiCheck` reads run after capture. They still gate `DEMO PASS`. A second tab or popup fails the demo because capture follows one page.

The event log records the viewport, device scale, frame count, duration and timestamped events. Each step has `t`, `type`, `box` and `caption`, with the verb and header text where relevant. `dialog` events hold the whole visible dialog box or `null` on close; `glide` events hold their action target and destination. Use these events with the retained source for later renderers.

## Tutorial metadata and affected demos

```bash
$S manifest [dir]                # default .verify/demos; prints MANIFEST <n> tutorials <n> roles
$S affected <base> <head>         # sorted demo names, one per line; empty output means no recording
$S demo-index [dir]              # rebuild index.html from manifest.json
```

Run these commands on Node 24 or newer. `demo` generates the manifest and gallery after rendering. The manifest records actual ffprobe duration, SHA256, capture-file modification time, and the current commit. Set `SOURCE_COMMIT` to the recording commit when generating metadata later. Unchanged media keeps its original recording metadata. Video and poster names contain their own content hashes. The manifest is sorted and replaced atomically after all referenced files exist. Partial runs retain existing entries with verified media hashes.

Audiences come from `lib/permissions.ts`. The generator considers direct navigation, asserted destinations after link clicks, and the actor's landing page for `/`. Sign-in group demos serve every role. Other primary roles must be able to open every demonstrated page. `demo.audience` can narrow this list for action permissions, such as room edits restricted to admin and manager. Invalid overrides fail and name the spec. Page access alone does not authorize mutations.

The affected map follows alias and relative imports through components and libraries to pages. Shell, permission, recording-script, and dependency edits affect every demo. Demo edits affect that demo. Optional `demo.covers` path globs add dependencies missed by the import walk. Tours are affected when a page they demonstrate changes.

## Cleanup

```bash
$S down
```

It kills only the process group recorded at `up`, after checking that its cwd is this repo and its cmdline is `next dev`. It runs the backend skill's `down`, which stops Postgres and deletes the database, then removes the run directory and prints `DOWN ok evidence=<dir>`. Evidence survives. It's safe to run when nothing is up and prints `DOWN nothing-running`. Run it at the end of every session, including after a failed `up`.

## Helpers

- `scripts/control.sh` is the entry point. It needs `node`, `npm`, `curl`, `ss`, `pgrep`, a Chromium binary and the backend repo.
- `scripts/drive.mjs` runs one spec. `control.sh drive`, `suite` and `demo` call it with the instance's environment. Don't call it directly.
- `scripts/demo-index.mjs` writes the demo gallery. `control.sh demo` calls it.
