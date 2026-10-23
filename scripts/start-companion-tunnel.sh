#!/usr/bin/env bash
# One-shot companion stack + Cloudflare quick tunnel for the RAI VM.
# Usage (from repo root):
#   bash scripts/start-companion-tunnel.sh
#
# Instalează/repară cloudflared dacă lipsește sau e stub invalid (ex. 9 bytes),
# face build la UI (dist/), pornește API (care servește și UI-ul pe :3002) + tunnel,
# așteaptă URL trycloudflare, scrie CLIENT_ORIGIN în server/.env (+ .env.companion),
# apoi repornește API pentru CORS. Pentru lucru pe UI: UI_MODE=dev (Vite pe :5174).

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Node pe VM (nvm) — fără asta npm poate lipsi din PATH non-login
if [[ -f "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  source "$HOME/.nvm/nvm.sh"
  nvm use 20 >/dev/null 2>&1 || nvm use default >/dev/null 2>&1 || true
fi
export COMPANION="${COMPANION:-1}"

LOG_DIR="${TMPDIR:-/tmp}/transitix-companion"
mkdir -p "$LOG_DIR"
API_LOG="$LOG_DIR/api.log"
UI_LOG="$LOG_DIR/vite.log"
CF_LOG="$LOG_DIR/cloudflared.log"
PID_FILE="$LOG_DIR/pids"

# Each service runs in its own process group (setsid), so stopping it reaches npm, the
# `node --watch` supervisor and its child. Killing only the subshell pid used to leave the
# watcher holding :3002: the restarted API died with EADDRINUSE, the stale one kept the old
# env, and migrations never ran after a pull.
start_group() {
  local log="$1"; shift
  setsid bash -c "cd \"$ROOT\" && $*" >"$log" 2>&1 &
  echo $!
}

kill_group() {
  local pid="$1"
  [[ -n "$pid" ]] || return 0
  kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
}

stop_old() {
  if [[ -f "$PID_FILE" ]]; then
    while read -r pid; do
      kill_group "$pid"
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi
  # Leftovers from older versions of this script (plain `kill` on the subshell).
  pkill -f 'node --watch src/index.js' 2>/dev/null || true
  pkill -f 'node src/migrate.js' 2>/dev/null || true
  pkill -f 'vite --mode companion' 2>/dev/null || true
  # Best-effort cleanup of leftover listeners on companion ports.
  for port in 3002 5174; do
    pids=$(ss -lntp 2>/dev/null | awk -v p=":$port" '$4 ~ p {print}' | grep -oP 'pid=\K[0-9]+' || true)
    for pid in $pids; do
      kill "$pid" 2>/dev/null || true
    done
  done
  pkill -f 'cloudflared tunnel --url' 2>/dev/null || true
  sleep 1
}

# What the tunnel serves.
#   dist (default) — `vite build` once, the API serves dist/ on :3002: one origin, no HMR.
#   dev            — `vite dev` on :5174 for working on the UI. Never hand this to drivers: the
#                    Vite client reloads the page whenever its socket drops, and opening the phone
#                    camera drops it, so the photo the driver just took was lost on return.
UI_MODE="${UI_MODE:-dist}"
if [[ "$UI_MODE" == "dev" ]]; then UI_PORT=5174; else UI_PORT=3002; fi

pick_origin() {
  local lan
  lan="$(hostname -I 2>/dev/null | awk '{print $1}')"
  if curl -sf --connect-timeout 2 "http://127.0.0.1:${UI_PORT}/" >/dev/null; then
    echo "http://127.0.0.1:${UI_PORT}"
  elif [[ -n "${lan:-}" ]] && curl -sf --connect-timeout 2 "http://${lan}:${UI_PORT}/" >/dev/null; then
    echo "http://${lan}:${UI_PORT}"
  elif [[ -n "${lan:-}" ]]; then
    # UI not up yet when we pick; prefer LAN if loopback has been flaky on this VM.
    echo "http://${lan}:${UI_PORT}"
  else
    echo "http://127.0.0.1:${UI_PORT}"
  fi
}

set_client_origin() {
  local url="$1"
  python3 - "$url" <<'PY'
import re, sys
from pathlib import Path
url = sys.argv[1]
line = f"CLIENT_ORIGIN={url}"

def patch(path: Path) -> None:
    if not path.exists():
        return
    text = path.read_text(encoding="utf-8")
    if re.search(r"^CLIENT_ORIGIN=.*$", text, flags=re.M):
        text = re.sub(r"^CLIENT_ORIGIN=.*$", line, text, count=1, flags=re.M)
    else:
        text = text.rstrip() + "\n" + line + "\n"
    if "TRUST_PROXY=" not in text:
        text = text.rstrip() + "\nTRUST_PROXY=1\n"
    else:
        text = re.sub(r"^TRUST_PROXY=.*$", "TRUST_PROXY=1", text, count=1, flags=re.M)
    path.write_text(text, encoding="utf-8")
    print(f"{path}: {line}")

env_path = Path("server/.env")
if not env_path.exists():
    raise SystemExit(f"missing {env_path} — copy server/companion.env.example first")
patch(env_path)
patch(Path("server/.env.companion"))
PY
}

echo "==> stopping old companion processes"
stop_old
: > "$PID_FILE"

if [[ ! -f server/.env ]]; then
  if [[ -f server/companion.env.example ]]; then
    cp server/companion.env.example server/.env
  elif [[ -f server/.env.companion ]]; then
    cp server/.env.companion server/.env
  fi
  echo "created server/.env — edit secrets if needed"
fi
# Prefer companion DB URL (:5435) when present
if [[ -f server/.env.companion ]]; then
  _db="$(grep -E '^DATABASE_URL=' server/.env.companion | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true)"
  [[ -n "${_db:-}" ]] && export DATABASE_URL="$_db"
fi
grep -q '^COMPANION=' server/.env 2>/dev/null || echo 'COMPANION=1' >> server/.env

if [[ "$UI_MODE" != "dev" ]]; then
  # Before the API starts: it decides at boot whether there is a dist/ to serve.
  echo "==> building UI (dist/) — log: $UI_LOG"
  if ! COMPANION=1 npm run build:companion >"$UI_LOG" 2>&1; then
    echo "FAILED: UI build. Last lines:"
    tail -n 30 "$UI_LOG" || true
    exit 1
  fi
fi

echo "==> API on :3002 (COMPANION=$COMPANION)"
start_group "$API_LOG" "COMPANION=1 npm run dev --prefix server" >>"$PID_FILE"

if [[ "$UI_MODE" == "dev" ]]; then
  echo "==> Vite companion on :5174 (UI_MODE=dev)"
  start_group "$UI_LOG" "COMPANION=1 npm run dev:companion" >>"$PID_FILE"
fi

echo "==> waiting for the UI on :${UI_PORT}"
for _ in $(seq 1 90); do
  if curl -sf --connect-timeout 1 "http://127.0.0.1:${UI_PORT}/" >/dev/null \
    || curl -sf --connect-timeout 1 "http://$(hostname -I | awk '{print $1}'):${UI_PORT}/" >/dev/null; then
    break
  fi
  sleep 1
done

ORIGIN="$(pick_origin)"

ensure_cloudflared() {
  local cf=""
  if command -v cloudflared >/dev/null 2>&1; then
    cf="$(command -v cloudflared)"
  elif [[ -x /usr/local/bin/cloudflared ]]; then
    cf=/usr/local/bin/cloudflared
  elif [[ -x "$HOME/.local/bin/cloudflared" ]]; then
    cf="$HOME/.local/bin/cloudflared"
    export PATH="$HOME/.local/bin:$PATH"
  fi
  # stub de 9 bytes / text ≠ binar real
  if [[ -n "$cf" && -f "$cf" ]]; then
    local sz
    sz="$(wc -c <"$cf" | tr -d ' ')"
    if [[ "$sz" -ge 1000000 ]] && "$cf" --version >/dev/null 2>&1; then
      echo "$cf"
      return 0
    fi
    echo "==> cloudflared invalid ($cf, ${sz} bytes) — reinstalez" >&2
  else
    echo "==> cloudflared lipsește — instalez" >&2
  fi
  bash "$ROOT/scripts/install-cloudflared.sh" >&2
  command -v cloudflared >/dev/null 2>&1 || [[ -x /usr/local/bin/cloudflared ]] \
    || { echo "FAILED: cloudflared tot lipsește după install" >&2; return 1; }
  command -v cloudflared 2>/dev/null || echo /usr/local/bin/cloudflared
}

CF_BIN="$(ensure_cloudflared)"
echo "==> cloudflared → $ORIGIN ($CF_BIN)"
: >"$CF_LOG"
"$CF_BIN" tunnel --url "$ORIGIN" >"$CF_LOG" 2>&1 &
echo $! >>"$PID_FILE"

echo "==> waiting for trycloudflare URL"
PUBLIC_URL=""
for _ in $(seq 1 45); do
  PUBLIC_URL="$(grep -oE 'https://[a-zA-Z0-9-]+\.trycloudflare\.com' "$CF_LOG" | head -1 || true)"
  if [[ -n "$PUBLIC_URL" ]]; then
    break
  fi
  sleep 1
done

if [[ -z "$PUBLIC_URL" ]]; then
  echo "FAILED: no trycloudflare URL. Last cloudflared log:"
  tail -n 40 "$CF_LOG" || true
  exit 1
fi

echo "==> writing CLIENT_ORIGIN"
set_client_origin "$PUBLIC_URL"

echo "==> restarting API so .env reloads"
# Kill only the API child (first pid) and start again.
API_PID="$(head -1 "$PID_FILE")"
kill_group "$API_PID"
for _ in $(seq 1 20); do
  ss -lnt 2>/dev/null | grep -q ':3002 ' || break
  sleep 0.5
done
# replace first pid line
{
  start_group "$API_LOG" "COMPANION=1 npm run dev --prefix server"
  tail -n +2 "$PID_FILE"
} >"$PID_FILE.tmp"
mv "$PID_FILE.tmp" "$PID_FILE"

sleep 2
echo
echo "Ready."
echo "  Local UI:  $ORIGIN"
echo "  Local API: http://127.0.0.1:3002/api/health"
echo "  Public:    $PUBLIC_URL"
echo "  Logs:      $LOG_DIR"
echo
echo "Stop later with:  for p in \$(cat $PID_FILE); do kill -- -\$p; done; pkill -f 'cloudflared tunnel --url'"
