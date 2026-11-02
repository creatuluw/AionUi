# AionUi Multi-User on Railway — Architecture & Implementation Plan

**Goal**: Multi-user AionUi on Railway — people sign up with invite codes (or are provisioned by admins), work in their own accounts, and use either **their own API keys (BYOK)** or the **admin-enabled shared key pool**.

**Status**: Decisions locked (2026-11-02). Secure-design walkthrough included (§6). Next step: Milestone 0.

---

## 1. Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Tenancy | **Multi-user from the start** (no separate single-tenant release) |
| 2 | Code strategy | **We own forks of both repos** and modify them (see §2) |
| 3 | Shared keys | **Shared convenience** — admins can enable a shared key service; no billing, simple fair-use caps |
| 4 | Signup | **Invite codes + admin-provisioned accounts** (no open signup) |

---

## 2. Fork topology (decision #2, flagged assumption)

- **`hoipippeloi/AionUi`** (TypeScript: Electron shell, web-host, web-cli, renderer) — already exists; our working copy `E:/AionUi` tracks it, currently at upstream v2.2.2 / aioncore v0.2.2.
- **`hoipippeloi/AionCore`** (Rust: the Axum + SQLite backend) — **to be created**. Your link pointed at the AionUi fork, but multi-user + per-user keys + shared pool **cannot ship TS-only**: providers, auth, and the users table live in AionCore. It is public, Apache-2.0, actively maintained (`github.com/iOfficeAI/AionCore`, ~1.5k commits, documented crate conventions), so we fork it the same way. This is the flagged assumption of this plan — say the word if you'd rather coordinate with upstream instead of maintaining the fork.

Both forks stay as close to upstream as possible; our changes concentrate in AionCore where the features actually live.

**Why the Rust side is unavoidable** (verified): handlers extract the authenticated user and services take `&user.id` — conversations/teams are already user-scoped in Rust. But providers (`aionui-system` crate) are global rows, there is no signup/invite flow, and `listProviders` returns raw `api_key` values.

---

## 3. Target architecture

```
                        Railway (TLS at edge)
  Browser ──HTTPS──► web-host static server (:PORT, 0.0.0.0)
                      ├─ serves SPA (our fork's renderer)
                      ├─ CSRF bridge: fills x-csrf-token from cookie (same-origin)
                      └─ proxies /api/*, /login, /logout, /ws ──► aioncore (our fork, built from source)
                                                                    ├─ JWT cookie auth + CSRF + rate limits  [built]
                                                                    ├─ users: admin/member roles             [new: roles]
                                                                    ├─ invite codes + admin user mgmt        [new]
                                                                    ├─ providers: user-scoped + shared pool  [new]
                                                                    ├─ usage metering + fair-use caps        [new]
                                                                    ├─ keys encrypted at rest                [built: encryption_secret_raw]
                                                                    └─ spawns agent CLIs (gemini/claude/codex/opencode)
  Volume /data: SQLite (aionui.db), workspaces, logs, agent CLIs
```

**Key architectural fix** (prerequisite for everything): today every conversation embeds a full provider snapshot **including the raw `api_key`** (`conversations.model` column). In the fork, conversations store a **provider reference**, and AionCore resolves (and decrypts) the key at send time. Without this, per-user keys, key rotation, and key masking are all impossible.

---

## 4. Workstreams

### A. Railway runtime (TS fork) — *unblocks everything, uses upstream aioncore v0.2.2 unchanged*

- Enable real auth in web mode: env-gate `local` in `packages/web-host/src/backend-launcher.ts` (`AIONUI_REMOTE_AUTH=1` → `local: false`).
- CSRF bridge in `packages/web-host/src/static-server.ts` proxy (pattern from `two-workspaces/aionui` `remote-auth.patch`): same-origin requests get `x-csrf-token` filled from the `aionui-csrf-token` cookie; cross-site requests still fail.
- Replace the dead root `Dockerfile` (references deleted `build-server.mjs`, wrong `DATA_DIR` var) with a two-stage image:
  - **build**: bun + our repo → `bun install` → `electron-vite build` → `pack-web-cli.js` (linux-x64)
  - **runtime**: `node:22-bookworm-slim` + `libicu72 git curl procps python3`; env: `AIONUI_DATA_DIR=/data`, `AIONUI_ALLOW_REMOTE=true`, `AIONUI_PORT=$PORT`, `IS_SANDBOX=1`, `GEMINI_CLI_TRUST_WORKSPACE=true`
