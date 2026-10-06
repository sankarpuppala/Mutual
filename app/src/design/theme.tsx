/**
 * Theme plumbing (SPEC.md §13.4, §13.7): the OS light/dark setting drives colours, and the
 * OS reduce-motion setting is read once here and shared.
 *
 * Every screen works in both themes -- that is a review checklist item, not a nice-to-have
 * (SPEC §13.9). Components get colours through `useTheme()` and never import the raw
 * `colors` map.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, useColorScheme } from 'react-native';

import { colors, shadow, type Colors, type ThemeName } from './tokens';

export interface Theme {
  name: ThemeName;
  colors: Colors;
  /** The one soft shadow level, already shaped for this theme. */
  shadow: object;
  isDark: boolean;
}

const ReduceMotionContext = createContext(false);

function buildTheme(name: ThemeName): Theme {
  return { name, colors: colors[name], shadow: shadow[name], isDark: name === 'dark' };
}

const ThemeContext = createContext<Theme>(buildTheme('light'));

/**
 * Wraps the app. Reads the OS colour scheme and the OS reduce-motion flag, and keeps both
 * current if the user changes them while the app is open.
 */
export function ThemeProvider({ children }: { children: ReactNode }): ReactNode {
  const scheme = useColorScheme();
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (active) setReduceMotion(on);
      })
      .catch(() => {
        // Nothing to recover: the default (motion on) is the documented fallback.
      });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  const theme = buildTheme(scheme === 'dark' ? 'dark' : 'light');
  return (
    <ThemeContext.Provider value={theme}>
      <ReduceMotionContext.Provider value={reduceMotion}>{children}</ReduceMotionContext.Provider>
    </ThemeContext.Provider>
  );
}

/** The current theme. */
export function useTheme(): Theme {
  return useContext(ThemeContext);
}

/** True when the OS asked for reduced motion. Prefer `useMotion()` from ./motion. */
export function useReduceMotion(): boolean {
  return useContext(ReduceMotionContext);
}
