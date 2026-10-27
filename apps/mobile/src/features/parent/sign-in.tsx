import { useState } from 'react';

import { Body, Button, Card, ErrorText, Field, Screen, Title } from '@/components/ui';
import { supabase } from '@/lib/supabase';

export function SignIn({ onBack }: { onBack: () => void }) {
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  async function submit() {
    setBusy(true);
    setError('');
    setInfo('');
    const creds = { email: email.trim(), password };
    const { data, error: e } =
      mode === 'signIn' ? await supabase.auth.signInWithPassword(creds) : await supabase.auth.signUp(creds);
    setBusy(false);
    if (e) return setError(e.message);
    if (mode === 'signUp' && !data.session) setInfo('Compte créé. Confirme ton e-mail, puis connecte-toi.');
  }

  return (
    <Screen center>
      <Title>{mode === 'signIn' ? 'Connexion parent' : 'Créer un compte parent'}</Title>
      <Card>
        <Field
          label="E-mail"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
        />
        <Field
          label="Mot de passe"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete={mode === 'signIn' ? 'current-password' : 'new-password'}
        />
        <ErrorText>{error}</ErrorText>
        {info ? <Body>{info}</Body> : null}
        <Button
          label={mode === 'signIn' ? 'Se connecter' : 'Créer le compte'}
          onPress={submit}
          loading={busy}
          disabled={!email || password.length < 6}
        />
        <Button
          label={mode === 'signIn' ? 'Pas de compte ? Créer un compte' : 'Déjà un compte ? Se connecter'}
          variant="ghost"
          onPress={() => setMode(mode === 'signIn' ? 'signUp' : 'signIn')}
        />
      </Card>
      <Button label="Changer de rôle" variant="ghost" onPress={onBack} />
    </Screen>
  );
}
