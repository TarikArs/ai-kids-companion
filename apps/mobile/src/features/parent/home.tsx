import type { DeviceRole, SessionSummary } from '@hc/shared';
import { router } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/focus-pressable';
import { Icon } from '@/components/icons';
import { Button, ErrorText } from '@/components/ui';
import { useAppStore } from '@/lib/store';
import { functionError, supabase } from '@/lib/supabase';
import { colors, radius, space } from '@/lib/theme';
import { TUTOR_NAME } from '@/lib/tutor';
import { APP_LANGS, applyFamilyLang, dateLocale, systemLang, t } from '@/lib/i18n';

export type TutorLanguage = 'auto' | 'fr' | 'ar' | 'fus' | 'en';

export interface Household {
  id: string;
  name: string;
  children: { id: string; name: string; tutor_language: TutorLanguage; grade: number }[];
}

type Child = Household['children'][number];

const GRADES: { value: number; label: string }[] = [
  { value: 1, label: '1re année' },
  { value: 2, label: '2e année' },
  { value: 3, label: '3e année' },
  { value: 4, label: '4e année' },
  { value: 5, label: '5e année' },
  { value: 6, label: '6e année' },
  { value: 7, label: 'Collège' },
];

const LANGUAGES: { value: TutorLanguage; label: string; hint: string }[] = [
  { value: 'auto', label: 'Auto', hint: 'Suit la page : français, ou arabe classique pour une page en arabe' },
  { value: 'fr', label: 'Français', hint: 'Toujours en français' },
  { value: 'fus', label: 'العربية', hint: 'Arabe classique (fusha)' },
  { value: 'ar', label: 'Darija', hint: 'Arabe marocain' },
  { value: 'en', label: 'English', hint: 'Always in English' },
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

const ROLE: Record<DeviceRole, { title: string; icon: string; hint: string }> = {
  board: { title: 'Tableau', icon: '📺', hint: 'TV ou tablette : Silia parle et montre la page' },
  camera: { title: 'Caméra', icon: '📷', hint: 'Le téléphone au-dessus du cahier (une seule par famille)' },
};

type Sheet =
  | { kind: 'grade' | 'lang' | 'name'; child: Child }
  | { kind: 'device'; device: Device }
  | { kind: 'add' }
  | { kind: 'appLang' }
  | null;

const shortDate = (iso: string) => new Date(iso).toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' });
const longDate = (iso: string) => new Date(iso).toLocaleDateString(dateLocale(), { weekday: 'long', day: 'numeric', month: 'short' });
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Parent space: two tabs. Accueil = start the homework, last session, devices. Réglages = everything else. */
export function ParentHome({ household, onSignOut, onChanged }: { household: Household; onSignOut: () => void; onChanged: () => void }) {
  const [tab, setTab] = useState<'home' | 'settings'>('home');
  /** The phone's own navigation bar (buttons or gesture bar): the tabs sit above it. */
  const insets = useSafeAreaInsets();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [pairCode, setPairCode] = useState<PairCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState<{ started_at: string; summary: SessionSummary } | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  /** Household switches: Silia's voice, and « Un seul téléphone ». null = not loaded. */
  const [voiceOn, setVoiceOn] = useState<boolean | null>(null);
  const [soloOn, setSoloOn] = useState<boolean | null>(null);
  const [solutionOn, setSolutionOn] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const setDevice = useAppStore((s) => s.setDevice);
  const setRole = useAppStore((s) => s.setRole);
  const appLangSetting = useAppStore((s) => s.appLang);
  const setAppLang = useAppStore((s) => s.setAppLang);
  const child = household.children[0];

  useEffect(() => {
    supabase
      .from('households')
      .select('voice_enabled, solo_mode, solution_enabled, app_lang')
      .eq('id', household.id)
      .maybeSingle()
      .then(({ data }) => {
        const h = data as { voice_enabled?: boolean; solo_mode?: boolean; solution_enabled?: boolean } | null;
        setVoiceOn(h?.voice_enabled !== false);
        setSoloOn(h?.solo_mode === true);
        applyFamilyLang((data as { app_lang?: string } | null)?.app_lang);
        setSolutionOn(h?.solution_enabled === true);
      });
    // Report of the latest finished session (written by Silia at « Terminer »).
    supabase
      .from('homework_sessions')
      .select('started_at, summary')
      .eq('household_id', household.id)
      .not('summary', 'is', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.summary) setReport(data as { started_at: string; summary: SessionSummary });
      });
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? ''));
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

  /** This phone becomes the Camera (and the Board too with « Un seul téléphone »). « Parent » on the Camera comes back here. */
  function startHomework() {
    setDevice({ id: `parent:${household.id}`, householdId: household.id, role: 'camera', viaParent: true });
    setRole('camera');
    router.replace('/camera');
  }

  async function setHouseholdFlag(column: 'voice_enabled' | 'solo_mode' | 'solution_enabled', on: boolean) {
    const set = column === 'voice_enabled' ? setVoiceOn : column === 'solo_mode' ? setSoloOn : setSolutionOn;
    set(on);
    const { error: e } = await supabase.from('households').update({ [column]: on }).eq('id', household.id);
    if (e) {
      set(!on);
      setError(e.message);
    }
  }

  async function updateChild(childId: string, patch: { grade?: number; tutor_language?: TutorLanguage; name?: string }) {
    const { error: e } = await supabase.from('children').update(patch).eq('id', childId);
    if (e) setError(e.message);
    onChanged();
  }

  async function addDevice(role: DeviceRole) {
    setSheet(null);
    setBusy(true);
    setError('');
    const { data, error: e } = await supabase.functions.invoke('pair-device', { body: { action: 'create', household_id: household.id, role } });
    setBusy(false);
    if (e) return setError(await functionError(e));
    setPairCode(data as PairCode);
  }

  async function revoke(id: string) {
    setSheet(null);
    const { error: e } = await supabase.from('devices').update({ revoked_at: new Date().toISOString() }).eq('id', id);
    if (e) setError(e.message);
    loadDevices();
  }

  const hasCamera = devices.some((d) => d.role === 'camera');
  const hour = new Date().getHours();

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {tab === 'home' ? (
          <>
            <View style={styles.header}>
              <Text style={styles.avatar}>{(child?.name ?? household.name).charAt(0).toUpperCase()}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.family}>{household.name}</Text>
                <Text style={styles.hello}>{t(hour >= 17 || hour < 4 ? 'Bonsoir !' : 'Bonjour !')}</Text>
              </View>
            </View>

            {pairCode ? (
              <View style={[styles.group, styles.codeCard]}>
                <Text style={styles.codeLabel}>{t(pairCode.role === 'board' ? 'Sur le Tableau, tape ce code' : 'Sur la Caméra, tape ce code')}</Text>
                <Text style={styles.code} selectable>
                  {pairCode.code.slice(0, 3)} {pairCode.code.slice(3)}
                </Text>
                <Text style={styles.sub}>{t('Valable 10 minutes, une seule fois.')}</Text>
                <Button
                  label={t('C’est fait')}
                  onPress={() => {
                    setPairCode(null);
                    loadDevices();
                  }}
                />
              </View>
            ) : null}

            {/* the one main action */}
            <Pressable accessibilityRole="button" onPress={startHomework} style={({ pressed }) => [styles.start, pressed && { opacity: 0.9 }]}>
              <View style={styles.startIcon}>
                <Icon name="camera" size={30} color={colors.onAccent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.startTitle}>{t('Commencer les devoirs')}</Text>
                <Text style={styles.startSub}>
                  {child ? t('Avec {name} · ', { name: child.name }) : ''}
                  {t(soloOn ? 'ce téléphone fait tout' : 'ce téléphone devient la Caméra')}
                </Text>
              </View>
              <Text style={[styles.chevron, { color: colors.onAccent }]}>›</Text>
            </Pressable>

            {report ? (
              <>
                <Text style={styles.caption}>{t('DERNIÈRE SÉANCE')}</Text>
                <View style={[styles.group, styles.pad]}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.rowTitle}>{capital(longDate(report.started_at))}</Text>
                    <Text style={styles.sub}>{report.summary.minutes} min</Text>
                  </View>
                  <View style={styles.stats}>
                    <Stat value={report.summary.right} label={t('justes')} color={colors.success} />
                    <Stat value={report.summary.wrong} label={t('à revoir')} color="#FF7A7A" />
                    <Stat value={report.summary.answers} label={t('vérifiées')} color={colors.text} />
                  </View>
                  <Text style={styles.report} numberOfLines={reportOpen ? undefined : 2}>
                    {report.summary.parent_text}
                  </Text>
                  <Pressable accessibilityRole="button" onPress={() => setReportOpen((v) => !v)}>
                    <Text style={styles.link}>{t(reportOpen ? 'Réduire' : 'Voir le bilan ›')}</Text>
                  </Pressable>
                </View>
              </>
            ) : null}

            <Text style={styles.caption}>{t('APPAREILS')}</Text>
            {devices.length ? (
              <View style={styles.group}>
                {devices.map((d, i) => (
                  <Row
                    key={d.id}
                    first={i === 0}
                    icon={ROLE[d.role].icon}
                    title={`${t(ROLE[d.role].title)}${d.name ? ` · ${d.name}` : ''}`}
                    sub={t('relié le {date}', { date: shortDate(d.created_at) })}
                    onPress={() => setSheet({ kind: 'device', device: d })}
                  />
                ))}
              </View>
            ) : null}
            <Pressable accessibilityRole="button" onPress={() => setSheet({ kind: 'add' })} disabled={busy} style={styles.addDevice}>
              <Text style={styles.addDeviceText}>{t(busy ? 'Un instant…' : '＋  Lier un appareil (TV, tablette, téléphone)')}</Text>
            </Pressable>
            <ErrorText>{error}</ErrorText>
          </>
        ) : (
          <>
            <Text style={styles.pageTitle}>{t('Réglages')}</Text>

            {household.children.map((c) => {
              const lang = LANGUAGES.find((l) => l.value === (c.tutor_language ?? 'auto')) ?? LANGUAGES[0];
              return (
                <View key={c.id} style={{ gap: space.sm }}>
                  <Text style={styles.caption}>{c.name.toUpperCase()}</Text>
                  <View style={styles.group}>
                    <Row first icon="🎒" title={t('Classe')} value={t(GRADES.find((g) => g.value === (c.grade ?? 1))?.label ?? '')} onPress={() => setSheet({ kind: 'grade', child: c })} />
                    <Row icon="✏️" title={t('Prénom')} value={c.name} onPress={() => setSheet({ kind: 'name', child: c })} />
                    <Row icon="🗣️" title={t('Langue de {name}', { name: TUTOR_NAME })} sub={t(lang.hint)} value={t(lang.label)} onPress={() => setSheet({ kind: 'lang', child: c })} />
                  </View>
                </View>
              );
            })}

            <Text style={styles.caption}>{TUTOR_NAME.toUpperCase()}</Text>
            <View style={styles.group}>
              <Row
                first
                icon="🔊"
                title={t('Voix de {name}', { name: TUTOR_NAME })}
                sub={t(voiceOn === false ? 'Coupée : texte seulement, aucun crédit ElevenLabs' : 'Activée : les phrases déjà dites sont gratuites')}
                right={voiceOn === null ? null : <Switch on={voiceOn} onChange={(on) => setHouseholdFlag('voice_enabled', on)} />}
              />
            </View>

            <Text style={styles.caption}>{t('UTILISATION')}</Text>
            <View style={styles.group}>
              <Row
                first
                icon="📱"
                title={t('Un seul téléphone')}
                sub={t('Pas de télé ni de tablette : après la photo, le téléphone devient le Tableau')}
                right={soloOn === null ? null : <Switch on={soloOn} onChange={(on) => setHouseholdFlag('solo_mode', on)} />}
              />
              <Row
                icon="🔑"
                title={t('Solution')}
                sub={t('Un bouton « Solution » sur le Tableau : {name} écrit les bonnes réponses et explique', { name: TUTOR_NAME })}
                right={solutionOn === null ? null : <Switch on={solutionOn} onChange={(on) => setHouseholdFlag('solution_enabled', on)} />}
              />
            </View>

            <Text style={styles.caption}>{t('APPLICATION')}</Text>
            <View style={styles.group}>
              <Row
                first
                icon="🌐"
                title={t("Langue de l'app")}
                value={appLangSetting === 'system' ? t('Langue du téléphone') : APP_LANGS.find((l) => l.value === appLangSetting)?.label}
                onPress={() => setSheet({ kind: 'appLang' })}
              />
            </View>

            <Text style={styles.caption}>{t('COMPTE')}</Text>
            <View style={styles.group}>
              {email ? <Row first icon="✉️" title={email} /> : null}
              <Row first={!email} title={t('Se déconnecter')} danger onPress={onSignOut} />
            </View>
            <ErrorText>{error}</ErrorText>
          </>
        )}
      </ScrollView>

      {/* two places only */}
      <View style={[styles.tabs, { paddingBottom: Math.max(insets.bottom, 8) + 10 }]}>
        <TabButton label={t('Accueil')} icon="home" on={tab === 'home'} onPress={() => setTab('home')} />
        <TabButton label={t('Réglages')} icon="gear" on={tab === 'settings'} onPress={() => setTab('settings')} />
      </View>

      <SheetView sheet={sheet} bottom={insets.bottom} onClose={() => setSheet(null)}>
        {sheet?.kind === 'grade' ? (
          <Choices
            title={t('Classe')}
            hint={t('{name} parle et explique au niveau de {child}.', { name: TUTOR_NAME, child: sheet.child.name })}
            options={GRADES.map((g) => ({ value: g.value, label: t(g.label) }))}
            value={sheet.child.grade ?? 1}
            onChange={(grade) => {
              setSheet(null);
              updateChild(sheet.child.id, { grade });
            }}
          />
        ) : sheet?.kind === 'lang' ? (
          <Choices
            title={t('Langue de {name}', { name: TUTOR_NAME })}
            hint={t('La langue dans laquelle {name} parle à {child}. Le Tableau change tout de suite.', { name: TUTOR_NAME, child: sheet.child.name })}
            options={LANGUAGES.map((l) => ({ value: l.value, label: t(l.label), sub: t(l.hint) }))}
            value={sheet.child.tutor_language ?? 'auto'}
            onChange={(tutor_language) => {
              setSheet(null);
              updateChild(sheet.child.id, { tutor_language });
            }}
          />
        ) : sheet?.kind === 'name' ? (
          <NameEdit
            name={sheet.child.name}
            onSave={(name) => {
              setSheet(null);
              updateChild(sheet.child.id, { name });
            }}
          />
        ) : sheet?.kind === 'device' ? (
          <View style={{ gap: space.md }}>
            <Text style={styles.sheetTitle}>
              {ROLE[sheet.device.role].icon} {t(ROLE[sheet.device.role].title)}
              {sheet.device.name ? ` · ${sheet.device.name}` : ''}
            </Text>
            <Text style={styles.sub}>{t('Relié le {date}. Retiré, il devra être relié à nouveau avec un code.', { date: shortDate(sheet.device.created_at) })}</Text>
            <Button label={t('Retirer cet appareil')} variant="secondary" onPress={() => revoke(sheet.device.id)} />
          </View>
        ) : sheet?.kind === 'add' ? (
          <View style={{ gap: space.md }}>
            <Text style={styles.sheetTitle}>{t('Lier un appareil')}</Text>
            <Text style={styles.sub}>{t('Un code s’affiche ici : tape-le sur l’autre appareil, dans l’app Silia.')}</Text>
            <View style={styles.group}>
              {(['board', 'camera'] as const).map((role, i) => {
                const blocked = role === 'camera' && hasCamera;
                return (
                  <Row
                    key={role}
                    first={i === 0}
                    icon={ROLE[role].icon}
                    title={t(ROLE[role].title)}
                    sub={t(blocked ? 'Une caméra est déjà reliée (une seule par famille)' : ROLE[role].hint)}
                    onPress={blocked ? undefined : () => addDevice(role)}
                  />
                );
              })}
            </View>
          </View>
        ) : sheet?.kind === 'appLang' ? (
          <Choices
            title={t("Langue de l'app")}
            hint={t('Boutons et écrans de l’app, sur tous les appareils de la famille. Silia garde sa propre langue.')}
            options={APP_LANGS.map((l) => ({ value: l.value, label: l.value === 'system' ? `${t(l.label)} · ${APP_LANGS.find((x) => x.value === systemLang())?.label}` : l.label }))}
            value={appLangSetting}
            onChange={async (lang) => {
              setSheet(null);
              // For the whole family: the Board and the Camera follow (they reload in that language).
              const { error: e } = await supabase.from('households').update({ app_lang: lang }).eq('id', household.id);
              if (e) setError(e.message);
              setAppLang(lang);
            }}
          />
        ) : null}
      </SheetView>
    </SafeAreaView>
  );
}

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/** One line of a grouped list: icon, title (+ small text), value or control, chevron when it opens something. */
function Row({
  icon,
  title,
  sub,
  value,
  right,
  onPress,
  first = false,
  danger = false,
}: {
  icon?: string;
  title: string;
  sub?: string;
  value?: string;
  right?: ReactNode;
  onPress?: () => void;
  first?: boolean;
  danger?: boolean;
}) {
  const body = (
    <>
      {icon ? <Text style={styles.rowIcon}>{icon}</Text> : null}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.rowLabel, danger && { color: colors.danger }]} numberOfLines={1}>
          {title}
        </Text>
        {sub ? <Text style={styles.rowSub}>{sub}</Text> : null}
      </View>
      {value ? (
        <Text style={styles.rowValue} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {right}
      {onPress && !right && !danger ? <Text style={styles.chevron}>›</Text> : null}
    </>
  );
  return (
    <View>
      {first ? null : <View style={styles.sep} />}
      {onPress ? (
        <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }]}>
          {body}
        </Pressable>
      ) : (
        <View style={styles.row}>{body}</View>
      )}
    </View>
  );
}

