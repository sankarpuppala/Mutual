/**
 * The small set of styled primitives every screen is built from: a screen frame, text in a
 * named type style, buttons, cards, pills and hairlines.
 *
 * Why this file exists: without it, each screen would re-derive padding, type and colour
 * from the tokens by hand, and the prototype's spacing would drift screen by screen. Every
 * value here traces to `docs/design/prototype.html` (SPEC §13.9); the comments name the CSS
 * class each primitive corresponds to, so the two can be compared side by side.
 *
 * Added to SPEC §20's file list in the same change that introduced it (Phase 8).
 */

import type { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from './icons';
import { useTheme } from './theme';
import { hitSize, radius, space } from './tokens';
import { type, type TypeName } from './typography';

/** The horizontal gutter of every screen (`.view` padding in the prototype). */
export const GUTTER = 20;

// ------------------------------------------------------------------ Screen

interface ScreenProps {
  children: ReactNode;
  /** Scrollable by default; set false for screens that manage their own layout (chat). */
  scroll?: boolean;
  /** Extra bottom padding, e.g. for a sticky call to action. */
  bottomInset?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A screen's background, gutters and safe-area handling (`.view`). */
export function Screen({
  children,
  scroll = true,
  bottomInset = 0,
  style,
  testID,
}: ScreenProps): ReactNode {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const base: ViewStyle = { flex: 1, backgroundColor: theme.colors.bg };
  const inner: ViewStyle = {
    paddingHorizontal: GUTTER,
    paddingTop: space.sm,
    paddingBottom: space.xl + bottomInset + insets.bottom,
  };

  if (!scroll) {
    return (
      <View testID={testID} style={[base, style]}>
        {children}
      </View>
    );
  }
  return (
    <ScrollView
      testID={testID}
      style={[base, style]}
      contentContainerStyle={inner}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  );
}

// -------------------------------------------------------------------- Text

type Tone = 'ink' | 'muted' | 'signal' | 'mutual' | 'danger' | 'onSignal' | 'onMutual' | 'onInk';

interface AppTextProps extends TextProps {
  /** A named style from `src/design/typography.ts`. */
  variant?: TypeName;
  tone?: Tone;
  center?: boolean;
  children: ReactNode;
}

/**
 * Text in a named type style. Font scaling is left on (SPEC §13.7 requires 200 % support),
 * so no component may set `allowFontScaling={false}`.
 */
export function AppText({
  variant = 'body',
  tone = 'ink',
  center = false,
  style,
  children,
  ...rest
}: AppTextProps): ReactNode {
  const theme = useTheme();
  const toneColor: Record<Tone, string> = {
    ink: theme.colors.ink,
    muted: theme.colors.inkMuted,
    signal: theme.colors.signal,
    mutual: theme.colors.mutual,
    danger: theme.colors.danger,
    onSignal: theme.colors.onSignal,
    onMutual: theme.colors.onMutual,
    onInk: theme.colors.bg,
  };
  return (
    <Text
      style={[
        type[variant] as TextStyle,
        { color: toneColor[tone] },
        center && styles.center,
        style,
      ]}
      {...rest}
    >
      {children}
    </Text>
  );
}

// ------------------------------------------------------------------ Button

export type ButtonKind = 'signal' | 'mutual' | 'ink' | 'ghost' | 'danger';

interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  kind?: ButtonKind;
  /** Full width and taller, for a primary action (`.btn.wide`). */
  wide?: boolean;
  /** Compact, for inline actions like Withdraw (`.btn-sm`). */
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  left?: ReactNode;
}

/** A pill button (`.btn`). Minimum height is the 44 pt touch target (SPEC §13.7). */
export function Button({
  label,
  kind = 'ink',
  wide = false,
  small = false,
  disabled = false,
  style,
  left,
  ...rest
}: ButtonProps): ReactNode {
  const theme = useTheme();
  const fills: Record<ButtonKind, ViewStyle> = {
    signal: { backgroundColor: theme.colors.signal },
    mutual: { backgroundColor: theme.colors.mutual },
    ink: { backgroundColor: theme.colors.ink },
    ghost: { borderWidth: 1, borderColor: theme.colors.hairline },
    danger: { backgroundColor: theme.colors.danger },
  };
  const tones: Record<ButtonKind, Tone> = {
    signal: 'onSignal',
    mutual: 'onMutual',
    ink: 'onInk',
    ghost: 'ink',
    danger: 'onSignal',
  };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        fills[kind],
        small && styles.buttonSmall,
        wide && styles.buttonWide,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
      {...rest}
    >
      {left}
      <AppText variant={small ? 'smallSemiBold' : 'button'} tone={tones[kind]}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** An underlined text link (`.link`). Still 44 pt tall for the touch target. */
export function LinkButton({
  label,
  onPress,
  center = false,
  tone = 'ink',
}: {
  label: string;
  onPress: () => void;
  center?: boolean;
  tone?: Tone;
}): ReactNode {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.link, center && styles.linkCenter]}
    >
      <AppText
        variant="smallSemiBold"
        tone={tone}
        style={{
          textDecorationLine: 'underline',
          textDecorationColor: theme.colors.hairline,
        }}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

// -------------------------------------------------------------------- Card

/** A content card (`.card`): surface, 20 pt radius, one soft shadow. */
export function Card({
  children,
  style,
  ...rest
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
} & Omit<ViewProps, 'children' | 'style'>): ReactNode {
  const theme = useTheme();
  return (
    <View
      style={[styles.card, { backgroundColor: theme.colors.surface }, theme.shadow, style]}
      {...rest}
    >
      {children}
    </View>
  );
}

/** A horizontal rule (`border-top: 1px solid var(--hair)`). */
export function Hairline({ style }: { style?: StyleProp<ViewStyle> }): ReactNode {
  const theme = useTheme();
  return <View style={[{ height: 1, backgroundColor: theme.colors.hairline }, style]} />;
}

/** A screen's eyebrow + title block (`.top`). */
export function ScreenHeader({
  eyebrow,
  title,
  lede,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
}): ReactNode {
  return (
    <View style={styles.header}>
      {eyebrow ? (
        <AppText variant="eyebrow" tone="muted">
          {eyebrow}
        </AppText>
      ) : null}
      <AppText variant="title" accessibilityRole="header">
        {title}
      </AppText>
      {lede ? (
        <AppText variant="body" tone="muted">
          {lede}
        </AppText>
      ) : null}
    </View>
  );
}

/** A section label between blocks (`.section-h`). */
export function SectionHeading({ children }: { children: ReactNode }): ReactNode {
  return (
    <AppText variant="eyebrow" tone="muted" style={styles.sectionHeading}>
      {children}
    </AppText>
  );
}

/** A vertical stack with the standard 16 pt gap (`.stack`). */
export function Stack({
  children,
  gap = space.lg,
  style,
}: {
  children: ReactNode;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}): ReactNode {
  return <View style={[{ gap }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  center: { textAlign: 'center' },
  button: {
    minHeight: hitSize,
    paddingHorizontal: space.xl - space.xs,
    borderRadius: radius.pill,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
  buttonSmall: { paddingHorizontal: space.md + 2, minHeight: hitSize },
  buttonWide: { width: '100%', minHeight: 54 },
  disabled: { opacity: 0.38 },
  pressed: { transform: [{ scale: 0.97 }] },
  link: { minHeight: hitSize, justifyContent: 'center' },
  linkCenter: { alignSelf: 'center' },
  card: { borderRadius: radius.card, padding: space.xl - space.xs, gap: space.lg },
  header: { gap: space.xs + 2, paddingTop: space.md + 2, paddingBottom: space.xl - 2 },
  sectionHeading: { marginTop: space.xxl - 2, marginBottom: space.sm },
  field: { gap: space.sm - 2 },
  input: {
    minHeight: 52,
    borderRadius: radius.sm + 2,
    borderWidth: 1,
    paddingHorizontal: space.lg,
  },
  pill: {
    paddingHorizontal: space.sm + 2,
    paddingVertical: space.xs - 1,
    borderRadius: radius.pill,
  },
  timeChip: {
    paddingHorizontal: space.sm + 2,
    paddingVertical: space.xs + 1,
    borderRadius: radius.pill,
  },
  lockNote: { flexDirection: 'row', gap: space.sm + 2, alignItems: 'flex-start' },
  bar: { flexDirection: 'row', marginHorizontal: -GUTTER + space.sm, marginTop: -space.sm },
  barButton: {
    width: hitSize,
    height: hitSize,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// --------------------------------------------------------------- TextField

interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  /** Shown under the field in muted type. */
  hint?: string;
  /** Shown under the field in danger type, replacing the hint. */
  error?: string | null;
  /** Extra style for the input itself, e.g. a taller box for a multiline answer. */
  inputStyle?: StyleProp<TextStyle>;
}

/**
 * A labelled text input (`.composer input` in the prototype, extended with a label and a
 * hint for the onboarding forms).
 *
 * The label is a real label rather than a placeholder: a placeholder disappears as soon as
 * someone types, which fails anyone who looks away mid-answer, and screen readers treat it
 * inconsistently (SPEC §13.7).
 */
export function TextField({
  label,
  hint,
  error,
  inputStyle,
  ...rest
}: TextFieldProps): ReactNode {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <AppText variant="smallSemiBold">{label}</AppText>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.colors.inkMuted}
        style={[
          type.body as TextStyle,
          styles.input,
          {
            color: theme.colors.ink,
            backgroundColor: theme.colors.surface,
            borderColor: error ? theme.colors.danger : theme.colors.hairline,
          },
          inputStyle,
        ]}
        {...rest}
      />
      {error ? (
        <AppText variant="small" tone="danger">
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="small" tone="muted">
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

// ------------------------------------------------------------------- misc

/** An intent or state pill (`.pill`). `mutual` tints it indigo for a matched intent. */
export function Pill({
  label,
  tint = 'signal',
}: {
  label: string;
  tint?: 'signal' | 'mutual';
}): ReactNode {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.pill,
        {
          backgroundColor: tint === 'mutual' ? theme.colors.mutualSoft : theme.colors.signalSoft,
        },
      ]}
    >
      <AppText variant="tinySemiBold">{label}</AppText>
    </View>
  );
}

/** The coarse time chip on a crossing card (`.chip-time`). Computed on-device (§6.13). */
export function TimeChip({ label }: { label: string }): ReactNode {
  const theme = useTheme();
  return (
    <View style={[styles.timeChip, { backgroundColor: theme.colors.surfaceSunk }]}>
      <AppText variant="tiny" tone="muted">
        {label}
      </AppText>
    </View>
  );
}

/** A note with a lock icon, for the places where the app explains a privacy rule. */
export function LockNote({ children }: { children: ReactNode }): ReactNode {
  const theme = useTheme();
  return (
    <View style={styles.lockNote}>
      <Icon name="lock" size={16} color={theme.colors.inkMuted} />
      <AppText variant="small" tone="muted" style={{ flex: 1 }}>
        {children}
      </AppText>
    </View>
  );
}

/** A back or close button in a screen's top bar (`.bar .icon-btn`). */
export function BarButton({
  kind,
  onPress,
}: {
  kind: 'back' | 'close';
  onPress: () => void;
}): ReactNode {
  return (
    <View style={styles.bar}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={kind === 'close' ? 'Close' : 'Back'}
        onPress={onPress}
        style={styles.barButton}
      >
        <Icon name={kind} />
      </Pressable>
    </View>
  );
}
