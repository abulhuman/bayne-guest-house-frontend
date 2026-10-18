#!/usr/bin/env bash
# Every subcommand prints fixed-format lines and exits 0 on success, 1 on failure.
set -uo pipefail

ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
SELF="$ROOT/.claude/skills/verify/scripts/control.sh"
SPECS="$ROOT/.claude/skills/verify/specs"
DEMOS="$ROOT/.claude/skills/verify/demos"
DEMO_DIR="${DEMO_DIR:-$ROOT/.verify/demos}"
BACKEND_DIR="${BACKEND_DIR:-$(cd "$ROOT/.." && pwd)/bayne-guest-house-backend}"
BACKEND_CTL="$BACKEND_DIR/.claude/skills/verify/scripts/control.sh"
VERIFY_ID="${VERIFY_ID:-}"
RUN_DIR="$ROOT/.verify/run${VERIFY_ID:+-$VERIFY_ID}"
STATE="$RUN_DIR/state.env"
EVIDENCE_ROOT="$ROOT/.verify/evidence"
TOOLS="$ROOT/.verify/tools"
PORT_FILE="$ROOT/.verify/web-port${VERIFY_ID:+-$VERIFY_ID}"
BACKEND_BUILD_LOCK="$BACKEND_DIR/.verify/build.lock"
VERIFY_LOCK_WAIT="${VERIFY_LOCK_WAIT:-900}"
LOCK_TIMEOUT=75

die() { echo "FAIL $*"; exit 1; }
[[ -z "$VERIFY_ID" || "$VERIFY_ID" =~ ^[A-Za-z0-9_-]+$ ]] || die "bad-verify-id want=[A-Za-z0-9_-]+ got=$VERIFY_ID"
BACKEND_ID="${VERIFY_ID:+fe-$VERIFY_ID}"
BACKEND_ID="${BACKEND_ID:-frontend}"
backend() { VERIFY_ID="$BACKEND_ID" "$BACKEND_CTL" "$@"; }

load_state() {
  [[ -f "$STATE" ]] || die "no-instance run 'control.sh up' first (VERIFY_ID=${VERIFY_ID:-unset})"
  source "$STATE"
}

free_port() { node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})'; }
port_free() { ! ss -ltnH "sport = :$1" | grep -q .; }

web_alive() {
  [[ -n "${WEB_PID:-}" ]] && kill -0 "$WEB_PID" 2>/dev/null &&
    [[ "$(readlink "/proc/$WEB_PID/cwd")" == "$ROOT" ]] &&
    tr '\0' ' ' <"/proc/$WEB_PID/cmdline" 2>/dev/null | grep -q "next dev"
}

foreign_next() {
  local p
  for p in $(pgrep -f "next dev|next-server" || true); do
    [[ "$p" == "${WEB_PID:-}" ]] && continue
    [[ -n "${WEB_PID:-}" && "$(ps -o pgid= -p "$p" | tr -d ' ')" == "$WEB_PID" ]] && continue
    [[ "$(cat "/proc/$p/comm" 2>/dev/null)" =~ ^(node|next-server) ]] || continue
    [[ "$(readlink "/proc/$p/cwd" 2>/dev/null)" == "$ROOT" ]] && echo "$p"
  done
}

chromium_path() {
  local c
  for c in "${CHROMIUM:-}" /usr/bin/chromium /usr/bin/chromium-browser /usr/bin/google-chrome \
    "$HOME"/.cache/ms-playwright/chromium-*/chrome-linux*/chrome; do
    [[ -n "$c" && -x "$c" ]] && { echo "$c"; return 0; }
  done
  return 1
}

cors_ok() {
  local got
  got="$(curl -s -o /dev/null -D - -X OPTIONS "$API_URL/auth/me" -H "Origin: $WEB_URL" \
    -H 'Access-Control-Request-Method: GET' -H 'Access-Control-Request-Headers: authorization' |
    tr -d '\r' | awk -F': ' 'tolower($1)=="access-control-allow-origin"{print $2}')"
  [[ "$got" == "$WEB_URL" ]]
}

