import { router } from 'expo-router';
import { useState } from 'react';

import { View } from 'react-native';

import { RoleArt } from '@/components/illustrations';
import { Body, Button, Card, ErrorText, Field, Screen, Title } from '@/components/ui';
import { useAppStore } from '@/lib/store';
import { functionError, supabase } from '@/lib/supabase';
import { t } from '@/lib/i18n';

/** Board or Camera: sign in anonymously, then claim the 6-digit code shown on the parent's phone. */
export default function Pair() {
  const role = useAppStore((s) => s.role);
  const setDevice = useAppStore((s) => s.setDevice);
  const setRole = useAppStore((s) => s.setRole);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const label = role === 'board' ? 'Tableau' : 'Caméra';

  async function claim() {
    setBusy(true);
    setError('');
    try {
      const { data: current } = await supabase.auth.getSession();
      if (!current.session || !current.session.user.is_anonymous) {
        const { error: signInError } = await supabase.auth.signInAnonymously();
        if (signInError) throw signInError;
      }
      const { data, error: fnError } = await supabase.functions.invoke('pair-device', {
        body: { action: 'claim', code, name: label },
      });
      if (fnError) throw new Error(await functionError(fnError));
      if (data.role !== role) {
        throw new Error(data.role === 'board' ? t('Ce code est pour le Tableau. Demande un autre code.') : t('Ce code est pour la Caméra. Demande un autre code.'));
      }
      setDevice({ id: data.device_id, householdId: data.household_id, role: data.role });
      router.replace(role === 'board' ? '/board' : '/camera');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen center>
      <View style={{ alignItems: 'center', gap: 8 }}>
        <RoleArt name={role === 'board' ? 'board' : 'camera'} size={140} />
        <Title>{t('Relier : {name}', { name: t(label) })}</Title>
      </View>
      <Card>
        <Body muted>
          {t('Dans l’espace parent, appareil « {name} » → « Relier ». Tape le code affiché.', { name: t(label) })}
        </Body>
        <Field
          label={t('Code à 6 chiffres')}
          value={code}
          onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
          keyboardType="number-pad"
          placeholder="123456"
          maxLength={6}
          autoFocus
        />
        <ErrorText>{error}</ErrorText>
        <Button label={t('Relier')} onPress={claim} loading={busy} disabled={code.length !== 6} />
      </Card>
      <Button
        label={t('Changer d’appareil')}
        variant="ghost"
        onPress={() => {
          setRole(null);
          router.replace('/');
        }}
      />
    </Screen>
  );
}
