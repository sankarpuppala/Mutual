/**
 * Today — the morning letter (SPEC.md §13.2, §13.3, §13.9; journey J2).
 *
 * The screen the whole design is named after: "a morning letter, not a slot machine". It
 * arrives once, complete, and then stops changing until tomorrow. There is nothing to pull
 * to refresh into existence, nothing that loads as you scroll, and no count of anything.
 *
 * Three states, with the copy fixed in SPEC §13.6:
 *   - before the release time: "Your morning letter arrives at 8.";
 *   - a quiet day: "No crossings yesterday.";
 *   - the letter itself, with "Earlier this week" collapsed beneath it.
 */

import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { getConfig, getMe, resumeDiscovery } from '@/api/endpoints';
import type { Intent } from '@/api/types';
import { CrossingCard } from '@/components/CrossingCard';
import { EmptyState } from '@/components/EmptyState';
import { SignalSheet } from '@/components/SignalSheet';
import { useMorningLetter, type LetterEntry } from '@/digest/useDigest';
import { Icon } from '@/design/icons';
import {
  AppText,
  Button,
  Hairline,
  Screen,
  ScreenHeader,
  Stack,
} from '@/design/primitives';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import {
  SIGNAL_CAP,
  SignalCapReached,
  setSignalsForPeer,
  signalCount,
  withdrawPeer,
} from '@/signals/db';
import { localDay } from '@/signals/scheduler';
import { hasUploaded } from '@/storage/localDb';

