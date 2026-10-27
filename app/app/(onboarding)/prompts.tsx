/**
 * Prompt answers (journey J1, SPEC.md §11 Profile, §13.9).
 *
 * This is the heart of the product: before a reveal, a person *is* these three answers.
 * One of them must be "I'm looking for" (the required prompt), because a profile that does
 * not say what someone wants makes a signal a guess.
 *
 * A voice answer is always optional and never replaces the written one (decision D8): a
 * recording cannot be skimmed, cannot be read on a bus, and is not accessible to everyone.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ApiError, NetworkError } from '@/api/client';
import { getMe, getPromptLibrary, putProfile, uploadVoice } from '@/api/endpoints';
import { VoiceRecorder } from '@/components/VoiceRecorder';
import { Icon } from '@/design/icons';
import {
  AppText,
  BarButton,
  Button,
  Card,
  Screen,
  ScreenHeader,
  SectionHeading,
  Stack,
  TextField,
} from '@/design/primitives';
import { useTheme } from '@/design/theme';
import { hitSize, radius, space } from '@/design/tokens';
import {
  useOnboarding,
  validatePrompts,
  type PromptDraft,
} from '@/onboarding/store';

const REQUIRED_COUNT = 3;

export default function PromptsScreen(): ReactNode {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const isFromYou = from === 'you';

  const { firstName, yearOfStudy, prompts, setPrompts } = useOnboarding();
  const [drafts, setDrafts] = useState<PromptDraft[]>(prompts);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const library = useQuery({ queryKey: ['prompts'], queryFn: getPromptLibrary });
  const me = useQuery({
    queryKey: ['me'],
    queryFn: getMe,
    enabled: isFromYou || (!firstName && drafts.length === 0),
  });

  // Prepopulate saved answers when editing from You or when onboarding drafts are empty
  useEffect(() => {
    let cancelled = false;
    if (!initialized && me.data?.profile?.prompts && me.data.profile.prompts.length > 0) {
      if (isFromYou || drafts.length === 0) {
        const saved = me.data.profile.prompts.map((p) => ({
          prompt_id: p.prompt_id,
          text: p.text,
        }));
        void Promise.resolve().then(() => {
          if (!cancelled) {
            setDrafts(saved);
            setInitialized(true);
          }
        });
      }
    }
    return () => {
      cancelled = true;
    };
  }, [me.data, initialized, isFromYou, drafts.length]);

  const requiredId = library.data?.looking_for ?? 'looking_for';

  // The required prompt is always first in the picker, and cannot be removed.
  const options = useMemo(() => {
    const all = library.data?.prompts ?? [];
    const required = all.filter((p) => p.id === requiredId);
    const rest = all.filter((p) => p.id !== requiredId);
    return [...required, ...rest];
  }, [library.data, requiredId]);

  const chosen = (id: string): PromptDraft | undefined => drafts.find((d) => d.prompt_id === id);

  const toggle = (id: string): void => {
    setError(null);
    if (chosen(id)) {
      if (id === requiredId) return; // the required prompt stays
      setDrafts(drafts.filter((d) => d.prompt_id !== id));
      return;
    }
    if (drafts.length >= REQUIRED_COUNT) {
      setError(`Three answers. Remove one to swap it for another.`);
      return;
    }
    setDrafts([...drafts, { prompt_id: id, text: '' }]);
  };

  const setText = (id: string, text: string): void => {
    setDrafts(drafts.map((d) => (d.prompt_id === id ? { ...d, text } : d)));
  };

  const setVoice = (id: string, voice: PromptDraft['voice']): void => {
    setDrafts(drafts.map((d) => (d.prompt_id === id ? { ...d, voice } : d)));
  };

  const submit = async (): Promise<void> => {
    const invalid = validatePrompts(drafts, { requiredPromptId: requiredId });
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const effectiveFirstName = firstName.trim() || me.data?.first_name || '';
      const effectiveYearOfStudy = yearOfStudy.trim()
        ? Number(yearOfStudy)
        : me.data?.year_of_study;

      await putProfile({
        first_name: effectiveFirstName,
        ...(effectiveYearOfStudy ? { year_of_study: effectiveYearOfStudy } : {}),
        prompts: drafts.map((d) => ({ prompt_id: d.prompt_id, text: d.text.trim() })),
      });
      // Voice notes go up after the prompts exist: the server attaches each one to its
      // prompt, so the prompt has to be there first.
      for (const draft of drafts) {
        if (!draft.voice) continue;
        await uploadVoice(
          draft.prompt_id,
          { uri: draft.voice.uri, name: `${draft.prompt_id}.m4a` },
          draft.voice.waveform,
        );
      }
      setPrompts(drafts);
      if (isFromYou) {
        await queryClient.invalidateQueries({ queryKey: ['me'] });
        router.back();
      } else {
        router.push('/(onboarding)/photos');
      }
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else if (e instanceof NetworkError) setError('Could not reach Mutual. Check your connection.');
      else setError('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="prompts">
      <BarButton kind="back" onPress={() => router.back()} />
      <ScreenHeader
        title="Your answers"
        lede="Three answers. Before a mutual, this is how people meet you — so write the way you talk."
      />

      <SectionHeading>Pick three</SectionHeading>
      <View style={styles.chips}>
        {options.map((option) => {
          const on = Boolean(chosen(option.id));
          const locked = option.id === requiredId;
          return (
            <Pressable
              key={option.id}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={option.text}
              onPress={() => toggle(option.id)}
              style={[
                styles.chip,
                {
                  borderColor: on ? theme.colors.signal : theme.colors.hairline,
                  backgroundColor: on ? theme.colors.signalSoft : 'transparent',
                },
              ]}
            >
              {on ? (
                <Icon name="check" size={16} strokeWidth={2.2} color={theme.colors.signal} />
              ) : null}
              <AppText variant="smallMedium">{option.text}</AppText>
              {locked ? (
                <AppText variant="tiny" tone="muted">
                  required
                </AppText>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <SectionHeading>Write them</SectionHeading>
      <Stack>
        {drafts.length === 0 ? (
          <AppText variant="body" tone="muted">
            Choose three prompts above and they appear here.
          </AppText>
        ) : null}
        {drafts.map((draft) => {
          const question = options.find((o) => o.id === draft.prompt_id)?.text ?? draft.prompt_id;
          return (
            <Card key={draft.prompt_id}>
              <AppText variant="promptQuestion" tone="muted">
                {question}
              </AppText>
              <TextField
                label={question}
                value={draft.text}
                onChangeText={(text) => setText(draft.prompt_id, text)}
                multiline
                maxLength={300}
                placeholder="Your answer"
                inputStyle={styles.answer}
              />
              <AppText variant="tiny" tone="muted">
                {300 - draft.text.length} characters left
              </AppText>
              <VoiceRecorder
                existing={draft.voice ? { seconds: draft.voice.seconds } : null}
                onRecorded={(voice) => setVoice(draft.prompt_id, voice)}
                onCleared={() => setVoice(draft.prompt_id, null)}
              />
            </Card>
          );
        })}
      </Stack>

      {error ? (
        <AppText variant="small" tone="danger" style={styles.error}>
          {error}
        </AppText>
      ) : null}

      <Button
        label={busy ? 'Saving…' : isFromYou ? 'Save answers' : 'Continue'}
        kind="ink"
        wide
        disabled={busy}
        onPress={() => void submit()}
        style={styles.submit}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    minHeight: hitSize,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    borderWidth: 1.5,
  },
  answer: { minHeight: 96, paddingTop: space.md, textAlignVertical: 'top' },
  error: { marginTop: space.lg },
  submit: { marginTop: space.xl },
});
