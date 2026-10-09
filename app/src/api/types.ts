/**
 * Request and response shapes for the server API (SPEC.md §11).
 *
 * These mirror `server/mutual_server/schemas.py`. Two absences are deliberate and are the
 * whole point of the protocol, so they are called out here where someone adding a field
 * will read them:
 *
 *  - **No field anywhere carries an intent** (claim C3). An intent exists on this device as
 *    a label beside a locally stored token, and nowhere else. `server/tests/test_route_audit.py`
 *    fails the build if one appears in a server schema.
 *  - **No presence type carries a key, an ephemeral id, an RSSI value or a time**
 *    (invariant 3). `PresenceUpload` is a list of opaque token strings and nothing else.
 *
 * Added to SPEC §20's file list in the same change that introduced it (Phase 10).
 */

/** The five reasons to signal. Device-local: never sent, never stored by the server. */
export const INTENTS = ['study', 'project', 'fitness', 'friend', 'date'] as const;
export type Intent = (typeof INTENTS)[number];

export const INTENT_LABELS: Record<Intent, string> = {
  study: 'Study',
  project: 'Project',
  fitness: 'Fitness',
  friend: 'Friend',
  date: 'Date',
};

// ------------------------------------------------------------------ auth

export interface VerifyOtpResponse {
  session_token: string;
  account_exists: boolean;
}

export interface CreateAccountRequest {
  /** `YYYY-MM-DD`. Sent once, checked for 18+, then discarded by the server (S1). */
  date_of_birth: string;
  /** base64url X25519 public key. */
  identity_pk: string;
  first_name: string;
  year_of_study?: number;
  /** Required only when the server runs in study mode (invariant 9). */
  consent_version?: string;
}

export interface CreateAccountResponse {
  user_id: string;
}

export interface Campus {
  id: string;
  key: string;
  name: string;
}

export interface OwnProfile {
  prompts: PromptAnswer[];
  tags: string[];
  /** Own photo media ids, in index order. */
  photos: string[];
}

export interface AccountMe {
  user_id: string;
  first_name: string;
  year_of_study: number | null;
  campus: Campus;
  discovery_paused: boolean;
  created_at: string;
  /** Null until the three prompts have been answered. */
  profile: OwnProfile | null;
}

// --------------------------------------------------------------- profile

export interface PromptDefinition {
  id: string;
  /** The question, shown in Fraunces italic. */
  text: string;
  /** "looking_for" on the one prompt every profile must answer. */
  kind?: string | null;
}

export interface PromptLibrary {
  /** The id of the required prompt. */
  looking_for: string;
  prompts: PromptDefinition[];
}

export interface PromptAnswer {
  prompt_id: string;
  text: string;
  voice_media_id?: string;
  /** Exactly 48 values, 0-100, when a voice note exists. */
  waveform?: number[];
}

export interface ProfileRequest {
  first_name: string;
  year_of_study?: number;
  /** Exactly three, one of which is the required `looking_for` prompt. */
  prompts: { prompt_id: string; text: string }[];
  tags?: string[];
}

// ------------------------------------------------------- digest and peers

export interface PeerCard {
  peer_id: string;
  first_name: string;
  year_of_study: number | null;
  identity_pk: string;
  prompts: PromptAnswer[];
}

export interface DigestPeer {
  card: PeerCard;
  /** The most recent crossing day with this peer, `YYYY-MM-DD`. */
  last_day: string;
  /** The crossing's canonical encounter token, for the on-device time chip (SPEC §6.13). */
  encounter: string;
}

export interface DigestMediaItem {
  media_id: string;
  bytes: number;
  sha256: string;
}

export interface DigestResponse {
  release_day: string;
  peers: DigestPeer[];
  /** Every media item in the digest, prefetched in full in this order (invariant 1). */
  media: DigestMediaItem[];
}

// ------------------------------------------------------ signals and matches

/** Exactly `signal_set_size` base64url tokens. Never a count, never an intent. */
export interface SignalsUpload {
  tokens: string[];
}

/** A list of base64url encounter tokens, padded to a multiple of 256. Nothing else. */
export interface PresenceUpload {
  encounters: string[];
}

export interface MatchedToken {
  epoch: string;
  token: string;
}

export interface RevealState {
  state: 'pending' | 'revealed';
  policy: 'M' | 'C';
  /** Set only under policy C while still pending. */
  messages_needed_each?: number;
}

export interface Match {
  match_id: string;
  state: 'active' | 'ended';
  peer: PeerCard;
  /** Only tokens past their own `notify_after` appear here (SPEC §6.9). */
  matched: MatchedToken[];
  created_epoch: string;
  reveal: RevealState;
  unread: boolean;
}

export interface Message {
  message_id: string;
  /** The server returns a user id; the screen compares it with the viewer's own. */
  sender_id: string;
  body: string;
  created_at: string;
}

// ----------------------------------------------------------------- config

export interface ServerConfig {
  campus: Campus | null;
  server_time: string;
  /** The epoch a signal upload must be addressed to, `YYYY-MM-DD`. */
  epoch: string;
  protocol_version: number;
  reveal_policy: 'M' | 'C';
  next_policy_change?: string;
  signal_upload_window: { start: string; end: string };
  presence_upload_window: { start: string; end: string };
  /** A signal upload is rejected at or after this time (SPEC §6.9). */
  match_batch_time: string;
  digest_release_time: string;
  interest_ttl_days: number;
  ble: Record<string, number | string>;
  study_enabled: boolean;
}

/** Exactly the reasons the server accepts (`ReportReason` in schemas.py). */
export const REPORT_REASONS = [
  'harassment',
  'fake_profile',
  'inappropriate_content',
  'underage',
  'safety_concern',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  harassment: 'Harassment or abuse',
  fake_profile: 'This is not a real person',
  inappropriate_content: 'Inappropriate content',
  underage: 'They may be under 18',
  safety_concern: 'A safety concern',
  other: 'Something else',
};
