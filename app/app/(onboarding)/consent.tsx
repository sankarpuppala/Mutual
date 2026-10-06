/**
 * Taking part in the study ((onboarding)/consent).
 *
 * Phase 8 placeholder: the navigation skeleton and the design system are in place; the real
 * screen is built in Phase 12 (PLAN.md). It already renders in both themes so the tab
 * bar, gutters and type can be compared against `docs/design/prototype.html`.
 */

import type { ReactNode } from 'react';

import { AppText, Screen, ScreenHeader } from '@/design/primitives';

export default function ConsentScreen(): ReactNode {
  return (
    <Screen testID="consent">
      <ScreenHeader title="Taking part in the study" lede="Shown only when this server runs in study mode." />
      <AppText variant="small" tone="muted">
        Built in Phase 12.
      </AppText>
    </Screen>
  );
}
