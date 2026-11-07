import type { TextStyle } from 'react-native';

/**
 * « Playful notebook » look for the phone screens (Camera, Parent, sign-in, pairing).
 * The Board (TV) keeps its own chalkboard palette (theme.ts).
 *
 * Paper, pencil and crayons: cream paper with blue lines and a red margin, white index cards and sticky notes with a
 * charcoal pencil border, hard offset shadows (no blur, no glow), chunky crayon-coloured buttons.
 */
export const paper = {
  page: '#FFFDF9',
  line: '#E3ECF5',
  margin: '#F4B4B4',
  card: '#FFFFFF',
  ink: '#2D3142',
  inkSoft: '#6B6F82',
  inkFaint: '#A9ADBC',
  blueInk: '#3557A8',
  // crayons (buttons)
  yellow: '#FFD23F',
  red: '#FF6B5E',
  green: '#4CCB7A',
  blue: '#6EC1FF',
  // sticky notes
  stickyYellow: '#FFF3A3',
  stickyPink: '#FFD9E2',
  stickyGreen: '#D4F5DD',
  stickyBlue: '#D7ECFF',
  tape: 'rgba(255, 236, 170, 0.85)',
  wood: '#B9844F',
  chalkboard: '#1F4A3D',
};

/** Hard offset shadow: paper lying on paper. */
export const hardShadow = (d = 4, color = paper.ink) => ({ boxShadow: `${d}px ${d}px 0px ${color}` });

/** Rounded, friendly sans (Fredoka) for headings, buttons and Silia's words; Caveat for notes written by hand. */
export const font = {
  regular: { fontFamily: 'Fredoka_400Regular' } as TextStyle,
  medium: { fontFamily: 'Fredoka_500Medium' } as TextStyle,
  semi: { fontFamily: 'Fredoka_600SemiBold' } as TextStyle,
  bold: { fontFamily: 'Fredoka_700Bold' } as TextStyle,
  hand: { fontFamily: 'Caveat_700Bold' } as TextStyle,
};

/** Height of one ruled line of the notebook. */
export const LINE = 32;
/** Where the red margin is drawn; text starts after it. */
export const MARGIN_X = 30;
