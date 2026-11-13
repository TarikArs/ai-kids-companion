import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FocusPressable as Pressable } from '@/components/focus-pressable';
import { LegalLinks } from '@/components/legal-page';

import { Body, Button, Card, ErrorText, Field, Screen, Title } from '@/components/ui';
import { supabase } from '@/lib/supabase';
import { t } from '@/lib/i18n';
import { LEGAL_VERSION } from '@/lib/legal';
import { font, paper } from '@/lib/paper-theme';
import { TUTOR_NAME } from '@/lib/tutor';

/** First launch for a parent: create the household and the first child. */
export function Setup({ onDone }: { onDone: () => void }) {
  const [family, setFamily] = useState('');
  const [child, setChild] = useState('');
  const [busy, setBusy] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState('');

  async function create() {
    setBusy(true);
    setError('');
    try {
      // Insert without returning the row: the owner membership is added by a trigger,
      // and reading the row back is allowed only once that membership exists.
      const { error: e1 } = await supabase
        .from('households')
        .insert({ name: family.trim(), terms_accepted_at: new Date().toISOString(), terms_version: LEGAL_VERSION });
      if (e1) throw e1;
      const { data: household, error: e2 } = await supabase.from('households').select('id').order('created_at', { ascending: false }).limit(1).single();
      if (e2) throw e2;
      const { error: e3 } = await supabase.from('children').insert({ household_id: household.id, name: child.trim() });
      if (e3) throw e3;
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen center>
      <Title>{t('Bienvenue')}</Title>
      <Body muted>{t('Deux informations pour commencer.')}</Body>
      <Card>
        <Field label={t('Nom de la famille')} value={family} onChangeText={setFamily} placeholder="Famille Salhi" />
        <Field label={t('Prénom de l’enfant')} value={child} onChangeText={setChild} />
        <Body muted>
          {t(
            '{name} est une IA : elle peut mal lire une photo ou se tromper. Vérifie ses corrections : c’est une aide aux devoirs, elle ne remplace ni l’enseignant ni toi.',
            { name: TUTOR_NAME },
          )}
        </Body>
        {/* the parent's consent, required and recorded (date + version of the texts) */}
        <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} onPress={() => setAgreed((v) => !v)} style={styles.agree}>
          <View style={[styles.box, agreed && styles.boxOn]}>{agreed ? <Text style={styles.tick}>✓</Text> : null}</View>
          <Text style={styles.agreeText}>
            {t('Je suis le parent ou le tuteur légal de l’enfant et j’accepte les conditions d’utilisation et la politique de confidentialité.')}
          </Text>
        </Pressable>
        <LegalLinks center={false} />
        <ErrorText>{error}</ErrorText>
        <Button label={t('Continuer')} onPress={create} loading={busy} disabled={!family.trim() || !child.trim() || !agreed} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  agree: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  box: {
    width: 24,
    height: 24,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: paper.ink,
    backgroundColor: paper.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  boxOn: { backgroundColor: paper.yellow },
  tick: { ...font.bold, color: paper.ink, fontSize: 15, lineHeight: 18 },
  agreeText: { ...font.medium, color: paper.ink, fontSize: 14, lineHeight: 20, flex: 1 },
});
