/**
 * Signals (Signals tab).
 *
 * Phase 8 placeholder: the navigation skeleton and the design system are in place; the real
 * screen is built in Phase 11 (PLAN.md). It already renders in both themes so the tab
 * bar, gutters and type can be compared against `docs/design/prototype.html`.
 */

import type { ReactNode } from 'react';

import { AppText, Screen, ScreenHeader } from '@/design/primitives';

export default function SignalsScreen(): ReactNode {
  return (
    <Screen testID="signals">
      <ScreenHeader title="Signals" lede="A signal becomes a mutual only if they send one back for the same thing." />
      <AppText variant="small" tone="muted">
        Built in Phase 11.
      </AppText>
    </Screen>
  );
}
