/**
 * Permissions (journey J1, SPEC.md §14.1, CLAUDE.md invariant 3).
 *
 * The honest version of a permissions screen. It names each permission, says what it is
 * for, and says what Mutual does **not** ask for -- because "Bluetooth" on Android has
 * historically meant "location", and a user who has learned to be suspicious of that
 * deserves a straight answer rather than a reassuring adjective.
 *
 * If the Bluetooth permissions are refused, the app still works: the user simply has no
 * crossings. Nothing here is a wall.
 */

import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { PrivacyRow } from '@/components/PrivacyRow';
import {
  AppText,
  BarButton,
  Button,
  Card,
  LinkButton,
  Screen,
  ScreenHeader,
  SectionHeading,
  Stack,
} from '@/design/primitives';
import { space } from '@/design/tokens';
import { NativeBle } from '@/presence/nativeBle';

const ASKS_FOR = [
  'Bluetooth, to notice other phones running Mutual and let them notice yours.',
  'A notification, so you can always see that discovery is on and stop it in one tap.',
];

const NEVER_ASKS_FOR = [
  'Location. Not GPS, not approximate location, not location in the background.',
  'Your contacts, your calendar, or anything else on your phone.',
];

export default function PermissionsScreen(): ReactNode {
  const [granted, setGranted] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const ok = await new NativeBle().requestPermissions();
      setGranted(ok);
    } catch (e) {
      // The wrapper throws rather than requesting a location permission (invariant 3).
      // If that ever happens it is an escalation, so the message says so plainly.
      setError(e instanceof Error ? e.message : 'Could not request permissions.');
    } finally {
      setBusy(false);
    }
  };

  const finish = (): void => {
    router.replace('/(tabs)/today');
  };

  return (
    <Screen testID="permissions">
      <BarButton kind="back" onPress={() => router.back()} />
      <ScreenHeader
        title="Keeping it on"
        lede="Mutual notices phones nearby while you go about your day. Here is exactly what that needs."
      />

      <SectionHeading>What Mutual asks for</SectionHeading>
      <Card>
        {ASKS_FOR.map((text, i) => (
          <PrivacyRow key={text} text={text} kind="can" last={i === ASKS_FOR.length - 1} />
        ))}
      </Card>

      <SectionHeading>What Mutual never asks for</SectionHeading>
      <Card>
        {NEVER_ASKS_FOR.map((text, i) => (
          <PrivacyRow
            key={text}
            text={text}
            kind="never"
            last={i === NEVER_ASKS_FOR.length - 1}
          />
        ))}
      </Card>

      <View style={styles.actions}>
        <Stack gap={space.md}>
          {granted === false ? (
            <AppText variant="small" tone="muted">
              Without Bluetooth, Mutual still works — you just will not have any
              crossings. You can turn it on later from the You tab.
            </AppText>
          ) : null}
          {granted === true ? (
            <AppText variant="small" tone="mutual">
              Discovery is ready. Your first letter arrives tomorrow morning at 8.
            </AppText>
          ) : null}
          {error ? (
            <AppText variant="small" tone="danger">
              {error}
            </AppText>
          ) : null}

          {granted === null ? (
            <Button
              label={busy ? 'Asking…' : 'Allow Bluetooth and notifications'}
              kind="ink"
              wide
              disabled={busy}
              onPress={() => void ask()}
            />
          ) : (
            <Button label="Open my letter" kind="ink" wide onPress={finish} />
          )}

          {granted === null ? (
            <LinkButton label="Not now" center onPress={finish} />
          ) : null}
        </Stack>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { marginTop: space.xl },
});
