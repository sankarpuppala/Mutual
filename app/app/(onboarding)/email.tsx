/**
 * College email step (journey J1, SPEC.md §11 "Auth and account").
 *
 * Two things are deliberately *not* done here:
 *
 *  - The address is never written to device storage (invariant 5). It lives in the
 *    in-memory onboarding store until the code is verified, then it is forgotten.
 *  - The screen does not tell the user whether the address is already registered, and it
 *    cannot: `POST /auth/request-otp` answers 204 either way, and the 60-second resend
 *    cooldown is applied silently. So this screen always moves on to the code step, which
 *    is what stops it becoming a way to test whether someone uses Mutual.
 */

import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { StyleSheet } from "react-native";

import { ApiError, NetworkError, baseUrl } from "@/api/client";
import { requestOtp } from "@/api/endpoints";
import {
  AppText,
  BarButton,
  Button,
  LockNote,
  Screen,
  ScreenHeader,
  Stack,
  TextField,
} from "@/design/primitives";
import { space } from "@/design/tokens";
import { useOnboarding, validateEmail } from "@/onboarding/store";

/** Server error codes this screen can explain better than the server's generic message. */
const MESSAGES: Record<string, () => string> = {
  not_a_college_email: () =>
    "That has to be a college address. Mutual only works inside a campus, which is how it " +
    "knows you are a student.",
  campus_not_open: () =>
    "Your college is not open yet. We have noted that a student asked. It opens once " +
    "someone at the college — a dean, or the student council — applies at " +
    `${baseUrl()}/colleges and we have spoken to them.`,
};

export default function EmailScreen(): ReactNode {
  const { email, setEmail } = useOnboarding();
  const [value, setValue] = useState(email);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async (): Promise<void> => {
    const invalid = validateEmail(value);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setSending(true);
    try {
      await requestOtp(value);
      setEmail(value);
      router.push("/(onboarding)/code");
    } catch (e) {
      if (e instanceof ApiError) setError(MESSAGES[e.code]?.() ?? e.message);
      else if (e instanceof NetworkError)
        setError("Could not reach Mutual. Check your connection.");
      else setError("Something went wrong. Try again.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen testID="email">
      <BarButton kind="back" onPress={() => router.back()} />
      <ScreenHeader
        title="Your college email"
        lede="We send a six-digit code to check you study here. That is the only thing the address is used for."
      />

      <Stack gap={space.xl}>
        <TextField
          label="College email address"
          value={value}
          // An error describes the text that was submitted. Once it is being corrected the
          // message is about something no longer on screen, so it goes as soon as the
          // field changes; `submit` puts it back if the new text is still wrong.
          onChangeText={(text) => {
            setValue(text);
            setError(null);
          }}
          error={error}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          inputMode="email"
          returnKeyType="send"
          onSubmitEditing={() => void submit()}
          placeholder="you@college.ac.in"
        />

        <Button
          label={sending ? "Sending…" : "Send me a code"}
          kind="ink"
          wide
          disabled={sending}
          onPress={() => void submit()}
        />

        <LockNote>
          Mutual stores a one-way hash of your address, never the address
          itself, and never your date of birth. See &ldquo;What Mutual can and
          can never see&rdquo;.
        </LockNote>

        <AppText variant="small" tone="muted" style={styles.note}>
          If your college is not open yet, we will say so rather than leaving
          you waiting for a code that is not coming.
        </AppText>
      </Stack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  note: { marginTop: -space.sm },
});
