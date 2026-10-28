import type { DeviceRole } from '@hc/shared';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { RoleArt } from '@/components/illustrations';
import { Body, Button, ErrorText, Screen } from '@/components/ui';
import { functionError, supabase } from '@/lib/supabase';
import { colors, radius, space } from '@/lib/theme';
import { TUTOR_NAME } from '@/lib/tutor';

export type TutorLanguage = 'auto' | 'fr' | 'ar' | 'fus' | 'en';

export interface Household {
  id: string;
  name: string;
  children: { id: string; name: string; tutor_language: TutorLanguage; grade: number }[];
}

const GRADES: { value: number; label: string }[] = [
  { value: 1, label: '1re' },
  { value: 2, label: '2e' },
  { value: 3, label: '3e' },
  { value: 4, label: '4e' },
  { value: 5, label: '5e' },
  { value: 6, label: '6e' },
  { value: 7, label: 'Collège' },
];

const LANGUAGES: { value: TutorLanguage; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto', hint: 'La langue de l’exercice (page en arabe → arabe standard).' },
  { value: 'fr', label: 'Français', hint: 'Toujours en français.' },
  { value: 'fus', label: 'العربية', hint: 'Toujours en arabe standard (fusha).' },
  { value: 'ar', label: 'Darija', hint: 'Toujours en darija marocaine.' },
  { value: 'en', label: 'English', hint: 'Always in English.' },
];

interface Device {
  id: string;
  role: DeviceRole;
  name: string | null;
  created_at: string;
}

interface PairCode {
  code: string;
  role: DeviceRole;
  expires_at: string;
}

const ROLE: Record<DeviceRole, { title: string; one: string; none: string }> = {
  board: { title: 'Tableau', one: 'TV ou tablette', none: 'Aucun tableau relié' },
  camera: { title: 'Caméra', one: 'Une seule par famille', none: 'Aucune caméra reliée' },
};

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });

