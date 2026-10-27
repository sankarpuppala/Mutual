/**
 * Code step (journey J1). Verifies the OTP, stores the session token in secure storage, and
 * branches: a returning device goes straight to the morning letter, a new one continues to
 * the age check.
 *
 * The OTP itself is never stored, not even briefly (invariant 5) -- it exists in this
 * screen's state until the request returns, and nowhere else.
 */

import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';

import { ApiError, NetworkError } from '@/api/client';
import { requestOtp, verifyOtp } from '@/api/endpoints';
import {
  BarButton,
  Button,
  LinkButton,
  Screen,
  ScreenHeader,
  Stack,
  TextField,
} from '@/design/primitives';
import { space } from '@/design/tokens';
import { ensureIdentity } from '@/onboarding/identity';
import { useOnboarding, validateCode } from '@/onboarding/store';
import { setSessionToken } from '@/storage/secure';

const MESSAGES: Record<string, string> = {
  invalid_code: 'That code is not right. Check it and try again.',
  code_expired: 'That code has expired. Ask for a new one.',
  too_many_attempts: 'Too many tries. Ask for a new code.',
  account_suspended:
    'This account has been suspended. If you think that is a mistake, contact whoever runs ' +
    'this campus’s server.',
};

export default function CodeScreen(): ReactNode {
  const { email } = useOnboarding();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState(false);

  const submit = async (): Promise<void> => {
    const invalid = validateCode(code);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const result = await verifyOtp(email, code.trim());
      await setSessionToken(result.session_token);
      await ensureIdentity().catch(() => undefined);
      // A returning device has an account already; it only needs its session back. A new
      // one goes through the consent screen, which forwards straight to the age check when
      // this campus is not running a study (SPEC §16, invariant 9).
      router.replace(result.account_exists ? '/(tabs)/today' : '/(onboarding)/consent');
    } catch (e) {
      if (e instanceof ApiError) setError(MESSAGES[e.code] ?? e.message);
      else if (e instanceof NetworkError) setError('Could not reach Mutual. Check your connection.');
      else setError('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const resend = async (): Promise<void> => {
    setResent(true);
    // Always 204, whether or not a new code was actually sent (the cooldown is silent).
    await requestOtp(email).catch(() => undefined);
  };

  return (
    <Screen testID="code">
      <BarButton kind="back" onPress={() => router.back()} />
      <ScreenHeader
        title="Enter your code"
        lede={`We sent six digits to ${email}. It is valid for a few minutes.`}
      />

      <Stack gap={space.xl}>
        <TextField
          label="Six-digit code"
          value={code}
          onChangeText={(text) => {
            setCode(text.replace(/\D/g, '').slice(0, 6));
            setError(null); // the message is about the old digits (see email.tsx)
          }}
          error={error}
          keyboardType="number-pad"
          inputMode="numeric"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          returnKeyType="done"
          onSubmitEditing={() => void submit()}
        />

        <Button
          label={busy ? 'Checking…' : 'Continue'}
          kind="ink"
          wide
          disabled={busy}
          onPress={() => void submit()}
        />

        <LinkButton
          label={resent ? 'Code sent again' : 'Send the code again'}
          center
          onPress={() => void resend()}
        />
      </Stack>
    </Screen>
  );
}
