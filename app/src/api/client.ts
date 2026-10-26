/**
 * The ONLY place in the app that touches the network (SPEC.md §13.8, CLAUDE.md invariant 1).
 * ESLint forbids `fetch` and `XMLHttpRequest` everywhere else, and
 * `scripts/check-privacy-invariants.ts` fails the build if either appears outside this file.
 *
 * Two privacy rules shape this module and are easy to break by accident:
 *
 * 1. **Nothing attention-dependent.** No function here may be called because a user
 *    viewed, opened, scrolled to or played something. Digest media is fetched in full by
 *    `src/digest/prefetch.ts` in a fixed order; UI components read the local cache only.
 * 2. **No per-user logging.** Request URLs, bodies and tokens are never logged, not even in
 *    dev. A console line naming a peer id is a leak into the device log.
 *
 * Everything crossing this boundary is already-encoded protocol data: base64url token
 * strings. Daily keys, ephemeral ids, RSSI values and sighting times must never be passed
 * to any function in this file (CLAUDE.md invariant 3) -- a jest test asserts this for the
 * presence path (AC-T2-2).
 */

import Constants from 'expo-constants';

import {
  clearServerUrlOverride,
  getServerUrlOverride,
  getSessionToken,
  setServerUrlOverride,
} from '../storage/secure';

/** Shape of the server's error body (SPEC §11). */
export interface ApiErrorBody {
  error: string;
  message: string;
}

/** A non-2xx response. Carries the server's error code so screens can branch on it. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** The request never reached the server (airplane mode, server down, DNS). */
export class NetworkError extends Error {
  constructor() {
    // No cause attached: an underlying fetch error message can contain the URL.
    super('Could not reach Mutual.');
    this.name = 'NetworkError';
  }
}

interface Extra {
  serverBaseUrl?: string;
  env?: string;
}

function extra(): Extra {
  return (Constants.expoConfig?.extra ?? {}) as Extra;
}

/**
 * A dev-panel override of the compiled-in address, held in memory so `baseUrl()` can stay
 * synchronous. `loadServerUrlOverride()` fills it at startup; the dev panel sets it.
 */
let serverUrlOverride: string | null = null;

/** The server base URL: the dev override if one is set, else app.config.ts. */
export function baseUrl(): string {
  const url = serverUrlOverride ?? extra().serverBaseUrl;
  if (!url) throw new Error('serverBaseUrl is not configured; see app.config.ts');
  return url.replace(/\/+$/, '');
}

/**
 * Reads the stored override into memory. Called once at startup, before anything fetches.
 *
 * Ignored outside a dev build: the override is a development affordance for sideloaded
 * builds whose compiled-in address has gone stale, and a prod build must always talk to
 * the address it shipped with.
 */
export async function loadServerUrlOverride(): Promise<void> {
  if (!isDev()) return;
  serverUrlOverride = await getServerUrlOverride();
}

/** Points this device at `url`, or back at the compiled-in address when given null. */
export async function overrideServerUrl(url: string | null): Promise<void> {
  if (!isDev()) return;
  if (url === null) {
    serverUrlOverride = null;
    await clearServerUrlOverride();
    return;
  }
  const trimmed = url.trim().replace(/\/+$/, '');
  serverUrlOverride = trimmed;
  await setServerUrlOverride(trimmed);
}

/** True when the app is running against a dev server (enables the dev panel, SPEC §13.2). */
export function isDev(): boolean {
  return extra().env === 'dev';
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface RequestOptions {
  /** Send the session bearer token. Default true; false for the OTP endpoints. */
  auth?: boolean;
  /** JSON body. Omitted for GET and for endpoints that take none. */
  body?: unknown;
  /** Already-built multipart body, for the two upload endpoints. */
  form?: FormData;
  /** Abort signal, so a screen leaving can cancel its own in-flight request. */
  signal?: AbortSignal;
}

const TIMEOUT_MS = 20_000;

/**
 * Longer than `TIMEOUT_MS`: a voice note is up to a few hundred kilobytes over whatever
 * connection a campus has at 8 am, where a JSON response is a few hundred bytes. Long
 * enough to be generous, finite so one stalled socket cannot hold up the whole prefetch.
 */
const MEDIA_TIMEOUT_MS = 60_000;

async function parseError(response: Response): Promise<ApiError> {
  let code = 'http_error';
  let message = 'Something went wrong.';
  try {
    const body = (await response.json()) as Partial<ApiErrorBody>;
    if (typeof body.error === 'string') code = body.error;
    if (typeof body.message === 'string') message = body.message;
  } catch {
    // A non-JSON error body (a proxy page, say) keeps the generic code above.
  }
  return new ApiError(response.status, code, message);
}

/**
 * Performs one request and returns the parsed body, or undefined for 204/202 responses.
 * Callers use the typed wrappers below rather than this directly.
 */
export async function request<T>(
  method: Method,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { auth = true, body, form, signal } = options;

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (auth) {
    const token = await getSessionToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const controller = new AbortController();
  const timeoutMs = form ? MEDIA_TIMEOUT_MS : TIMEOUT_MS;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

  let response: Response;
  try {
    response = await fetch(`${baseUrl()}/v1${path}`, {
      method,
      headers,
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
      signal: controller.signal,
    });
  } catch {
    // Deliberately swallowing the underlying error: its message can contain the full URL,
    // and a URL with a peer or match id in it must not reach a log or a crash report.
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) throw await parseError(response);
  if (response.status === 204 || response.status === 202) return undefined as T;

  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export const api = {
  get: <T>(path: string, options?: Omit<RequestOptions, 'body' | 'form'>) =>
    request<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('POST', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: Omit<RequestOptions, 'body'>) =>
    request<T>('PUT', path, { ...options, body }),
  delete: <T>(path: string, options?: Omit<RequestOptions, 'body' | 'form'>) =>
    request<T>('DELETE', path, options),
  /** Multipart upload, for voice notes and photos only (SPEC §11 Profile). */
  upload: <T>(path: string, form: FormData) => request<T>('POST', path, { form }),
  /**
   * Fetches a media file as bytes. Only `src/digest/prefetch.ts` may call this, and only
   * for every item in the digest's media list, in the listed order (invariant 1).
   */
  async media(mediaId: string): Promise<ArrayBuffer> {
    const token = await getSessionToken();

    // The same timeout `request` uses. The prefetch loop is deliberately sequential, so a
    // single hung connection here would stall the rest of the morning's prefetch for as
    // long as the socket stayed open -- and every voice note after it would then be missing
    // from the cache, which on screen looks like one person's recording being broken.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MEDIA_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(`${baseUrl()}/v1/media/${mediaId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      });
    } catch {
      throw new NetworkError();
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw await parseError(response);
    return response.arrayBuffer();
  },
};
