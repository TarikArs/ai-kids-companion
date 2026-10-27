import type { DeviceRole } from '@hc/shared';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Body, Button, Card, ErrorText, Screen, Title } from '@/components/ui';
import { functionError, supabase } from '@/lib/supabase';
import { colors, space } from '@/lib/theme';

export interface Household {
  id: string;
  name: string;
  children: { id: string; name: string }[];
}

interface Device {
  id: string;
  role: DeviceRole;
  name: string | null;
  last_seen_at: string | null;
  revoked_at: string | null;
}

interface PairCode {
  code: string;
  role: DeviceRole;
  expires_at: string;
}

const ROLE_LABEL: Record<DeviceRole, string> = { board: 'Tableau', camera: 'Caméra' };

export function ParentHome({ household, onSignOut }: { household: Household; onSignOut: () => void }) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [pairCode, setPairCode] = useState<PairCode | null>(null);
  const [busy, setBusy] = useState<DeviceRole | null>(null);
  const [error, setError] = useState('');

  const loadDevices = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('devices')
      .select('id, role, name, last_seen_at, revoked_at')
      .eq('household_id', household.id)
      .is('revoked_at', null)
      .order('created_at');
    if (e) setError(e.message);
    else setDevices(data ?? []);
  }, [household.id]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  async function addDevice(role: DeviceRole) {
    setBusy(role);
    setError('');
    const { data, error: e } = await supabase.functions.invoke('pair-device', {
      body: { action: 'create', household_id: household.id, role },
    });
    setBusy(null);
    if (e) return setError(await functionError(e));
    setPairCode(data as PairCode);
  }

  async function revoke(id: string) {
    const { error: e } = await supabase.from('devices').update({ revoked_at: new Date().toISOString() }).eq('id', id);
    if (e) setError(e.message);
    loadDevices();
  }

  return (
    <Screen>
      <Title>{household.name}</Title>
      <Body muted>Enfant : {household.children.map((c) => c.name).join(', ') || '—'}</Body>

      {pairCode ? (
        <Card>
          <Body>Sur {pairCode.role === 'board' ? 'le Tableau' : 'la Caméra'}, tape ce code :</Body>
          <Text style={styles.code} selectable>
            {pairCode.code.slice(0, 3)} {pairCode.code.slice(3)}
          </Text>
          <Body muted>Valable 10 minutes, une seule fois.</Body>
          <Button
            label="C’est fait"
            onPress={() => {
              setPairCode(null);
              loadDevices();
            }}
          />
        </Card>
      ) : null}

      <Card>
        <Body>Appareils reliés</Body>
        {devices.length === 0 ? <Body muted>Aucun pour l’instant.</Body> : null}
        {devices.map((d) => (
          <View key={d.id} style={styles.deviceRow}>
            <Text style={styles.deviceName}>{d.name || ROLE_LABEL[d.role]}</Text>
            <Button label="Retirer" variant="ghost" onPress={() => revoke(d.id)} />
          </View>
        ))}
        <ErrorText>{error}</ErrorText>
        <Button label="Ajouter le Tableau (TV)" onPress={() => addDevice('board')} loading={busy === 'board'} />
        <Button
          label="Ajouter la Caméra"
          variant="secondary"
          onPress={() => addDevice('camera')}
          loading={busy === 'camera'}
        />
        <Button label="Actualiser" variant="ghost" onPress={loadDevices} />
      </Card>

      <Button label="Se déconnecter" variant="ghost" onPress={onSignOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: { color: colors.accent, fontSize: 56, fontWeight: '900', letterSpacing: 6, textAlign: 'center' },
  deviceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  deviceName: { color: colors.text, fontSize: 18, fontWeight: '700', flexShrink: 1 },
});
