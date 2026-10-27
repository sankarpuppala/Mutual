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
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';

import { ApiError, NetworkError } from '@/api/client';
import { deletePhoto, getPhotos, uploadPhoto } from '@/api/endpoints';
import { ownPhotoSource, type PhotoSource } from '@/matches/photo';
import { getSessionToken } from '@/storage/secure';
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

interface ServerPhotoItem {
  mediaId: string;
  index: number;
  source: PhotoSource;
}

export default function PhotosScreen(): ReactNode {
  const theme = useTheme();
  const { photos, setPhotos } = useOnboarding();
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [serverPhotos, setServerPhotos] = useState<ServerPhotoItem[]>([]);
  const [loadingServer, setLoadingServer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadServerPhotos = useCallback(async (): Promise<void> => {
    try {
      setLoadingServer(true);
      const list = await getPhotos();
      const items: ServerPhotoItem[] = [];
      for (const p of list) {
        const source = await ownPhotoSource(p.index);
        if (source) items.push({ mediaId: p.media_id, index: p.index, source });
      }
      setServerPhotos(items);
    } catch {
      // Non-fatal if offline or not yet initialized
    } finally {
      setLoadingServer(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getSessionToken().then((token) => {
      if (cancelled) return;
      if (token) {
        setIsSignedIn(true);
        void loadServerPhotos();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadServerPhotos]);

  const currentCount = isSignedIn ? serverPhotos.length : photos.length;

  const pick = async (): Promise<void> => {
    setError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError('Mutual needs permission to read the photo you choose.');
      return;
    }
    const remaining = MAX_PHOTOS - currentCount;
    if (remaining <= 0) {
      setError('You can add up to 4 photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.9,
    });
    if (result.canceled || result.assets.length === 0) return;

    if (isSignedIn) {
      setBusy(true);
      try {
        for (const asset of result.assets) {
          await uploadPhoto({
            uri: asset.uri,
            name: asset.fileName ?? 'photo.jpg',
            mimeType: asset.mimeType ?? 'image/jpeg',
          });
        }
        await loadServerPhotos();
      } catch (e) {
        if (e instanceof ApiError) setError(e.message);
        else if (e instanceof NetworkError) setError('Could not reach Mutual. Check your connection.');
        else setError('Something went wrong uploading photo.');
      } finally {
        setBusy(false);
      }
    } else {
      setPhotos([
        ...photos,
        ...result.assets.slice(0, remaining).map((asset, i) => ({
          uri: asset.uri,
          name: asset.fileName ?? `photo-${photos.length + i + 1}.jpg`,
          mimeType: asset.mimeType ?? 'image/jpeg',
        })),
      ]);
    }
  };

  const removeServerPhoto = async (index: number): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      await deletePhoto(index);
      await loadServerPhotos();
    } catch (e) {
      if (e instanceof ApiError) setError(e.message);
      else setError('Failed to remove photo.');
    } finally {
      setBusy(false);
    }
  };

  const removeLocal = (uri: string): void => {
    setPhotos(photos.filter((p) => p.uri !== uri));
  };

  const submit = async (): Promise<void> => {
    if (isSignedIn) {
      router.back();
      return;
    }
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
          {isSignedIn ? (
            serverPhotos.map((photo) => (
              <View key={photo.mediaId} style={styles.slot}>
                <Image source={photo.source} style={styles.image} accessibilityIgnoresInvertColors />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove this photo"
                  onPress={() => void removeServerPhoto(photo.index)}
                  disabled={busy}
                  style={[styles.removeButton, { backgroundColor: theme.colors.ink }]}
                >
                  <Icon name="close" size={16} strokeWidth={2.2} color={theme.colors.bg} />
                </Pressable>
              </View>
            ))
          ) : (
            photos.map((photo) => (
              <View key={photo.uri} style={styles.slot}>
                <Image source={{ uri: photo.uri }} style={styles.image} accessibilityIgnoresInvertColors />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove this photo"
                  onPress={() => removeLocal(photo.uri)}
                  disabled={busy}
                  style={[styles.removeButton, { backgroundColor: theme.colors.ink }]}
                >
                  <Icon name="close" size={16} strokeWidth={2.2} color={theme.colors.bg} />
                </Pressable>
              </View>
            ))
          )}

          {currentCount < MAX_PHOTOS ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add a photo"
              onPress={() => void pick()}
              disabled={busy}
              style={[
                styles.slot,
                styles.addSlot,
                { borderColor: theme.colors.hairline, backgroundColor: theme.colors.surface },
              ]}
            >
              {busy ? (
                <ActivityIndicator size="small" color={theme.colors.inkMuted} />
              ) : (
                <AppText variant="smallSemiBold" tone="muted">
                  Add
                </AppText>
              )}
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
          label={
            busy
              ? 'Working…'
              : isSignedIn
                ? 'Done'
                : photos.length > 0
                  ? 'Continue'
                  : 'Add photos later'
          }
          kind="ink"
          wide
          disabled={busy}
          onPress={() => void submit()}
        />

        {!isSignedIn && photos.length > 0 ? (
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
