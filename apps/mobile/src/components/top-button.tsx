import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text } from 'react-native';

import { FocusPressable, fromPointer } from '@/components/focus-pressable';
import { colors } from '@/lib/theme';

import { Icon, type IconName } from './icons';

/**
 * Round icon button of the Board's top bar. With the TV remote (or the keyboard) the focused button opens into a pill
 * with its label; touch and mouse only show the icon. `showLabel` keeps the label always (« Oui, le 1 »).
 */
export function TopButton({
  icon,
  label,
  onPress,
  tone = 'normal',
  disabled = false,
  loading = false,
  showLabel = false,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  /** primary = yellow (« Silia, regarde »), normal = dark round, quiet = no background (Recharger, Délier). */
  tone?: 'primary' | 'normal' | 'quiet';
  disabled?: boolean;
  loading?: boolean;
  showLabel?: boolean;
}) {
  const [remoteFocus, setRemoteFocus] = useState(false);
  const open = showLabel || remoteFocus;
  const fg = tone === 'primary' ? colors.onAccent : tone === 'quiet' ? colors.muted : colors.text;
  return (
    <FocusPressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      disabled={disabled || loading}
      onFocus={() => setRemoteFocus(!fromPointer())}
      onBlur={() => setRemoteFocus(false)}
      style={({ pressed }) => [
        styles.button,
        tone === 'primary' ? styles.primary : tone === 'normal' ? styles.normal : styles.quiet,
        open && styles.open,
        (disabled || loading) && { opacity: 0.45 },
        pressed && { transform: [{ scale: 0.95 }] },
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : <Icon name={icon} size={24} color={fg} />}
      {open ? <Text style={[styles.label, { color: fg }]}>{label}</Text> : null}
    </FocusPressable>
  );
}

const styles = StyleSheet.create({
  button: { height: 50, minWidth: 50, borderRadius: 25, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primary: { backgroundColor: colors.accent },
  normal: { backgroundColor: colors.surface },
  quiet: { backgroundColor: 'transparent' },
  open: { paddingLeft: 14, paddingRight: 20 },
  label: { fontSize: 18, fontWeight: '900' },
});
