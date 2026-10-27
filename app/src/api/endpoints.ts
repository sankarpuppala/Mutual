/**
 * One typed function per server route (SPEC.md §11), all going through `./client.ts`.
 *
 * The point of collecting them here rather than letting screens assemble paths is that this
 * file can be read in one sitting and checked against invariant 1: **there is no function
 * here that a screen could call because a user looked at something.** The two that could be
 * mistaken for one are:
 *
 *  - `getDigest()`, which returns the whole day's snapshot at once, not a page or a card;
 *  - `getMedia()`, which only `src/digest/prefetch.ts` may call, and only for every item in
 *    the digest's media list in the order it lists them.
 *
 * Added to SPEC §20's file list in the same change that introduced it (Phase 10).
 */

import { Platform } from 'react-native';

import { api } from './client';
import type {
  AccountMe,
  CreateAccountRequest,
  CreateAccountResponse,
  DigestResponse,
  Match,
  Message,
  PresenceUpload,
  ProfileRequest,
  PromptLibrary,
  ReportReason,
  ServerConfig,
  SignalsUpload,
  VerifyOtpResponse,
} from './types';

// ------------------------------------------------------------------- auth

/**
 * Always resolves for an allowed college domain, whether or not a code was actually sent:
 * the 60-second resend cooldown is applied silently (SPEC §11), so a caller cannot use the
 * response to probe whether an address is already registered.
 */
export async function requestOtp(email: string): Promise<void> {
  await api.post<void>('/auth/request-otp', { email }, { auth: false });
}

export async function verifyOtp(email: string, code: string): Promise<VerifyOtpResponse> {
  return api.post<VerifyOtpResponse>('/auth/verify-otp', { email, code }, { auth: false });
}

export async function logout(): Promise<void> {
  await api.post<void>('/auth/logout');
}

// ---------------------------------------------------------------- account

/**
 * Creates the account. The date of birth is sent exactly once, checked for 18+ and then
 * discarded by the server (S1, invariant 5); it is never written to device storage either.
 */
export async function createAccount(
  body: CreateAccountRequest,
): Promise<CreateAccountResponse> {
  return api.post<CreateAccountResponse>('/account', body);
}

export async function getMe(): Promise<AccountMe> {
  return api.get<AccountMe>('/account/me');
}

/** For a reinstall. Rate-limited server-side to once per `identity_key_change_min_days`. */
export async function replaceIdentityKey(identityPk: string): Promise<void> {
  await api.put<void>('/account/identity-key', { identity_pk: identityPk });
}

/** What a piece of feedback is about (SPEC §11.4). Never names or points at a person. */
export type FeedbackCategory = 'idea' | 'problem' | 'other';

/** POST /feedback: a message to the Mutual team, sent only when the student presses Send. */
export async function sendFeedback(category: FeedbackCategory, body: string): Promise<void> {
  await api.post<void>('/feedback', { category, body });
}

export async function deleteAccount(): Promise<void> {
  await api.delete<void>('/account');
}

// ---------------------------------------------------------------- profile

export async function getPromptLibrary(): Promise<PromptLibrary> {
  return api.get<PromptLibrary>('/prompts');
}

export async function putProfile(body: ProfileRequest): Promise<void> {
  await api.put<void>('/profile', body);
}

/**
 * Uploads a voice answer: the m4a file plus its 48 waveform values.
 *
 * The waveform is computed on the device while recording (`VoiceRecorder`), not derived
 * from the audio by the server, so the server never has to decode the file.
 */
export async function uploadVoice(
  promptId: string,
  file: { uri: string; name: string },
  waveform: readonly number[],
): Promise<{ media_id: string }> {
  const form = new FormData();
  form.append('audio', {
    uri: file.uri,
    name: file.name,
    type: 'audio/m4a',
  } as unknown as Blob);
  form.append('waveform', JSON.stringify(waveform));
  return api.upload<{ media_id: string }>(`/profile/voice/${promptId}`, form);
}

export async function deleteVoice(promptId: string): Promise<void> {
  await api.delete<void>(`/profile/voice/${promptId}`);
}

/** At most four. The server strips every piece of metadata and re-encodes (SPEC §11). */
export async function uploadPhoto(file: {
  uri: string;
  name: string;
  mimeType: string;
  base64?: string | null;
}): Promise<{ media_id: string; index: number }> {
  if (file.base64) {
    return api.post<{ media_id: string; index: number }>('/profile/photos', {
      data: file.base64,
    });
  }

  let normalizedUri = file.uri;
  if (Platform.OS === 'android' && !normalizedUri.startsWith('file://') && !normalizedUri.startsWith('content://')) {
    normalizedUri = `file://${normalizedUri.replace(/^file:\/*/, '')}`;
  }
  let filename = file.name || normalizedUri.split('/').pop() || 'photo.jpg';
  if (!filename.includes('.')) {
    filename = `${filename}.jpg`;
  }
  const type = file.mimeType || 'image/jpeg';

  const form = new FormData();
  form.append('image', {
    uri: normalizedUri,
    name: filename,
    type,
  } as unknown as Blob);
  return api.upload<{ media_id: string; index: number }>('/profile/photos', form);
}

