/**
 * Theme tokens. A theme is data: colours, font families per weight, radii, and which component
 * family ("cards" or "receipt") renders it. Adding a theme later = adding one object here.
 * Values come from the approved design canvas (pages A1, A3, B1, B4).
 */

export type ThemeFamily = 'cards' | 'receipt';
export type ThemeId = 'mint' | 'neon-lime' | 'receipt' | 'thermal';

export interface ThemeColors {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  muted: string;
  border: string;
  borderStrong: string;
  primary: string;
  onPrimary: string;
  /** Money you get back. */
  get: string;
  /** Money you owe. */
  owe: string;
  /** "Needs you" callouts and sticky notes. */
  attnBg: string;
  attnBorder: string;
  attnText: string;
  /** Selected rows and gentle highlights. */
  tint: string;
  chip: string;
  overlay: string;
}

export interface ThemeFonts {
  regular: string;
  medium: string;
  semibold: string;
  bold: string;
  heavy: string;
  mono: string;
  monoBold: string;
}

export interface Theme {
  id: ThemeId;
  name: string;
  family: ThemeFamily;
  dark: boolean;
  c: ThemeColors;
  f: ThemeFonts;
  r: { card: number; button: number; input: number };
  /** Accent glow for the primary button and big balance; null = no glow. */
  glow: string | null;
  /** Avatar colours, cycled by member position. */
  avatars: { bg: string; fg: string }[];
  /** Swatches shown in the theme picker. */
  swatch: [string, string, string];
}

const manrope: ThemeFonts = {
  regular: 'Manrope_400Regular',
  medium: 'Manrope_500Medium',
  semibold: 'Manrope_600SemiBold',
  bold: 'Manrope_700Bold',
  heavy: 'Manrope_800ExtraBold',
  mono: 'Manrope_600SemiBold',
  monoBold: 'Manrope_700Bold',
};

const spaceGrotesk: ThemeFonts = {
  regular: 'SpaceGrotesk_400Regular',
  medium: 'SpaceGrotesk_500Medium',
  semibold: 'SpaceGrotesk_600SemiBold',
  bold: 'SpaceGrotesk_700Bold',
  heavy: 'SpaceGrotesk_700Bold',
  mono: 'JetBrainsMono_500Medium',
  monoBold: 'JetBrainsMono_700Bold',
};

export const THEMES: Record<ThemeId, Theme> = {
  mint: {
    id: 'mint',
    name: 'Mint',
    family: 'cards',
    dark: false,
    c: {
      bg: '#F4F7F5',
      surface: '#FFFFFF',
      surfaceAlt: '#F7F9F8',
      text: '#111816',
      muted: '#5B6661',
      border: '#E3E8E5',
      borderStrong: '#DDE3E0',
      primary: '#0B6E4F',
      onPrimary: '#FFFFFF',
      get: '#0B6E4F',
      owe: '#B4410C',
      attnBg: '#FFF6E8',
      attnBorder: '#F3DDB8',
      attnText: '#7A4A06',
      tint: '#EAF3EF',
      chip: '#EEF1EF',
      overlay: 'rgba(17,24,22,0.45)',
    },
    f: { ...manrope, mono: 'Manrope_600SemiBold' },
    r: { card: 18, button: 16, input: 14 },
    glow: null,
    avatars: [
      { bg: '#DCEFE6', fg: '#0B4F39' },
      { bg: '#E4E8FB', fg: '#2B3A9C' },
      { bg: '#FBE7DA', fg: '#8A3A0E' },
      { bg: '#EDE4F8', fg: '#5B2E91' },
      { bg: '#E2F1F8', fg: '#0E5F80' },
    ],
    swatch: ['#F4F7F5', '#0B6E4F', '#111816'],
  },
  'neon-lime': {
    id: 'neon-lime',
    name: 'Neon Lime',
    family: 'cards',
    dark: true,
    c: {
      bg: '#050506',
      surface: '#0F1012',
      surfaceAlt: '#141518',
      text: '#F4F5F6',
      muted: '#9A9EA6',
      border: '#232529',
      borderStrong: '#2A2C31',
      primary: '#C8FF2E',
      onPrimary: '#0F1012',
      get: '#C8FF2E',
      owe: '#FF8F6B',
      attnBg: '#0F1012',
      attnBorder: '#4A5E12',
      attnText: '#C8FF2E',
      tint: '#1E260A',
      chip: '#1B1C20',
      overlay: 'rgba(0,0,0,0.72)',
    },
    f: spaceGrotesk,
    r: { card: 18, button: 16, input: 14 },
    glow: 'rgba(200,255,46,0.30)',
    avatars: [{ bg: '#1C1D21', fg: '#F4F5F6' }],
    swatch: ['#050506', '#C8FF2E', '#F4F5F6'],
  },
  receipt: {
    id: 'receipt',
    name: 'Receipt',
    family: 'receipt',
    dark: false,
    c: {
      bg: '#EDE7DA',
      surface: '#FFFDF7',
      surfaceAlt: '#F3EEE3',
      text: '#1A1814',
      muted: '#6B655B',
      border: '#CFC6B4',
      borderStrong: '#CFC6B4',
      primary: '#1A1814',
      onPrimary: '#FFFFFF',
      get: '#1F5FD1',
      owe: '#A93A0A',
      attnBg: '#FFE98F',
      attnBorder: '#FFE98F',
      attnText: '#1A1814',
      tint: '#FFF4C2',
      chip: '#F3EEE3',
      overlay: 'rgba(26,24,20,0.5)',
    },
    f: {
      regular: 'BricolageGrotesque_400Regular',
      medium: 'BricolageGrotesque_500Medium',
      semibold: 'BricolageGrotesque_600SemiBold',
      bold: 'BricolageGrotesque_700Bold',
      heavy: 'BricolageGrotesque_800ExtraBold',
      mono: 'JetBrainsMono_500Medium',
      monoBold: 'JetBrainsMono_700Bold',
    },
    r: { card: 0, button: 999, input: 999 },
    glow: null,
    avatars: [{ bg: '#1A1814', fg: '#FFFFFF' }],
    swatch: ['#EDE7DA', '#FFFDF7', '#1F5FD1'],
  },
  thermal: {
    id: 'thermal',
    name: 'Thermal',
    family: 'receipt',
    dark: true,
    c: {
      bg: '#08080A',
      surface: '#141417',
      surfaceAlt: '#1E1E22',
      text: '#F2F2F0',
      muted: '#9B9BA1',
      border: '#34343A',
      borderStrong: '#34343A',
      primary: '#C8FF2E',
      onPrimary: '#08080A',
      get: '#C8FF2E',
      owe: '#FF8F6B',
      attnBg: '#22260F',
      attnBorder: '#22260F',
      attnText: '#F2F2F0',
      tint: '#1C2010',
      chip: '#1E1E22',
      overlay: 'rgba(0,0,0,0.7)',
    },
    f: spaceGrotesk,
    r: { card: 0, button: 999, input: 999 },
    glow: 'rgba(200,255,46,0.30)',
    avatars: [{ bg: '#26262B', fg: '#F2F2F0' }],
    swatch: ['#08080A', '#141417', '#C8FF2E'],
  },
};

export const THEME_ORDER: ThemeId[] = ['mint', 'neon-lime', 'receipt', 'thermal'];
export const DEFAULT_THEME: ThemeId = 'mint';
