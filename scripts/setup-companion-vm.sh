#!/usr/bin/env bash
# Companion RAI pe VM (Ubuntu) â€” dupÄƒ git pull / clone.
#
#   cd ~/Desktop/Transitix   # sau path-ul repo-ului
#   git pull
#   bash scripts/setup-companion-vm.sh
#
# OpÈ›iuni:
#   --skip-npm       nu ruleazÄƒ npm ci
#   --skip-docker    nu porneÈ™te Postgres (presupune cÄƒ e deja up pe :5435)
#   --skip-seed      doar migrate + bootstrap GOD (fÄƒrÄƒ seed)
#   --start          porneÈ™te API + Vite Ã®n background (loguri Ã®n /tmp)
#   --tunnel         dupÄƒ --start, porneÈ™te cloudflared (afiÈ™eazÄƒ URL)
#
# Env opÈ›ional:
#   GOD_EMAIL=godadmin@transitix.ro
#   GOD_PASSWORD=GodAdmin123
#   JWT_SECRET=â€¦   (altfel lasÄƒ valoarea din .env.companion)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SKIP_NPM=0
SKIP_DOCKER=0
SKIP_SEED=0
DO_START=0
DO_TUNNEL=0
for arg in "$@"; do
  case "$arg" in
    --skip-npm) SKIP_NPM=1 ;;
    --skip-docker) SKIP_DOCKER=1 ;;
    --skip-seed) SKIP_SEED=1 ;;
    --start) DO_START=1 ;;
    --tunnel) DO_TUNNEL=1; DO_START=1 ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg (vezi --help)" >&2
      exit 1
      ;;
  esac
done

GOD_EMAIL="${GOD_EMAIL:-godadmin@transitix.ro}"
GOD_PASSWORD="${GOD_PASSWORD:-GodAdmin123}"
DB_URL_DEFAULT='postgresql://postgres:password@localhost:5435/transitix_rai'

log() { printf '\n==> %s\n' "$*"; }

