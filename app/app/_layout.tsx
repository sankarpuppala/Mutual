/**
 * Root layout (SPEC.md §13.2). Order matters here:
 *   1. the CSPRNG polyfill is the first import below, before any protocol code can run;
 *   2. fonts load before anything renders, because type carries the design (SPEC §13.3);
 *   3. the theme provider wraps everything, so every screen works in both themes.
 *
 * TanStack Query holds server state (SPEC §13.1). Its defaults are deliberately quiet: no
 * refetch on window focus, because a refetch triggered by the user opening the app while
 * looking at a particular card would be attention-dependent traffic (invariant 1).
 */

// The CSPRNG polyfill, before anything else (CLAUDE.md invariant 7). This is the first
// module of the app's own tree to execute, and nothing in @mutual/protocol touches the
// CSPRNG at import time -- random.ts throws when called, never on load -- so this runs
// before any protocol code can.
import 'react-native-get-random-values';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, type ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { loadServerUrlOverride } from '@/api/client';
import { ThemeProvider, useTheme } from '@/design/theme';
import { useAppFonts } from '@/design/typography';
import { registerNightlyTask } from '@/presence/schedule';

/**
 * Query defaults chosen for invariant 1, not for freshness.
 *
 * `staleTime: Infinity` is the important one, and it is a privacy setting rather than a
 * performance one. With a finite stale time, opening a profile card would remount a
 * `useQuery(['digest'])` whose data had aged out, and TanStack Query would issue a
 * `GET /digest`. The request would not say *which* card was opened — but its existence and
 * timing would depend on a card having been opened, which is exactly what invariant 1
 * forbids ("existence, timing, size, order or parameters").
 *
 * Nothing is lost by it. The digest is byte-identical between release times by design
 * (claim C5), so a refetch inside a day cannot return anything new. Screens that genuinely
 * need fresh data ask for it explicitly: `matches` and `messages` set their own
 * `refetchInterval`, and Today exposes a manual refresh.
 *
 * Focus and reconnect refetching are off for the same reason: a refetch triggered by the
 * user opening the app while looking at a particular card is attention-dependent traffic.
 */
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
        retry: 1,
        staleTime: Number.POSITIVE_INFINITY,
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
        initialRouteName="index"
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.colors.bg },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="(onboarding)" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="profile/[id]" />
        <Stack.Screen name="match/[id]" />
        <Stack.Screen name="reveal/[id]" options={{ presentation: 'fullScreenModal' }} />
        <Stack.Screen name="privacy" options={{ presentation: 'card' }} />
        <Stack.Screen name="feedback" options={{ presentation: 'card' }} />
        <Stack.Screen name="dev" />
      </Stack>
    </>
  );
}

export default function RootLayout(): ReactNode {
  const fontsLoaded = useAppFonts();
  const queryClient = useMemo(() => makeQueryClient(), []);

  // The nightly presence and signal uploads run from a background task (SPEC §6.11,
  // §13.8). Registering is idempotent, and a failure here is not fatal: the same work also
  // runs whenever the app is opened before the cutoff.
  useEffect(() => {
    void registerNightlyTask().catch(() => undefined);
  }, []);

  // Dev builds only, and a no-op unless the dev panel has pointed this device somewhere
  // else. Runs before the first screen renders, so no request can go to the stale
  // compiled-in address first.
  useEffect(() => {
    void loadServerUrlOverride().catch(() => undefined);
  }, []);

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
