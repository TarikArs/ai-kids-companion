import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';

import { Button, ErrorText, Screen } from '@/components/ui';
import { authParams, completeAuth } from '@/lib/auth';
import { useAppStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';

/** Google sign-in comes back here (web, or a phone opening the link). */
export default function AuthCallback() {
  const params = useLocalSearchParams<Record<string, string>>();
  const setRole = useAppStore((s) => s.setRole);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const href = (globalThis as any).location?.href as string | undefined;
        const all = { ...(href ? authParams(href) : {}), ...params };
        const { data } = await supabase.auth.getSession();
        // The phone may already have finished it in the Google window.
        if (!(data.session && !data.session.user.is_anonymous)) await completeAuth(all);
        setRole('parent');
        router.replace('/parent');
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Screen center>
      {error ? (
        <>
          <ErrorText>{error}</ErrorText>
          <Button label="Retour à la connexion" onPress={() => router.replace('/parent')} />
        </>
      ) : (
        <ActivityIndicator color={colors.accent} size="large" />
      )}
    </Screen>
  );
}
