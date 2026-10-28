import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors } from '@/lib/theme';

import { Icon, type IconName } from './icons';

/** Round icon button. `label` is read by screen readers; `caption` is an optional tiny visible word. */
export function IconButton({
  icon,
  label,
  onPress,
  size = 64,
  tone = 'dark',
  disabled = false,
  loading = false,
  caption,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  size?: number;
  tone?: 'dark' | 'accent' | 'danger';
  disabled?: boolean;
  loading?: boolean;
  caption?: string;
}) {
  const bg = tone === 'accent' ? colors.accent : tone === 'danger' ? '#E5484D' : 'rgba(27,35,64,0.88)';
  const fg = tone === 'accent' ? colors.onAccent : colors.text;
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        disabled={disabled || loading}
        hitSlop={8}
        style={({ pressed }) => [
          styles.button,
          { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
          (disabled || loading) && { opacity: 0.45 },
          pressed && { transform: [{ scale: 0.94 }] },
        ]}
      >
        {loading ? <ActivityIndicator color={fg} /> : <Icon name={icon} size={size * 0.44} color={fg} />}
      </Pressable>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 4 },
  button: { alignItems: 'center', justifyContent: 'center' },
  caption: { color: colors.text, fontSize: 13, fontWeight: '800', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 3 },
});
