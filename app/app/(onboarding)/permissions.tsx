/**
 * Keeping it on ((onboarding)/permissions).
 *
 * Phase 8 placeholder: the navigation skeleton and the design system are in place; the real
 * screen is built in Phase 10 (PLAN.md). It already renders in both themes so the tab
 * bar, gutters and type can be compared against `docs/design/prototype.html`.
 */

import type { ReactNode } from 'react';

import { AppText, Screen, ScreenHeader } from '@/design/primitives';

export default function PermissionsScreen(): ReactNode {
  return (
    <Screen testID="permissions">
      <ScreenHeader title="Keeping it on" lede="Bluetooth, a quiet notification, and never location." />
      <AppText variant="small" tone="muted">
        Built in Phase 10.
      </AppText>
    </Screen>
  );
}
