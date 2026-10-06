/**
 * SafetySheet (SPEC.md §8, §13.9): report, unmatch, block.
 *
 * Three properties the copy has to get right, because all three are facts about the system
 * rather than reassurances:
 *
 *  - **Blocking is immediate and silent.** The other person is never told. The server
 *    returns the same 204 whether or not the id means anything, so a block can never be
 *    used to test whether someone exists or has matched you (SPEC §11).
 *  - **Unmatching deletes the conversation** -- for both sides. But the match itself does
 *    not disappear for the other person: they keep it as ended (invariant 12). The sheet
 *    says so, because quietly implying otherwise would misrepresent the one design decision
 *    users are most likely to be surprised by.
 *  - **Reporting goes to a person.** Nothing is acted on automatically, and a report filed
 *    from an ended match is flagged for review rather than enforced (SPEC §7.2).
 *
 * Added to SPEC §20's file list in the same change that introduced it (Phase 11).
 */

import { useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';

import { REPORT_REASONS, REPORT_REASON_LABELS, type ReportReason } from '@/api/types';
import { AppText, Button, Hairline } from '@/design/primitives';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';

export interface SafetySheetProps {
  visible: boolean;
  peerName: string;
  /** Hidden before a match: there is no conversation to end. */
  canUnmatch: boolean;
  onClose: () => void;
  onBlock: () => void;
  onUnmatch: () => void;
  onReport: (reason: ReportReason) => void;
}

export function SafetySheet({
  visible,
  peerName,
  canUnmatch,
  onClose,
  onBlock,
  onUnmatch,
  onReport,
}: SafetySheetProps): ReactNode {
  const theme = useTheme();
  const [choosingReason, setChoosingReason] = useState(false);

  const close = (): void => {
    setChoosingReason(false);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={[styles.scrim, { backgroundColor: theme.colors.scrim }]}
        onPress={close}
      />
      <View
        style={[styles.sheet, { backgroundColor: theme.colors.surface }]}
        accessibilityViewIsModal
      >
        <View style={[styles.handle, { backgroundColor: theme.colors.hairline }]} />
        <AppText variant="sheetTitle" accessibilityRole="header">
          {choosingReason ? `Report ${peerName}` : peerName}
        </AppText>

        {choosingReason ? (
          <>
            <AppText variant="small" tone="muted">
              A moderator reads every report. Nothing is acted on automatically.
            </AppText>
            <View>
              {REPORT_REASONS.map((reason) => (
                <View key={reason}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={REPORT_REASON_LABELS[reason]}
                    onPress={() => {
                      setChoosingReason(false);
                      onReport(reason);
                    }}
                    style={styles.item}
                  >
                    <AppText variant="listTitle">{REPORT_REASON_LABELS[reason]}</AppText>
                  </Pressable>
                  <Hairline />
                </View>
              ))}
            </View>
          </>
        ) : (
          <>
            <View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Report ${peerName}`}
                onPress={() => setChoosingReason(true)}
                style={styles.item}
              >
                <AppText variant="listTitle">{`Report ${peerName}`}</AppText>
              </Pressable>
              <Hairline />

              {canUnmatch ? (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Unmatch"
                    onPress={onUnmatch}
                    style={styles.item}
                  >
                    <AppText variant="listTitle">Unmatch</AppText>
                  </Pressable>
                  <Hairline />
                </>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Block ${peerName}`}
                onPress={onBlock}
                style={styles.item}
              >
                <AppText variant="listTitle" tone="danger">
                  {`Block ${peerName}`}
                </AppText>
              </Pressable>
              <Hairline />
            </View>

            <AppText variant="small" tone="muted">
              {`Blocking is immediate and silent. ${peerName} won’t be told, and you won’t appear to each other again.`}
            </AppText>
            {canUnmatch ? (
              <AppText variant="small" tone="muted">
                Unmatching deletes the conversation for both of you. The mutual itself stays
                as ended on their side &mdash; neither of you can remove it from the
                other&rsquo;s history.
              </AppText>
            ) : null}
          </>
        )}

        <Button label="Cancel" kind="ghost" wide onPress={close} />
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
  item: { minHeight: 54, justifyContent: 'center' },
});
