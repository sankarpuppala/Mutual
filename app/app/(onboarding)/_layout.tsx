/**
 * The onboarding flow (SPEC.md §13.2, journey J1). A plain stack with no headers: each
 * screen carries its own back affordance, as in the prototype.
 */

import { Stack } from 'expo-router';
import type { ReactNode } from 'react';

import { useTheme } from '@/design/theme';

export default function OnboardingLayout(): ReactNode {
  const theme = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: theme.colors.bg },
        animation: 'slide_from_right',
      }}
    />
  );
}
