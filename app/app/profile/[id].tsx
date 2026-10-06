/**
 * A digest peer's full profile (SPEC.md §13.9).
 *
 * Every answer as its own large card, each with its voice player, the note about when photos
 * appear, a sticky "Send a signal", and "Not for me".
 *
 * **There is no network request on this screen.** It reads the digest already in the query
 * cache and the media already prefetched (invariant 1) -- which is also why there is no
 * `GET /peers/{id}`: invariant 10 forbids a per-peer endpoint before a match, and this
 * screen is proof that none is needed.
 *
 * "Not for me" hides the peer's cards on this device only, writes one local row, and sends
 * nothing (SPEC §13.9).
 */

import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { getDigest, getPromptLibrary } from '@/api/endpoints';
import { INTENT_LABELS, type Intent } from '@/api/types';
import { GenerativeAvatar } from '@/components/GenerativeAvatar';
import { SignalSheet } from '@/components/SignalSheet';
import { VoicePlayer } from '@/components/VoicePlayer';
import { cachedMediaUri } from '@/digest/cache';
import { Icon } from '@/design/icons';
import {
  AppText,
  BarButton,
  Button,
  Card,
  LinkButton,
  LockNote,
  Screen,
  Stack,
} from '@/design/primitives';
import { useTheme } from '@/design/theme';
import { space } from '@/design/tokens';
import {
  SIGNAL_CAP,
  SignalCapReached,
  setSignalsForPeer,
  signalCount,
  signalsForPeer,
  withdrawPeer,
} from '@/signals/db';
import { localDay } from '@/signals/scheduler';
import { hasUploaded, hidePeer } from '@/storage/localDb';

export default function ProfileScreen(): ReactNode {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();

  const digest = useQuery({ queryKey: ['digest'], queryFn: getDigest });
  const library = useQuery({ queryKey: ['prompts'], queryFn: getPromptLibrary });

  const [signalled, setSignalled] = useState<Intent[]>([]);
  const [usedByOthers, setUsedByOthers] = useState(0);
  const [uploadedTonight, setUploadedTonight] = useState(false);
  const [voiceUris, setVoiceUris] = useState<Record<string, string | null>>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const entry = digest.data?.peers.find((p) => p.card.peer_id === id);
  const card = entry?.card;

  useEffect(() => {
    if (!card) return;
    let cancelled = false;
    void (async () => {
      const [mine, total, uploaded] = await Promise.all([
        signalsForPeer(card.peer_id),
        signalCount(),
        hasUploaded('signals', localDay(new Date())),
      ]);
      const uris: Record<string, string | null> = {};
      for (const prompt of card.prompts) {
        if (prompt.voice_media_id) uris[prompt.prompt_id] = await cachedMediaUri(prompt.voice_media_id);
      }
      if (cancelled) return;
      setSignalled(mine);
      setUsedByOthers(total - mine.length);
      setUploadedTonight(uploaded);
      setVoiceUris(uris);
    })();
    return () => {
      cancelled = true;
    };
  }, [card]);

  const questionFor = (promptId: string): string =>
    library.data?.prompts.find((p) => p.id === promptId)?.text ?? '';

  const confirm = async (intents: Intent[]): Promise<void> => {
    if (!card || !entry) return;
    setSheetOpen(false);
    setError(null);
    try {
      if (intents.length === 0) {
        await withdrawPeer(card.peer_id);
        setSignalled([]);
      } else {
        await setSignalsForPeer(card.peer_id, intents, {
          lastCrossingDay: entry.last_day,
          now: new Date().toISOString(),
          peerName: card.first_name,
          peerIdentityPk: card.identity_pk,
        });
        setSignalled(intents);
      }
    } catch (e) {
      setError(e instanceof SignalCapReached ? e.message : 'Could not save that. Try again.');
    }
  };

  const notForMe = async (): Promise<void> => {
    if (!card) return;
    await hidePeer(card.peer_id, new Date().toISOString());
    router.back();
  };

  if (!card) {
    return (
      <Screen testID="profile">
        <BarButton kind="back" onPress={() => router.back()} />
        <AppText variant="title">Not in your letter</AppText>
        <AppText variant="body" tone="muted">
          This person is no longer in your morning letter.
        </AppText>
      </Screen>
    );
  }

  const sentLabel = signalled.map((i) => INTENT_LABELS[i]).join(', ');

  return (
    <Screen testID="profile" bottomInset={90}>
      <BarButton kind="back" onPress={() => router.back()} />

      <View style={styles.hero}>
        <GenerativeAvatar identityPk={card.identity_pk} size={88} />
        <AppText variant="name" accessibilityRole="header">
          {card.first_name}
        </AppText>
        <AppText variant="small" tone="muted">
          {[card.year_of_study ? `Year ${card.year_of_study}` : null, entry?.last_day]
            .filter(Boolean)
            .join(' · ')}
        </AppText>
      </View>

      <Stack>
        {card.prompts.map((prompt) => (
          <Card key={prompt.prompt_id} style={styles.promptCard}>
            <AppText variant="promptQuestion" tone="muted">
              {questionFor(prompt.prompt_id)}
            </AppText>
            <AppText variant="promptAnswerLarge">{prompt.text}</AppText>
            {prompt.voice_media_id ? (
              <VoicePlayer
                uri={voiceUris[prompt.prompt_id] ?? null}
                waveform={prompt.waveform ?? []}
                speakerName={card.first_name}
              />
            ) : null}
          </Card>
        ))}

        <LockNote>
          Photos appear only if you both signal each other for the same thing.
        </LockNote>
      </Stack>

      {error ? (
        <AppText variant="small" tone="danger" style={styles.error}>
          {error}
        </AppText>
      ) : null}

      <View style={[styles.cta, { backgroundColor: theme.colors.bg }]}>
        {signalled.length > 0 ? (
          <Button
            label={`Signal sent · ${sentLabel}`}
            kind="ghost"
            wide
            left={<Icon name="check" size={16} strokeWidth={2.2} color={theme.colors.signal} />}
            onPress={() => setSheetOpen(true)}
          />
        ) : (
          <Button label="Send a signal" kind="signal" wide onPress={() => setSheetOpen(true)} />
        )}
        <LinkButton label="Not for me" center onPress={() => void notForMe()} />
      </View>

      <SignalSheet
        visible={sheetOpen}
        peerName={card.first_name}
        current={signalled}
        usedByOthers={usedByOthers}
        cap={SIGNAL_CAP}
        uploadedTonight={uploadedTonight}
        onClose={() => setSheetOpen(false)}
        onConfirm={(intents) => void confirm(intents)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: space.sm + 2, paddingTop: space.sm, paddingBottom: space.xl - 2 },
  promptCard: { paddingVertical: space.xl + 2, paddingHorizontal: space.xl - 2, gap: space.md },
  error: { marginTop: space.lg },
  cta: { marginTop: space.lg, gap: space.xs, alignItems: 'center' },
});
