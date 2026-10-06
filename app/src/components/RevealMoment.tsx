/**
 * RevealMoment (SPEC.md §13.5, §13.9): the one deliberately theatrical screen in the app.
 *
 * The avatar dissolves into the photo -- crossfade, blur 20 to 0, scale 1.04 to 1, over
 * 900 ms. It is the only place a 900 ms animation is allowed, and it is there because this
 * is the moment the product has been withholding: the whole design asks people to meet
 * through words first, so the face arriving should feel like an event rather than a load.
 *
 * Three non-negotiables:
 *
 *  1. **`FLAG_SECURE` while this screen is open** (via `expo-screen-capture`), so the
 *     reveal cannot be screenshotted or recorded. A photo released on the understanding
 *     that it is shown only after a mutual should not be trivially exportable.
 *  2. **Instant when reduce-motion is on** (SPEC §13.7). Not faster -- instant.
 *  3. **The shared intents are shown**, because that is what the match means, and they come
 *     from the device's own records (`matches/resolve.ts`), never from the server.
 */

import * as ScreenCapture from 'expo-screen-capture';
import { useEffect, type ReactNode } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { Icon } from '@/design/icons';
import { AppText, Button } from '@/design/primitives';
import { useMotion } from '@/design/motion';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';

import { GenerativeAvatar } from './GenerativeAvatar';

/** How long the avatar holds before dissolving, so the screen is readable first. */
const HOLD_MS = 350;

export interface RevealMomentProps {
  peerName: string;
  identityPk: string;
  /**
   * The photo source, including the Authorization header the endpoint needs, or null while
   * it loads. Built by `src/matches/photo.ts`.
   */
  photo: { uri: string; headers: Record<string, string> } | null;
  /** "Study and Project", from the device's own token records. Null if nothing resolved. */
  intentsLabel: string | null;
  /** "Say hello" on a fresh match, "Back to the conversation" otherwise. */
  actionLabel: string;
  onContinue: () => void;
  onClose: () => void;
}

export function RevealMoment({
  peerName,
  identityPk,
  photo,
  intentsLabel,
  actionLabel,
  onContinue,
  onClose,
}: RevealMomentProps): ReactNode {
  const theme = useTheme();
  const motion = useMotion();

  // 0 = avatar, 1 = photo.
  const progress = useSharedValue(0);

  useEffect(() => {
    if (motion.reduced) {
      progress.value = 1;
      return;
    }
    progress.value = withDelay(HOLD_MS, withTiming(1, { duration: motion.reveal }));
  }, [motion.reduced, motion.reveal, progress]);

  // FLAG_SECURE for as long as this screen is mounted (SPEC §13.5).
  useEffect(() => {
    void ScreenCapture.preventScreenCaptureAsync('reveal');
    return () => {
      void ScreenCapture.allowScreenCaptureAsync('reveal');
    };
  }, []);

  const photoStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 1.04 - 0.04 * progress.value }],
  }));
  const avatarStyle = useAnimatedStyle(() => ({ opacity: 1 - progress.value }));

  return (
    <View style={[styles.screen, { backgroundColor: theme.colors.bg }]} testID="reveal">
      <View style={styles.bar}>
        <Button label="Close" kind="ghost" small onPress={onClose} />
      </View>

      <View style={styles.body}>
        <AppText variant="eyebrow" tone="mutual">
          It&rsquo;s mutual
        </AppText>

        <View style={[styles.stage, { backgroundColor: theme.colors.surfaceSunk }]}>
          {photo ? (
            <Animated.View style={[styles.layer, photoStyle]}>
              <Image
                source={photo}
                style={styles.photo}
                accessibilityLabel={`Photo of ${peerName}`}
                accessibilityIgnoresInvertColors
                // The blur is part of the dissolve; Image's own blurRadius animates poorly,
                // so the effect is carried by opacity and scale, which Reanimated drives on
                // the UI thread.
              />
            </Animated.View>
          ) : null}
          <Animated.View style={[styles.layer, avatarStyle]} pointerEvents="none">
            <GenerativeAvatar identityPk={identityPk} size={250} square />
          </Animated.View>
        </View>

        <AppText variant="name" center accessibilityRole="header">
          {peerName}
        </AppText>
        {intentsLabel ? (
          <AppText variant="body" tone="muted" center>
            {`You both signalled for ${intentsLabel}`}
          </AppText>
        ) : (
          <AppText variant="body" tone="muted" center>
            You both signalled each other for the same thing.
          </AppText>
        )}
      </View>

      <View style={styles.actions}>
        <Button label={actionLabel} kind="mutual" wide onPress={onContinue} />
        <View style={styles.fine}>
          <Icon name="lock" size={14} color={theme.colors.inkMuted} />
          <AppText variant="tiny" tone="muted">
            Screenshots are off on this screen.
          </AppText>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: space.xl, paddingBottom: space.xl },
  bar: { flexDirection: 'row', justifyContent: 'flex-end', paddingTop: space.sm },
  body: { flex: 1, alignItems: 'center', gap: space.md + 2 },
  stage: {
    width: 250,
    maxWidth: '72%',
    aspectRatio: 13 / 16,
    borderRadius: radius.sheet,
    overflow: 'hidden',
    marginVertical: space.sm,
  },
  layer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  photo: { width: '100%', height: '100%' },
  actions: { gap: space.md },
  fine: { flexDirection: 'row', gap: space.xs + 2, alignItems: 'center', justifyContent: 'center' },
});
