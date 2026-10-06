/**
 * The Reveal moment, as a full-screen modal (SPEC.md §13.2, §13.5).
 *
 * This route is thin on purpose: `RevealMoment` holds the animation, the `FLAG_SECURE` and
 * the reduce-motion rule. What happens here is the data: resolve the match's intents from
 * this device's own token records, fetch the photo source, and record locally that this
 * reveal has been played so the Mutuals tab stops calling it "new this morning".
 */

import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { getMatches } from '@/api/endpoints';
import { INTENT_LABELS } from '@/api/types';
import { RevealMoment } from '@/components/RevealMoment';
import { AppText, BarButton, Screen } from '@/design/primitives';
import { useTheme } from '@/design/theme';
import { matchPhotoSource, type PhotoSource } from '@/matches/photo';
import { describeIntents, photosAvailable, resolveMatch } from '@/matches/resolve';
import { markRevealSeen } from '@/storage/localDb';

export default function RevealScreen(): ReactNode {
  const theme = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const matches = useQuery({ queryKey: ['matches'], queryFn: getMatches });

  const [intentsLabel, setIntentsLabel] = useState<string | null>(null);
  const [photo, setPhoto] = useState<PhotoSource | null>(null);
  const [hasMessages, setHasMessages] = useState(false);

  const match = matches.data?.find((m) => m.match_id === id);

  useEffect(() => {
    if (!match) return;
    let cancelled = false;
    void (async () => {
      const resolved = await resolveMatch(match);
      const source = photosAvailable(match)
        ? await matchPhotoSource(match.match_id, 0)
        : null;
      if (cancelled) return;
      setIntentsLabel(describeIntents(resolved.intents, INTENT_LABELS));
      setPhoto(source);
      setHasMessages(match.unread);
      await markRevealSeen(match.match_id, new Date().toISOString());
    })();
    return () => {
      cancelled = true;
    };
  }, [match]);

  if (!match) {
    return (
      <Screen testID="reveal">
        <BarButton kind="close" onPress={() => router.back()} />
        <View>
          <AppText variant="title">Not available</AppText>
          <AppText variant="body" tone="muted">
            {matches.isLoading ? 'Opening…' : 'This mutual is no longer available.'}
          </AppText>
        </View>
      </Screen>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.bg }}>
      <RevealMoment
        peerName={match.peer.first_name}
        identityPk={match.peer.identity_pk}
        photo={photo}
        intentsLabel={intentsLabel}
        actionLabel={hasMessages ? 'Back to the conversation' : 'Say hello'}
        onContinue={() => router.replace(`/match/${match.match_id}`)}
        onClose={() => router.back()}
      />
    </View>
  );
}
