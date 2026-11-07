import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Chunky, type Crayon } from '@/components/paper';
import { font, hardShadow, paper } from '@/lib/paper-theme';

import { Icon, type IconName } from './icons';

/**
 * Round chunky button of the Camera: crayon colour, thick pencil border, hard shadow; it sinks when pressed.
 * `label` is read by screen readers; `caption` is a small paper label under it (readable over the camera picture).
 */
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
  tone?: 'dark' | 'accent' | 'danger' | 'green';
  disabled?: boolean;
  loading?: boolean;
  caption?: string;
}) {
  const color: Crayon = tone === 'accent' ? 'yellow' : tone === 'danger' ? 'red' : tone === 'green' ? 'green' : 'white';
  return (
    <View style={styles.wrap}>
      <Chunky
        accessibilityLabel={label}
        onPress={onPress}
        color={color}
        disabled={disabled || loading}
        radius={size / 2}
        depth={size >= 80 ? 6 : 4}
        style={{ width: size, height: size }}
      >
        {loading ? <ActivityIndicator color={paper.ink} /> : <Icon name={icon} size={size * 0.44} color={paper.ink} />}
      </Chunky>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 8 },
  caption: {
    ...font.semi,
    color: paper.ink,
    fontSize: 13,
    backgroundColor: paper.card,
    borderWidth: 1.5,
    borderColor: paper.ink,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 1,
    overflow: 'hidden',
    ...hardShadow(2),
  },
});
