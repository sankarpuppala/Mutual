/**
 * The icon set, transcribed path-for-path from `docs/design/prototype.html` (SPEC §13.9) so
 * the app's icons are the approved ones rather than a lookalike library.
 *
 * All are 24x24 line icons at 1.7 stroke width unless the caller overrides it; `play`,
 * `pause` and `more` are filled, exactly as in the prototype's `ic()` helper.
 *
 * Added to SPEC §20's file list in the same change that introduced it (Phase 8).
 */

import type { ReactNode } from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

import { useTheme } from './theme';

export type IconName =
  | 'today'
  | 'signals'
  | 'mutuals'
  | 'you'
  | 'back'
  | 'close'
  | 'check'
  | 'lock'
  | 'chev'
  | 'right'
  | 'send'
  | 'eye'
  | 'eyeoff'
  | 'sun'
  | 'play'
  | 'pause'
  | 'more';

interface IconProps {
  name: IconName;
  size?: number;
  /** Stroke width for line icons. */
  strokeWidth?: number;
  /** Defaults to the current ink colour. */
  color?: string;
}

/** One icon. `aria-hidden` by default: the label lives on the control that contains it. */
export function Icon({ name, size = 24, strokeWidth = 1.7, color }: IconProps): ReactNode {
  const theme = useTheme();
  const tint = color ?? theme.colors.ink;

  if (name === 'play' || name === 'pause' || name === 'more') {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill={tint}>
        {name === 'play' ? <Path d="M8 5.5v13l11-6.5z" /> : null}
        {name === 'pause' ? (
          <>
            <Rect x={6.5} y={5} width={4} height={14} rx={1} />
            <Rect x={13.5} y={5} width={4} height={14} rx={1} />
          </>
        ) : null}
        {name === 'more' ? (
          <>
            <Circle cx={5} cy={12} r={1.6} />
            <Circle cx={12} cy={12} r={1.6} />
            <Circle cx={19} cy={12} r={1.6} />
          </>
        ) : null}
      </Svg>
    );
  }

  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={tint}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {LINE_ICONS[name]}
    </Svg>
  );
}

/** Mutual's mark: a terracotta circle and an indigo circle, overlapping. */
export function Logo({ size = 64 }: { size?: number }): ReactNode {
  const theme = useTheme();
  return (
    <Svg width={size} height={Math.round(size * 0.66)} viewBox="0 0 60 40">
      <Circle cx={22} cy={20} r={15} fill={theme.colors.signal} opacity={0.9} />
      <Circle cx={38} cy={20} r={15} fill={theme.colors.mutual} opacity={0.8} />
    </Svg>
  );
}

const LINE_ICONS: Record<Exclude<IconName, 'play' | 'pause' | 'more'>, ReactNode> = {
  today: (
    <>
      <Rect x={3} y={5.5} width={18} height={13} rx={2.5} />
      <Path d="M3.8 7.2l8.2 5.9 8.2-5.9" />
    </>
  ),
  signals: (
    <>
      <Circle cx={12} cy={12} r={2} />
      <Path d="M8.2 8.2a5.4 5.4 0 0 0 0 7.6M15.8 8.2a5.4 5.4 0 0 1 0 7.6M5.4 5.4a9.3 9.3 0 0 0 0 13.2M18.6 5.4a9.3 9.3 0 0 1 0 13.2" />
    </>
  ),
  mutuals: (
    <>
      <Circle cx={9} cy={12} r={5.6} />
      <Circle cx={15} cy={12} r={5.6} />
    </>
  ),
  you: (
    <>
      <Circle cx={12} cy={8.6} r={3.8} />
      <Path d="M4.6 20c1.2-3.6 4.1-5.5 7.4-5.5s6.2 1.9 7.4 5.5" />
    </>
  ),
  back: <Path d="M15 5l-7 7 7 7" />,
  close: <Path d="M6 6l12 12M18 6L6 18" />,
  check: <Path d="M5 12.5l4.5 4.5L19 7.5" />,
  lock: (
    <>
      <Rect x={5} y={10.5} width={14} height={10} rx={2.5} />
      <Path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  chev: <Path d="M6 9l6 6 6-6" />,
  right: <Path d="M9 5l7 7-7 7" />,
  send: <Path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" />,
  eye: (
    <>
      <Path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <Circle cx={12} cy={12} r={2.8} />
    </>
  ),
  eyeoff: (
    <>
      <Path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <Circle cx={12} cy={12} r={2.8} />
      <Path d="M4 4l16 16" />
    </>
  ),
  sun: (
    <>
      <Circle cx={12} cy={12} r={4} />
      <Path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
};