export async function deletePhoto(index: number): Promise<void> {
  await api.delete<void>(`/profile/photos/${index}`);
}

export async function getPhotos(): Promise<{ media_id: string; index: number }[]> {
  return api.get<{ media_id: string; index: number }[]>('/profile/photos');
}

// ------------------------------------------------------- presence and digest

/**
 * The night's padded encounter-token set for `day` (SPEC §6.13).
 *
 * Everything in `body` is an opaque 32-byte token. No daily key, ephemeral id, RSSI value or
 * sighting time may ever be passed to this function (invariant 3); a jest test asserts it
 * for the whole presence path (AC-T2-2).
 */
export async function uploadPresence(day: string, body: PresenceUpload): Promise<void> {
  await api.post<void>(`/presence/${day}`, body);
}

/**
 * The whole morning letter in one response, including the list of every media item in it.
 *
 * It is byte-identical between release times (claim C5), so polling tells the server
 * nothing -- and because it arrives complete, no later request depends on which card the
 * user opened (invariant 1).
 */
export async function getDigest(): Promise<DigestResponse> {
  return api.get<DigestResponse>('/digest');
}

/** Only `src/digest/prefetch.ts` may call this. See the note at the top of this file. */
export async function getMedia(mediaId: string): Promise<ArrayBuffer> {
  return api.media(mediaId);
}

// ------------------------------------------------------- signals and matches

/**
 * Uploads the epoch's padded signal set: exactly 20 tokens, shuffled, once per epoch, at a
 * random time inside the window (SPEC §6.7, §6.11).
 *
 * This is the single most privacy-sensitive call in the app. It must never be triggered by a
 * user action -- only by `src/signals/scheduler.ts` at its chosen time.
 */
export async function uploadSignals(epoch: string, body: SignalsUpload): Promise<void> {
  await api.put<void>(`/signals/${epoch}`, body);
}

export async function getMatches(): Promise<Match[]> {
  return api.get<Match[]>('/matches');
}

export async function getMessages(matchId: string, after?: string): Promise<Message[]> {
  const query = after ? `?after=${encodeURIComponent(after)}` : '';
  return api.get<Message[]>(`/matches/${matchId}/messages${query}`);
}

export async function sendMessage(matchId: string, body: string): Promise<Message> {
  return api.post<Message>(`/matches/${matchId}/messages`, { body });
}

/** Policy C only: both sides consenting reveals photos early (SPEC §11.2). */
export async function postRevealConsent(matchId: string): Promise<void> {
  await api.post<void>(`/matches/${matchId}/reveal-consent`);
}

export async function unmatch(matchId: string): Promise<void> {
  await api.delete<void>(`/matches/${matchId}`);
}

/** The photo URL for a revealed match. Fetched through the image loader, not `fetch`. */
export function matchPhotoPath(matchId: string, index: number): string {
  return `/matches/${matchId}/photos/${index}`;
}

// --------------------------------------------------------- safety and config

/**
 * Blocks a peer. Returns 204 whether or not the id means anything to the server (SPEC §11),
 * so neither the caller nor an observer learns whether a match or crossing existed -- which
 * is what keeps a block from becoming a probe.
 */
export async function blockPeer(peerId: string): Promise<void> {
  await api.post<void>('/blocks', { peer_id: peerId });
}

export async function reportPeer(
  peerId: string,
  reason: ReportReason,
  messageIds: string[] = [],
): Promise<void> {
  await api.post<void>('/reports', {
    peer_id: peerId,
    reason,
    message_ids: messageIds,
  });
}

export async function pauseDiscovery(): Promise<void> {
  await api.post<void>('/discovery/pause');
}

export async function resumeDiscovery(): Promise<void> {
  await api.post<void>('/discovery/resume');
}

export async function getConfig(): Promise<ServerConfig> {
  return api.get<ServerConfig>('/config');
}

// ------------------------------------------------------------------ dev only

/** Dev server only; absent otherwise (invariant 11). */
/** One synthetic account from `python -m mutual_server.demo_seed` (dev only). */
export interface DemoAccount {
  user_id: string;
  first_name: string;
  session_token: string;
  identity_sk: string;
  identity_pk: string;
}

export const dev = {
  /** The last demo_seed run's accounts, for one-tap login in the dev panel. */
  async demoAccounts(): Promise<{ campus: string; users: DemoAccount[] }> {
    return api.get<{ campus: string; users: DemoAccount[] }>('/dev/demo-accounts');
  },
  async setClockOffset(offsetSeconds: number): Promise<void> {
    await api.post<void>('/dev/clock', { offset_seconds: offsetSeconds });
  },
  async makeCrossing(userA: string, userB: string, day: string): Promise<void> {
    await api.post<void>('/dev/crossing', { user_a: userA, user_b: userB, day });
  },
  async seed(count: number, campusKey: string): Promise<unknown> {
    return api.post<unknown>('/dev/seed', { count, campus_key: campusKey });
  },
};
