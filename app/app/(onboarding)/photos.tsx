/**
 * Photos (journey J1, SPEC.md §11 Profile, §11.2).
 *
 * This screen's main job is explanation, not upload. A user who has used any other app in
 * this category expects photos to be the profile; here they are invisible until a mutual
 * match, and if that is not said clearly now, it reads as a bug later.
 *
 * Photos are optional. Under policy C they are not shown even after a match until a
 * conversation has happened, which the copy also says.
 */

import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';

import { ApiError, NetworkError } from '@/api/client';
import { uploadPhoto } from '@/api/endpoints';
import { Icon } from '@/design/icons';
import {
  AppText,
  BarButton,
  Button,
  LinkButton,
  LockNote,
  Screen,
  ScreenHeader,
  Stack,
} from '@/design/primitives';
import { useTheme } from '@/design/theme';
import { radius, space } from '@/design/tokens';
import { useOnboarding } from '@/onboarding/store';

/** The server accepts at most four (SPEC §11). */
const MAX_PHOTOS = 4;

export default function PhotosScreen(): ReactNode {
  const theme = useTheme();
  const { photos, setPhotos } = useOnboarding();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pick = async (): Promise<void> => {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Mutual needs permission to read the photo you choose.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_PHOTOS - photos.length,
      quality: 0.9,
    });
    if (result.canceled) return;

    setPhotos([
      ...photos,
      ...result.assets.slice(0, MAX_PHOTOS - photos.length).map((asset, i) => ({
        uri: asset.uri,
        name: asset.fileName ?? `photo-${photos.length + i + 1}.jpg`,
        mimeType: asset.mimeType ?? 'image/jpeg',
      })),
    ]);
  };

  const remove = (uri: string): void => {
    setPhotos(photos.filter((p) => p.uri !== uri));
  };

  const submit = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      for (const photo of photos) {
        await uploadPhoto(photo);
      }
      router.push('/(onboarding)/permissions');
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else if (e instanceof NetworkError) setError('Could not reach Mutual. Check your connection.');
      else setError('Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen testID="photos">
      <BarButton kind="back" onPress={() => router.back()} />
      <ScreenHeader
        title="Photos"
        lede="Up to four. Nobody sees them while browsing — only after you have both signalled each other for the same thing."
      />

      <Stack gap={space.xl}>
        <View style={styles.grid}>
          {photos.map((photo) => (
            <View key={photo.uri} style={styles.slot}>
              <Image source={{ uri: photo.uri }} style={styles.image} accessibilityIgnoresInvertColors />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove this photo"
                onPress={() => remove(photo.uri)}
                style={[styles.removeButton, { backgroundColor: theme.colors.ink }]}
              >
                <Icon name="close" size={16} strokeWidth={2.2} color={theme.colors.bg} />
              </Pressable>
            </View>
          ))}
          {photos.length < MAX_PHOTOS ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add a photo"
              onPress={() => void pick()}
              style={[
                styles.slot,
                styles.addSlot,
                { borderColor: theme.colors.hairline, backgroundColor: theme.colors.surface },
              ]}
            >
              <AppText variant="smallSemiBold" tone="muted">
                Add
              </AppText>
            </Pressable>
          ) : null}
        </View>

        <LockNote>
          Your photos are revealed only after a mutual match. On a campus running the
          after-conversation setting, they appear once you have both written a few messages.
        </LockNote>

        <AppText variant="small" tone="muted">
          Every piece of metadata is stripped when a photo is uploaded, including the time
          and place a camera records inside the file.
        </AppText>

        {error ? (
          <AppText variant="small" tone="danger">
            {error}
          </AppText>
        ) : null}

        <Button
          label={busy ? 'Uploading…' : photos.length > 0 ? 'Continue' : 'Add photos later'}
          kind="ink"
          wide
          disabled={busy}
          onPress={() => void submit()}
        />

        {photos.length > 0 ? (
          <LinkButton
            label="Skip for now"
            center
            onPress={() => router.push('/(onboarding)/permissions')}
          />
        ) : null}
      </Stack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  slot: { width: 96, height: 128, borderRadius: radius.sm + 2, overflow: 'hidden' },
  addSlot: {
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  image: { width: '100%', height: '100%' },
  removeButton: {
    position: 'absolute',
    top: space.xs,
    right: space.xs,
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
