/**
 * The in-progress signup, held in memory only (journey J1, SPEC.md §13.2).
 *
 * **Nothing here is persisted**, and that is the point rather than an oversight. The store
 * holds the email address and the date of birth while the user moves between screens, and
 * both are things the device must not keep (CLAUDE.md invariant 5): the server discards the
 * date of birth after checking 18+, and the email only ever exists long enough to receive a
 * code. Writing either to `expo-secure-store` or to AsyncStorage would undo that.
 *
 * What *is* persisted, by the screens rather than by this store, is exactly what has to be:
 * the session token and the identity keypair, both in secure storage.
 *
 * Added to SPEC §20's file list in the same change that introduced it (Phase 10).
 */

import { create } from 'zustand';

export interface PromptDraft {
  prompt_id: string;
  text: string;
  /** A recorded voice answer waiting to be uploaded, if any. */
  voice?: { uri: string; seconds: number; waveform: number[] } | null;
}

export interface OnboardingState {
  /** The college email the code was sent to. In memory only. */
  email: string;
  /** `YYYY-MM-DD`. In memory only, sent once, never stored anywhere. */
  dateOfBirth: string;
  firstName: string;
  yearOfStudy: string;
  prompts: PromptDraft[];
  tags: string[];
  /** Local URIs of photos chosen but not yet uploaded. */
  photos: { uri: string; name: string; mimeType: string }[];
  /** Set when the server is in study mode and the consent screen was accepted. */
  consentVersion: string | null;

  setEmail: (email: string) => void;
  setDateOfBirth: (dob: string) => void;
  setBasics: (firstName: string, yearOfStudy: string) => void;
  setPrompts: (prompts: PromptDraft[]) => void;
  setTags: (tags: string[]) => void;
  setPhotos: (photos: OnboardingState['photos']) => void;
  setConsentVersion: (version: string | null) => void;
  /** Wipes everything, including the email and the date of birth. Called after signup. */
  reset: () => void;
}

const EMPTY = {
  email: '',
  dateOfBirth: '',
  firstName: '',
  yearOfStudy: '',
  prompts: [] as PromptDraft[],
  tags: [] as string[],
  photos: [] as OnboardingState['photos'],
  consentVersion: null,
};

export const useOnboarding = create<OnboardingState>((set) => ({
  ...EMPTY,
  setEmail: (email) => set({ email: email.trim() }),
  setDateOfBirth: (dateOfBirth) => set({ dateOfBirth }),
  setBasics: (firstName, yearOfStudy) => set({ firstName: firstName.trim(), yearOfStudy }),
  setPrompts: (prompts) => set({ prompts }),
  setTags: (tags) => set({ tags }),
  setPhotos: (photos) => set({ photos }),
  setConsentVersion: (consentVersion) => set({ consentVersion }),
  reset: () => set({ ...EMPTY }),
}));

// ----------------------------------------------------------------- validation
//
// Pure functions, so the jest suite can check the rules without rendering a screen
// (PLAN.md Phase 10: "jest tests cover form validation and key generation").

/**
 * A plausible college email address. The real decision is the server's -- it alone knows
 * which domains map to an open campus (SPEC §4.1) -- so this only catches typing mistakes
 * before a pointless round trip.
 */
export function validateEmail(email: string): string | null {
  const value = email.trim();
  if (value.length === 0) return 'Enter your college email address.';
  if (value.length > 254) return 'That address is too long.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'That does not look like an email address.';
  return null;
}

/** The OTP as the server issues it: six digits (`auth.otp_length`). */
export function validateCode(code: string): string | null {
  if (!/^\d{6}$/.test(code.trim())) return 'The code is six digits.';
  return null;
}

/** Whole years between `dob` and `on`, by calendar date rather than by dividing days. */
export function ageOn(dob: string, on: Date): number {
  const [y, m, d] = dob.split('-').map(Number);
  let age = on.getFullYear() - (y ?? 0);
  const beforeBirthday =
    on.getMonth() + 1 < (m ?? 1) || (on.getMonth() + 1 === (m ?? 1) && on.getDate() < (d ?? 1));
  if (beforeBirthday) age -= 1;
  return age;
}

/**
 * Mutual is 18+ (safety requirement S1). The server checks this too and is the authority;
 * checking here as well means an under-18 user is told kindly on the device instead of
 * receiving a rejection, and their date of birth is never sent at all.
 */
export function validateDateOfBirth(dob: string, now: Date = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return 'Use the form YYYY-MM-DD.';
  const parsed = new Date(`${dob}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return 'That is not a real date.';
  if (parsed.getTime() > now.getTime()) return 'That date is in the future.';
  const age = ageOn(dob, now);
  if (age < 18) return 'Mutual is for students aged 18 and over.';
  if (age > 120) return 'Check that date — it does not look right.';
  return null;
}

/** `profile.first_name_max_length` is 40 in server/config.yaml. */
export function validateFirstName(name: string): string | null {
  const value = name.trim();
  if (value.length === 0) return 'Enter the name you want people to see.';
  if (value.length > 40) return 'Keep it under 40 characters.';
  return null;
}

/** Optional; `profile.year_of_study_max` is 8. */
export function validateYearOfStudy(year: string): string | null {
  if (year.trim() === '') return null;
  const value = Number(year);
  if (!Number.isInteger(value) || value < 1 || value > 8) return 'Enter a year from 1 to 8.';
  return null;
}

/** `profile.prompt_text_max_length` is 300. */
export function validatePromptText(text: string): string | null {
  const value = text.trim();
  if (value.length === 0) return 'Write an answer, even a short one.';
  if (value.length > 300) return 'Keep it under 300 characters.';
  return null;
}

export interface PromptsValidationOptions {
  /** The id of the prompt every profile must answer (`looking_for`). */
  requiredPromptId: string;
  /** `profile.prompts_required` is 3. */
  count?: number;
}

/**
 * The whole prompt step: exactly three answers, all non-empty, one of them the required
 * `looking_for` prompt, and no prompt answered twice.
 */
export function validatePrompts(
  prompts: readonly PromptDraft[],
  { requiredPromptId, count = 3 }: PromptsValidationOptions,
): string | null {
  if (prompts.length !== count) return `Choose and answer ${count} prompts.`;
  if (!prompts.some((p) => p.prompt_id === requiredPromptId)) {
    return 'One of your three answers has to be "I\'m looking for".';
  }
  if (new Set(prompts.map((p) => p.prompt_id)).size !== prompts.length) {
    return 'Each prompt can only be answered once.';
  }
  for (const prompt of prompts) {
    const error = validatePromptText(prompt.text);
    if (error) return error;
  }
  return null;
}

/** `profile.tags_max` is 8 and `profile.tag_max_length` is 24. */
export function validateTags(tags: readonly string[]): string | null {
  if (tags.length > 8) return 'Up to 8 tags.';
  if (tags.some((t) => t.trim().length === 0)) return 'Remove the empty tag.';
  if (tags.some((t) => t.length > 24)) return 'Keep each tag under 24 characters.';
  return null;
}
