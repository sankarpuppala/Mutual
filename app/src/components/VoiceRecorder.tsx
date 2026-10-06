/**
 * VoiceRecorder (SPEC.md §13.5, §11): records a voice answer of at most 30 seconds and
 * captures 48 waveform values from the recorder's metering, which is what `VoicePlayer`
 * later draws.
 *
 * Two product rules are enforced here rather than left to the screen:
 *   - a voice answer never replaces the written one (decision D8), so this component is
 *     always rendered beneath a text field that is already filled in;
 *   - recording stops itself at the limit instead of letting the user overrun and then
 *     rejecting the file.
 *
 * The 48 values are sampled evenly across whatever was recorded, so a 6-second answer and a
 * 30-second answer both produce 48 bars and look alike. Metering is in dBFS (negative, 0 is
 * full scale); it is mapped to 0-100 because that is what the server stores.
 */

import {
  AudioModule,
  RecordingPresets,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Stack } from '@/design/primitives';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';

import { WAVEFORM_POINTS } from './VoicePlayer';

/** `media.voice_max_seconds` in server/config.yaml. */
export const VOICE_MAX_SECONDS = 30;

/** Quietest level we bother to show, in dBFS. Below this a bar is at its floor. */
const SILENCE_DBFS = -60;

/** Maps one metering reading in dBFS to the 0-100 scale the server stores. */
export function meteringToLevel(dbfs: number): number {
  if (!Number.isFinite(dbfs)) return 0;
  const clamped = Math.max(SILENCE_DBFS, Math.min(0, dbfs));
  return Math.round(((clamped - SILENCE_DBFS) / -SILENCE_DBFS) * 100);
}

/**
 * Reduces an arbitrary number of readings to exactly 48 values by averaging each bucket.
 * Averaging rather than sampling, so one loud click does not become a whole bar.
 */
export function toWaveform(levels: readonly number[], points = WAVEFORM_POINTS): number[] {
  if (levels.length === 0) return Array.from({ length: points }, () => 0);
  return Array.from({ length: points }, (_, i) => {
    const start = Math.floor((i * levels.length) / points);
    const end = Math.max(start + 1, Math.floor(((i + 1) * levels.length) / points));
    let sum = 0;
    for (let k = start; k < end && k < levels.length; k++) sum += levels[k]!;
    return Math.round(sum / (end - start));
  });
}

export interface RecordedVoice {
  /** Local file URI of the recording. */
  uri: string;
  seconds: number;
  /** Exactly 48 values, 0-100. */
  waveform: number[];
}

export interface VoiceRecorderProps {
  /** Called when a recording is finished and ready to upload. */
  onRecorded: (voice: RecordedVoice) => void;
  /** Called when the user discards an existing recording. */
  onCleared?: () => void;
  /** An already-recorded answer, so the component can show "replace" instead of "record". */
  existing?: { seconds: number } | null;
}

export function VoiceRecorder({
  onRecorded,
  onCleared,
  existing = null,
}: VoiceRecorderProps): ReactNode {
  const theme = useTheme();
  // HIGH_QUALITY is m4a/AAC, which is what the server accepts (SPEC §11).
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 100);
  const [error, setError] = useState<string | null>(null);
  const levels = useRef<number[]>([]);
  const meterTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopMetering = (): void => {
    if (meterTimer.current) clearInterval(meterTimer.current);
    meterTimer.current = null;
  };

  const finish = useCallback(async () => {
    stopMetering();
    await recorder.stop();
    const uri = recorder.uri;
    if (!uri) {
      setError('That recording did not save. Try once more.');
      return;
    }
    const seconds = Math.min(VOICE_MAX_SECONDS, (state.durationMillis ?? 0) / 1000);
    onRecorded({ uri, seconds, waveform: toWaveform(levels.current) });
  }, [recorder, state.durationMillis, onRecorded]);

  const begin = useCallback(async () => {
    setError(null);
    levels.current = [];

    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setError('Mutual needs the microphone to record a voice answer.');
      return;
    }

    await recorder.prepareToRecordAsync({ isMeteringEnabled: true });
    recorder.record();

    meterTimer.current = setInterval(() => {
      const metering = recorder.getStatus().metering;
      if (typeof metering === 'number') levels.current.push(meteringToLevel(metering));
      // Stop ourselves at the limit rather than rejecting the file afterwards.
      if (levels.current.length >= VOICE_MAX_SECONDS * 10) void finish();
    }, 100);
  }, [recorder, finish]);

  const recording = state.isRecording;
  const elapsed = Math.min(VOICE_MAX_SECONDS, (state.durationMillis ?? 0) / 1000);
  const remaining = Math.max(0, VOICE_MAX_SECONDS - elapsed);

  return (
    <Stack gap={space.md}>
      {recording ? (
        <View style={[styles.meter, { backgroundColor: theme.colors.signalSoft }]}>
          <AppText variant="bodySemiBold">Recording</AppText>
          <AppText variant="small" tone="muted">
            {remaining <= 5
              ? `${Math.ceil(remaining)} second${Math.ceil(remaining) === 1 ? '' : 's'} left`
              : `${Math.floor(elapsed)}s`}
          </AppText>
        </View>
      ) : null}

      <View style={styles.row}>
        <Button
          label={recording ? 'Stop' : existing ? 'Record again' : 'Add a voice answer'}
          kind={recording ? 'signal' : 'ghost'}
          onPress={() => void (recording ? finish() : begin())}
        />
        {existing && !recording ? (
          <Button
            label="Remove"
            kind="ghost"
            small
            onPress={() => {
              onCleared?.();
            }}
          />
        ) : null}
      </View>

      {error ? (
        <AppText variant="small" tone="danger">
          {error}
        </AppText>
      ) : (
        <AppText variant="small" tone="muted">
          Up to 30 seconds. Your written answer stays either way — a voice note is extra,
          never instead.
        </AppText>
      )}
    </Stack>
  );
}

const styles = StyleSheet.create({
  meter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.tray,
    padding: space.md,
  },
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'center', flexWrap: 'wrap' },
});
