/**
 * Onboarding validation and identity-key generation (PLAN.md Phase 10 "Done when": jest
 * tests cover form validation and key generation).
 *
 * The age rule gets the most attention here because it is a safety requirement (S1) rather
 * than a form nicety, and because date arithmetic is the classic place to be off by one day
 * in a way nobody notices until a 17-year-old gets in.
 */

import { b64urlDecode, isValidPublicKey, pairKey, publicKey } from '@mutual/protocol';

import { createAndStoreIdentity, ensureIdentity } from '@/onboarding/identity';
import {
  ageOn,
  validateCode,
  validateDateOfBirth,
  validateEmail,
  validateFirstName,
  validatePromptText,
  validatePrompts,
  validateTags,
  validateYearOfStudy,
} from '@/onboarding/store';
import { clearAll, getIdentity } from '@/storage/secure';

const NOW = new Date('2026-10-06T00:00:00Z');

beforeEach(async () => {
  await clearAll();
});

describe('email validation', () => {
  it('rejects an empty address', () => {
    expect(validateEmail('   ')).toMatch(/college email/i);
  });

  it('rejects something that is not an address', () => {
    expect(validateEmail('ananya at college')).toMatch(/email address/i);
    expect(validateEmail('ananya@college')).toMatch(/email address/i);
  });

  it('accepts a college address and tolerates surrounding spaces', () => {
    expect(validateEmail(' ananya@college.ac.in ')).toBeNull();
  });

  it('leaves the campus decision to the server', () => {
    // A perfectly formed address at a domain the server may not know is accepted here: only
    // the server knows which domains map to an open campus (SPEC §4.1).
    expect(validateEmail('someone@unknown-college.edu')).toBeNull();
  });
});

describe('code validation', () => {
  it('requires exactly six digits', () => {
    expect(validateCode('12345')).toMatch(/six digits/i);
    expect(validateCode('1234567')).toMatch(/six digits/i);
    expect(validateCode('12a456')).toMatch(/six digits/i);
    expect(validateCode('123456')).toBeNull();
  });
});

describe('age (safety requirement S1)', () => {
  it('counts whole years by calendar date', () => {
    expect(ageOn('2008-10-06', NOW)).toBe(18);
    expect(ageOn('2008-10-07', NOW)).toBe(17);
    expect(ageOn('2008-01-01', NOW)).toBe(18);
  });

  it('accepts someone who turns 18 today', () => {
    expect(validateDateOfBirth('2008-10-06', NOW)).toBeNull();
  });

  it('rejects someone who turns 18 tomorrow, kindly', () => {
    expect(validateDateOfBirth('2008-10-07', NOW)).toMatch(/18 and over/);
  });

  it('rejects a future date', () => {
    expect(validateDateOfBirth('2030-01-01', NOW)).toMatch(/future/);
  });

  it('rejects a malformed date rather than guessing', () => {
    expect(validateDateOfBirth('06-10-2008', NOW)).toMatch(/YYYY-MM-DD/);
    expect(validateDateOfBirth('2008-13-40', NOW)).not.toBeNull();
  });

  it('questions an implausible age instead of accepting it', () => {
    expect(validateDateOfBirth('1860-01-01', NOW)).toMatch(/does not look right/);
  });
});

describe('profile field validation', () => {
  it('requires a first name of at most 40 characters', () => {
    expect(validateFirstName(' ')).toMatch(/name/i);
    expect(validateFirstName('a'.repeat(41))).toMatch(/40/);
    expect(validateFirstName('Ananya')).toBeNull();
  });

  it('treats year of study as optional but bounded', () => {
    expect(validateYearOfStudy('')).toBeNull();
    expect(validateYearOfStudy('3')).toBeNull();
    expect(validateYearOfStudy('0')).toMatch(/1 to 8/);
    expect(validateYearOfStudy('9')).toMatch(/1 to 8/);
  });

  it('caps a prompt answer at 300 characters', () => {
    expect(validatePromptText('')).toMatch(/answer/i);
    expect(validatePromptText('x'.repeat(301))).toMatch(/300/);
    expect(validatePromptText('Filter coffee before an 8 am lab.')).toBeNull();
  });

  it('caps tags at 8 of 24 characters', () => {
    expect(validateTags(['Economics', 'Debate'])).toBeNull();
    expect(validateTags(Array.from({ length: 9 }, (_, i) => `t${i}`))).toMatch(/8 tags/);
    expect(validateTags(['x'.repeat(25)])).toMatch(/24/);
    expect(validateTags(['  '])).toMatch(/empty/);
  });
});

