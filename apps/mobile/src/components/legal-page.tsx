import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { FocusPressable as Pressable } from '@/components/focus-pressable';

import { Button, Screen, Title } from '@/components/ui';
import { appLang, t } from '@/lib/i18n';
import { legalDoc, type LegalKind } from '@/lib/legal';
import { font, paper } from '@/lib/paper-theme';
import { space } from '@/lib/theme';

/** The privacy policy or the terms of use, on a notebook page (app and web: /privacy, /terms). */
export function LegalPage({ kind }: { kind: LegalKind }) {
  const lang = appLang();
  const doc = legalDoc(kind, lang);
  return (
    <Screen>
      <Title>{doc.title}</Title>
      {lang === 'ar' ? <Text style={[styles.note, styles.rtl]}>هذا النص متوفّر بالفرنسية والإنجليزية.</Text> : null}
      <Text style={styles.updated}>{doc.updated}</Text>
      <Text style={styles.p}>{doc.intro}</Text>
      {doc.sections.map((s) => (
        <View key={s.h} style={styles.section}>
          <Text style={styles.h}>{s.h}</Text>
          {s.p.map((line, i) => (
            <Text key={i} style={styles.p}>
              {line}
            </Text>
          ))}
        </View>
      ))}
      <Button label={t('Retour')} variant="ghost" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
    </Screen>
  );
}

/** « Politique de confidentialité · Conditions d’utilisation », small links (sign-in, first screen, settings). */
export function LegalLinks({ lead, center = true }: { lead?: string; center?: boolean }) {
  return (
    <View style={[styles.links, center && { justifyContent: 'center' }]}>
      {lead ? <Text style={styles.lead}>{lead}</Text> : null}
      <Pressable accessibilityRole="link" onPress={() => router.push('/terms')}>
        <Text style={styles.link}>{t('Conditions d’utilisation')}</Text>
      </Pressable>
      <Text style={styles.lead}>·</Text>
      <Pressable accessibilityRole="link" onPress={() => router.push('/privacy')}>
        <Text style={styles.link}>{t('Politique de confidentialité')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  links: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  lead: { ...font.regular, color: paper.inkSoft, fontSize: 13 },
  link: { ...font.semi, color: paper.blueInk, fontSize: 13, textDecorationLine: 'underline' },
  updated: { ...font.hand, color: paper.blueInk, fontSize: 20 },
  note: { ...font.medium, color: paper.inkSoft, fontSize: 15 },
  rtl: { writingDirection: 'rtl', textAlign: 'right' },
  section: { gap: space.xs },
  h: { ...font.bold, color: paper.ink, fontSize: 18, marginTop: space.sm },
  p: { ...font.regular, color: paper.ink, fontSize: 15, lineHeight: 22 },
});
