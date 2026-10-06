/**
 * Welcome (SPEC.md §13.2, §13.9). Copy and structure as in the approved prototype: the
 * logo, one sentence that says what the product is, a paragraph that says how it protects
 * you, and a link to the privacy page before you have given anything away.
 *
 * The privacy link sits here, before sign-up, on purpose: a user should be able to read
 * exactly what the server will and will not learn *before* entering an email address.
 */

import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Logo } from '@/design/icons';
import { AppText, Button, LinkButton } from '@/design/primitives';
import { useTheme } from '@/design/theme';
import { space } from '@/design/tokens';
import { fonts, type } from '@/design/typography';

export default function WelcomeScreen(): ReactNode {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      testID="welcome"
      style={[
        styles.screen,
        {
          backgroundColor: theme.colors.bg,
          paddingTop: insets.top + space.xl,
          paddingBottom: insets.bottom + space.xl + 2,
        },
      ]}
    >
      <View style={styles.top}>
        <Logo size={64} />
        <AppText style={type.welcome} accessibilityRole="header">
          Meet the people you{' '}
          <AppText style={[type.welcome, styles.italic]} tone="signal">
            almost
          </AppText>{' '}
          meet.
        </AppText>
        <AppText variant="body" tone="muted">
          Mutual quietly notices who you spend time near on campus, never where. Each morning
          you meet them through their words. Send a private signal, and they only find out if
          they signal you back.
        </AppText>
      </View>

      <View style={styles.actions}>
        <Button
          label="Get started"
          kind="ink"
          wide
          onPress={() => router.push('/(onboarding)/how-it-works')}
        />
        <LinkButton
          label="What Mutual can and can never see"
          center
          onPress={() => router.push('/privacy')}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: space.xl + 2,
  },
  top: { gap: space.xl, paddingTop: space.xxl + space.lg },
  // Fraunces italic is its own loaded face: `fontStyle: 'italic'` would ask Android to
  // synthesise a slant, which looks wrong next to the real italic.
  italic: { fontFamily: fonts.displayItalic },
  actions: { gap: space.xs + 2 },
});
