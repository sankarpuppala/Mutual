/**
 * VoicePlayer (SPEC.md §13.5): a play/pause button, 48 waveform bars drawn from the stored
 * waveform values, and an elapsed time.
 *
 * The privacy-critical part is what this component does **not** do: it never touches the
 * network (CLAUDE.md invariant 1). Audio comes from the local cache that
 * `src/digest/prefetch.ts` filled in full, in a fixed order, before any of this rendered.
 * If the file is missing, the player says so rather than fetching it -- a fetch at the
 * moment someone pressed play would tell the server which card they were interested in,
 * which is precisely the leak this whole design exists to prevent. A jest test asserts that
 * rendering and pressing play make no request (AC-T2-2).
 */

import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useEffect, useMemo, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Icon } from '@/design/icons';
import { AppText } from '@/design/primitives';
import { useTheme } from '@/design/theme';
import { hitSize, radius, space } from '@/design/tokens';

/** SPEC §11: a voice note carries exactly 48 waveform values, each 0-100. */
export const WAVEFORM_POINTS = 48;

export interface VoicePlayerProps {
  /** Local file URI from the prefetch cache. Null while the cache has not got it. */
  uri: string | null;
  /** The 48 stored waveform values. A short or missing array is padded flat. */
  waveform: readonly number[];
  /** Whose answer this is, for the accessibility label. */
  speakerName: string;
}

function formatSeconds(total: number): string {
  const seconds = Math.max(0, Math.floor(total));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function VoicePlayer({ uri, waveform, speakerName }: VoicePlayerProps): ReactNode {
  const theme = useTheme();
  const player = useAudioPlayer(uri ? { uri } : null);
  const status = useAudioPlayerStatus(player);

  const bars = useMemo(() => {
    const values = Array.from({ length: WAVEFORM_POINTS }, (_, i) => waveform[i] ?? 0);
    // A flat zero waveform would render as an invisible strip, so every bar keeps a floor.
    return values.map((v) => Math.max(12, Math.min(100, v)));
  }, [waveform]);

  const duration = status.duration ?? 0;
  const elapsed = status.currentTime ?? 0;
  const playing = status.playing;
  const playedBars = duration > 0 ? Math.floor((elapsed / duration) * bars.length) : 0;

  // Rewind once playback finishes, so pressing play again starts from the beginning rather
  // than doing nothing.
  useEffect(() => {
    if (status.didJustFinish) void player.seekTo(0);
  }, [status.didJustFinish, player]);

  const toggle = (): void => {
    if (!uri) return;
    if (playing) player.pause();
    else player.play();
  };

  return (
    <View style={[styles.tray, { backgroundColor: theme.colors.surfaceSunk }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          playing
            ? `Pause ${speakerName}'s voice answer`
            : `Play ${speakerName}'s voice answer`
        }
        accessibilityState={{ disabled: !uri }}
        disabled={!uri}
        onPress={toggle}
        style={[styles.play, { backgroundColor: theme.colors.ink }, !uri && styles.disabled]}
      >
        <Icon name={playing ? 'pause' : 'play'} size={18} color={theme.colors.bg} />
      </Pressable>

      <View style={styles.wave} accessible={false} importantForAccessibility="no-hide-descendants">
        {bars.map((height, index) => (
          <View
            key={index}
            style={[
              styles.bar,
              {
                height: `${height}%`,
                backgroundColor: index < playedBars ? theme.colors.ink : theme.colors.inkMuted,
                opacity: index < playedBars ? 1 : 0.32,
              },
            ]}
          />
        ))}
      </View>

      <AppText variant="tiny" tone="muted" style={styles.time}>
        {uri ? formatSeconds(playing || elapsed > 0 ? elapsed : duration) : '—'}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  tray: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderRadius: radius.tray,
    paddingVertical: space.sm,
    paddingLeft: space.sm,
    paddingRight: space.md + 2,
  },
  play: {
    width: hitSize,
    height: hitSize,
    borderRadius: hitSize / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.38 },
  wave: { flex: 1, height: 30, flexDirection: 'row', alignItems: 'center', gap: 2 },
  bar: { flex: 1, borderRadius: 2, minHeight: 3 },
  time: { minWidth: 30, textAlign: 'right' },
});
