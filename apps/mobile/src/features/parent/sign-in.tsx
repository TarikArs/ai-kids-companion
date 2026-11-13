import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FocusPressable as Pressable } from '@/components/focus-pressable';

import { RoleArt } from '@/components/illustrations';
import { Body, Button, Card, ErrorText, Field, Screen, Title } from '@/components/ui';
import { LegalLinks } from '@/components/legal-page';
import { authRedirect, sendPasswordReset, signInWithGoogle } from '@/lib/auth';
import { supabase } from '@/lib/supabase';
import { colors, space } from '@/lib/theme';
import { t } from '@/lib/i18n';
import { font, paper } from '@/lib/paper-theme';

type Mode = 'signIn' | 'signUp' | 'forgot';

/** Google sign-in stays hidden until the Google app is published (needs a home page + privacy policy). */
const GOOGLE_ENABLED = false;

const TITLE: Record<Mode, string> = {
  signIn: 'Espace parent',
  signUp: 'Créer un compte',
  forgot: 'Mot de passe oublié',
};

const friendly = (m: string) =>
  /invalid login/i.test(m)
    ? t('E-mail ou mot de passe incorrect.')
    : /email not confirmed/i.test(m)
      ? t('Confirme d’abord ton e-mail (regarde ta boîte de réception).')
      : /provider is not enabled/i.test(m)
        ? t('La connexion Google n’est pas encore activée sur le serveur.')
        : m;

/** The sign-in page (Parent role chosen, nobody signed in yet). */
export function SignIn({ onBack }: { onBack: () => void }) {
  return (
    <Screen center>
      <SignInBox art />
      <Button label={t('Changer d’appareil')} variant="ghost" onPress={onBack} />
    </Screen>
  );
}

/**
 * The parent's sign-in box: e-mail, password, create an account, forgotten password.
 * Also shown directly on the first screen of a big screen; `onSignedIn` then opens the parent space.
 */
export function SignInBox({ art = false, onSignedIn }: { art?: boolean; onSignedIn?: () => void }) {
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
        setInfo(t('Si ce compte existe, un lien vient d’être envoyé. Ouvre-le sur cet appareil.'));
      } else if (mode === 'signIn') {
        const { error: e } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (e) throw e;
        onSignedIn?.();
      } else {
        const { data, error: e } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: authRedirect('auth-callback') },
        });
        if (e) throw e;
        if (!data.session) setInfo(t('Compte créé. Confirme ton e-mail, puis connecte-toi.'));
        else onSignedIn?.();
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
    <View style={styles.box}>
      <View style={[styles.hero, !art && styles.heroRow]}>
        <RoleArt name="parent" size={art ? 140 : 64} />
        <Title>{t(TITLE[mode])}</Title>
        {mode === 'forgot' ? <Body muted>{t('On t’envoie un lien pour choisir un nouveau mot de passe.')}</Body> : null}
      </View>

      <Card>
        {GOOGLE_ENABLED && mode !== 'forgot' ? (
          <>
            <Button label={t('Continuer avec Google')} variant="light" onPress={google} loading={busy === 'google'} disabled={!!busy} />
            <View style={styles.divider}>
              <View style={styles.line} />
              <Text style={styles.or}>{t('ou')}</Text>
              <View style={styles.line} />
            </View>
          </>
        ) : null}

        <Field label={t('E-mail')} value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" />
        {mode !== 'forgot' ? (
          <Field
            label={t('Mot de passe')}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
          />
        ) : null}
        {mode === 'signIn' ? (
          <Pressable accessibilityRole="link" onPress={() => go('forgot')} style={styles.forgot}>
            <Text style={styles.link}>{t('Mot de passe oublié ?')}</Text>
          </Pressable>
        ) : null}

        <ErrorText>{error}</ErrorText>
        {info ? <Body>{info}</Body> : null}
        <Button
          label={t(mode === 'signIn' ? 'Se connecter' : mode === 'signUp' ? 'Créer le compte' : 'Envoyer le lien')}
          onPress={submit}
          loading={busy === 'email'}
          disabled={!canSubmit || !!busy}
        />
      </Card>

      <Pressable accessibilityRole="link" onPress={() => go(mode === 'signIn' ? 'signUp' : 'signIn')} style={styles.switch}>
        <Text style={styles.switchText}>
          {mode === 'signIn' ? t('Pas encore de compte ? ') : mode === 'signUp' ? t('Déjà un compte ? ') : ''}
          <Text style={styles.link}>{t(mode === 'signIn' ? 'Créer un compte' : 'Se connecter')}</Text>
        </Text>
      </Pressable>
      <LegalLinks lead={t('En continuant, tu acceptes :')} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: space.lg },
  hero: { alignItems: 'center', gap: space.sm },
  heroRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    gap: space.md,
  },
  divider: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  line: {
    flex: 1,
    borderTopWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: paper.inkFaint,
  },
  or: { ...font.hand, color: paper.inkSoft, fontSize: 20 },
  forgot: { alignSelf: 'flex-end', paddingVertical: space.xs },
  link: {
    ...font.semi,
    color: paper.blueInk,
    fontSize: 15,
    textDecorationLine: 'underline',
  },
  switch: { alignSelf: 'center', paddingVertical: space.sm },
  switchText: {
    ...font.medium,
    color: paper.inkSoft,
    fontSize: 15,
    textAlign: 'center',
  },
});
