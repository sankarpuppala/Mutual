/**
 * The dev panel (SPEC.md §13.2). Present only when the app is built against a dev server;
 * it renders a refusal otherwise, and `/v1/dev/*` does not exist on a non-dev server anyway
 * (CLAUDE.md invariant 11).
 *
 * Phase 8 ships the part that proves the stack works: the protocol self-test running inside
 * Hermes. Clock travel, simulated crossings and the epoch/policy readout are added in
 * Phase 11 once there is a server session to use them with.
 */

import { router } from 'expo-router';
import { useCallback, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { isDev } from '@/api/client';
import { runProtocolSelfTest, type SelfTestResult } from '@/dev/protocolSelfTest';
import { Icon } from '@/design/icons';
import { AppText, Button, Card, GUTTER, Screen, SectionHeading } from '@/design/primitives';
import { useTheme } from '@/design/theme';
import { hitSize, radius, space } from '@/design/tokens';

interface SelfTestState {
  result: SelfTestResult | null;
  error: string | null;
}

/** Runs the self-test, turning a thrown error into a displayable message. */
function runSafely(): SelfTestState {
  try {
    return { result: runProtocolSelfTest(), error: null };
  } catch (e) {
    return { result: null, error: e instanceof Error ? e.message : 'unknown error' };
  }
}

export default function DevScreen(): ReactNode {
  const theme = useTheme();
  // The self-test is synchronous and pure, so it runs as the initial state rather than in
  // an effect: no cascading render, and the panel is correct on its very first frame.
  const [{ result, error }, setState] = useState(runSafely);
  const run = useCallback(() => setState(runSafely()), []);

  if (!isDev()) {
    return (
      <Screen testID="dev">
        <AppText variant="title">Not available</AppText>
        <AppText variant="body" tone="muted">
          The dev panel exists only in a dev build.
        </AppText>
      </Screen>
    );
  }

  const failures = result?.cases.filter((c) => !c.passed) ?? [];

  return (
    <Screen testID="dev">
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          style={styles.iconButton}
        >
          <Icon name="back" />
        </Pressable>
      </View>

      <AppText variant="title" accessibilityRole="header">
        Dev panel
      </AppText>

      <SectionHeading>Protocol self-test</SectionHeading>
      <Card>
        {error ? (
          <AppText variant="bodySemiBold" tone="danger">
            Self-test could not run: {error}
          </AppText>
        ) : result ? (
          <>
            <AppText
              variant="nameSmall"
              tone={result.ok ? 'mutual' : 'danger'}
              testID="selftest-headline"
            >
              {result.ok ? 'Protocol OK' : `${failures.length} vector(s) FAILED`}
            </AppText>
            <AppText variant="small" tone="muted">
              {result.cases.length} vectors from packages/protocol-spec/vectors.json, run here
              under Hermes. Protocol version {result.protocolVersion}.
            </AppText>
            <View style={styles.list}>
              {result.cases.map((c) => (
                <View key={c.name} style={styles.caseRow}>
                  <Icon
                    name={c.passed ? 'check' : 'close'}
                    size={16}
                    strokeWidth={2.2}
                    color={c.passed ? theme.colors.mutual : theme.colors.danger}
                  />
                  <AppText variant="tiny" tone={c.passed ? 'muted' : 'danger'} style={styles.flex}>
                    {c.name}
                    {c.detail ? ` — ${c.detail}` : ''}
                  </AppText>
                </View>
              ))}
            </View>
          </>
        ) : (
          <AppText variant="body" tone="muted">
            Running…
          </AppText>
        )}
        <Button label="Run again" kind="ghost" onPress={run} />
      </Card>

      <SectionHeading>Added in Phase 11</SectionHeading>
      <AppText variant="small" tone="muted">
        Clock travel, a simulated crossing, the current epoch and the active reveal policy.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', marginHorizontal: -GUTTER + space.sm, marginTop: -space.sm },
  iconButton: {
    width: hitSize,
    height: hitSize,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { gap: space.xs + 2 },
  caseRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  flex: { flex: 1 },
});
