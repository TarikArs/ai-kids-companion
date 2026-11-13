import { StatusBar } from 'expo-status-bar';
import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChunkyButton, InkLink, NotebookPage, PaperCard, PaperInput, Spiral } from '@/components/paper';
import { font, MARGIN_X, paper } from '@/lib/paper-theme';
import { space } from '@/lib/theme';

// The phone's simple screens (sign-in, pairing, setup…) as a page of a spiral notebook.

/** `wide`: a larger page for big screens (two columns side by side). */
export function Screen({ children, center = false, wide = false }: { children: ReactNode; center?: boolean; wide?: boolean }) {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" />
      <NotebookPage fill>
        <Spiral />
        <ScrollView contentContainerStyle={[styles.scroll, center && styles.center]} keyboardShouldPersistTaps="handled">
          <View style={[styles.content, wide && styles.contentWide]}>{children}</View>
        </ScrollView>
      </NotebookPage>
    </SafeAreaView>
  );
}

/** A heading written on the page, with a yellow highlighter stroke behind it. */
export function Title({ children }: { children: ReactNode }) {
  return (
    <View style={styles.titleWrap}>
      <View style={styles.highlighter} />
      <Text style={styles.title}>{children}</Text>
    </View>
  );
}

export function Body({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <Text style={[styles.body, muted && { color: paper.inkSoft }]}>{children}</Text>;
}

/** A mistake note: red crayon on a pink sticky note. */
export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <PaperCard kind="sticky" color={paper.stickyPink} pad={12} tilt={-1}>
      <Text style={styles.error}>✗ {children}</Text>
    </PaperCard>
  );
}

/** An index card lying on the page. */
export function Card({ children }: { children: ReactNode }) {
  return (
    <PaperCard kind="index" pad={18} style={{ paddingTop: 22, gap: space.md }}>
      {children}
    </PaperCard>
  );
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
  variant?: 'primary' | 'secondary' | 'ghost' | 'light';
  loading?: boolean;
  disabled?: boolean;
}) {
  if (variant === 'ghost') return <InkLink label={label} onPress={onPress} />;
  return (
    <ChunkyButton
      label={label}
      onPress={onPress}
      color={variant === 'primary' ? 'yellow' : variant === 'secondary' ? 'red' : 'white'}
      loading={loading}
      disabled={disabled}
    />
  );
}

export function Field({ label, ...input }: TextInputProps & { label: string }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>{label}</Text>
      <PaperInput {...input} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: paper.page },
  scroll: { flexGrow: 1, paddingLeft: MARGIN_X + 18, paddingRight: 22, paddingTop: space.md, paddingBottom: space.xl },
  center: { justifyContent: 'center' },
  content: { width: '100%', maxWidth: 520, alignSelf: 'center', gap: space.lg },
  contentWide: { maxWidth: 1040 },
  titleWrap: { alignSelf: 'flex-start' },
  highlighter: { position: 'absolute', left: -6, right: -8, bottom: 6, height: 16, borderRadius: 4, backgroundColor: paper.yellow, opacity: 0.55, transform: [{ rotate: '-1.2deg' }] },
  title: { ...font.bold, color: paper.ink, fontSize: 32, lineHeight: 40 },
  body: { ...font.medium, color: paper.ink, fontSize: 18, lineHeight: 26 },
  error: { ...font.semi, color: '#C0392B', fontSize: 16, lineHeight: 22 },
  label: { ...font.semi, color: paper.inkSoft, fontSize: 15 },
});
