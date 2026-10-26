/**
 * Send feedback (SPEC.md §11.4). A message to the Mutual team, from the You tab.
 *
 * Built only from existing primitives and tokens, in the same shape as the email screen:
 * a header, a field, one primary action, and a lock note saying who reads it. The only
 * network call is the one the Send button makes, so nothing here depends on what the
 * student looked at (invariant 1). The copy steers reports about a person to Report, which
 * carries the conversation excerpt a moderator needs and works through the safety sheet.
 */

import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { ApiError, NetworkError } from '@/api/client';
import { sendFeedback, type FeedbackCategory } from '@/api/endpoints';
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

const CATEGORIES: { value: FeedbackCategory; label: string }[] = [
  { value: 'idea', label: 'An idea' },
  { value: 'problem', label: 'Something’s wrong' },
  { value: 'other', label: 'Something else' },
];

export default function FeedbackScreen(): ReactNode {
  const [category, setCategory] = useState<FeedbackCategory>('idea');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (): Promise<void> => {
    if (!body.trim()) {
      setError('Write a few words first.');
      return;
    }
    setError(null);
    setSending(true);
    try {
      await sendFeedback(category, body.trim());
      setSent(true);
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else if (e instanceof NetworkError) setError('Could not reach Mutual. Check your connection.');
      else setError('Something went wrong. Try again.');
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <Screen testID="feedback">
        <BarButton kind="back" onPress={() => router.back()} />
        <ScreenHeader
          title="Thank you"
          lede="The Mutual team reads every message. We may not reply to each one, but it shapes what we change next."
        />
        <Button label="Back to You" kind="ink" wide onPress={() => router.back()} />
      </Screen>
    );
  }

  return (
    <Screen testID="feedback">
      <BarButton kind="back" onPress={() => router.back()} />
      <ScreenHeader
        title="Send feedback"
        lede="Tell us what works, what doesn't, or what you wish Mutual did. It goes to the team that runs Mutual."
      />

      <Stack gap={space.xl}>
        <View style={styles.categories} accessibilityRole="radiogroup">
          {CATEGORIES.map((c) => (
            <Button
              key={c.value}
              label={c.label}
              kind={category === c.value ? 'ink' : 'ghost'}
              small
              accessibilityState={{ selected: category === c.value }}
              onPress={() => setCategory(c.value)}
            />
          ))}
        </View>

        <TextField
          label="Your message"
          value={body}
          onChangeText={(text) => {
            setBody(text);
            setError(null);
          }}
          error={error}
          multiline
          textAlignVertical="top"
          inputStyle={styles.message}
          placeholder="What's on your mind?"
        />

        <Button
          label={sending ? 'Sending…' : 'Send'}
          kind="ink"
          wide
          disabled={sending}
          onPress={() => void submit()}
        />

        <LockNote>
          To report a person, use Report on their profile or chat instead: it reaches a
          moderator with the messages they need. Feedback is kept to improve Mutual, and stays
          even if you delete your account, no longer linked to you.
        </LockNote>
      </Stack>
      <AppText variant="small" tone="muted" center style={styles.footnote}>
        Mutual is an unaudited research prototype.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  categories: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  message: { minHeight: space.xxl * 4 },
  footnote: { marginTop: space.xl },
});
