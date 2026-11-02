#!/bin/sh
set -e

# The admin password lives in a Railway variable: (re)apply it on every boot so
# rotating it is "change the variable, redeploy". aioncore's `user set-password`
# is the offline bootstrap path for self-hosted WebUI (runs migrations on an
# empty data dir, then sets the password on the default user: username `admin`).
: "${AIONUI_ADMIN_PASSWORD:?set AIONUI_ADMIN_PASSWORD}"
A=/opt/aionui-web/bundled-aioncore/linux-x64/aioncore
mkdir -p "$AIONUI_DATA_DIR"
printf '%s\n' "$AIONUI_ADMIN_PASSWORD" | $A --data-dir "$AIONUI_DATA_DIR" user set-password --password-stdin

# set-password keeps existing sessions; disable+enable revokes them. Do that
# only when the password actually changed (salted hash stamp on the volume),
# so a plain redeploy doesn't log everyone out.
STAMP="$AIONUI_DATA_DIR/.admin-password"
salt=$(cut -d: -f1 "$STAMP" 2>/dev/null || true)
[ -n "$salt" ] || salt=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
new="$salt:$(python3 -c 'import hashlib,os,sys; print(hashlib.pbkdf2_hmac("sha256", os.environ["AIONUI_ADMIN_PASSWORD"].encode(), bytes.fromhex(sys.argv[1]), 200000).hex())' "$salt")"
if [ "$new" != "$(cat "$STAMP" 2>/dev/null)" ]; then
  $A --data-dir "$AIONUI_DATA_DIR" user disable --username admin >/dev/null 2>&1 || true
  $A --data-dir "$AIONUI_DATA_DIR" user enable --username admin >/dev/null 2>&1 || true
  echo "$new" > "$STAMP"
  echo "admin password changed: existing sessions revoked"
fi

# ---------------------------------------------------------------------------
# Agent CLIs for AionUi to detect on $PATH. They live on the volume and are
# updated on every boot, because a copy baked into the image would go stale.
# Short names map to npm packages; anything else is used as an npm package name.
# AIONUI_AGENTS=none installs none.
AGENTS_DIR="$AIONUI_DATA_DIR/agents"
mkdir -p "$AGENTS_DIR"
pkgs=""
for a in $(echo "${AIONUI_AGENTS-claude,codex,gemini,opencode}" | tr ',' ' '); do
  case "$a" in
    claude) pkgs="$pkgs @anthropic-ai/claude-code" ;;
    codex) pkgs="$pkgs @openai/codex" ;;
    gemini) pkgs="$pkgs @google/gemini-cli" ;;
    opencode) pkgs="$pkgs opencode-ai" ;;
    qwen) pkgs="$pkgs @qwen-code/qwen-code" ;;
    none) ;;
    *) pkgs="$pkgs $a" ;;
  esac
done
# A changed list starts from scratch, so removed agents actually disappear.
[ "$pkgs" = "$(cat "$AGENTS_DIR/.list" 2>/dev/null)" ] || rm -rf "$AGENTS_DIR"
mkdir -p "$AGENTS_DIR"
if [ -n "$pkgs" ]; then
  echo "installing/updating agent CLIs:$pkgs"
  # A failed update keeps the old CLIs; a failed first install retries next boot.
  # npm cache goes to /tmp so it doesn't keep ~750 MB on the volume.
  if timeout 240 npm install -g --prefix "$AGENTS_DIR" --cache /tmp/npm-cache \
      --no-fund --no-audit --no-update-notifier --loglevel=error \
      $(for p in $pkgs; do echo "$p@latest"; done); then
    echo "$pkgs" > "$AGENTS_DIR/.list"
  else
    echo "agent CLI install failed, starting with what is there"
    rm -rf /tmp/npm-cache
  fi
fi

# ---------------------------------------------------------------------------
# Railway counts page cache as the service's memory. Reading the CLIs (install,
# startup probes, agent runs) leaves up to ~2 GB of it and nothing reclaims it
# below the plan's limit — and the container can't drop caches. Evict the
# agents' file pages every 5 minutes (mapped pages of running agents stay).
[ -z "$pkgs" ] || (
  while sleep 300; do
    python3 - "$AGENTS_DIR" <<'PYEOF' || true
import os, sys
for root, _, files in os.walk(sys.argv[1]):
    for f in files:
        p = os.path.join(root, f)
        try:
            fd = os.open(p, os.O_RDONLY)
            try:
                os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
            finally:
                os.close(fd)
        except OSError:
            pass
PYEOF
  done
) &

exec /opt/aionui-web/aionui-web start
