/**
 * Secrets at rest (SPEC.md §9, CLAUDE.md invariant 5, 7).
 *
 * expo-secure-store keeps these in the Android Keystore-backed shared preferences, not in
 * plain app storage. What lives here:
 *   - the session bearer token;
 *   - the device's X25519 identity private key (the single most important secret on the
 *     device: it is what makes one-sided interest unreadable to the server);
 *   - the user id.
 *
 * What is **not** here: the daily keys. They live in `mutual.db`
 * (`storage/localDb.ts`, table `daily_keys`) until the night they are uploaded as encounter
 * tokens and deleted. That is deliberate and is now written into SPEC §9.1: device
 * compromise is out of scope (§7.2), and SecureStore has no enumeration, so keeping a set
 * of per-day keys here would need a second index to list them. The identity key is the
 * exception because it outlives every daily key and is what makes one-sided interest
 * unreadable to the server (claim C1).
 *
 * What must never live here, or anywhere on the device: a plaintext email address, a date
 * of birth, or an OTP code (invariant 5).
 */

import * as SecureStore from 'expo-secure-store';

const SESSION_TOKEN = 'mutual.session_token';
const IDENTITY_SK = 'mutual.identity_sk';
const IDENTITY_PK = 'mutual.identity_pk';
const USER_ID = 'mutual.user_id';

/** expo-secure-store is string-only, so byte keys are stored base64url-encoded. */
async function getString(key: string): Promise<string | null> {
  return SecureStore.getItemAsync(key);
}

async function setString(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
}

export async function getSessionToken(): Promise<string | null> {
  return getString(SESSION_TOKEN);
}

export async function setSessionToken(token: string): Promise<void> {
  await setString(SESSION_TOKEN, token);
}

export async function clearSessionToken(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_TOKEN);
}

/** The identity keypair, base64url-encoded. Generated once, at account creation. */
export interface StoredIdentity {
  sk: string;
  pk: string;
}

export async function getIdentity(): Promise<StoredIdentity | null> {
  const [sk, pk] = await Promise.all([getString(IDENTITY_SK), getString(IDENTITY_PK)]);
  return sk && pk ? { sk, pk } : null;
}

export async function setIdentity(identity: StoredIdentity): Promise<void> {
  await Promise.all([setString(IDENTITY_SK, identity.sk), setString(IDENTITY_PK, identity.pk)]);
}

export async function getUserId(): Promise<string | null> {
  return getString(USER_ID);
}

export async function setUserId(userId: string): Promise<void> {
  await setString(USER_ID, userId);
}

/**
 * Wipes every secret. Used on logout and on account deletion -- after this the device
 * cannot read any token it previously built, which is the point.
 */
export async function clearAll(): Promise<void> {
  await Promise.all(
    [SESSION_TOKEN, IDENTITY_SK, IDENTITY_PK, USER_ID].map((k) => SecureStore.deleteItemAsync(k)),
  );
}
