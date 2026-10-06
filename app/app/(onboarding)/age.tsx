/**
 * Age check (safety requirement S1, journey J1).
 *
 * The date of birth is the most carefully handled field in onboarding:
 *
 *  - it is checked on the device first, so an under-18 user is told kindly and their date
 *    of birth is never transmitted at all;
 *  - it is sent exactly once, in `POST /account`, and the server discards it after checking,
 *    keeping only an `age_verified_at` timestamp (invariant 5);
 *  - it is never written to device storage -- it lives in the in-memory onboarding store
 *    until the account is created, then `reset()` clears it.
 *
 * The copy says all of that plainly rather than asking for a birthday and moving on.
 */

import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';

import {
  AppText,
  BarButton,
  Button,
  LockNote,
  Screen,
  ScreenHeader,
  Stack,
  TextField,
} from '@/design/primitives';
import { space } from '@/design/tokens';
import { useOnboarding, validateDateOfBirth } from '@/onboarding/store';

export default function AgeScreen(): ReactNode {
  const { dateOfBirth, setDateOfBirth } = useOnboarding();
  const [value, setValue] = useState(dateOfBirth);
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    const invalid = validateDateOfBirth(value);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setDateOfBirth(value);
    router.push('/(onboarding)/basics');
  };

  return (
    <Screen testID="age">
      <BarButton kind="back" onPress={() => router.back()} />
      <ScreenHeader
        title="Your date of birth"
        lede="Mutual is for students aged 18 and over. We check once, then throw the date away."
      />

      <Stack gap={space.xl}>
        <TextField
          label="Date of birth"
          value={value}
          onChangeText={(text) => setValue(text.replace(/[^\d-]/g, '').slice(0, 10))}
          error={error}
          hint="Year, month, day — for example 2005-04-17."
          keyboardType="numbers-and-punctuation"
          autoCorrect={false}
          maxLength={10}
          placeholder="YYYY-MM-DD"
          returnKeyType="done"
          onSubmitEditing={submit}
        />

        <Button label="Continue" kind="ink" wide onPress={submit} />

        <LockNote>
          Your date of birth is sent once and checked, and then it is gone. The server keeps
          only the fact that someone checked, and when.
        </LockNote>

        <AppText variant="small" tone="muted">
          If you are under 18, Mutual will say so and stop here. Nothing is sent in that case.
        </AppText>
      </Stack>
    </Screen>
  );
}