cmd_up() {
  if [[ -f "$STATE" ]]; then
    if cmd_doctor >/dev/null && backend doctor | grep "^OK names=$([[ ${DEMO_NAMES:-0} == 1 ]] && echo demo || echo verify)$" >/dev/null; then load_state; echo "READY web=$WEB_URL api=$API_URL rev=$GIT_REV evidence=$EVIDENCE_DIR"; return 0; fi
    cmd_down >/dev/null
  fi
  [[ -x "$BACKEND_CTL" ]] || die "backend-missing want=$BACKEND_CTL (set BACKEND_DIR)"
  local busy; busy="$(foreign_next | tr '\n' ' ')"
  [[ -z "$busy" ]] || die "web-busy pids=${busy% } another next dev runs in this checkout and shares .next; stop it first"

  local evidence="$EVIDENCE_ROOT/$(date -u +%Y%m%dT%H%M%SZ)"
  mkdir -p "$RUN_DIR" "$evidence" "$TOOLS"
  local log="$RUN_DIR/up.log"; : >"$log"

  [[ -d "$ROOT/node_modules/next" ]] || (cd "$ROOT" && npm ci --no-audit --no-fund >>"$log" 2>&1) || die "npm-ci log=$log"
  [[ -d "$TOOLS/node_modules/playwright-core" ]] ||
    npm install --prefix "$TOOLS" --no-audit --no-fund playwright-core@1.58 >>"$log" 2>&1 || die "install-playwright log=$log"
  local chrome; chrome="$(chromium_path)" || die "no-chromium set CHROMIUM=<path to chrome binary>"

  local port=""
  [[ -s "$PORT_FILE" ]] && port_free "$(cat "$PORT_FILE")" && port="$(cat "$PORT_FILE")"
  [[ -n "$port" ]] || { port="$(free_port)"; echo "$port" >"$PORT_FILE"; }
  local web="http://127.0.0.1:$port"

  local line
  mkdir -p "${BACKEND_BUILD_LOCK%/*}"
  # -o keeps the lock off the backend server that up leaves running.
  line="$(ALLOWED_ORIGINS="[\"$web\"]" VERIFY_ID="$BACKEND_ID" flock -o -E "$LOCK_TIMEOUT" -w "$VERIFY_LOCK_WAIT" "$BACKEND_BUILD_LOCK" "$BACKEND_CTL" up | tail -1)"
  (( $? == LOCK_TIMEOUT )) && die "backend-up lock-timeout lock=$BACKEND_BUILD_LOCK"
  [[ "$line" == READY* ]] || die "backend-up $line"
  local api; api="$(sed -E 's/.*base=([^ ]+).*/\1/' <<<"$line")"

  (cd "$ROOT" && exec setsid env NEXT_PUBLIC_API_BASE="$api" NEXT_TELEMETRY_DISABLED=1 \
    nohup node_modules/.bin/next dev --turbopack -p "$port" -H 127.0.0.1 >"$RUN_DIR/web.log" 2>&1) &
  local pid=$!
  cat >"$STATE" <<STATE_EOF
EVIDENCE_DIR=$evidence
WEB_PID=$pid
WEB_PORT=$port
WEB_URL=$web
API_URL=$api
CHROME=$chrome
GIT_REV=$(git -C "$ROOT" rev-parse --short HEAD)$(git -C "$ROOT" diff --quiet HEAD -- pages components context utils styles || echo -dirty)
STATE_EOF
  load_state

  local i
  for i in $(seq 120); do
    [[ "$(curl -s -o /dev/null -w '%{http_code}' -m 60 "$WEB_URL/login")" == 200 ]] && break
    web_alive || die "web-exited log=$RUN_DIR/web.log"
    sleep 1
  done
  [[ "$(curl -s -o /dev/null -w '%{http_code}' -m 60 "$WEB_URL/login")" == 200 ]] || die "web-timeout log=$RUN_DIR/web.log"
  cors_ok || die "cors api=$API_URL does not allow origin $WEB_URL; run 'control.sh down' then 'control.sh up'"
  echo "READY web=$WEB_URL api=$API_URL rev=$GIT_REV evidence=$EVIDENCE_DIR"
}

