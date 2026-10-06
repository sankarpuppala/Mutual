/**
 * SignalSheet (SPEC.md §13.5, §13.9): the bottom sheet where a signal is sent, changed or
 * withdrawn.
 *
 * This is the one screen in the app where the privacy promise has to be stated at the exact
 * moment it matters, and the prototype's sentence is used unchanged: *"They'll only know if
 * they signal you back — for the same thing."*
 *
 * Two behaviours are load-bearing rather than cosmetic:
 *
 *  - **Confirming makes no network request.** The choice is written to the local database
 *    and leaves with the whole padded set at a random time tonight (SPEC §6.11). The sheet
 *    says so under the dots.
 *  - **Withdrawing is honest about tonight.** If the set has already gone out, the token is
 *    in it and can still match tonight. The copy says that in so many words
 *    (SPEC §13.6) rather than implying the signal has vanished.
 */

import { useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { INTENTS, INTENT_LABELS, type Intent } from '@/api/types';
import { AppText, Button, LockNote } from '@/design/primitives';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';

import { IntentChip } from './IntentChip';
import { SignalDots } from './SignalDots';

export interface SignalSheetProps {
  visible: boolean;
  peerName: string;
  /** Intents already signalled to this peer. */
  current: readonly Intent[];
  /** Slots used by signals to *other* peers. */
  usedByOthers: number;
  cap: number;
  /** True once tonight's set has been uploaded, which changes the withdrawal copy. */
  uploadedTonight: boolean;
  onClose: () => void;
  /** Called with the new set of intents. An empty array is a withdrawal. */
  onConfirm: (intents: Intent[]) => void;
}

export function SignalSheet({
  visible,
  peerName,
  current,
  usedByOthers,
  cap,
  uploadedTonight,
  onClose,
  onConfirm,
}: SignalSheetProps): ReactNode {
  const theme = useTheme();
  const [selected, setSelected] = useState<Intent[]>([...current]);

  // Re-seed when the sheet opens for a different peer.
  const [seededFor, setSeededFor] = useState(peerName);
  if (seededFor !== peerName) {
    setSeededFor(peerName);
    setSelected([...current]);
  }

  const total = usedByOthers + selected.length;
  const full = total >= cap;
  const had = current.length > 0;

  const toggle = (intent: Intent): void => {
    setSelected((previous) =>
      previous.includes(intent)
        ? previous.filter((i) => i !== intent)
        : [...previous, intent],
    );
  };

  const label = had
    ? selected.length > 0
      ? 'Update signal'
      : 'Withdraw signal'
    : 'Send signal';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={[styles.scrim, { backgroundColor: theme.colors.scrim }]}
        onPress={onClose}
      />
      <View
        style={[styles.sheet, { backgroundColor: theme.colors.surface }]}
        accessibilityViewIsModal
      >
        <View style={[styles.handle, { backgroundColor: theme.colors.hairline }]} />

        <AppText variant="sheetTitle" accessibilityRole="header">
          {`Signal ${peerName} for…`}
        </AppText>
        <AppText variant="small" tone="muted" style={styles.sub}>
          Pick one or more. You can change this any time.
        </AppText>

        <View style={styles.chips} accessibilityRole="radiogroup">
          {INTENTS.map((intent) => {
            const on = selected.includes(intent);
            return (
              <IntentChip
                key={intent}
                label={INTENT_LABELS[intent]}
                selected={on}
                disabled={!on && full}
                onPress={() => toggle(intent)}
              />
            );
          })}
        </View>

        <AppText variant="reassure">
          They&rsquo;ll only know if they signal you back &mdash; for the same thing.
        </AppText>

        <View style={styles.meter}>
          <SignalDots
            used={usedByOthers}
            pending={selected.length}
            total={cap}
            compact
          />
          <AppText variant="small" tone="muted">
            {`${Math.max(0, cap - total)} of ${cap} signals free`}
            {full ? `. All ${cap} signals are out. Withdraw one to send another.` : ''}
          </AppText>
        </View>

        {had && selected.length === 0 ? (
          <LockNote>
            {uploadedTonight
              ? 'Withdrawing now still leaves tonight’s set as it went out, so this could match tonight. From tomorrow it is gone.'
              : 'Nothing has left your phone yet, so withdrawing means nobody was ever told.'}
          </LockNote>
        ) : (
          <LockNote>
            Nothing is sent now. Tonight, at a random time, your phone sends all{' '}
            {cap} at once &mdash; the unused ones are random decoys, so nobody can tell how
            many are real.
          </LockNote>
        )}

        <Button
          label={label}
          kind={selected.length === 0 && had ? 'ghost' : 'signal'}
          wide
          disabled={!had && selected.length === 0}
          onPress={() => onConfirm(selected)}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '88%',
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: space.xl - 2,
    paddingTop: space.md - 2,
    paddingBottom: space.xl + 2,
    gap: space.lg,
  },
  handle: { width: 40, height: 5, borderRadius: radius.pill, alignSelf: 'center' },
  sub: { marginTop: -space.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  meter: { gap: space.sm },
});
