# AionUi WebUI for Railway — built from THIS repo (multi-user fork line).
#
# Stage 1 (build): install + build the renderer SPA, then pack the web-cli
#   tarball (bun-compiled `aionui-web` host + `static/` SPA + bundled
#   linux-x64 aioncore binary downloaded from the pinned release).
# Stage 2 (runtime): node:22-slim + libicu + agent tooling. Agent CLIs
#   (claude/codex/gemini/opencode, AIONUI_AGENTS) are installed onto the
#   volume at boot by entrypoint.sh so they never go stale in the image.
#
# Auth: AIONUI_REMOTE_AUTH=1 keeps aioncore's JWT-cookie auth + CSRF ON
# (the SPA-facing CSRF bridge lives in packages/web-host/src/static-server.ts).

# ---- Stage 1: build the web tarball ---------------------------------------
FROM node:22-bookworm AS build
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
RUN ln -s bun /usr/local/bin/bunx
WORKDIR /src
# ELECTRON_SKIP_BINARY_DOWNLOAD: the web build never launches Electron.
# CI=true: postinstall skips electron-builder native rebuilds.
# HUSKY=0: no git hooks in a container build.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1 CI=true HUSKY=0 \
    BUN_INSTALL_REGISTRY=https://registry.npmjs.org/ \
    NODE_OPTIONS=--max-old-space-size=8192
COPY . .
RUN bun install --frozen-lockfile
RUN bunx electron-vite build --config packages/desktop/electron.vite.config.ts
RUN PACK_PLATFORM=linux PACK_ARCH=x64 node scripts/pack-web-cli.js

# ---- Stage 2: runtime -------------------------------------------------------
FROM node:22-bookworm-slim
# libicu72: officecli (Office previews) aborts without it.
# git/curl/procps/python3: agent tooling + cache-eviction helper.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libicu72 git curl procps python3 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/dist-web-cli/ /tmp/dist/
RUN mkdir -p /opt \
    && tar xzf /tmp/dist/aionui-web-*-linux-x86_64.tar.gz -C /opt \
    && rm -rf /tmp/dist \
    && chmod +x /opt/aionui-web/aionui-web
COPY entrypoint.sh /entrypoint.sh
# IS_SANDBOX=1: Claude Code refuses --dangerously-skip-permissions as root
#   unless told it runs in a sandbox (this container IS the sandbox).
# GEMINI_CLI_TRUST_WORKSPACE=true: Gemini CLI refuses fresh per-conversation
#   workspace dirs otherwise.
# AIONUI_REMOTE_AUTH=1: untrusted-network deployment — auth stays ON.
ENV PORT=25808 \
    AIONUI_ALLOW_REMOTE=true \
    AIONUI_REMOTE_AUTH=1 \
    AIONUI_DATA_DIR=/data \
    HOME=/data \
    IS_SANDBOX=1 \
    GEMINI_CLI_TRUST_WORKSPACE=true
# Agent CLIs land here at boot; also on PATH for `railway ssh`.
ENV PATH=/data/agents/bin:$PATH
EXPOSE 25808
ENTRYPOINT ["/entrypoint.sh"]
