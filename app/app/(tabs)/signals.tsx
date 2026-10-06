/**
 * Signals (SPEC.md §13.2, §13.9; journey J3).
 *
 * A list of what you have sent, which exists on this phone and nowhere else. The screen's
 * real job is to make the privacy mechanism legible: twenty dots, and a sentence explaining
 * that all twenty leave together at a random time tonight and the unused ones are decoys.
 *
 * There is nothing here about signals *received*, because that quantity does not exist
 * anywhere in the system (claim C1). Most apps in this category make it the headline.
 */

import { useQuery } from '@tanstack/react-query';
import { useCallback, useState, type ReactNode } from 'react';
import { useFocusEffect } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { getConfig } from '@/api/endpoints';
import { INTENT_LABELS, type Intent } from '@/api/types';
import { GenerativeAvatar } from '@/components/GenerativeAvatar';
import { SignalDots } from '@/components/SignalDots';
import {
  AppText,
  Button,
  Card,
  Hairline,
  LockNote,
  Pill,
  Screen,
  ScreenHeader,
  SectionHeading,
} from '@/design/primitives';
import { space } from '@/design/tokens';
import { SIGNAL_CAP, listSignals, withdrawPeer, type StoredSignal } from '@/signals/db';
import { localDay } from '@/signals/scheduler';
import { expiryLabel } from '@/signals/ttl';
import { hasUploaded } from '@/storage/localDb';

interface PeerGroup {
  peerId: string;
  intents: Intent[];
  signal: StoredSignal;
}

/** Weekday name for the TTL label. */
function weekdayName(day: string): string {
  return [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ][new Date(`${day}T00:00:00Z`).getUTCDay()]!;
}

export default function SignalsScreen(): ReactNode {
  const config = useQuery({ queryKey: ['config'], queryFn: getConfig });
  const [groups, setGroups] = useState<PeerGroup[]>([]);
  const [uploadedTonight, setUploadedTonight] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const signals = await listSignals();
    const byPeer = new Map<string, PeerGroup>();
    for (const signal of signals) {
      const existing = byPeer.get(signal.peerId);
      if (existing) existing.intents.push(signal.intent);
      else byPeer.set(signal.peerId, { peerId: signal.peerId, intents: [signal.intent], signal });
    }
    setGroups([...byPeer.values()]);
    setUploadedTonight(await hasUploaded('signals', localDay(new Date())));
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const used = groups.reduce((n, g) => n + g.intents.length, 0);
  const window = config.data?.signal_upload_window;
  const ttl = config.data?.interest_ttl_days ?? 7;
  const today = localDay(new Date());

  const withdraw = async (group: PeerGroup): Promise<void> => {
    await withdrawPeer(group.peerId);
    setToast(
      uploadedTonight
        ? 'Signal withdrawn. It already left with tonight’s set, so it could still match tonight. From tomorrow it’s gone.'
        : 'Signal withdrawn. Nobody was ever told.',
    );
    await load();
  };

  return (
    <Screen testID="signals">
      <ScreenHeader
        title="Signals"
        lede="A signal becomes a mutual only if they send one back for the same thing. Until then it stays secret."
      />

      <Card>
        <SignalDots used={used} total={SIGNAL_CAP} />
        <AppText variant="body" tone="muted">
          <AppText variant="nameSmall">{`${SIGNAL_CAP - used} of ${SIGNAL_CAP}`}</AppText>
          {'  signals free'}
        </AppText>
        <Hairline />
        <LockNote>
          {window
            ? `Tonight, at a random time between ${friendlyTime(window.start)} and ${friendlyTime(window.end)}, your phone sends all ${SIGNAL_CAP} at once. Unused ones are random decoys, so nobody can tell how many are real.`
            : `Tonight, at a random time, your phone sends all ${SIGNAL_CAP} at once. Unused ones are random decoys, so nobody can tell how many are real.`}
        </LockNote>
      </Card>

      {used >= SIGNAL_CAP ? (
        <AppText variant="body" tone="muted" style={styles.full}>
          {`All ${SIGNAL_CAP} signals are out. Withdraw one to send another.`}
        </AppText>
      ) : null}

      <SectionHeading>Active</SectionHeading>
      {groups.length === 0 ? (
        <AppText variant="body" tone="muted">
          No active signals. You can send one from your morning letter.
        </AppText>
      ) : (
        <View>
          {groups.map((group) => (
            <View key={group.peerId}>
              <View style={styles.row}>
                <GenerativeAvatar identityPk={group.signal.peerIdentityPk} size={40} />
                <View style={styles.rowMain}>
                  <View style={styles.rowTitle}>
                    <AppText variant="bodySemiBold">{group.signal.peerName}</AppText>
                    {group.intents.map((intent) => (
                      <Pill key={intent} label={INTENT_LABELS[intent]} />
                    ))}
                  </View>
                  <AppText variant="small" tone="muted">
                    {expiryLabel(group.signal, today, ttl, weekdayName)}
                  </AppText>
                </View>
                <Button
                  label="Withdraw"
                  kind="ghost"
                  small
                  accessibilityLabel={`Withdraw signal to ${group.signal.peerName}`}
                  onPress={() => void withdraw(group)}
                />
              </View>
              <Hairline />
            </View>
          ))}
        </View>
      )}

      {toast ? (
        <AppText variant="small" tone="muted" style={styles.toast}>
          {toast}
        </AppText>
      ) : null}
    </Screen>
  );
}

/** "6" and "11:30 pm" rather than "18:00" and "23:30". */
function friendlyTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const hour = h ?? 0;
  const suffix = hour >= 12 ? 'pm' : 'am';
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return m && m > 0 ? `${twelve}:${String(m).padStart(2, '0')} ${suffix}` : `${twelve} ${suffix}`;
}

const styles = StyleSheet.create({
  full: { marginTop: space.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md + 2 },
  rowMain: { flex: 1, gap: 3 },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: space.xs + 2, flexWrap: 'wrap' },
  toast: { marginTop: space.xl },
});
