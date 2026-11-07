import type { AppRole } from '@hc/shared';
import { Redirect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { FocusPressable as Pressable } from '@/components/focus-pressable';

import { RoleArt } from '@/components/illustrations';
import { PaperCard, Polaroid } from '@/components/paper';
import { Screen, Title } from '@/components/ui';
import { Avatar } from '@/features/board/avatar';
import { APP_LANGS, t } from '@/lib/i18n';
import { font, hardShadow, paper } from '@/lib/paper-theme';
import { useAppStore } from '@/lib/store';
import { space } from '@/lib/theme';
import { TUTOR_NAME } from '@/lib/tutor';

/** Each role is a sticky note of its own colour, slightly turned, as if stuck on the page by hand. */
const ROLES: { role: AppRole; title: string; text: string; color: string; tilt: number }[] = [
  { role: 'board', title: 'Tableau', text: 'TV ou tablette. {name} parle et montre le cahier.', color: paper.stickyBlue, tilt: -1.2 },
  { role: 'camera', title: 'Caméra', text: 'Téléphone posé au-dessus du cahier.', color: paper.stickyYellow, tilt: 1 },
  { role: 'parent', title: 'Parent', text: 'Relier les appareils, régler la langue et le niveau.', color: paper.stickyPink, tilt: -0.6 },
];

export default function Home() {
  const role = useAppStore((s) => s.role);
  const device = useAppStore((s) => s.device);
  const setRole = useAppStore((s) => s.setRole);
  const appLangSetting = useAppStore((s) => s.appLang);
  const setAppLang = useAppStore((s) => s.setAppLang);

  if (role === 'parent') return <Redirect href="/parent" />;
  if (role === 'board' || role === 'camera') {
    if (device?.role === role) return <Redirect href={role === 'board' ? '/board' : '/camera'} />;
    return <Redirect href="/pair" />;
  }

  return (
    <Screen>
      <View style={styles.header}>
        <Polaroid caption={TUTOR_NAME} width={128} tilt={-4}>
          <Avatar mood="idle" />
        </Polaroid>
        <View style={{ flex: 1, gap: space.xs }}>
          <Title>{t('Cet appareil sera…')}</Title>
          <Text style={styles.note}>{t('Tu pourras changer plus tard.')}</Text>
        </View>
      </View>

      <View style={{ gap: space.lg }}>
        {ROLES.map((r, i) => (
          <Pressable
            key={r.role}
            preferFocus={i === 0}
            accessibilityRole="button"
            accessibilityLabel={`${t(r.title)}. ${t(r.text, { name: TUTOR_NAME })}`}
            onPress={() => setRole(r.role)}
            style={({ pressed }) => [pressed && { transform: [{ translateX: 3 }, { translateY: 3 }] }]}
          >
            <PaperCard kind="sticky" color={r.color} tilt={r.tilt} tape={i === 1} pad={12} style={styles.card}>
              {/* the drawing hangs in a little wooden chalkboard frame */}
              <View style={styles.frame}>
                <RoleArt name={r.role} size={80} />
              </View>
              <View style={styles.texts}>
                <Text style={styles.cardTitle}>{t(r.title)}</Text>
                <Text style={styles.cardText}>{t(r.text, { name: TUTOR_NAME })}</Text>
              </View>
              <Text style={styles.arrow}>➜</Text>
            </PaperCard>
          </Pressable>
        ))}
      </View>

      {/* App language: every device passes here first (the Board and the Camera have no settings screen). */}
      <View style={styles.langs}>
        {APP_LANGS.map((l) => {
          const on = appLangSetting === l.value;
          return (
            <Pressable
              key={l.value}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => setAppLang(l.value)}
              style={[styles.lang, on ? styles.langOn : null]}
            >
              <Text style={[styles.langText, on && font.bold]}>{l.value === 'system' ? t(l.label) : l.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm, marginBottom: space.sm },
  note: { ...font.hand, color: paper.blueInk, fontSize: 22 },
  card: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  frame: {
    width: 96,
    height: 76,
    borderRadius: 6,
    borderWidth: 5,
    borderColor: paper.wood,
    backgroundColor: paper.chalkboard,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  texts: { flex: 1, gap: 2 },
  cardTitle: { ...font.bold, color: paper.ink, fontSize: 24 },
  cardText: { ...font.medium, color: paper.inkSoft, fontSize: 15, lineHeight: 20 },
  arrow: { ...font.bold, color: paper.ink, fontSize: 22 },
  langs: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm, marginTop: space.sm },
  lang: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, borderWidth: 2, borderColor: paper.ink, backgroundColor: paper.card, ...hardShadow(2) },
  langOn: { backgroundColor: paper.yellow, ...hardShadow(3) },
  langText: { ...font.medium, color: paper.ink, fontSize: 14 },
});
