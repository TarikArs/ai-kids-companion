import { useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { FocusPressable as Pressable } from '@/components/focus-pressable';
import { Icon, type IconName } from '@/components/icons';
import { font, hardShadow, paper } from '@/lib/paper-theme';

// The Board as a school desk: an open ring binder lying on warm wood, with real school supplies as controls.

/** Warm wooden desk: a light oak colour with a few long grain streaks. */
export function Desk({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.desk, style]}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {GRAIN.map((g, i) => (
          <View key={i} style={[styles.grain, { top: `${g.y}%`, left: `${g.x}%`, width: `${g.w}%`, opacity: g.o, transform: [{ rotate: `${g.r}deg` }] }]} />
        ))}
      </View>
      {children}
    </View>
  );
}
const GRAIN = [
  { y: 6, x: -5, w: 70, o: 0.35, r: 0.4 },
  { y: 14, x: 30, w: 80, o: 0.25, r: -0.3 },
  { y: 31, x: -10, w: 60, o: 0.3, r: 0.2 },
  { y: 47, x: 45, w: 70, o: 0.2, r: -0.2 },
  { y: 63, x: -8, w: 85, o: 0.3, r: 0.3 },
  { y: 78, x: 20, w: 90, o: 0.25, r: -0.4 },
  { y: 91, x: -5, w: 60, o: 0.3, r: 0.2 },
];

