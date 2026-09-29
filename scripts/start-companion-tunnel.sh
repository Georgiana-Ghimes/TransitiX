#!/usr/bin/env bash
# One-shot companion stack + Cloudflare quick tunnel for the RAI VM.
# Usage (from repo root):
#   bash scripts/start-companion-tunnel.sh
#
# Stops previous API/Vite/cloudflared started by this script, brings them up,
# waits for the trycloudflare URL, writes CLIENT_ORIGIN into server/.env,
# then restarts the API so CORS picks up the new origin.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOG_DIR="${TMPDIR:-/tmp}/transitix-companion"
mkdir -p "$LOG_DIR"
API_LOG="$LOG_DIR/api.log"
UI_LOG="$LOG_DIR/vite.log"
CF_LOG="$LOG_DIR/cloudflared.log"
PID_FILE="$LOG_DIR/pids"

stop_old() {
  if [[ -f "$PID_FILE" ]]; then
    while read -r pid; do
      kill "$pid" 2>/dev/null || true
    done < "$PID_FILE"
    rm -f "$PID_FILE"
  fi
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

pick_origin() {
  local lan
  lan="$(hostname -I 2>/dev/null | awk '{print $1}')"
  if curl -sf --connect-timeout 2 "http://127.0.0.1:5174/" >/dev/null; then
    echo "http://127.0.0.1:5174"
  elif [[ -n "${lan:-}" ]] && curl -sf --connect-timeout 2 "http://${lan}:5174/" >/dev/null; then
    echo "http://${lan}:5174"
  elif [[ -n "${lan:-}" ]]; then
    # Vite not up yet when we pick; prefer LAN if loopback has been flaky on this VM.
    echo "http://${lan}:5174"
  else
    echo "http://127.0.0.1:5174"
  fi
}

set_client_origin() {
  local url="$1"
  python3 - "$url" <<'PY'
import re, sys
from pathlib import Path
url = sys.argv[1]
path = Path("server/.env")
if not path.exists():
    raise SystemExit(f"missing {path} — copy server/companion.env.example first")
text = path.read_text(encoding="utf-8")
line = f"CLIENT_ORIGIN={url}"
if re.search(r"^CLIENT_ORIGIN=.*$", text, flags=re.M):
    text = re.sub(r"^CLIENT_ORIGIN=.*$", line, text, count=1, flags=re.M)
else:
    text = text.rstrip() + "\n" + line + "\n"
if "TRUST_PROXY=" not in text:
    text = text.rstrip() + "\nTRUST_PROXY=1\n"
else:
    text = re.sub(r"^TRUST_PROXY=.*$", "TRUST_PROXY=1", text, count=1, flags=re.M)
path.write_text(text, encoding="utf-8")
print(line)
PY
}

echo "==> stopping old companion processes"
stop_old
: > "$PID_FILE"

if [[ ! -f server/.env ]]; then
  cp server/companion.env.example server/.env
  echo "created server/.env from companion.env.example — edit secrets if needed"
fi

echo "==> API on :3002"
(
  cd "$ROOT"
  npm run dev --prefix server
) >"$API_LOG" 2>&1 &
echo $! >>"$PID_FILE"

echo "==> Vite companion on :5174"
(
  cd "$ROOT"
  npm run dev:companion
) >"$UI_LOG" 2>&1 &
echo $! >>"$PID_FILE"

echo "==> waiting for Vite"
for _ in $(seq 1 60); do
  if curl -sf --connect-timeout 1 "http://127.0.0.1:5174/" >/dev/null \
    || curl -sf --connect-timeout 1 "http://$(hostname -I | awk '{print $1}'):5174/" >/dev/null; then
    break
  fi
  sleep 1
done

ORIGIN="$(pick_origin)"
echo "==> cloudflared → $ORIGIN"
: >"$CF_LOG"
cloudflared tunnel --url "$ORIGIN" >"$CF_LOG" 2>&1 &
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
kill "$API_PID" 2>/dev/null || true
sleep 1
(
  cd "$ROOT"
  npm run dev --prefix server
) >"$API_LOG" 2>&1 &
# replace first pid line
{
  echo $!
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
echo "Stop later with:  kill \$(cat $PID_FILE); pkill -f 'cloudflared tunnel --url'"
