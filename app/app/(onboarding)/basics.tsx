/**
 * Basics (journey J1): first name, year of study, and the step where the account is
 * actually created.
 *
 * This is where the identity keypair is generated and stored (SPEC §6.4). It happens here
 * rather than earlier because `POST /account` is the one request that carries the public
 * key, and generating a key the server then rejects would leave the device holding a key it
 * cannot use.
 *
 * Only a first name is asked for. No surname, no course, no hometown: the less a profile
 * says, the less a stranger can use it to find someone off the app.
 */

import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';

import { ApiError, NetworkError } from '@/api/client';
import { createAccount } from '@/api/endpoints';
import {
  AppText,
  BarButton,
  Button,
  Screen,
  ScreenHeader,
  Stack,
  TextField,
} from '@/design/primitives';
import { space } from '@/design/tokens';
import { ensureIdentity } from '@/onboarding/identity';
import {
  useOnboarding,
  validateFirstName,
  validateYearOfStudy,
} from '@/onboarding/store';
import { setUserId } from '@/storage/secure';

const MESSAGES: Record<string, string> = {
  under_age: 'Mutual is for students aged 18 and over.',
  identity_key_in_use:
    'That identity key is already registered. Reinstalling? Delete the app data and start again.',
  invalid_identity_key: 'The app could not create a valid key. Try again.',
  account_exists: 'This device already has an account.',
  consent_required: 'This campus is running a study, so the consent step comes first.',
};

export default function BasicsScreen(): ReactNode {
  const { dateOfBirth, firstName, yearOfStudy, consentVersion, setBasics } = useOnboarding();
  const [name, setName] = useState(firstName);
  const [year, setYear] = useState(yearOfStudy);
  const [nameError, setNameError] = useState<string | null>(null);
  const [yearError, setYearError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    const nameInvalid = validateFirstName(name);
    const yearInvalid = validateYearOfStudy(year);
    setNameError(nameInvalid);
    setYearError(yearInvalid);
    if (nameInvalid || yearInvalid) return;

    setError(null);
    setBusy(true);
    try {
      const identity = await ensureIdentity();
      const created = await createAccount({
        date_of_birth: dateOfBirth,
        identity_pk: identity.pk,
        first_name: name.trim(),
        ...(year.trim() ? { year_of_study: Number(year) } : {}),
        ...(consentVersion ? { consent_version: consentVersion } : {}),
      });
      await setUserId(created.user_id);
      setBasics(name, year);
      router.push('/(onboarding)/prompts');
    } catch (e) {
      if (e instanceof ApiError) setError(MESSAGES[e.code] ?? e.message);
      else if (e instanceof NetworkError) setError('Could not reach Mutual. Check your connection.');
      else setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="basics">
      <BarButton kind="back" onPress={() => router.back()} />
      <ScreenHeader
        title="The basics"
        lede="A first name and your year. That is all anyone sees at the top of your answers."
      />

      <Stack gap={space.xl}>
        <TextField
          label="First name"
          value={name}
          onChangeText={setName}
          error={nameError}
          autoCapitalize="words"
          autoComplete="given-name"
          maxLength={40}
          returnKeyType="next"
        />

        <TextField
          label="Year of study"
          value={year}
          onChangeText={(text) => setYear(text.replace(/\D/g, '').slice(0, 1))}
          error={yearError}
          hint="Optional. 1 to 8."
          keyboardType="number-pad"
          inputMode="numeric"
          maxLength={1}
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
        />

        <Button
          label={busy ? 'Creating your account…' : 'Continue'}
          kind="ink"
          wide
          disabled={busy}
          onPress={() => void submit()}
        />

        {error ? (
          <AppText variant="small" tone="danger">
            {error}
          </AppText>
        ) : (
          <AppText variant="small" tone="muted">
            No surname, no course, no hometown. The less your profile says, the harder it is
            for anyone to find you off Mutual.
          </AppText>
        )}
      </Stack>
    </Screen>
  );
}