/** Graph paper (the teacher's page): small soft-green squares, a darker line every 5 squares. */
export function GraphPaper({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const cols = Math.ceil(size.w / CELL);
  const rows = Math.ceil(size.h / CELL);
  return (
    <View style={[styles.graph, style]} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {Array.from({ length: cols }, (_, i) => (
          <View key={`c${i}`} style={[styles.gridV, { left: i * CELL }, i % 5 === 0 && styles.gridStrong]} />
        ))}
        {Array.from({ length: rows }, (_, i) => (
          <View key={`r${i}`} style={[styles.gridH, { top: i * CELL }, i % 5 === 0 && styles.gridStrong]} />
        ))}
      </View>
      {children}
    </View>
  );
}
const CELL = 22;

/** The binder's spine between the two pages: three groups of metal rings over a dark gutter. */
export function BinderRings({ compact = false }: { compact?: boolean }) {
  const ring = compact ? 22 : 34;
  return (
    <View style={[styles.spine, { width: compact ? 26 : 44 }]} pointerEvents="none">
      {[0, 1, 2].map((g) => (
        <View key={g} style={styles.ringGroup}>
          {[0, 1].map((k) => (
            <View key={k} style={[styles.ring, { width: ring + 22, height: ring * 0.62, borderRadius: ring }]}>
              <View style={styles.ringShine} />
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/** A strip of washi tape (patterned paper tape) holding something on the page. */
export function Washi({
  color = '#FF9EB5',
  width = 96,
  tilt = -3,
  style,
}: {
  color?: string;
  width?: number;
  tilt?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View pointerEvents="none" style={[styles.washi, { width, backgroundColor: color, transform: [{ rotate: `${tilt}deg` }] }, style]}>
      {Array.from({ length: Math.floor(width / 14) }, (_, i) => (
        <View key={i} style={styles.washiDot} />
      ))}
    </View>
  );
}

/**
 * A yellow wooden school ruler used as a progress bar: centimetre ticks, the numbers, and a red pencil mark at the
 * reached point (3 right answers out of 5 = the mark at 60 %).
 */
export function Ruler({ value, total, label }: { value: number; total: number; label?: string }) {
  const ratio = total ? Math.max(0, Math.min(1, value / total)) : 0;
  return (
    <View style={styles.rulerRow} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: total, now: value }}>
      <View style={styles.ruler}>
        <View style={[styles.rulerFill, { width: `${ratio * 100}%` }]} />
        <View style={styles.ticks} pointerEvents="none">
          {Array.from({ length: 21 }, (_, i) => (
            <View key={i} style={[styles.tick, i % 5 === 0 ? styles.tickLong : null]} />
          ))}
        </View>
        <View style={[styles.marker, { left: `${ratio * 100}%` }]} />
      </View>
      {label ? <Text style={styles.rulerLabel}>{label}</Text> : null}
    </View>
  );
}

/**
 * A binder index tab sticking out of the right edge of the binder: a big coloured action (« Silia, regarde »,
 * « Exercice similaire »…). Hover or press pushes it in (the hard shadow goes from 6 px to 2 px).
 */
export function IndexTab({
  icon,
  label,
  color,
  onPress,
  disabled = false,
  loading = false,
  primary = false,
  compact = false,
  short = false,
}: {
  icon: IconName;
  label: string;
  color: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  primary?: boolean;
  compact?: boolean;
  /** A shorter tab, for screens with little height (TV at 720p, laptop). */
  short?: boolean;
}) {
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled || loading}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={({ pressed }) => {
        const d = disabled ? 6 : pressed ? 1 : hover ? 2 : 6;
        return [
          styles.tab,
          { backgroundColor: color, minHeight: compact ? 52 : short ? (primary ? 78 : 62) : primary ? 104 : 86, width: compact ? 58 : short ? (primary ? 122 : 108) : primary ? 132 : 118 },
          { transform: [{ translateX: 6 - d }, { translateY: 6 - d }] },
          hardShadow(d),
          disabled && styles.disabled,
        ];
      }}
    >
      {loading ? <ActivityIndicator color={paper.ink} /> : <Icon name={icon} size={compact ? 24 : short ? (primary ? 28 : 22) : primary ? 34 : 28} color={paper.ink} />}
      {compact ? null : (
        <Text style={[styles.tabText, primary && styles.tabTextPrimary]} numberOfLines={2}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

/** Small square paper button lying on the desk (Plein écran, Recharger, Délier, Tourner la page). */
export function DeskButton({ icon, label, onPress, glyph }: { icon?: IconName; label: string; onPress: () => void; glyph?: string }) {
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      hitSlop={6}
      style={({ pressed }) => {
        const d = pressed ? 1 : hover ? 2 : 4;
        return [styles.deskButton, { transform: [{ translateX: 4 - d }, { translateY: 4 - d }] }, hardShadow(d)];
      }}
    >
      {icon ? <Icon name={icon} size={20} color={paper.ink} /> : <Text style={styles.glyph}>{glyph}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  desk: { flex: 1, backgroundColor: '#EFE6DD', overflow: 'hidden' },
  grain: { position: 'absolute', height: 2, borderRadius: 1, backgroundColor: '#D9C6AE' },
  graph: { backgroundColor: '#FBFEFB' },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: '#DCEFE2' },
  gridH: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#DCEFE2' },
  gridStrong: { backgroundColor: '#BFE3CB' },
  spine: { alignSelf: 'stretch', backgroundColor: '#2F3A57', alignItems: 'center', justifyContent: 'space-around', overflow: 'visible', zIndex: 5 },
  ringGroup: { gap: 10, alignItems: 'center' },
  ring: { borderWidth: 4, borderColor: '#9AA3B5', backgroundColor: 'transparent', boxShadow: '2px 2px 0px #2D3142' },
  ringShine: { position: 'absolute', top: 1, left: '25%', width: '30%', height: 2, borderRadius: 1, backgroundColor: '#E9EDF4' },
  washi: {
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-evenly',
    opacity: 0.92,
    borderLeftWidth: 0,
    borderRightWidth: 0,
  },
  washiDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.75)' },
  rulerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ruler: {
    flex: 1,
    height: 30,
    backgroundColor: '#FFD86B',
    borderWidth: 2,
    borderColor: paper.ink,
    borderRadius: 4,
    overflow: 'hidden',
    ...hardShadow(3),
  },
  rulerFill: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: 'rgba(76,203,122,0.55)' },
  ticks: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 6 },
  tick: { width: 1.5, height: 8, backgroundColor: paper.ink },
  tickLong: { height: 15 },
  marker: { position: 'absolute', top: -2, bottom: -2, width: 4, marginLeft: -2, backgroundColor: paper.red },
  rulerLabel: { ...font.bold, color: paper.ink, fontSize: 20 },
  tab: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderWidth: 3,
    borderLeftWidth: 0,
    borderColor: paper.ink,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
  },
  tabText: { ...font.semi, color: paper.ink, fontSize: 15, textAlign: 'center', lineHeight: 18 },
  tabTextPrimary: { ...font.bold, fontSize: 17 },
  disabled: { opacity: 0.45 },
  deskButton: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 2.5,
    borderColor: paper.ink,
    backgroundColor: paper.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { ...font.bold, color: paper.ink, fontSize: 22 },
});
