import { useState, type ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { FocusPressable as Pressable } from '@/components/focus-pressable';
import { Icon, type IconName } from '@/components/icons';
import { font, hardShadow, LINE, MARGIN_X, paper } from '@/lib/paper-theme';

// ---------- the page ----------

/**
 * A sheet of a composition notebook: cream paper, blue ruled lines, a faint red margin on the left.
 * Draws behind its children; `fill` makes it take all the space (a screen), otherwise it wraps its content (a panel).
 */
export function NotebookPage({
  children,
  style,
  fill = false,
  margin = true,
  top = 64,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  fill?: boolean;
  margin?: boolean;
  /** First ruled line (room for the spiral / a header). */
  top?: number;
}) {
  const [h, setH] = useState(0);
  const lines = Math.max(0, Math.ceil((h - top) / LINE));
  return (
    <View style={[{ backgroundColor: paper.page }, fill && { flex: 1 }, style]} onLayout={(e) => setH(e.nativeEvent.layout.height)}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {Array.from({ length: lines }, (_, i) => (
          <View key={i} style={[styles.rule, { top: top + i * LINE }]} />
        ))}
        {margin ? <View style={styles.margin} /> : null}
      </View>
      {children}
    </View>
  );
}

/** Spiral-notebook wire along the top edge: punched holes with a metal loop through each. */
export function Spiral({ rings = 12 }: { rings?: number }) {
  return (
    <View style={styles.spiral} pointerEvents="none">
      {Array.from({ length: rings }, (_, i) => (
        <View key={i} style={styles.ringSlot}>
          <View style={styles.hole} />
          <View style={styles.wire} />
        </View>
      ))}
    </View>
  );
}

/** A strip of sticky tape holding a note on the page. */
export function Tape({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View pointerEvents="none" style={[styles.tape, style]} />;
}

// ---------- cards ----------

type CardKind = 'index' | 'sticky' | 'plain';

/**
 * Paper lying on the page: a white index card (red header rule), a sticky note (coloured), or plain white paper.
 * Charcoal pencil border, hard offset shadow, an optional small tilt and a strip of tape.
 */
export function PaperCard({
  children,
  kind = 'plain',
  color,
  tilt = 0,
  tape = false,
  style,
  pad = 16,
}: {
  children: ReactNode;
  kind?: CardKind;
  color?: string;
  tilt?: number;
  tape?: boolean;
  style?: StyleProp<ViewStyle>;
  pad?: number;
}) {
  const bg = color ?? (kind === 'sticky' ? paper.stickyYellow : paper.card);
  return (
    <View style={[{ transform: tilt ? [{ rotate: `${tilt}deg` }] : undefined }]}>
      <View style={[styles.card, { backgroundColor: bg, padding: pad }, kind === 'sticky' && styles.sticky, style]}>
        {kind === 'index' ? <View pointerEvents="none" style={styles.indexRule} /> : null}
        {children}
      </View>
      {tape ? <Tape /> : null}
    </View>
  );
}

// ---------- buttons ----------

export type Crayon = 'yellow' | 'red' | 'green' | 'blue' | 'white' | 'pink';
const CRAYON: Record<Crayon, string> = { yellow: paper.yellow, red: paper.red, green: paper.green, blue: paper.blue, white: paper.card, pink: '#FF9EB5' };

/**
 * A chunky physical button: crayon colour, thick pencil border, hard shadow. Pressed, it sinks onto the page
 * (the shadow disappears and the button moves down by the same amount).
 */
export function Chunky({
  children,
  onPress,
  color = 'yellow',
  disabled = false,
  depth = 5,
  radius = 18,
  style,
  accessibilityLabel,
  accessibilityRole = 'button',
}: {
  children: ReactNode;
  onPress?: () => void;
  color?: Crayon;
  disabled?: boolean;
  depth?: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'tab' | 'radio' | 'switch';
}) {
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={({ pressed }) => {
        const d = disabled ? depth : pressed ? 1 : hover ? 2 : depth;
        return [
          styles.chunky,
          { backgroundColor: CRAYON[color], borderRadius: radius },
          d < depth ? { transform: [{ translateX: depth - d }, { translateY: depth - d }] } : null,
          hardShadow(d),
          disabled && styles.disabled,
          style,
        ];
      }}
    >
      {children}
    </Pressable>
  );
}

/** Chunky button with a label (and an optional icon). */
export function ChunkyButton({
  label,
  onPress,
  color = 'yellow',
  icon,
  size = 'lg',
  loading = false,
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  color?: Crayon;
  icon?: IconName;
  size?: 'lg' | 'md' | 'sm';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const h = size === 'lg' ? 60 : size === 'md' ? 50 : 40;
  return (
    <Chunky onPress={onPress} color={color} disabled={disabled || loading} depth={size === 'sm' ? 3 : 5} style={[{ minHeight: h, paddingHorizontal: size === 'sm' ? 14 : 22 }, styles.row, style]}>
      {loading ? (
        <ActivityIndicator color={paper.ink} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={size === 'lg' ? 24 : 20} color={paper.ink} /> : null}
          <Text style={[styles.chunkyText, { fontSize: size === 'lg' ? 20 : size === 'md' ? 17 : 15 }]} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </Chunky>
  );
}

/** A plain text link written in blue ink, underlined. */
export function InkLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={8} style={({ pressed }) => [styles.inkLink, pressed && { opacity: 0.6 }]}>
      <Text style={styles.inkLinkText}>{label}</Text>
    </Pressable>
  );
}

// ---------- inputs ----------

/** A writing box pressed into the page: white, pencil border, slightly recessed (inner top shadow). */
export function PaperInput(props: TextInputProps & { big?: boolean }) {
  const { big, style, ...rest } = props;
  return <TextInput placeholderTextColor={paper.inkFaint} {...rest} style={[styles.input, big && styles.inputBig, style]} />;
}

/** Small round pencil-bordered toggle: grass green when on. */
export function PaperSwitch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label?: string }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: on }}
      onPress={() => onChange(!on)}
      hitSlop={8}
      style={[styles.switch, { backgroundColor: on ? paper.green : paper.line }]}
    >
      <View style={[styles.knob, on ? { right: 2 } : { left: 2 }]} />
    </Pressable>
  );
}

