import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator } from 'react-native';

import { Button, ErrorText, Screen } from '@/components/ui';
import { ParentHome, type Household } from '@/features/parent/home';
import { Setup } from '@/features/parent/setup';
import { SignIn } from '@/features/parent/sign-in';
import { useAppStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import { useSession } from '@/lib/use-session';

export default function Parent() {
  const session = useSession();
  const setRole = useAppStore((s) => s.setRole);
  const [household, setHousehold] = useState<Household | null | undefined>(undefined);
  const [error, setError] = useState('');

  const signedInParent = !!session && !session.user.is_anonymous;

  const loadHousehold = useCallback(async () => {
    setError('');
    const { data, error: e } = await supabase
      .from('households')
      .select('id, name, children(id, name, tutor_language, grade)')
      .order('created_at')
      .limit(1)
      .maybeSingle();
    if (e) setError(e.message);
    setHousehold((data as Household | null) ?? null);
  }, []);

  useEffect(() => {
    if (signedInParent) loadHousehold();
    else setHousehold(undefined);
  }, [signedInParent, loadHousehold]);

  function changeRole() {
    setRole(null);
    router.replace('/');
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  if (session === undefined) return <Loading />;
  if (!signedInParent) return <SignIn onBack={changeRole} />;
  if (household === undefined) return <Loading error={error} onRetry={loadHousehold} />;
  if (household === null) return <Setup onDone={loadHousehold} />;
  return <ParentHome household={household} onSignOut={signOut} onChanged={loadHousehold} />;
}

function Loading({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  return (
    <Screen center>
      {error ? (
        <>
          <ErrorText>{error}</ErrorText>
          {onRetry ? <Button label="Réessayer" onPress={onRetry} /> : null}
        </>
      ) : (
        <ActivityIndicator color={colors.accent} size="large" />
      )}
    </Screen>
  );
}