describe('the prompt step as a whole', () => {
  const required = 'looking_for';
  const three = [
    { prompt_id: 'looking_for', text: 'Someone to argue thermodynamics with.' },
    { prompt_id: 'simple_pleasures', text: 'A fresh page in a new notebook.' },
    { prompt_id: 'ask_me_about', text: 'Why textbooks should come with podcasts.' },
  ];

  it('accepts exactly three answers including the required one', () => {
    expect(validatePrompts(three, { requiredPromptId: required })).toBeNull();
  });

  it('insists on three', () => {
    expect(validatePrompts(three.slice(0, 2), { requiredPromptId: required })).toMatch(/3 prompts/);
  });

  it('insists that one of them is "I\'m looking for"', () => {
    const without = [
      { prompt_id: 'simple_pleasures', text: 'a' },
      { prompt_id: 'ask_me_about', text: 'b' },
      { prompt_id: 'geek_out', text: 'c' },
    ];
    expect(validatePrompts(without, { requiredPromptId: required })).toMatch(/looking for/i);
  });

  it('rejects the same prompt answered twice', () => {
    const duplicated = [three[0]!, three[1]!, { ...three[1]!, text: 'again' }];
    expect(validatePrompts(duplicated, { requiredPromptId: required })).toMatch(/once/);
  });

  it('rejects a blank answer even when three prompts are chosen', () => {
    const blank = [three[0]!, three[1]!, { prompt_id: 'geek_out', text: '   ' }];
    expect(validatePrompts(blank, { requiredPromptId: required })).toMatch(/answer/i);
  });
});

describe('identity key generation (SPEC §6.4)', () => {
  it('stores a keypair whose public half is a valid X25519 key', async () => {
    const identity = await createAndStoreIdentity();
    const pk = b64urlDecode(identity.pk);
    const sk = b64urlDecode(identity.sk);
    expect(pk).toHaveLength(32);
    expect(sk).toHaveLength(32);
    expect(isValidPublicKey(pk)).toBe(true);
  });

  it('stores a public key that really matches its private key', async () => {
    const identity = await createAndStoreIdentity();
    expect(Array.from(publicKey(b64urlDecode(identity.sk)))).toEqual(
      Array.from(b64urlDecode(identity.pk)),
    );
  });

  it('never produces the same key twice', async () => {
    const keys = new Set<string>();
    for (let i = 0; i < 20; i++) {
      await clearAll();
      keys.add((await createAndStoreIdentity()).pk);
    }
    expect(keys.size).toBe(20);
  });

  it('persists the key to secure storage, so a restart keeps it', async () => {
    const created = await createAndStoreIdentity();
    expect(await getIdentity()).toEqual(created);
  });

  it('is idempotent: resuming onboarding never replaces an existing key', async () => {
    const first = await ensureIdentity();
    const second = await ensureIdentity();
    expect(second).toEqual(first);
  });

  it('produces a key that can actually derive a pair key with a peer', async () => {
    // The point of the key: two devices must derive the same pair key (SPEC §6.5). If key
    // generation or encoding were subtly wrong, this is where it would show.
    const a = await createAndStoreIdentity();
    await clearAll();
    const b = await createAndStoreIdentity();
    const uidA = '11111111-1111-4111-8111-111111111111';
    const uidB = '22222222-2222-4222-8222-222222222222';

    const fromA = pairKey(
      b64urlDecode(a.sk),
      b64urlDecode(a.pk),
      uidA,
      b64urlDecode(b.pk),
      uidB,
    );
    const fromB = pairKey(
      b64urlDecode(b.sk),
      b64urlDecode(b.pk),
      uidB,
      b64urlDecode(a.pk),
      uidA,
    );
    expect(Array.from(fromA)).toEqual(Array.from(fromB));
  });
});