export function ParentHome({
  household,
  onSignOut,
  onChanged,
}: {
  household: Household;
  onSignOut: () => void;
  onChanged: () => void;
}) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [pairCode, setPairCode] = useState<PairCode | null>(null);
  const [busy, setBusy] = useState<DeviceRole | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [voices, setVoices] = useState('');
  const [warming, setWarming] = useState(false);

  const loadDevices = useCallback(async () => {
    const { data, error: e } = await supabase
      .from('devices')
      .select('id, role, name, created_at')
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
    setConfirmId(null);
    const { error: e } = await supabase.from('devices').update({ revoked_at: new Date().toISOString() }).eq('id', id);
    if (e) setError(e.message);
    loadDevices();
  }

  async function update(childId: string, patch: { grade?: number; tutor_language?: TutorLanguage }) {
    const { error: e } = await supabase.from('children').update(patch).eq('id', childId);
    if (e) setError(e.message);
    onChanged();
  }

  async function warmVoices() {
    setWarming(true);
    setVoices('');
    const { data, error: e } = await supabase.functions.invoke('warm-phrases', { body: {} });
    setWarming(false);
    if (e) return setVoices(`Erreur : ${await functionError(e)}`);
    setVoices(`${data.ready} phrases prêtes${data.failed?.length ? `, ${data.failed.length} en erreur` : ''}.`);
  }

  const hasCamera = devices.some((d) => d.role === 'camera');

  return (
    <Screen>
      {/* header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.family}>{household.name}</Text>
          <Text style={styles.sub}>Espace parent</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={onSignOut} style={styles.signOut}>
          <Text style={styles.signOutText}>Déconnexion</Text>
        </Pressable>
      </View>

      {/* pairing code */}
      {pairCode ? (
        <View style={[styles.section, styles.codeCard]}>
          <Text style={styles.codeLabel}>Sur {pairCode.role === 'board' ? 'le Tableau' : 'la Caméra'}, tape ce code</Text>
          <Text style={styles.code} selectable>
            {pairCode.code.slice(0, 3)} {pairCode.code.slice(3)}
          </Text>
          <Text style={styles.sub}>Valable 10 minutes, une seule fois.</Text>
          <Button
            label="C’est fait"
            onPress={() => {
              setPairCode(null);
              loadDevices();
            }}
          />
        </View>
      ) : null}

      {/* devices */}
      <Text style={styles.heading}>Appareils</Text>
      <View style={styles.section}>
        {(['board', 'camera'] as const).map((role, i) => {
          const list = devices.filter((d) => d.role === role);
          const canAdd = role === 'board' || !hasCamera;
          return (
            <View key={role} style={[styles.deviceBlock, i > 0 && styles.separator]}>
              <View style={styles.deviceHead}>
                <View style={styles.art}>
                  <RoleArt name={role} size={64} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{ROLE[role].title}</Text>
                  <Text style={styles.sub}>{list.length ? ROLE[role].one : ROLE[role].none}</Text>
                </View>
                {canAdd ? (
                  <Button
                    label={list.length ? 'Ajouter' : 'Relier'}
                    variant={list.length ? 'secondary' : 'primary'}
                    onPress={() => addDevice(role)}
                    loading={busy === role}
                  />
                ) : null}
              </View>
              {list.map((d) => (
                <View key={d.id} style={styles.deviceRow}>
                  <View style={styles.dot} />
                  <Text style={styles.deviceName}>
                    {d.name || ROLE[role].title} · relié le {shortDate(d.created_at)}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => (confirmId === d.id ? revoke(d.id) : setConfirmId(d.id))}
                    style={[styles.remove, confirmId === d.id && styles.removeConfirm]}
                  >
                    <Text style={[styles.removeText, confirmId === d.id && { color: colors.bg }]}>
                      {confirmId === d.id ? 'Confirmer' : 'Retirer'}
                    </Text>
                  </Pressable>
                </View>
              ))}
            </View>
          );
        })}
        <ErrorText>{error}</ErrorText>
      </View>

      {/* each child: level + language */}
      {household.children.map((child) => {
        const lang = LANGUAGES.find((l) => l.value === (child.tutor_language ?? 'auto')) ?? LANGUAGES[0];
        return (
          <View key={child.id} style={{ gap: space.sm }}>
            <Text style={styles.heading}>{child.name}</Text>
            <View style={styles.section}>
              <Text style={styles.label}>Niveau</Text>
              <Pills
                options={GRADES}
                value={child.grade ?? 1}
                onChange={(grade) => update(child.id, { grade })}
              />
              <Text style={[styles.label, { marginTop: space.sm }]}>Langue de {TUTOR_NAME}</Text>
              <Pills
                options={LANGUAGES}
                value={lang.value}
                onChange={(tutor_language) => update(child.id, { tutor_language })}
              />
              <Text style={styles.sub}>{lang.hint}</Text>
            </View>
          </View>
        );
      })}

      {/* advanced */}
      <Pressable accessibilityRole="button" onPress={() => setAdvanced((v) => !v)} style={styles.advancedToggle}>
        <Text style={styles.sub}>{advanced ? '▾' : '▸'} Avancé</Text>
      </Pressable>
      {advanced ? (
        <View style={styles.section}>
          <Text style={styles.rowTitle}>Voix de {TUTOR_NAME}</Text>
          <Body muted>Prépare une fois les phrases habituelles (Bravo, Hmm…). À refaire seulement si une voix change.</Body>
          {voices ? <Body>{voices}</Body> : null}
          <Button label="Préparer les voix" variant="secondary" onPress={warmVoices} loading={warming} />
        </View>
      ) : null}
    </Screen>
  );
}

function Pills<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.pills}>
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => !selected && onChange(o.value)}
            style={[styles.pill, selected && styles.pillSelected]}
          >
            <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  family: { color: colors.text, fontSize: 28, fontWeight: '900' },
  sub: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  signOut: { paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: colors.surface },
  signOutText: { color: colors.muted, fontWeight: '800', fontSize: 14 },
  heading: { color: colors.muted, fontSize: 13, fontWeight: '900', letterSpacing: 1, textTransform: 'uppercase', marginTop: space.sm },
  section: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.md, gap: space.sm },
  codeCard: { alignItems: 'center', borderWidth: 2, borderColor: colors.accent },
  codeLabel: { color: colors.text, fontSize: 17, fontWeight: '800' },
  code: { color: colors.accent, fontSize: 52, fontWeight: '900', letterSpacing: 6 },
  deviceBlock: { gap: space.sm },
  separator: { borderTopWidth: 1, borderTopColor: colors.surfaceHigh, paddingTop: space.md },
  deviceHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  art: { width: 72, height: 56, borderRadius: radius.md, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  rowTitle: { color: colors.text, fontSize: 18, fontWeight: '900' },
  deviceRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingLeft: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success },
  deviceName: { color: colors.text, fontSize: 15, flex: 1 },
  remove: { paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill },
  removeConfirm: { backgroundColor: colors.danger },
  removeText: { color: colors.danger, fontWeight: '800', fontSize: 14 },
  label: { color: colors.text, fontSize: 15, fontWeight: '800' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  pill: {
    minHeight: 40,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillSelected: { backgroundColor: colors.accent },
  pillText: { color: colors.text, fontSize: 15, fontWeight: '800' },
  pillTextSelected: { color: colors.onAccent },
  advancedToggle: { alignSelf: 'flex-start', paddingVertical: space.sm },
});