cmd_doctor() {
  local fails=0
  check() { if eval "$2" >/dev/null 2>&1; then echo "OK $1"; else echo "FAIL $1"; fails=$((fails+1)); fi; }
  [[ -f "$STATE" ]] || { echo "FAIL state no-instance"; echo "DOCTOR FAIL"; return 1; }
  load_state
  check web-pid "web_alive"
  check web-port-owner "[[ \$(ps -o pgid= -p \$(ss -ltnpH 'sport = :$WEB_PORT' | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2) | tr -d ' ') == $WEB_PID ]]"
  check web-login "[[ \$(curl -s -o /dev/null -w '%{http_code}' -m 60 $WEB_URL/login) == 200 ]]"
  check backend "backend doctor | tail -1 | grep -q '^DOCTOR PASS'"
  check cors "cors_ok"
  check browser "[[ -x '$CHROME' && -d '$TOOLS/node_modules/playwright-core' ]]"
  local head; head="$(git -C "$ROOT" rev-parse --short HEAD)$(git -C "$ROOT" diff --quiet HEAD -- pages components context utils styles || echo -dirty)"
  if [[ "$head" == "$GIT_REV" ]]; then echo "OK rev $GIT_REV"; else echo "OK rev started=$GIT_REV now=$head (next dev hot-reloads, no restart needed)"; fi
  if (( fails == 0 )); then echo "DOCTOR PASS web=$WEB_URL api=$API_URL"; else echo "DOCTOR FAIL"; return 1; fi
}