export default function TodayScreen(): ReactNode {
  const theme = useTheme();
  const letter = useMorningLetter();
  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  const config = useQuery({ queryKey: ['config'], queryFn: getConfig });

  const [earlierOpen, setEarlierOpen] = useState(false);
  const [sheetFor, setSheetFor] = useState<LetterEntry | null>(null);
  const [usedByOthers, setUsedByOthers] = useState(0);
  const [uploadedTonight, setUploadedTonight] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openSheet = async (entry: LetterEntry): Promise<void> => {
    const total = await signalCount();
    setUsedByOthers(total - entry.signalled.length);
    setUploadedTonight(await hasUploaded('signals', localDay(new Date())));
    setSheetFor(entry);
  };

  const confirm = async (intents: Intent[]): Promise<void> => {
    const entry = sheetFor;
    if (!entry) return;
    setSheetFor(null);
    setError(null);
    try {
      if (intents.length === 0) {
        await withdrawPeer(entry.peer.card.peer_id);
        setToast(
          uploadedTonight
            ? 'Signal withdrawn. It already left with tonight’s set, so it could still match tonight. From tomorrow it’s gone.'
            : 'Signal withdrawn. Nobody was ever told.',
        );
      } else {
        await setSignalsForPeer(entry.peer.card.peer_id, intents, {
          lastCrossingDay: entry.peer.last_day,
          now: new Date().toISOString(),
          peerName: entry.peer.card.first_name,
          peerIdentityPk: entry.peer.card.identity_pk,
        });
        setToast(
          entry.signalled.length > 0
            ? 'Signal updated. Still private until they send one back.'
            : 'Signal sent. If they send one back, you’ll both know tomorrow morning.',
        );
      }
      letter.refresh();
    } catch (e) {
      setError(e instanceof SignalCapReached ? e.message : 'Could not save that. Try again.');
    }
  };

  const paused = me.data?.discovery_paused ?? false;
  const releaseTime = config.data?.digest_release_time ?? '8';
  const hasLetter = letter.today.length > 0 || letter.earlier.length > 0;

  const renderCard = (entry: LetterEntry): ReactNode => (
    <CrossingCard
      key={entry.peer.card.peer_id}
      card={entry.peer.card}
      timeLabel={entry.timeLabel}
      signalled={entry.signalled}
      voiceUri={entry.voiceUri}
      questionFor={letter.questionFor}
      onOpenProfile={() => router.push(`/profile/${entry.peer.card.peer_id}`)}
      onSignal={() => void openSheet(entry)}
    />
  );

  return (
    <Screen testID="today">
      <ScreenHeader
        eyebrow={letter.releaseDay ? formatReleaseDay(letter.releaseDay) : undefined}
        title={me.data ? `Good morning, ${me.data.first_name}.` : 'Good morning.'}
        lede={
          hasLetter
            ? 'Yesterday you crossed paths with these people. They stay in your letter all week, so take your time.'
            : undefined
        }
      />

      {paused ? (
        <View style={[styles.banner, { backgroundColor: theme.colors.surfaceSunk }]}>
          <AppText variant="small" style={styles.bannerText}>
            Discovery is paused. You won&rsquo;t appear in anyone&rsquo;s letter.
          </AppText>
          <Button
            label="Resume"
            kind="ghost"
            small
            onPress={() => {
              void resumeDiscovery().then(() => me.refetch());
            }}
          />
        </View>
      ) : null}

      {letter.loading ? (
        <AppText variant="body" tone="muted">
          Opening your letter&hellip;
        </AppText>
      ) : !hasLetter ? (
        letter.releaseDay ? (
          <EmptyState
            icon="today"
            title="No crossings yesterday."
            body="Mutual notices people you spend a little time near — keep it on during your day."
          />
        ) : (
          <EmptyState
            icon="sun"
            title={`Your morning letter arrives at ${releaseTime.replace(':00', '')}.`}
            body="Yesterday's crossings are on their way. Nothing to do until then."
          />
        )
      ) : (
        <Stack>{letter.today.map(renderCard)}</Stack>
      )}

      {letter.earlier.length > 0 ? (
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Earlier this week"
            accessibilityState={{ expanded: earlierOpen }}
            onPress={() => setEarlierOpen(!earlierOpen)}
            style={styles.earlier}
          >
            <Hairline style={styles.earlierRule} />
            <View style={styles.earlierRow}>
              <AppText variant="bodySemiBold">Earlier this week</AppText>
              <View style={earlierOpen ? styles.flipped : undefined}>
                <Icon name="chev" size={20} />
              </View>
            </View>
          </Pressable>
          {earlierOpen ? <Stack>{letter.earlier.map(renderCard)}</Stack> : null}
        </View>
      ) : null}

      {hasLetter ? (
        <AppText variant="small" tone="muted" center style={styles.footnote}>
          That&rsquo;s everyone from yesterday. Your next letter arrives tomorrow at{' '}
          {releaseTime.replace(':00', '')}.
        </AppText>
      ) : null}

      {error ? (
        <AppText variant="small" tone="danger" center style={styles.footnote}>
          {error}
        </AppText>
      ) : null}

      {toast ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          onPress={() => setToast(null)}
          style={[styles.toast, { backgroundColor: theme.colors.ink }]}
        >
          <AppText variant="small" tone="onInk">
            {toast}
          </AppText>
        </Pressable>
      ) : null}

      {sheetFor ? (
        <SignalSheet
          visible
          peerName={sheetFor.peer.card.first_name}
          current={sheetFor.signalled}
          usedByOthers={usedByOthers}
          cap={SIGNAL_CAP}
          uploadedTonight={uploadedTonight}
          onClose={() => setSheetFor(null)}
          onConfirm={(intents) => void confirm(intents)}
        />
      ) : null}
    </Screen>
  );
}

/** "Monday, 5 October" — the eyebrow above the greeting. */
function formatReleaseDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  const weekday = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ][date.getUTCDay()];
  const month = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ][date.getUTCMonth()];
  return `${weekday}, ${date.getUTCDate()} ${month}`;
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.tray,
    paddingVertical: space.sm + 2,
    paddingLeft: space.lg,
    paddingRight: space.sm + 2,
    marginBottom: space.lg,
  },
  bannerText: { flex: 1 },
  earlier: { marginTop: space.xxl - 2 },
  earlierRule: { marginBottom: space.md },
  earlierRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
  },
  flipped: { transform: [{ rotate: '180deg' }] },
  footnote: { marginTop: space.xl + space.xs },
  toast: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    bottom: space.lg,
    borderRadius: radius.tray,
    padding: space.md + 2,
  },
});
