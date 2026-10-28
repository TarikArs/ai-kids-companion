import type { AppRole } from '@hc/shared';
import { Redirect } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RoleArt } from '@/components/illustrations';
import { Screen } from '@/components/ui';
import { useAppStore } from '@/lib/store';
import { colors, radius, space } from '@/lib/theme';
import { TUTOR_NAME } from '@/lib/tutor';

const ROLES: { role: AppRole; title: string; text: string }[] = [
  { role: 'board', title: 'Tableau', text: `TV ou tablette. ${TUTOR_NAME} parle et montre le cahier.` },
  { role: 'camera', title: 'Caméra', text: 'Téléphone posé au-dessus du cahier.' },
  { role: 'parent', title: 'Parent', text: 'Relier les appareils, régler la langue et le niveau.' },
];

export default function Home() {
  const role = useAppStore((s) => s.role);
  const device = useAppStore((s) => s.device);
  const setRole = useAppStore((s) => s.setRole);

  if (role === 'parent') return <Redirect href="/parent" />;
  if (role === 'board' || role === 'camera') {
    if (device?.role === role) return <Redirect href={role === 'board' ? '/board' : '/camera'} />;
    return <Redirect href="/pair" />;
  }

  return (
    <Screen center>
      <View style={styles.header}>
        <Text style={styles.brand}>{TUTOR_NAME}</Text>
        <Text style={styles.question}>Cet appareil sera…</Text>
      </View>
      <View style={{ gap: space.md }}>
        {ROLES.map((r) => (
          <Pressable
            key={r.role}
            accessibilityRole="button"
            accessibilityLabel={`${r.title}. ${r.text}`}
            onPress={() => setRole(r.role)}
            style={({ pressed }) => [styles.card, pressed && styles.pressed]}
          >
            <View style={styles.art}>
              <RoleArt name={r.role} size={92} />
            </View>
            <View style={styles.texts}>
              <Text style={styles.cardTitle}>{r.title}</Text>
              <Text style={styles.cardText}>{r.text}</Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.footnote}>Tu pourras changer plus tard.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: 'center', gap: space.xs, marginBottom: space.sm },
  brand: { color: colors.accent, fontSize: 18, fontWeight: '900', letterSpacing: 3, textTransform: 'uppercase' },
  question: { color: colors.text, fontSize: 30, fontWeight: '900', textAlign: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.md,
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.99 }] },
  art: { width: 100, height: 80, borderRadius: radius.md, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  texts: { flex: 1, gap: 2 },
  cardTitle: { color: colors.text, fontSize: 22, fontWeight: '900' },
  cardText: { color: colors.muted, fontSize: 15, lineHeight: 20 },
  chevron: { color: colors.muted, fontSize: 32, fontWeight: '300' },
  footnote: { color: colors.muted, fontSize: 14, textAlign: 'center' },
});