// ---------- Silia's photo ----------

/**
 * Silia in a Polaroid clipped to the page: white frame with the thick bottom border, a handwritten caption, a paper clip.
 */
export function Polaroid({
  children,
  caption,
  width = 120,
  tilt = -3,
  clip = true,
  style,
}: {
  children: ReactNode;
  caption?: string;
  width?: number;
  tilt?: number;
  clip?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const inner = width - 16;
  return (
    <View style={[{ width, transform: [{ rotate: `${tilt}deg` }] }, style]}>
      <View style={[styles.polaroid, hardShadow(4)]}>
        <View style={[styles.polaroidPhoto, { width: inner, height: inner }]}>{children}</View>
        <Text style={[styles.polaroidCaption, { fontSize: Math.max(16, width / 6) }]} numberOfLines={1}>
          {caption ?? ''}
        </Text>
      </View>
      {clip ? <PaperClip style={{ position: 'absolute', top: -14, left: width * 0.62 }} /> : null}
    </View>
  );
}

/** A metal paper clip, drawn. */
export function PaperClip({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View pointerEvents="none" style={style}>
      <Svg width={22} height={46} viewBox="0 0 22 46">
        <Path
          d="M7 14 V36 a4 4 0 0 0 8 0 V8 a6 6 0 0 0 -12 0 V34 a8 8 0 0 0 16 0 V14"
          fill="none"
          stroke="#7C8496"
          strokeWidth={2.6}
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}

// ---------- navigation ----------

/**
 * Coloured divider tabs sticking out of the top of the page (like a binder's sticky tabs). The selected one is taller
 * and joins the page.
 */
export function StickyTabs<K extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { key: K; label: string; icon: IconName; color: string }[];
  value: K;
  onChange: (k: K) => void;
}) {
  return (
    <View style={styles.tabs} accessibilityRole="tablist">
      {tabs.map((tab) => {
        const on = tab.key === value;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(tab.key)}
            style={[styles.tab, { backgroundColor: tab.color }, on ? styles.tabOn : styles.tabOff]}
          >
            <Icon name={tab.icon} size={20} color={paper.ink} />
            <Text style={[styles.tabText, on && font.bold]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Section title written by hand in blue ink, with a highlighter stroke. */
export function HandCaption({ children, color = paper.stickyYellow }: { children: ReactNode; color?: string }) {
  return (
    <View style={styles.handWrap}>
      <View style={[styles.highlighter, { backgroundColor: color }]} />
      <Text style={styles.hand}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  rule: { position: 'absolute', left: 0, right: 0, height: 1.5, backgroundColor: paper.line },
  margin: { position: 'absolute', top: 0, bottom: 0, left: MARGIN_X, width: 1.5, backgroundColor: paper.margin },
  spiral: { flexDirection: 'row', justifyContent: 'space-evenly', height: 28, paddingHorizontal: 12, zIndex: 2 },
  ringSlot: { width: 16, alignItems: 'center' },
  hole: { position: 'absolute', top: 15, width: 10, height: 10, borderRadius: 5, backgroundColor: '#E2DCCD', borderWidth: 1.5, borderColor: paper.ink },
  wire: { position: 'absolute', top: -6, width: 9, height: 28, borderRadius: 5, borderWidth: 3, borderColor: '#8B93A5', backgroundColor: 'transparent' },
  tape: {
    position: 'absolute',
    top: -10,
    alignSelf: 'center',
    width: 74,
    height: 22,
    backgroundColor: paper.tape,
    borderWidth: 1,
    borderColor: 'rgba(45,49,66,0.15)',
    transform: [{ rotate: '-4deg' }],
  },
  card: { borderWidth: 2, borderColor: paper.ink, borderRadius: 8, gap: 12, ...hardShadow(4) },
  sticky: { borderRadius: 3, borderBottomRightRadius: 16 },
  indexRule: { position: 'absolute', left: 0, right: 0, top: 40, height: 2, backgroundColor: paper.margin },
  chunky: { borderWidth: 3, borderColor: paper.ink, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: 10 },
  chunkyText: { ...font.bold, color: paper.ink, letterSpacing: 0.2 },
  disabled: { opacity: 0.45 },
  inkLink: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 6 },
  inkLinkText: { ...font.semi, color: paper.blueInk, fontSize: 16, textDecorationLine: 'underline' },
  input: {
    ...font.medium,
    minHeight: 54,
    backgroundColor: paper.card,
    borderWidth: 2,
    borderColor: paper.ink,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 19,
    color: paper.ink,
    boxShadow: 'inset 0px 3px 0px rgba(45,49,66,0.12)',
  },
  inputBig: { minHeight: 60, fontSize: 24 },
  switch: { width: 54, height: 32, borderRadius: 16, borderWidth: 2.5, borderColor: paper.ink, justifyContent: 'center' },
  knob: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: paper.card, borderWidth: 2.5, borderColor: paper.ink },
  polaroid: { backgroundColor: paper.card, borderWidth: 2, borderColor: paper.ink, borderRadius: 4, padding: 8, paddingBottom: 6, alignItems: 'center' },
  polaroidPhoto: { backgroundColor: '#DDF0FF', borderWidth: 1.5, borderColor: paper.ink, alignItems: 'center', justifyContent: 'flex-end', overflow: 'hidden' },
  polaroidCaption: { ...font.hand, color: paper.ink, marginTop: 2 },
  tabs: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingHorizontal: 18, zIndex: 3 },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    borderWidth: 2,
    borderColor: paper.ink,
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
  },
  tabOn: { height: 50, borderBottomWidth: 0, marginBottom: -2 },
  tabOff: { height: 40, opacity: 0.85 },
  tabText: { ...font.semi, color: paper.ink, fontSize: 16 },
  handWrap: { alignSelf: 'flex-start', marginTop: 6 },
  highlighter: { position: 'absolute', left: -4, right: -6, bottom: 4, height: 12, borderRadius: 3, transform: [{ rotate: '-1deg' }] },
  hand: { ...font.hand, color: paper.blueInk, fontSize: 26, lineHeight: 30 },
});