# --- nvm (Node pe VM fÄƒrÄƒ sudo) ---
if [[ -f "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  source "$HOME/.nvm/nvm.sh"
  nvm use 20 >/dev/null 2>&1 || nvm use default >/dev/null 2>&1 || true
fi
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  echo "LipseÈ™te node/npm. InstaleazÄƒ nvm + Node 20, apoi reia scriptul." >&2
  echo "  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash" >&2
  exit 1
fi
log "node $(node -v) Â· npm $(npm -v)"

# --- env companion ---
log "PregÄƒtesc server/.env.companion + COMPANION=1"
mkdir -p server
if [[ ! -f server/.env.companion ]]; then
  if [[ -f server/companion.env.example ]]; then
    cp server/companion.env.example server/.env.companion
  else
    cat > server/.env.companion <<EOF
COMPANION=1
PORT=3002
DATABASE_URL=${DB_URL_DEFAULT}
JWT_SECRET=schimba-jwt-secret-companion-rai-vm
CLIENT_ORIGIN=http://127.0.0.1:5174
TRUST_PROXY=1
EOF
  fi
fi

# AsigurÄƒ COMPANION=1 È™i DATABASE_URL pe :5435 Ã®n companion
grep -q '^COMPANION=' server/.env.companion \
  || printf '\nCOMPANION=1\n' >> server/.env.companion
grep -q '^DATABASE_URL=' server/.env.companion \
  || printf 'DATABASE_URL=%s\n' "$DB_URL_DEFAULT" >> server/.env.companion
# DacÄƒ DATABASE_URL e pe 5432 din greÈ™ealÄƒ, nu rescriem automat â€” doar avertim
if grep -q 'localhost:5432' server/.env.companion 2>/dev/null; then
  echo "ATENÈšIE: server/.env.companion are :5432 â€” companion e pe :5435. CorecteazÄƒ manual." >&2
fi

# loadEnv citeÈ™te COMPANION din .env (bazÄƒ) Ã®nainte de companion
touch server/.env
grep -q '^COMPANION=' server/.env || echo 'COMPANION=1' >> server/.env

export COMPANION=1
# shellcheck disable=SC1091
set -a
# nu folosim source pe .env (poate avea spaÈ›ii); exportÄƒm explicit ce trebuie
set +a
export DATABASE_URL
DATABASE_URL="$(grep -E '^DATABASE_URL=' server/.env.companion | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'")"
export DATABASE_URL="${DATABASE_URL:-$DB_URL_DEFAULT}"

log "DATABASE_URL=$DATABASE_URL"

# --- npm ci ---
if [[ "$SKIP_NPM" -eq 0 ]]; then
  log "npm ci (root + server)"
  npm ci
  npm ci --prefix server
else
  log "skip npm ci"
fi

# --- docker postgres ---
if [[ "$SKIP_DOCKER" -eq 0 ]]; then
  if ! command -v docker >/dev/null; then
    echo "LipseÈ™te docker. InstaleazÄƒ: sudo apt-get install -y docker.io docker-compose-v2" >&2
    exit 1
  fi
  log "docker compose companion (Postgres :5435)"
  docker compose -f docker-compose.companion.yml up -d
  # aÈ™teaptÄƒ healthy
  for i in $(seq 1 30); do
    if docker compose -f docker-compose.companion.yml ps 2>/dev/null | grep -qi healthy; then
      break
    fi
    # fallback: port open
    if (echo >/dev/tcp/127.0.0.1/5435) >/dev/null 2>&1; then
      sleep 2
      break
    fi
    sleep 1
  done
  docker ps --filter name=transitix-db || true
else
  log "skip docker"
fi

# --- migrate / seed / GOD ---
log "migrate"
COMPANION=1 DATABASE_URL="$DATABASE_URL" npm run migrate --prefix server

if [[ "$SKIP_SEED" -eq 0 ]]; then
  log "seed (DB de test goalÄƒ â€” NU pe PROD real)"
  COMPANION=1 DATABASE_URL="$DATABASE_URL" npm run seed --prefix server
else
  log "skip seed"
fi

log "platform bootstrap GOD ($GOD_EMAIL)"
COMPANION=1 DATABASE_URL="$DATABASE_URL" \
  PLATFORM_ADMIN_EMAILS="$GOD_EMAIL" \
  PLATFORM_ADMIN_BOOTSTRAP_PASSWORD="$GOD_PASSWORD" \
  npm run platform:bootstrap --prefix server

log "Verificare loadEnv"
COMPANION=1 DATABASE_URL="$DATABASE_URL" node --input-type=module -e "
import './server/src/loadEnv.js';
const u = process.env.DATABASE_URL || '';
console.log('COMPANION=', process.env.COMPANION);
console.log('DATABASE_URL=', u);
if (!u.includes('5435')) {
  console.error('FAIL: DATABASE_URL nu e pe :5435');
  process.exit(1);
}
"

echo
echo "â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€"
echo " Setup OK. Conturi (dupÄƒ seed):"
echo "   $GOD_EMAIL / $GOD_PASSWORD"
echo "   admin@rai-spedition.ro / admin123"
echo "   sofer@rai-spedition.ro / sofer123"
echo " Local: http://127.0.0.1:5174/"
echo "â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€"

if [[ "$DO_START" -eq 1 ]]; then
  log "Pornesc API (:3002) + Vite (:5174)"
  mkdir -p /tmp/transitix-vm
  # opreÈ™te instanÈ›e vechi pe aceleaÈ™i porturi (best-effort)
  pkill -f 'dev-companion-api|vite --mode companion' 2>/dev/null || true
  sleep 1
  nohup env COMPANION=1 DATABASE_URL="$DATABASE_URL" npm run dev:companion-api \
    > /tmp/transitix-vm/api.log 2>&1 &
  echo $! > /tmp/transitix-vm/api.pid
  nohup env COMPANION=1 npm run dev:companion \
    > /tmp/transitix-vm/vite.log 2>&1 &
  echo $! > /tmp/transitix-vm/vite.pid
  sleep 3
  echo "API log:  /tmp/transitix-vm/api.log  (pid $(cat /tmp/transitix-vm/api.pid))"
  echo "Vite log: /tmp/transitix-vm/vite.log (pid $(cat /tmp/transitix-vm/vite.pid))"
  echo "Deschide: http://127.0.0.1:5174/"
fi

if [[ "$DO_TUNNEL" -eq 1 ]]; then
  log "Asigur cloudflared (install/repair)"
  bash "$ROOT/scripts/install-cloudflared.sh"
  hash -r 2>/dev/null || true
  log "cloudflared tunnel → http://127.0.0.1:5174"
  echo "Copiază URL-ul trycloudflare în server/.env.companion ca CLIENT_ORIGIN=… apoi repornește API."
  echo "Sau: bash scripts/start-companion-tunnel.sh (scrie CLIENT_ORIGIN automat)."
  echo "Oprești cu Ctrl+C."
  exec cloudflared tunnel --url http://127.0.0.1:5174
fi

if [[ "$DO_START" -eq 0 ]]; then
  echo
  echo "PorneÈ™te manual (2 terminale):"
  echo "  source ~/.nvm/nvm.sh && export COMPANION=1 DATABASE_URL='$DATABASE_URL'"
  echo "  npm run dev:companion-api"
  echo "  npm run dev:companion"
  echo
  echo "Sau: bash scripts/setup-companion-vm.sh --skip-npm --skip-docker --start"
  echo "Tunnel:  bash scripts/setup-companion-vm.sh --skip-npm --skip-docker --tunnel"
fi


