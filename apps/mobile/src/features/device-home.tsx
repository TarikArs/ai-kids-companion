import { router } from 'expo-router';
import { useEffect, useState } from 'react';

import { Body, Button, Card, Screen, Title } from '@/components/ui';
import { useAppStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

/** Placeholder home for a paired Board or Camera. The real screens come next in M1. */
export function DeviceHome({ title }: { title: string }) {
  const device = useAppStore((s) => s.device);
  const reset = useAppStore((s) => s.reset);
  const [household, setHousehold] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!device) return;
    supabase
      .from('households')
      .select('name')
      .eq('id', device.householdId)
      .maybeSingle()
      .then(({ data, error: e }) => {
        if (e) setError(e.message);
        else if (!data) setError('Cet appareil n’a plus accès. Relie-le à nouveau.');
        else setHousehold(data.name);
      });
  }, [device]);

  async function unpair() {
    await supabase.auth.signOut();
    reset();
    router.replace('/');
  }

  return (
    <Screen center>
      <Title>{title}</Title>
      <Card>
        <Body>{household ? `Relié à la famille « ${household} » ✓` : error || 'Connexion…'}</Body>
        <Body muted>Prochaine étape : {title === 'Caméra' ? 'photos du cahier' : 'avatar et tableau'}.</Body>
      </Card>
      <Button label="Délier cet appareil" variant="ghost" onPress={unpair} />
    </Screen>
  );
}
