/**
 * Root layout (SPEC.md §13.2). Order matters here:
 *   1. the CSPRNG polyfill is already loaded by `index.ts`, before this file runs;
 *   2. fonts load before anything renders, because type carries the design (SPEC §13.3);
 *   3. the theme provider wraps everything, so every screen works in both themes.
 *
 * TanStack Query holds server state (SPEC §13.1). Its defaults are deliberately quiet: no
 * refetch on window focus, because a refetch triggered by the user opening the app while
 * looking at a particular card would be attention-dependent traffic (invariant 1).
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useMemo, type ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ThemeProvider, useTheme } from '@/design/theme';
import { useAppFonts } from '@/design/typography';

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The digest is a daily snapshot; polling it adds nothing and costs battery.
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: 1,
        staleTime: 60_000,
      },
    },
  });
}

function Navigator(): ReactNode {
  const theme = useTheme();
  return (
    <>
      <StatusBar style={theme.isDark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.bg },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="profile/[id]" />
        <Stack.Screen name="match/[id]" />
        <Stack.Screen name="reveal/[id]" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="privacy" options={{ presentation: 'card' }} />
        <Stack.Screen name="dev" />
      </Stack>
    </>
  );
}

export default function RootLayout(): ReactNode {
  const fontsLoaded = useAppFonts();
  const queryClient = useMemo(() => makeQueryClient(), []);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          {fontsLoaded ? <Navigator /> : <Splash />}
        </ThemeProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

/** A plain background while the fonts load -- never a spinner or a logo flash. */
function Splash(): ReactNode {
  const theme = useTheme();
  return <View style={{ flex: 1, backgroundColor: theme.colors.bg }} />;
}
