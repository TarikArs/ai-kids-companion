import { useState } from 'react';

import { Body, Button, Card, ErrorText, Field, Screen, Title } from '@/components/ui';
import { supabase } from '@/lib/supabase';

/** First launch for a parent: create the household and the first child. */
export function Setup({ onDone }: { onDone: () => void }) {
  const [family, setFamily] = useState('');
  const [child, setChild] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function create() {
    setBusy(true);
    setError('');
    try {
      // Insert without returning the row: the owner membership is added by a trigger,
      // and reading the row back is allowed only once that membership exists.
      const { error: e1 } = await supabase.from('households').insert({ name: family.trim() });
      if (e1) throw e1;
      const { data: household, error: e2 } = await supabase
        .from('households')
        .select('id')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
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
      <Title>Bienvenue</Title>
      <Body muted>Deux informations pour commencer.</Body>
      <Card>
        <Field label="Nom de la famille" value={family} onChangeText={setFamily} placeholder="Famille Salhi" />
        <Field label="Prénom de l’enfant" value={child} onChangeText={setChild} />
        <ErrorText>{error}</ErrorText>
        <Button label="Continuer" onPress={create} loading={busy} disabled={!family.trim() || !child.trim()} />
      </Card>
    </Screen>
  );
}
