/**
 * The two faces (SPEC.md §13.4): Fraunces for display -- names, prompt answers, headings,
 * italic for prompt questions -- and Inter for UI. Both are OFL licensed Google Fonts,
 * loaded through expo-font (CLAUDE.md: free and open-source only).
 *
 * `useAppFonts()` is called once in the root layout. Until the fonts are ready the app
 * renders nothing rather than flashing a system face, because type does the expressive
 * work in this design and a swap is very visible.
 */

import {
  Fraunces_400Regular,
  Fraunces_400Regular_Italic,
  Fraunces_500Medium,
  Fraunces_500Medium_Italic,
  Fraunces_600SemiBold,
} from '@expo-google-fonts/fraunces';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold } from '@expo-google-fonts/inter';
import { useFonts } from 'expo-font';

import { displaySize, fontSize, lineHeight, tracking } from './tokens';

/** Font family names as registered with expo-font. Use these, never a raw string. */
export const fonts = {
  display: 'Fraunces_400Regular',
  displayItalic: 'Fraunces_400Regular_Italic',
  displayMedium: 'Fraunces_500Medium',
  displayMediumItalic: 'Fraunces_500Medium_Italic',
  displaySemiBold: 'Fraunces_600SemiBold',
  ui: 'Inter_400Regular',
  uiMedium: 'Inter_500Medium',
  uiSemiBold: 'Inter_600SemiBold',
} as const;

/** Loads every face the design uses. Returns true once they are all ready. */
export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    Fraunces_400Regular,
    Fraunces_400Regular_Italic,
    Fraunces_500Medium,
    Fraunces_500Medium_Italic,
    Fraunces_600SemiBold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
  });

  // Carry on in the system face if a font fails to load.
  //
  // The root layout renders a blank background until this returns true, so swallowing the
  // error would leave the app on a blank screen **forever**, with nothing on screen and
  // nothing in the log to explain it -- the worst possible failure, because it looks
  // identical to a hang. A wrong-looking app that works is better than a correct-looking
  // app that never appears.
  if (error) {
    console.warn('Fonts failed to load; falling back to the system face.', error);
    return true;
  }
  return loaded;
}

const display = (size: number, track: number, family: string = fonts.displayMedium) => ({
  fontFamily: family,
  fontSize: size,
  lineHeight: Math.round(size * lineHeight.display),
  letterSpacing: size * track,
});

const body = (size: number, family: string = fonts.ui) => ({
  fontFamily: family,
  fontSize: size,
  lineHeight: Math.round(size * lineHeight.body),
});

/**
 * Named text styles, one per element in the approved prototype. Screens pick a style from
 * here instead of assembling font, size and spacing themselves.
 */
export const type = {
  /** `.welcome-title` */
  welcome: display(displaySize.welcome, tracking.welcome),
  /** `.display-name` -- a name on a profile or the reveal */
  name: display(displaySize.name, tracking.name),
  /** `.display-name.sm` */
  nameSmall: display(displaySize.nameSmall, tracking.name),
  /** `.how-text h1` */
  howTitle: display(displaySize.howTitle, tracking.title),
  /** `.h-title` -- a screen heading */
  title: display(displaySize.title, tracking.title),
  /** `.sheet-title` */
  sheetTitle: display(displaySize.nameSmall, tracking.tight),
  /** `.empty h2` */
  emptyTitle: display(displaySize.emptyTitle, tracking.tight),
  /** `.priv h2` */
  sectionTitle: display(fontSize.xl, tracking.tight),
  /** `.a` -- a prompt answer on a card */
  promptAnswer: display(displaySize.promptAnswer, tracking.answer, fonts.display),
  /** `.pcard .a` -- a prompt answer on the full profile */
  promptAnswerLarge: display(displaySize.promptAnswerLarge, tracking.answer, fonts.display),
  /** `.context .a` */
  chatContext: display(displaySize.chatContext, tracking.answer, fonts.display),
  /** `.mcard-body p` */
  mutualBody: display(displaySize.mutualBody, 0, fonts.display),
  /** `.reassure` */
  reassure: display(displaySize.reassure, 0, fonts.display),
  /** `.q` -- a prompt question, always italic (SPEC §13.4) */
  promptQuestion: {
    fontFamily: fonts.displayItalic,
    fontSize: fontSize.sm,
    lineHeight: Math.round(fontSize.sm * lineHeight.body),
  },

  /** `.lede`, `.bubble`, `.composer input`, body copy */
  body: body(fontSize.md - 1), // 15pt: the prototype's base UI size
  bodyMedium: body(fontSize.md - 1, fonts.uiMedium),
  bodySemiBold: body(fontSize.md - 1, fonts.uiSemiBold),
  /** `.row-sub`, `.who-year`, `.set-sub`, `.small`, `.footnote` */
  small: body(fontSize.sm),
  smallMedium: body(fontSize.sm, fonts.uiMedium),
  smallSemiBold: body(fontSize.sm, fonts.uiSemiBold),
  /** `.chip-time`, `.pill`, `.fine`, `.vtime` */
  tiny: body(fontSize.xs),
  tinySemiBold: body(fontSize.xs, fonts.uiSemiBold),
  /** `.btn` */
  button: body(fontSize.md - 1, fonts.uiSemiBold),
  /** `.set-title`, `.sheet-item` */
  listTitle: body(fontSize.md, fonts.uiMedium),
  /** `.eyebrow`, `.section-h` -- uppercase, tracked out */
  eyebrow: {
    fontFamily: fonts.uiSemiBold,
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 11 * tracking.eyebrow,
    textTransform: 'uppercase' as const,
  },
  /** `.tab` label */
  tabLabel: {
    fontFamily: fonts.uiMedium,
    fontSize: 11,
    lineHeight: 14,
  },
} as const;

export type TypeName = keyof typeof type;