cmd_drive() {
  local spec="${1:?usage: drive <spec.json | spec name | inline JSON>}"
  load_state
  [[ "$spec" != \{* && ! -f "$spec" && -f "$SPECS/$spec.json" ]] && spec="$SPECS/$spec.json"
  WEB_URL="$WEB_URL" API_URL="$API_URL" CHROME="$CHROME" EVIDENCE_DIR="$EVIDENCE_DIR" CONTROL="$SELF" \
    NODE_PATH="$TOOLS/node_modules" node "$ROOT/.claude/skills/verify/scripts/drive.mjs" "$spec"
}

cmd_suite() {
  local filter="${1:-}" f name out result pass=0 fail=0 xfail=0 xpass=0
  load_state
  for f in "$SPECS"/*.json; do
    name="$(basename "$f" .json)"
    [[ -n "$filter" && "$name" != $filter ]] && continue
    out="$(cmd_drive "$f")"
    result="$(grep -E '^RESULT ' <<<"$out" | tail -1 | cut -d' ' -f2)"
    case "$result" in PASS) pass=$((pass+1));; XFAIL) xfail=$((xfail+1));; XPASS) xpass=$((xpass+1));; *) result=FAIL; fail=$((fail+1));; esac
    echo "SPEC $result $name $(grep -E '^EVIDENCE ' <<<"$out" | tail -1 | cut -d' ' -f2)"
    [[ "$result" == FAIL || "$result" == XPASS ]] && grep -E '^(STEP [0-9]+ FAIL|SETUP FAIL|NEXT) ' <<<"$out" | sed 's/^/  /'
  done
  echo "SUITE pass=$pass fail=$fail xfail=$xfail xpass=$xpass"
  (( fail == 0 && xpass == 0 ))
}

cmd_demo() {
  export DEMO_NAMES=1
  local filter="${1:-}" f name out pass=0 fail=0
  command -v ffmpeg >/dev/null || die "no-ffmpeg install ffmpeg"
  command -v python3 >/dev/null || die "no-python3 install python3"
  command -v fc-match >/dev/null || die "no-fontconfig install fontconfig"
  cmd_up || return 1
  load_state
  mkdir -p "$DEMO_DIR"
  for f in "$DEMOS"/*.json; do
    name="$(basename "$f" .json)"
    [[ -n "$filter" && "$name" != $filter ]] && continue
    out="$(DEMO_OUT="$DEMO_DIR/$name.src.mkv" cmd_drive "$f")"
    grep '^CAPTURE ' <<<"$out"
    if grep -qx 'RESULT PASS' <<<"$out" &&
      python3 "$ROOT/.claude/skills/verify/scripts/demo-render.py" "$DEMO_DIR/$name.src.mkv" "$DEMO_DIR/$name.events.json" "$DEMO_DIR/$name.mp4" --width "${DEMO_WIDTH:-1920}" ${DEMO_NO_ZOOM:+--no-zoom} &&
      ffmpeg -loglevel error -y -i "$DEMO_DIR/$name.poster.png" -frames:v 1 -vf scale=640:-2 "$DEMO_DIR/$name.jpg"; then
      rm -f "$DEMO_DIR/$name.poster.png"
      pass=$((pass+1)); echo "DEMO PASS $name $DEMO_DIR/$name.mp4"
    else
      rm -f "$DEMO_DIR/$name.mp4" "$DEMO_DIR/$name.jpg" "$DEMO_DIR/$name.poster.png"
      fail=$((fail+1)); echo "DEMO FAIL $name $(grep -E '^EVIDENCE ' <<<"$out" | cut -d' ' -f2)"
      grep -E '^(STEP [0-9]+ FAIL|SETUP FAIL|RESULT) ' <<<"$out" | sed 's/^/  /'
    fi
  done
  cmd_manifest "$DEMO_DIR" || return 1
  cmd_demo_index || return 1
  echo "DEMOS pass=$pass fail=$fail index=$DEMO_DIR/index.html"
  (( fail == 0 ))
}

cmd_manifest() { node "$ROOT/.claude/skills/verify/scripts/demo-manifest.mjs" "${1:-$DEMO_DIR}"; }
cmd_affected() { node "$ROOT/.claude/skills/verify/scripts/demo-affected.mjs" "$@"; }
cmd_demo_index() { node "$ROOT/.claude/skills/verify/scripts/demo-index.mjs" "${1:-$DEMO_DIR}"; }

# The backend skill keeps each response in one shared last.body, so concurrent drives must take turns.
cmd_api() { load_state; { flock 9; backend "$@"; } 9>"$RUN_DIR/api.lock"; }

cmd_down() {
  [[ -f "$STATE" ]] || { backend down >/dev/null; echo "DOWN nothing-running evidence=$EVIDENCE_ROOT"; return 0; }
  load_state
  if web_alive; then kill -- "-$WEB_PID" 2>/dev/null; sleep 1; web_alive && kill -9 -- "-$WEB_PID" 2>/dev/null; fi
  backend down >/dev/null
  [[ -d "${EVIDENCE_DIR:-}" ]] && cp "$RUN_DIR/web.log" "$EVIDENCE_DIR/" 2>/dev/null
  rm -rf "$RUN_DIR"
  echo "DOWN ok evidence=$EVIDENCE_DIR"
}

case "${1:-}" in
  demo-index) shift; cmd_demo_index "$@" ;;
  up|doctor|drive|suite|demo|manifest|affected|api|down) c="$1"; shift; "cmd_$c" "$@" ;;
  *) echo "usage: control.sh up|doctor|drive <spec>|suite [glob]|demo [glob]|manifest [dir]|affected <base> <head>|demo-index [dir]|api <backend control.sh args>|down"; exit 1 ;;
esac
