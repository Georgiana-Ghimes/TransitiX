#!/usr/bin/env bash
# Instalează / repară cloudflared pe Linux (Ubuntu VM companion).
#
#   bash scripts/install-cloudflared.sh
#
# Opțiuni:
#   --force     reinstalează chiar dacă --version merge
#   --user      instalează în ~/.local/bin (fără sudo)
#
# Env:
#   CLOUDFLARED_VERSION=2025.8.1   (implicit: latest de pe GitHub)
#   CLOUDFLARED_BIN=/usr/local/bin/cloudflared
set -euo pipefail

FORCE=0
USER_INSTALL=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --user) USER_INSTALL=1 ;;
    -h|--help)
      sed -n '2,14p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg (vezi --help)" >&2
      exit 1
      ;;
  esac
done

log() { printf '==> %s\n' "$*"; }
die() { echo "FAILED: $*" >&2; exit 1; }

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "lipsește comanda: $1"
}

need_cmd curl
need_cmd file
need_cmd mktemp

arch="$(uname -m)"
case "$arch" in
  x86_64|amd64) CF_ARCH=amd64 ;;
  aarch64|arm64) CF_ARCH=arm64 ;;
  *) die "arch nesuportat: $arch (așteptat amd64/arm64)" ;;
esac

if [[ "$USER_INSTALL" -eq 1 ]]; then
  BIN_DIR="${HOME}/.local/bin"
  mkdir -p "$BIN_DIR"
  TARGET="${CLOUDFLARED_BIN:-$BIN_DIR/cloudflared}"
else
  TARGET="${CLOUDFLARED_BIN:-/usr/local/bin/cloudflared}"
fi

is_good_binary() {
  local path="$1"
  [[ -f "$path" ]] || return 1
  local sz
  sz="$(wc -c <"$path" | tr -d ' ')"
  # binarul real e ~20–60MB; 9 bytes / HTML = download eșuat
  [[ "$sz" -ge 1000000 ]] || return 1
  file -b "$path" 2>/dev/null | grep -qiE 'ELF|executable' || return 1
  [[ -x "$path" ]] || return 1
  "$path" --version >/dev/null 2>&1
}

already_ok() {
  if is_good_binary "$TARGET"; then
    return 0
  fi
  local which
  which="$(command -v cloudflared 2>/dev/null || true)"
  if [[ -n "$which" && "$which" != "$TARGET" ]] && is_good_binary "$which"; then
    TARGET="$which"
    return 0
  fi
  return 1
}

if [[ "$FORCE" -eq 0 ]] && already_ok; then
  log "cloudflared deja OK: $TARGET"
  "$TARGET" --version
  exit 0
fi

# Șterge stub-uri / download-uri eșuate (ex. 9 bytes ASCII)
if [[ -e "$TARGET" ]] && ! is_good_binary "$TARGET"; then
  log "șterg binar invalid: $TARGET ($(wc -c <"$TARGET" | tr -d ' ') bytes, $(file -b "$TARGET"))"
  if [[ -w "$(dirname "$TARGET")" ]]; then
    rm -f "$TARGET"
  else
    sudo rm -f "$TARGET"
  fi
fi

resolve_version() {
  if [[ -n "${CLOUDFLARED_VERSION:-}" ]]; then
    echo "$CLOUDFLARED_VERSION"
    return
  fi
  # latest tag de pe GitHub API (fără jq)
  local tag
  tag="$(
    curl -fsSL --connect-timeout 15 \
      https://api.github.com/repos/cloudflare/cloudflared/releases/latest \
      | grep -oE '"tag_name":[[:space:]]*"[^"]+"' \
      | head -1 \
      | sed -E 's/.*"([^"]+)".*/\1/'
  )"
  [[ -n "$tag" ]] || die "nu pot afla versiunea latest de pe GitHub"
  echo "$tag"
}

VERSION="$(resolve_version)"
ASSET="cloudflared-linux-${CF_ARCH}"
URL="https://github.com/cloudflare/cloudflared/releases/download/${VERSION}/${ASSET}"

log "download $ASSET ($VERSION) → /tmp"
TMP="$(mktemp "/tmp/cloudflared.XXXXXX")"
cleanup() { rm -f "$TMP" "${TMP}.tgz" 2>/dev/null || true; }
trap cleanup EXIT

download_ok=0
if curl -fL --connect-timeout 30 --retry 3 --retry-delay 2 \
  --progress-bar -o "$TMP" "$URL"; then
  download_ok=1
else
  log "asset fără extensie eșuat; încerc .tgz"
  TGZ_URL="${URL}.tgz"
  if curl -fL --connect-timeout 30 --retry 3 --retry-delay 2 \
    --progress-bar -o "${TMP}.tgz" "$TGZ_URL"; then
    need_cmd tar
    tar -xzf "${TMP}.tgz" -C "$(dirname "$TMP")"
    # găsește binarul extras
    found="$(find "$(dirname "$TMP")" -maxdepth 2 -type f -name 'cloudflared' 2>/dev/null | head -1 || true)"
    [[ -n "$found" ]] || die "nu am găsit cloudflared în arhivă"
    mv -f "$found" "$TMP"
    download_ok=1
  fi
fi

[[ "$download_ok" -eq 1 ]] || die "download eșuat pentru $URL"

sz="$(wc -c <"$TMP" | tr -d ' ')"
log "descărcat: $sz bytes · $(file -b "$TMP")"
[[ "$sz" -ge 1000000 ]] || die "fișier prea mic ($sz bytes) — nu e binarul real (verifică rețeaua / URL)"
file -b "$TMP" | grep -qiE 'ELF|executable' || die "nu e ELF executable: $(file -b "$TMP")"

chmod 755 "$TMP"
"$TMP" --version || die "binarul nu rulează --version"

install_bin() {
  local dest_dir
  dest_dir="$(dirname "$TARGET")"
  mkdir -p "$dest_dir" 2>/dev/null || true
  if [[ -w "$dest_dir" ]]; then
    cp -f "$TMP" "$TARGET"
    chmod 755 "$TARGET"
  else
    log "scriu cu sudo în $TARGET"
    sudo cp -f "$TMP" "$TARGET"
    sudo chmod 755 "$TARGET"
  fi
}

install_bin

# PATH: dacă e în ~/.local/bin și nu e pe PATH
if [[ "$TARGET" == "$HOME/.local/bin/"* ]]; then
  case ":$PATH:" in
    *":$HOME/.local/bin:"*) ;;
    *)
      export PATH="$HOME/.local/bin:$PATH"
      log "adaugă permanent: export PATH=\"\$HOME/.local/bin:\$PATH\" în ~/.bashrc"
      ;;
  esac
fi

hash -r 2>/dev/null || true
log "instalat: $TARGET"
"$TARGET" --version

# Verificare finală via PATH
if command -v cloudflared >/dev/null 2>&1; then
  which_cf="$(command -v cloudflared)"
  if ! is_good_binary "$which_cf"; then
    die "cloudflared din PATH ($which_cf) e încă invalid — rulează: hash -r && which cloudflared"
  fi
  echo
  echo "OK. Test: cloudflared --version"
  echo "Tunnel:  bash scripts/start-companion-tunnel.sh"
else
  echo
  echo "OK (binar la $TARGET), dar nu e pe PATH."
  echo "  export PATH=\"$(dirname "$TARGET"):\$PATH\""
  echo "sau: bash scripts/install-cloudflared.sh --user"
fi
