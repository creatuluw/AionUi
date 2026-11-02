/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared auth identity + multi-user admin API types.
 *
 * Mirror of the backend auth/admin contracts (camelCase JSON). The backend
 * workstream may land slightly after the UI — every field beyond the stable
 * identity pair (`id`, `username`) is optional so the UI degrades gracefully
 * when an older backend omits it.
 */

/** Role of an authenticated user. Only `admin` sees the admin console. */
export type AuthRole = 'admin' | 'member';

/** The authenticated user as reported by /api/auth/user and /api/auth/register. */
export type IAuthUser = {
  id: string;
  username: string;
  /** Present when the backend has multi-user roles enabled. */
  role?: AuthRole;
};

/** A user as listed by GET /api/admin/users. */
export type IAdminUser = {
  id: string;
  username: string;
  role: AuthRole;
  /** Disabled users cannot sign in. Absent/falsy = enabled. */
  disabled?: boolean;
  created_at?: string | number;
};

/** Params for POST /api/admin/users (admin provisioned user). */
export type AdminCreateUserRequest = {
  username: string;
  password: string;
  role: AuthRole;
};

/** An invite as listed by GET /api/admin/invites. */
export type IAdminInvite = {
  id: string;
  /**
   * Code hint. List responses never contain the plaintext code — at most a
   * masked hint (the plaintext is returned exactly once on create).
   */
  code?: string;
  /** Backend-provided status when present; the UI derives one otherwise. */
  status?: string;
  created_at?: string | number;
  created_by?: string | null;
  /** Expiry instant (ISO string or epoch millis) when the invite expires. */
  expires_at?: string | number | null;
  /** Set when the invite has been redeemed. */
  used_at?: string | number | null;
  used_by?: string | null;
  /** Revoked invites can no longer be redeemed. */
  disabled?: boolean;
};

/** Params for POST /api/admin/invites. */
export type AdminCreateInviteRequest = {
  /** Optional expiry, in hours from now. Omit for a non-expiring invite. */
  expires_in_hours?: number;
};

/** POST /api/admin/invites response — the ONLY place the plaintext code appears. */
export type AdminCreateInviteResponse = IAdminInvite & {
  /** Plaintext invite code, returned exactly once. */
  code: string;
};

/** Shared pool settings — GET/PUT /api/admin/pool-settings. */
export type IPoolSettings = {
  /** When true, members without their own keys can use the shared provider pool. */
  shared_key_service_enabled: boolean;
  /** Daily request cap for the shared pool. */
  shared_pool_daily_request_cap: number;
};

/**
 * Derive a coarse invite status for display. Prefers an explicit backend
 * `status`; falls back to a derivation over the timestamps so an older backend
 * without `status` still renders sensibly.
 */
export function deriveInviteStatus(invite: IAdminInvite, now: number = Date.now()): string {
  if (invite.status) {
    return invite.status;
  }
  if (invite.disabled) {
    return 'revoked';
  }
  if (invite.used_at) {
    return 'used';
  }
  if (invite.expires_at) {
    const expiry = typeof invite.expires_at === 'number' ? invite.expires_at : Date.parse(invite.expires_at);
    if (!Number.isNaN(expiry) && expiry <= now) {
      return 'expired';
    }
  }
  return 'active';
}
