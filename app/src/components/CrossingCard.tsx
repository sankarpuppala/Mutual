/**
 * CrossingCard (SPEC.md §13.5, §13.9): one person in the morning letter.
 *
 * What is on it: the avatar, the first name and year, the coarse time chip, the first prompt
 * question and answer, a voice player if there is one, a link to the rest, and the signal
 * action.
 *
 * What is deliberately **not** on it, each for a reason:
 *   - **no photo** -- that is the whole product (SPEC §11.2);
 *   - **no crossing count and no exact time** -- only a quarter-of-the-day chip computed on
 *     this device from its own sighting log (invariant 4);
 *   - **no "they viewed you" or "you have been signalled" hint** -- one-sided interest is
 *     unobservable by design (claim C1), so there is nothing to hint at;
 *   - **no network call of any kind.** Rendering this card, and playing its voice note,
 *     must make no request (invariant 1, AC-T2-2). The media comes from the local cache the
 *     prefetch filled.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { INTENT_LABELS, type Intent, type PeerCard } from '@/api/types';
import { Icon } from '@/design/icons';
import { AppText, Card, LinkButton, TimeChip } from '@/design/primitives';
import { useTheme } from '@/design/theme';
import { hitSize, radius, space } from '@/design/tokens';

import { GenerativeAvatar } from './GenerativeAvatar';
import { VoicePlayer } from './VoicePlayer';

export interface CrossingCardProps {
  card: PeerCard;
  /** "Yesterday · evening", computed on-device (SPEC §6.13). */
  timeLabel: string;
  /** The intents already signalled to this peer. Visible to the sender only. */
  signalled: readonly Intent[];
  /** Local URI for the first prompt's voice note, from the prefetch cache. */
  voiceUri: string | null;
  /**
   * The question text for a prompt id, from the prompt library (`GET /prompts`).
   *
   * The digest carries answers and prompt ids, not questions, so the library has to be
   * looked up by the caller. Passing a resolver rather than guessing here keeps the card
   * from inventing a question that the library does not use.
   */
  questionFor: (promptId: string) => string;
  onOpenProfile: () => void;
  onSignal: () => void;
}

export function CrossingCard({
  card,
  timeLabel,
  signalled,
  voiceUri,
  questionFor,
  onOpenProfile,
  onSignal,
}: CrossingCardProps): ReactNode {
  const theme = useTheme();
  const prompt = card.prompts[0];
  const sentLabel = signalled.map((i) => INTENT_LABELS[i]).join(', ');

  return (
    <Card accessibilityLabel={`${card.first_name}, ${card.year_of_study ?? 'year unknown'}`}>
      <View style={styles.head}>
        <GenerativeAvatar identityPk={card.identity_pk} size={44} />
        <View style={styles.who}>
          <AppText variant="bodySemiBold">{card.first_name}</AppText>
          {card.year_of_study ? (
            <AppText variant="small" tone="muted">
              {`${card.year_of_study}${suffix(card.year_of_study)} year`}
            </AppText>
          ) : null}
        </View>
        <TimeChip label={timeLabel} />
      </View>

      {prompt ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${prompt.text}. See all of ${card.first_name}'s answers`}
          onPress={onOpenProfile}
          style={styles.prompt}
        >
          <AppText variant="promptQuestion" tone="muted">
            {questionFor(prompt.prompt_id)}
          </AppText>
          <AppText variant="promptAnswer">{prompt.text}</AppText>
        </Pressable>
      ) : null}

      {prompt?.voice_media_id ? (
        <VoicePlayer
          uri={voiceUri}
          waveform={prompt.waveform ?? []}
          speakerName={card.first_name}
        />
      ) : null}

      <View style={styles.foot}>
        <LinkButton label="See all answers" onPress={onOpenProfile} />
        {signalled.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Signal sent for ${sentLabel}. Change or withdraw it`}
            onPress={onSignal}
            style={[styles.sent, { backgroundColor: theme.colors.signalSoft }]}
          >
            <Icon name="check" size={16} strokeWidth={2.2} color={theme.colors.signal} />
            <AppText variant="smallSemiBold">{`Sent · ${sentLabel}`}</AppText>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Send a signal to ${card.first_name}`}
            onPress={onSignal}
            style={({ pressed }) => [
              styles.signalButton,
              { backgroundColor: theme.colors.signal },
              pressed && styles.pressed,
            ]}
          >
            <AppText variant="button" tone="onSignal">
              Send a signal
            </AppText>
          </Pressable>
        )}
      </View>
    </Card>
  );
}

function suffix(year: number): string {
  if (year === 1) return 'st';
  if (year === 2) return 'nd';
  if (year === 3) return 'rd';
  return 'th';
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  who: { flex: 1, gap: 1 },
  prompt: { gap: space.xs + 2, borderRadius: radius.sm },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    flexWrap: 'wrap',
  },
  sent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs + 2,
    minHeight: hitSize,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
  },
  signalButton: {
    minHeight: hitSize,
    paddingHorizontal: space.xl - space.xs,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { transform: [{ scale: 0.97 }] },
});
