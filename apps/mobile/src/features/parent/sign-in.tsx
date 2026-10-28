import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RoleArt } from '@/components/illustrations';
import { Body, Button, Card, ErrorText, Field, Screen, Title } from '@/components/ui';
import { authRedirect, sendPasswordReset, signInWithGoogle } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { colors, space } from '@/lib/theme';

type Mode = 'signIn' | 'signUp' | 'forgot';

const TITLE: Record<Mode, string> = { signIn: 'Espace parent', signUp: 'Créer un compte', forgot: 'Mot de passe oublié' };

const friendly = (m: string) =>
  /invalid login/i.test(m)
    ? 'E-mail ou mot de passe incorrect.'
    : /email not confirmed/i.test(m)
      ? 'Confirme d’abord ton e-mail (regarde ta boîte de réception).'
      : /provider is not enabled/i.test(m)
        ? 'La connexion Google n’est pas encore activée sur le serveur.'
        : m;

export function SignIn({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState<'email' | 'google' | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  function go(next: Mode) {
    setMode(next);
    setError('');
    setInfo('');
  }

  async function submit() {
    setBusy('email');
    setError('');
    setInfo('');
    try {
      if (mode === 'forgot') {
        await sendPasswordReset(email);
        setInfo('Si ce compte existe, un lien vient d’être envoyé. Ouvre-le sur cet appareil.');
      } else if (mode === 'signIn') {
        const { error: e } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (e) throw e;
      } else {
        const { data, error: e } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: authRedirect('auth-callback') },
        });
        if (e) throw e;
        if (!data.session) setInfo('Compte créé. Confirme ton e-mail, puis connecte-toi.');
      }
    } catch (e) {
      setError(friendly((e as Error).message));
    } finally {
      setBusy(null);
    }
  }

  async function google() {
    setBusy('google');
    setError('');
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(friendly((e as Error).message));
    } finally {
      setBusy(null);
    }
  }

  const canSubmit = mode === 'forgot' ? /\S+@\S+/.test(email) : /\S+@\S+/.test(email) && password.length >= 6;

  return (
    <Screen center>
      <View style={styles.hero}>
        <RoleArt name="parent" size={140} />
        <Title>{TITLE[mode]}</Title>
        {mode === 'forgot' ? <Body muted>On t’envoie un lien pour choisir un nouveau mot de passe.</Body> : null}
      </View>

      <Card>
        {mode !== 'forgot' ? (
          <>
            <Button label="Continuer avec Google" variant="light" onPress={google} loading={busy === 'google'} disabled={!!busy} />
            <View style={styles.divider}>
              <View style={styles.line} />
              <Text style={styles.or}>ou</Text>
              <View style={styles.line} />
            </View>
          </>
        ) : null}

        <Field label="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
        {mode !== 'forgot' ? (
          <Field
            label="Mot de passe"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
          />
        ) : null}
        {mode === 'signIn' ? (
          <Pressable accessibilityRole="link" onPress={() => go('forgot')} style={styles.forgot}>
            <Text style={styles.link}>Mot de passe oublié ?</Text>
          </Pressable>
        ) : null}

        <ErrorText>{error}</ErrorText>
        {info ? <Body>{info}</Body> : null}
        <Button
          label={mode === 'signIn' ? 'Se connecter' : mode === 'signUp' ? 'Créer le compte' : 'Envoyer le lien'}
          onPress={submit}
          loading={busy === 'email'}
          disabled={!canSubmit || !!busy}
        />
      </Card>

      <Pressable accessibilityRole="link" onPress={() => go(mode === 'signIn' ? 'signUp' : 'signIn')} style={styles.switch}>
        <Text style={styles.switchText}>
          {mode === 'signIn' ? 'Pas encore de compte ? ' : mode === 'signUp' ? 'Déjà un compte ? ' : ''}
          <Text style={styles.link}>{mode === 'signIn' ? 'Créer un compte' : 'Se connecter'}</Text>
        </Text>
      </Pressable>
      <Button label="Changer d’appareil" variant="ghost" onPress={onBack} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.sm },
  divider: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  line: { flex: 1, height: 1, backgroundColor: colors.surfaceHigh },
  or: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  forgot: { alignSelf: 'flex-end', paddingVertical: space.xs },
  link: { color: colors.accent, fontSize: 15, fontWeight: '800' },
  switch: { alignSelf: 'center', paddingVertical: space.sm },
  switchText: { color: colors.muted, fontSize: 15, textAlign: 'center' },
});
