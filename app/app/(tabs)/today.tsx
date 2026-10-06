/**
 * Today (Today tab).
 *
 * Phase 8 placeholder: the navigation skeleton and the design system are in place; the real
 * screen is built in Phase 11 (PLAN.md). It already renders in both themes so the tab
 * bar, gutters and type can be compared against `docs/design/prototype.html`.
 */

import type { ReactNode } from 'react';

import { AppText, Screen, ScreenHeader } from '@/design/primitives';

export default function TodayScreen(): ReactNode {
  return (
    <Screen testID="today">
      <ScreenHeader title="Today" lede="Your morning letter arrives at 8." />
      <AppText variant="small" tone="muted">
        Built in Phase 11.
      </AppText>
    </Screen>
  );
}
