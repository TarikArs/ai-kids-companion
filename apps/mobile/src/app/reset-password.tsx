import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';

import { Body, Button, Card, ErrorText, Field, Screen, Title } from '@/components/ui';
import { authParams, completeAuth } from '@/lib/auth';
import { useAppStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';

/** Opened from the "mot de passe oublié" e-mail: choose a new password. */
export default function ResetPassword() {
  const params = useLocalSearchParams<Record<string, string>>();
  const setRole = useAppStore((s) => s.setRole);
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const href = (globalThis as any).location?.href as string | undefined;
        await completeAuth({ ...(href ? authParams(href) : {}), ...params });
        setReady(true);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    if (password !== confirm) return setError('Les deux mots de passe sont différents.');
    setBusy(true);
    setError('');
    const { error: e } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (e) return setError(e.message);
    setDone(true);
  }

  if (!ready && !error) {
    return (
      <Screen center>
        <ActivityIndicator color={colors.accent} size="large" />
      </Screen>
    );
  }

  return (
    <Screen center>
      <Title>Nouveau mot de passe</Title>
      {done ? (
        <Card>
          <Body>C’est enregistré.</Body>
          <Button
            label="Continuer"
            onPress={() => {
              setRole('parent');
              router.replace('/parent');
            }}
          />
        </Card>
      ) : ready ? (
        <Card>
          <Field label="Nouveau mot de passe" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" />
          <Field label="Encore une fois" value={confirm} onChangeText={setConfirm} secureTextEntry autoComplete="new-password" />
          <ErrorText>{error}</ErrorText>
          <Button label="Enregistrer" onPress={save} loading={busy} disabled={password.length < 6 || !confirm} />
        </Card>
      ) : (
        <Card>
          <ErrorText>{error}</ErrorText>
          <Body muted>Le lien a peut-être expiré. Demande un nouveau lien.</Body>
          <Button label="Retour à la connexion" onPress={() => router.replace('/parent')} />
        </Card>
      )}
    </Screen>
  );
}
