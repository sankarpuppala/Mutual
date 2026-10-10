/**
 * Mutuals (SPEC.md §13.2, §13.9; journeys J4, J5).
 *
 * Two parts, as in the prototype: a "New this morning" card for each unrevealed match, then
 * the conversations.
 *
 * The intents on each row come from this device's own token records
 * (`src/matches/resolve.ts`), never from the server, which does not know them (claim C3). A
 * match whose tokens this device cannot account for -- after a reinstall, say -- is shown
 * without an intent rather than with a guessed one.
 */

import { useQuery } from '@tanstack/react-query';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { getMatches } from '@/api/endpoints';
import { INTENT_LABELS } from '@/api/types';
import { EmptyState } from '@/components/EmptyState';
import { GenerativeAvatar } from '@/components/GenerativeAvatar';
import {
  AppText,
  Button,
  Hairline,
  Pill,
  Screen,
  ScreenHeader,
  SectionHeading,
} from '@/design/primitives';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { matchPhotoSource, type PhotoSource } from '@/matches/photo';
import {
  describeIntents,
  messagesStillNeeded,
  photosAvailable,
  resolveMatches,
  type ResolvedMatch,
} from '@/matches/resolve';
import { seenRevealIds } from '@/storage/localDb';

export default function MutualsScreen(): ReactNode {
  const theme = useTheme();
  const matches = useQuery({
    queryKey: ['matches'],
    queryFn: getMatches,
    // The nightly batch is the only thing that creates a match, and it is delivered at a
    // fixed release time. Polling every minute would cost battery and learn nothing.
    refetchInterval: 5 * 60 * 1000,
  });
  const [resolved, setResolved] = useState<ResolvedMatch[]>([]);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [photos, setPhotos] = useState<Record<string, PhotoSource>>({});

  // `seenRevealIds()` reads local storage, which the reveal screen writes to when a card is
  // opened. react-query's `matches.data` does not change just from visiting that screen and
  // coming back, so this also has to re-run on focus -- otherwise a just-revealed match stays
  // stuck under "New this morning" until the next 5-minute matches refetch.
  const load = useCallback(async () => {
    if (!matches.data) return;
    const [result, played] = await Promise.all([resolveMatches(matches.data), seenRevealIds()]);
    // Photo sources carry the session token, so they are built once rather than per render.
    const sources: Record<string, PhotoSource> = {};
    for (const entry of result) {
      if (!photosAvailable(entry.match) || entry.match.state === 'ended') continue;
      const source = await matchPhotoSource(entry.match.match_id, 0);
      if (source) sources[entry.match.match_id] = source;
    }
    setResolved(result);
    setSeen(played);
    setPhotos(sources);
  }, [matches.data]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // "New this morning": revealed by the server, and this device has not played the reveal.
  const fresh = resolved.filter(
    (r) =>
      r.match.state === 'active' &&
      r.match.reveal.state === 'revealed' &&
      !seen.has(r.match.match_id),
  );
  const rest = resolved.filter((r) => !fresh.includes(r));

  return (
    <Screen testID="mutuals">
      <ScreenHeader title="Mutuals" />

      {fresh.map((entry) => {
        const label = describeIntents(entry.intents, INTENT_LABELS);
        return (
          <View
            key={entry.match.match_id}
            style={[styles.newCard, { backgroundColor: theme.colors.mutualSoft }]}
          >
            <AppText variant="eyebrow" tone="mutual">
              New this morning
            </AppText>
            <View style={styles.newBody}>
              <GenerativeAvatar identityPk={entry.match.peer.identity_pk} size={56} />
              <AppText variant="mutualBody" style={styles.flex}>
                {label
                  ? `You and ${entry.match.peer.first_name} both signalled for ${label}`
                  : `You and ${entry.match.peer.first_name} both signalled each other for the same thing`}
              </AppText>
            </View>
            <Button
              label={`See ${entry.match.peer.first_name}`}
              kind="mutual"
              wide
              onPress={() => router.push(`/reveal/${entry.match.match_id}`)}
            />
          </View>
        );
      })}

      <SectionHeading>Conversations</SectionHeading>

      {rest.length === 0 ? (
        <EmptyState
          icon="mutuals"
          title="Nothing mutual yet."
          body="When a signal is returned for the same thing, you'll find each other here the next morning."
        />
      ) : (
        <View>
          {rest.map((entry) => {
            const { match } = entry;
            const needed = messagesStillNeeded(match);
            const ended = match.state === 'ended';
            const subtitle = ended
              ? 'This mutual has ended.'
              : needed !== null
                ? `Photos after ${needed} more message${needed === 1 ? '' : 's'} each`
                : `Say hello. You both signalled for ${describeIntents(entry.intents, INTENT_LABELS) ?? 'the same thing'}.`;

            return (
              <View key={match.match_id}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${match.peer.first_name}. ${subtitle}`}
                  disabled={ended}
                  onPress={() => router.push(`/match/${match.match_id}`)}
                  style={styles.row}
                >
                  {photos[match.match_id] && !ended ? (
                    <Image
                      source={photos[match.match_id]!}
                      style={styles.thumb}
                      accessibilityIgnoresInvertColors
                    />
                  ) : (
                    <GenerativeAvatar identityPk={match.peer.identity_pk} size={48} />
                  )}
                  <View style={styles.rowMain}>
                    <View style={styles.rowTitle}>
                      <AppText variant="bodySemiBold">{match.peer.first_name}</AppText>
                      {entry.intents.map((i) => (
                        <Pill key={i.token} label={INTENT_LABELS[i.intent]} tint="mutual" />
                      ))}
                    </View>
                    <AppText variant="small" tone="muted" numberOfLines={1}>
                      {subtitle}
                    </AppText>
                  </View>
                  {match.unread && !ended ? (
                    <AppText variant="tinySemiBold" tone="mutual">
                      Your turn
                    </AppText>
                  ) : null}
                </Pressable>
                <Hairline />
              </View>
            );
          })}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  newCard: {
    borderRadius: radius.card,
    padding: space.xl - space.xs,
    gap: space.lg,
    marginBottom: space.lg,
  },
  newBody: { flexDirection: 'row', alignItems: 'center', gap: space.md + 2 },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md + 2 },
  rowMain: { flex: 1, gap: 3 },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: space.xs + 2, flexWrap: 'wrap' },
  thumb: { width: 48, height: 48, borderRadius: 24 },
});
