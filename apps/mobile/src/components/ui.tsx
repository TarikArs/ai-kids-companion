import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, space } from '@/lib/theme';

export function Screen({ children, center = false }: { children: ReactNode; center?: boolean }) {
  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={[styles.scroll, center && styles.center]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.content}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return <Text style={styles.title}>{children}</Text>;
}

export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted && { color: colors.muted }]}>{children}</Text>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <Text style={styles.error}>{children}</Text>;
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={styles.card}>{children}</View>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
}) {
  const primary = variant === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        primary ? styles.buttonPrimary : variant === 'secondary' ? styles.buttonSecondary : styles.buttonGhost,
        (disabled || loading) && { opacity: 0.5 },
        pressed && { transform: [{ scale: 0.98 }] },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? colors.onAccent : colors.text} />
      ) : (
        <Text style={[styles.buttonText, { color: primary ? colors.onAccent : colors.text }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Field({ label, ...input }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: space.xs }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} style={styles.input} {...input} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flexGrow: 1, padding: space.lg },
  center: { justifyContent: 'center' },
  content: { width: '100%', maxWidth: 520, alignSelf: 'center', gap: space.md },
  title: { color: colors.text, fontSize: 30, fontWeight: '900' },
  body: { color: colors.text, fontSize: 17, lineHeight: 24 },
  error: { color: colors.danger, fontSize: 16, fontWeight: '700' },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: space.md },
  button: {
    minHeight: 56,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonSecondary: { backgroundColor: colors.surfaceHigh },
  buttonGhost: { backgroundColor: 'transparent' },
  buttonText: { fontSize: 18, fontWeight: '800' },
  label: { color: colors.muted, fontSize: 15, fontWeight: '700' },
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    color: colors.text,
    paddingHorizontal: space.md,
    fontSize: 18,
  },
});
