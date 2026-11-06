import type { DeviceRole, SessionSummary } from '@hc/shared';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FocusPressable as Pressable } from '@/components/focus-pressable';

import { RoleArt } from '@/components/illustrations';
import { Body, Button, ErrorText, Screen } from '@/components/ui';
import { useAppStore } from '@/lib/store';
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
  const setDevice = useAppStore((s) => s.setDevice);
  const setRole = useAppStore((s) => s.setRole);

  /** This phone becomes the Camera: no third device, no pairing code. "Parent" on the Camera comes back here. */
  function openAsCamera() {
    setDevice({ id: `parent:${household.id}`, householdId: household.id, role: 'camera', viaParent: true });
    setRole('camera');
    router.replace('/camera');
  }

  /** Silia's voice. Off = text only on the Board, and NO request to ElevenLabs (no credits). null = not loaded. */
  const [voiceOn, setVoiceOn] = useState<boolean | null>(null);
  useEffect(() => {
    supabase
      .from('households')
      .select('voice_enabled')
      .eq('id', household.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!error && data) setVoiceOn((data as { voice_enabled?: boolean }).voice_enabled !== false);
      });
  }, [household.id]);

  async function setVoice(on: boolean) {
    const before = voiceOn;
    setVoiceOn(on);
    const { error: e } = await supabase.from('households').update({ voice_enabled: on }).eq('id', household.id);
    if (e) {
      setVoiceOn(before);
      setError(e.message);
    }
  }

  /** Report of the latest finished session (written by Silia at "Terminer"). */
  const [report, setReport] = useState<{ started_at: string; summary: SessionSummary } | null>(null);
  useEffect(() => {
    supabase
      .from('homework_sessions')
      .select('started_at, summary')
      .eq('household_id', household.id)
      .not('summary', 'is', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!error && data?.summary) setReport(data as { started_at: string; summary: SessionSummary });
      });
  }, [household.id]);

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

      {/* latest session report */}
      {report ? (
        <View style={styles.section}>
          <Text style={styles.rowTitle}>
            Dernière séance · {new Date(report.started_at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' })}
          </Text>
          <Text style={styles.sub}>
            {report.summary.minutes} min · {report.summary.answers} réponses vérifiées · {report.summary.right} justes
            {report.summary.wrong ? ` · ${report.summary.wrong} à revoir` : ''}
          </Text>
          <Text style={styles.report}>{report.summary.parent_text}</Text>
        </View>
      ) : null}

      {/* this phone as the Camera */}
      <Pressable accessibilityRole="button" onPress={openAsCamera} style={({ pressed }) => [styles.section, styles.thisPhone, pressed && { opacity: 0.85 }]}>
        <View style={styles.art}>
          <RoleArt name="camera" size={64} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>Utiliser ce téléphone comme Caméra</Text>
          <Text style={styles.sub}>Pas besoin d’un autre appareil. Bouton « Parent » pour revenir ici.</Text>
        </View>
        <Text style={styles.chevron}>›</Text>
      </Pressable>

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

      {/* Silia's voice */}
      {voiceOn !== null ? (
        <View style={{ gap: space.sm }}>
          <Text style={styles.heading}>Voix de {TUTOR_NAME}</Text>
          <View style={styles.section}>
            <Pills
              options={[
                { value: 'on', label: 'Activée' },
                { value: 'off', label: 'Coupée' },
              ]}
              value={voiceOn ? 'on' : 'off'}
              onChange={(v) => setVoice(v === 'on')}
            />
            <Text style={styles.sub}>
              {voiceOn
                ? `${TUTOR_NAME} parle sur le Tableau. Chaque nouvelle phrase utilise des crédits ElevenLabs ; les phrases déjà dites sont gratuites.`
                : `${TUTOR_NAME} écrit seulement sur le Tableau. Aucune requête ElevenLabs, aucun crédit utilisé.`}
            </Text>
          </View>
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
  thisPhone: { flexDirection: 'row', alignItems: 'center', gap: space.md, borderWidth: 2, borderColor: colors.accent },
  chevron: { color: colors.muted, fontSize: 30, fontWeight: '300' },
  report: { color: colors.text, fontSize: 15, lineHeight: 22 },
});