- `entrypoint.sh` (adapted from the template): bootstrap admin password from Railway var via `aioncore user set-password --password-stdin`; PBKDF2-stamp on volume so plain redeploys don't revoke sessions; install `AIONUI_AGENTS` CLIs onto the volume at boot; **page-cache eviction loop** (Railway counts page cache as memory).

### B. AionCore fork — multi-user foundation (Rust)

- Roles: `role` column on `users` (`admin` | `member`) + `require_admin` middleware; bootstrap admin = existing `system_default_user`.
- Invite codes: new migration in `crates/aionui-db/migrations/`; codes ≥128-bit random, **stored hashed**, single-use, expiry, revocable; `POST /api/auth/register {code, username, password}` (public, rate-limited — redemption can never grant admin).
- Admin provisioning: `POST /api/admin/users`, list/disable/reset-password endpoints (replaces the current local-only `/api/webui/*` paths, which are unreachable in remote mode — the known limitation of the template build).
- AuthZ convention (matches existing crate rules): handlers pass `user` into services; **every repository query scoped by `user_id`**; service-layer ownership check `row.user_id == user.id || user.role == admin`.
- Proper `POST /api/admin/users/:id/revoke-sessions` (replaces the template's disable/enable hack).

### C. AionCore fork — per-user BYOK + shared pool (Rust)

- Migration: `providers.owner_user_id` (nullable) + `providers.visibility` (`private` | `shared`).
- Provider service in `aionui-system`: list/create/update/delete scoped by owner; **shared rows visible read-only to all members when the `shared_key_service_enabled` system setting is on** (admin toggle — decision #3).
- **Mask keys in every response**: return `masked_key` (e.g. `AIza…9f2c`) + `has_key`; raw keys never leave the backend.
- Credential resolution at send time: decrypt `api_key` (existing `encryption_secret_raw` path — keep it decoupled from the JWT secret; set it explicitly as a Railway variable so volume backups stay decryptable).
- Usage metering: `(user_id, provider_id, day, requests)` table updated per send; powers the **fair-use cap** on shared providers (per-user daily request cap, admin-configurable default) → `429 RATE_LIMITED` when exceeded.
- Admin endpoints: toggle shared service, CRUD pool providers, per-user usage view.

### D. Web UI (TS fork)

- Signup-via-invite page; account settings (change password/username — existing endpoints become user-accessible); "shared" badge on pool providers in the model picker.
- Admin console page: users, invite codes, shared-key toggle, usage overview.
- Real client CSRF support: replace the no-op stubs in `AuthContext.tsx` / `httpBridge.ts` — read the cookie, send the header (the proxy bridge in A stays as defense-in-depth).

### E. CI/CD + ops

- TS fork CI: extend `.github/workflows/pack-web-cli.yml` to produce the patched-by-construction web tarball (it's our code now, no patch step).
- AionCore fork CI: build linux-x64 aioncore (repo has `Cross.toml` + workflows); pin `aioncoreVersion` in our TS fork to **our** release.
- Railway: one service + one volume (`/data`); recommended ≥ 2 GB RAM (idle ~75 MB + 200–600 MB per running agent CLI); volume snapshot schedule.

---

## 5. Milestones

| # | Milestone | Ships | Depends on |
|---|-----------|-------|------------|
| M0 | Container on Railway with auth ON, single admin | A | — |
| M1 | Multi-user accounts (invite + admin-provisioned) | B + D auth UI | M0 |
| M2 | Per-user BYOK (scoped, masked, reference-not-snapshot) | C core + D settings | M1 |
| M3 | Shared key pool + fair-use caps + admin console | C pool + D admin | M2 |
| M4 | Hardening | non-root user, audit log, backup schedule, secret-scrub audit | M3 |

Each milestone gets a `rafter-code-review` pass on its diff before done.

---

## 6. Secure-design walkthrough (rafter-secure-design)

### 6.1 Authentication & Authorization

- **Identity**: humans only (agents act *as* the user via the user's session — delegated; no separate agent principal in v1). No federation: justified because invite-only, admin-provisioned, small trusted user base, and aioncore already ships a hardened password pipeline (bcrypt cost 12, timing-attack floor, enumeration-safe dummy hash). OIDC = future option.
- **AuthN primitive**: JWT (HS256) in HttpOnly cookies — already built (`aionui-auth`); 24 h access token + 30 d cookie + refresh endpoint; revocation via server-side token blacklist; password/username change rotates the signing secret (global logout).
  - *Refuse-list waivers*: HS256 symmetric — accepted because signer and verifier are the same process (single binary), no key-confusion surface; re-evaluate if a second verifier ever appears. Not adopting PASETO — we inherit a maintained, exercised implementation rather than writing a new one.
- **AuthZ model**: RBAC (`admin`/`member`) **plus** resource-ownership checks (roles alone can't express "own records only"). Enforced in the service/repository layer (AionCore's convention), not per-route — routes only extract `Extension(user)`.
- **IDOR/BOLA**: every `/api/providers/:id`, conversation, team, admin route checks `owner == caller || caller is admin` in the service layer. All repository access goes through typed traits — raw-SQL-without-scoping is a code-review rule, not just a convention.
- **Sessions**: password change → secret rotation (kills all sessions, existing behavior); logout → server-side blacklist + cookie clear (existing); invite codes never grant admin; role fixed at account creation by an admin.
- **Credential stuffing**: login rate limit 5 fails/15 min/IP + API 60/min/IP + actions 20/min/user — all built; no open signup (decision #4).
- **MFA**: out of scope v1 (invite-only mitigates); revisit for admin accounts in M4.

### 6.2 Data storage

- **Classification**: username/email = identifier (PII-lite); passwords = credential (bcrypt, never reversible); **provider `api_key`s = crown-jewel credentials** (app-encrypted at rest); `encryption_secret_raw` + JWT secret + `AIONUI_ADMIN_PASSWORD` = secrets (Railway variable store); conversations/workspaces = content (plaintext on volume — accepted v1); admin actions + usage metering = audit.
- **Keys**: AionCore's `encryption_secret_raw` (already decoupled from the JWT secret) is the KEK for stored keys. **Set it explicitly as a Railway variable** — otherwise a fresh auto-generated secret and an old volume = undecryptable keys. Rotation = update variable + redeploy + re-enter keys (documented runbook; rare event).
- **Secrets**: Railway encrypted variable store is the accepted secret manager (no KMS on Railway — documented waiver; env vars are Railway's supported mechanism). `AIONUI_ADMIN_PASSWORD` never lands in logs (bootstrap reads stdin).
- **Tenancy isolation**: row-level (`user_id` column) — chosen deliberately: single-level tenancy, SQLite, trusted invite-only users, and all access flows through typed Repository traits, so scoping is reviewable per query. Upgrade path (DB-per-tenant) exists if ever needed.
- **Retention/deletion**: v1 = disable user (soft) + admin-triggered purge (conversations, teams, providers, workspace files). Logs: must not contain keys/tokens — scrub audit is an M4 acceptance criterion.
- **Backups**: Railway volume snapshots share blast radius with live data (platform limitation, accepted + documented); better story (scheduled `sqlite3 .backup` to a second volume) deferred to M4.

### 6.3 API surface & deployment (key points)

- Public routes: `POST /login`, `POST /api/auth/register` (invite redemption — rate-limited, hashed codes), `GET /api/auth/status`. Everything else behind auth middleware; admin routes behind role middleware.
- No tenant id ever accepted from the request — always from the session.
- Errors use the existing `ErrorResponse` taxonomy (`DbError::Query` → generic `Internal`) — no internal leakage.
- Transport: TLS 1.2+ terminated at Railway's edge; cookies get `Secure` automatically on HTTPS (existing behavior); the app itself stays plain HTTP inside the container (single service, no internal hops).
- **Biggest accepted risk**: all users' agents execute shell commands in the **same container, as root** — the container is the sandbox. Invite-only + trusted users is the mitigation in v1; non-root runtime in M4 shrinks it; true per-user isolation (per-user containers) is explicitly out of scope for Railway and would require a different platform.

### 6.4 STRIDE summary

| Threat | Control |
|--------|---------|
| Spoofing | HttpOnly cookie JWT, CSRF double-submit (built) + proxy bridge, WS token validation (built) |
| Tampering | Service-layer ownership checks + role middleware; integration tests per scoping rule |
| Repudiation | Minimal admin audit log + usage metering (who used which key, when) |
| Info disclosure | Masked keys in all responses; keys never in conversation snapshots (§3 fix); error taxonomy |
| DoS | Built-in rate limits; per-user fair-use cap on shared pool; cache eviction + RAM sizing |
| Elevation of privilege | Invite redemption can't grant admin; `/api/webui/*` local-only paths replaced by admin-gated routes; non-root in M4 |

---

## 7. Open items

- [ ] Create `hoipippeloi/AionCore` fork (§2 assumption — confirm)
- [ ] Verify aioncore CLI surface for our entrypoint (`user set-password/disable/enable` exist in v0.2.2 per the template; confirm in our pinned version)
- [ ] Confirm whether `encryption_secret_raw` can be injected via env var (vs. DB-stored) — decides the Railway variable name in M0
- [ ] Decide agent CLI default set for `AIONUI_AGENTS` (template default: claude, codex, gemini, opencode)
