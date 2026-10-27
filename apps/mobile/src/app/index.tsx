import type { AppRole } from '@hc/shared';
import { Redirect } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Body, Screen, Title } from '@/components/ui';
import { useAppStore } from '@/lib/store';
import { colors, radius, space } from '@/lib/theme';

const ROLES: { role: AppRole; title: string; text: string }[] = [
  { role: 'board', title: 'Tableau', text: 'TV ou tablette. La maîtresse animée et le tableau.' },
  { role: 'camera', title: 'Caméra', text: 'Téléphone posé près du cahier. Prend les photos.' },
  { role: 'parent', title: 'Parent', text: 'Suivre les devoirs, la progression, les réglages.' },
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
      <Title>Cet appareil sera…</Title>
      <Body muted>Choisis une fois. Tu pourras changer plus tard.</Body>
      <View style={{ gap: space.md }}>
        {ROLES.map((r) => (
          <Pressable
            key={r.role}
            accessibilityRole="button"
            onPress={() => setRole(r.role)}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}
          >
            <Text style={styles.cardTitle}>{r.title}</Text>
            <Text style={styles.cardText}>{r.text}</Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, gap: space.xs },
  cardTitle: { color: colors.accent, fontSize: 24, fontWeight: '900' },
  cardText: { color: colors.muted, fontSize: 16 },
});