function Switch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      onPress={() => onChange(!on)}
      style={[styles.switch, { backgroundColor: on ? colors.success : colors.bg }]}
    >
      <View style={[styles.knob, on ? { right: 3 } : { left: 3, backgroundColor: colors.muted }]} />
    </Pressable>
  );
}

function TabButton({ label, icon, on, onPress }: { label: string; icon: 'home' | 'gear'; on: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={onPress} style={styles.tab}>
      <Icon name={icon} size={24} color={on ? colors.accent : colors.muted} />
      <Text style={[styles.tabText, on && { color: colors.accent, fontWeight: '900' }]}>{label}</Text>
    </Pressable>
  );
}

/** One choice = one sheet from the bottom. */
function SheetView({ sheet, bottom, onClose, children }: { sheet: Sheet; bottom: number; onClose: () => void; children: ReactNode }) {
  return (
    <Modal visible={!!sheet} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Fermer')} onPress={onClose} style={styles.backdrop} />
      <View style={[styles.sheet, { paddingBottom: Math.max(bottom, 8) + space.lg }]}>
        <View style={styles.handle} />
        {children}
        <Button label={t('Fermer')} variant="ghost" onPress={onClose} />
      </View>
    </Modal>
  );
}

function Choices<T extends string | number>({
  title,
  hint,
  options,
  value,
  onChange,
}: {
  title: string;
  hint: string;
  options: { value: T; label: string; sub?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={{ gap: space.md }}>
      <Text style={styles.sheetTitle}>{title}</Text>
      <Text style={styles.sub}>{hint}</Text>
      <View style={styles.group}>
        {options.map((o, i) => (
          <View key={String(o.value)}>
            {i ? <View style={styles.sep} /> : null}
            <Pressable
              accessibilityRole="radio"
              accessibilityState={{ selected: o.value === value }}
              onPress={() => onChange(o.value)}
              style={({ pressed }) => [styles.row, pressed && { opacity: 0.75 }]}
            >
              <View style={[styles.radio, o.value === value && styles.radioOn]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{o.label}</Text>
                {o.sub ? <Text style={styles.rowSub}>{o.sub}</Text> : null}
              </View>
            </Pressable>
          </View>
        ))}
      </View>
    </View>
  );
}

function NameEdit({ name, onSave }: { name: string; onSave: (name: string) => void }) {
  const [value, setValue] = useState(name);
  const ok = value.trim().length > 0 && value.trim() !== name;
  return (
    <View style={{ gap: space.md }}>
      <Text style={styles.sheetTitle}>{t('Prénom')}</Text>
      <TextInput value={value} onChangeText={setValue} autoFocus maxLength={40} style={styles.input} placeholder={t('Prénom')} placeholderTextColor={colors.muted} />
      <Button label={t('Enregistrer')} onPress={() => ok && onSave(value.trim())} disabled={!ok} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, paddingBottom: space.xl, gap: space.md, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: colors.accent,
    color: colors.onAccent,
    fontSize: 20,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 44,
  },
  family: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  hello: { color: colors.text, fontSize: 22, fontWeight: '900' },
  pageTitle: { color: colors.text, fontSize: 28, fontWeight: '900', marginTop: space.sm },
  start: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.accent, borderRadius: radius.lg, paddingVertical: 20, paddingHorizontal: 18 },
  startIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(27,35,64,0.12)', alignItems: 'center', justifyContent: 'center' },
  startTitle: { color: colors.onAccent, fontSize: 20, fontWeight: '900' },
  startSub: { color: colors.onAccent, fontSize: 14, fontWeight: '700' },
  caption: { color: colors.muted, fontSize: 13, fontWeight: '900', letterSpacing: 1, paddingHorizontal: 4, marginTop: space.xs },
  group: { backgroundColor: colors.surface, borderRadius: 20, overflow: 'hidden' },
  pad: { padding: space.md, gap: space.md },
  rowBetween: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: '900' },
  sub: { color: colors.muted, fontSize: 14, lineHeight: 19 },
  stats: { flexDirection: 'row', gap: space.sm },
  stat: { flex: 1, backgroundColor: colors.bg, borderRadius: 14, paddingVertical: 10, alignItems: 'center' },
  statValue: { fontSize: 24, fontWeight: '900' },
  statLabel: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  report: { color: colors.text, fontSize: 15, lineHeight: 21 },
  link: { color: colors.accent, fontSize: 14, fontWeight: '900' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: space.md, minHeight: 52 },
  rowIcon: { fontSize: 20, width: 28, textAlign: 'center' },
  rowLabel: { color: colors.text, fontSize: 16, fontWeight: '800' },
  rowSub: { color: colors.muted, fontSize: 12, fontWeight: '700', lineHeight: 16, marginTop: 2 },
  rowValue: { color: colors.muted, fontSize: 15, fontWeight: '800', maxWidth: 140 },
  chevron: { color: colors.muted, fontSize: 24, fontWeight: '900' },
  sep: { height: 1, backgroundColor: colors.bg, marginLeft: 56 },
  addDevice: { height: 52, borderRadius: 18, borderWidth: 2, borderStyle: 'dashed', borderColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  addDeviceText: { color: colors.accent, fontSize: 15, fontWeight: '900' },
  codeCard: { alignItems: 'center', gap: space.sm, padding: space.md, borderWidth: 2, borderColor: colors.accent },
  codeLabel: { color: colors.text, fontSize: 17, fontWeight: '800' },
  code: { color: colors.accent, fontSize: 52, fontWeight: '900', letterSpacing: 6 },
  switch: { width: 50, height: 30, borderRadius: 15, justifyContent: 'center' },
  knob: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: '#FFFFFF' },
  tabs: { flexDirection: 'row', backgroundColor: '#141B33', paddingTop: 8, paddingBottom: 18 },
  tab: { flex: 1, alignItems: 'center', gap: 2 },
  tabText: { color: colors.muted, fontSize: 12, fontWeight: '800' },
  backdrop: { flex: 1, backgroundColor: 'rgba(10,14,30,0.6)' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: space.lg, paddingBottom: space.xl, gap: space.md },
  handle: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.surfaceHigh, alignSelf: 'center' },
  sheetTitle: { color: colors.text, fontSize: 22, fontWeight: '900' },
  radio: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: colors.muted },
  radioOn: { borderWidth: 7, borderColor: colors.accent },
  input: { backgroundColor: colors.surface, color: colors.text, borderRadius: 14, paddingHorizontal: space.md, minHeight: 50, fontSize: 18, fontWeight: '800' },
});
