import type { DeviceRole, SessionSummary } from '@hc/shared';
import { router } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { FocusPressable as Pressable } from '@/components/focus-pressable';
import { Icon } from '@/components/icons';
import { Chunky, HandCaption, NotebookPage, PaperSwitch, Polaroid, Spiral, StickyTabs } from '@/components/paper';
import { Avatar } from '@/features/board/avatar';
import { font, hardShadow, paper } from '@/lib/paper-theme';
import { StatusBar } from 'expo-status-bar';
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
      <StatusBar style="dark" />
      <Spiral />
      <StickyTabs
        tabs={[
          { key: 'home', label: t('Accueil'), icon: 'home', color: paper.stickyYellow },
          { key: 'settings', label: t('Réglages'), icon: 'gear', color: paper.stickyBlue },
        ]}
        value={tab}
        onChange={setTab}
      />
      <NotebookPage fill top={20} style={styles.page}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 48 }]} keyboardShouldPersistTaps="handled">
        {tab === 'home' ? (
          <>
            <View style={styles.header}>
              <Polaroid caption={TUTOR_NAME} width={92} tilt={-5} clip={false}>
                <Avatar mood="idle" />
              </Polaroid>
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
            <Chunky onPress={startHomework} color="yellow" depth={6} radius={20} style={styles.start}>
              <View style={styles.startIcon}>
                <Icon name="camera" size={30} color={paper.ink} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.startTitle}>{t('Commencer les devoirs')}</Text>
                <Text style={styles.startSub}>
                  {child ? t('Avec {name} · ', { name: child.name }) : ''}
                  {t(soloOn ? 'ce téléphone fait tout' : 'ce téléphone devient la Caméra')}
                </Text>
              </View>
              <Text style={[styles.chevron, { color: paper.ink }]}>➜</Text>
            </Chunky>

            {report ? (
              <>
                <HandCaption>{t('DERNIÈRE SÉANCE')}</HandCaption>
                <View style={[styles.group, styles.pad]}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.rowTitle}>{capital(longDate(report.started_at))}</Text>
                    <Text style={styles.sub}>{report.summary.minutes} min</Text>
                  </View>
                  <View style={styles.stats}>
                    <Stat value={report.summary.right} label={t('justes')} color="#1E8E4E" note={paper.stickyGreen} tilt={-2} />
                    <Stat value={report.summary.wrong} label={t('à revoir')} color="#D63B30" note={paper.stickyPink} tilt={1.5} />
                    <Stat value={report.summary.answers} label={t('vérifiées')} color={paper.ink} note={paper.stickyBlue} tilt={-1} />
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

            <HandCaption>{t('APPAREILS')}</HandCaption>
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
                  <HandCaption>{c.name.toUpperCase()}</HandCaption>
                  <View style={styles.group}>
                    <Row first icon="🎒" title={t('Classe')} value={t(GRADES.find((g) => g.value === (c.grade ?? 1))?.label ?? '')} onPress={() => setSheet({ kind: 'grade', child: c })} />
                    <Row icon="✏️" title={t('Prénom')} value={c.name} onPress={() => setSheet({ kind: 'name', child: c })} />
                    <Row icon="🗣️" title={t('Langue de {name}', { name: TUTOR_NAME })} sub={t(lang.hint)} value={t(lang.label)} onPress={() => setSheet({ kind: 'lang', child: c })} />
                  </View>
                </View>
              );
            })}

            <HandCaption>{TUTOR_NAME.toUpperCase()}</HandCaption>
            <View style={styles.group}>
              <Row
                first
                icon="🔊"
                title={t('Voix de {name}', { name: TUTOR_NAME })}
                sub={t(voiceOn === false ? 'Coupée : texte seulement, aucun crédit ElevenLabs' : 'Activée : les phrases déjà dites sont gratuites')}
                right={voiceOn === null ? null : <Switch on={voiceOn} onChange={(on) => setHouseholdFlag('voice_enabled', on)} />}
              />
            </View>

            <HandCaption>{t('UTILISATION')}</HandCaption>
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

            <HandCaption>{t('APPLICATION')}</HandCaption>
            <View style={styles.group}>
              <Row
                first
                icon="🌐"
                title={t("Langue de l'app")}
                value={appLangSetting === 'system' ? t('Langue du téléphone') : APP_LANGS.find((l) => l.value === appLangSetting)?.label}
                onPress={() => setSheet({ kind: 'appLang' })}
              />
            </View>

            <HandCaption>{t('COMPTE')}</HandCaption>
            <View style={styles.group}>
              {email ? <Row first icon="✉️" title={email} /> : null}
              <Row first={!email} title={t('Se déconnecter')} danger onPress={onSignOut} />
            </View>
            <ErrorText>{error}</ErrorText>
          </>
        )}
      </ScrollView>
      </NotebookPage>

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

function Stat({ value, label, color, note, tilt }: { value: number; label: string; color: string; note: string; tilt: number }) {
  return (
    <View style={[styles.stat, { backgroundColor: note, transform: [{ rotate: `${tilt}deg` }] }]}>
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
        <Text style={[styles.rowLabel, danger && { color: '#D63B30' }]} numberOfLines={1}>
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
  return <PaperSwitch on={on} onChange={onChange} />;
}

/** One choice = one sheet from the bottom. */
function SheetView({ sheet, bottom, onClose, children }: { sheet: Sheet; bottom: number; onClose: () => void; children: ReactNode }) {
  return (
    <Modal visible={!!sheet} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Fermer')} onPress={onClose} style={styles.backdrop} />
      <View style={[styles.sheet, { paddingBottom: Math.max(bottom, 8) + space.lg }]}>
        <Spiral rings={9} />
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
      <TextInput value={value} onChangeText={setValue} autoFocus maxLength={40} style={styles.input} placeholder={t('Prénom')} placeholderTextColor={paper.inkFaint} />
      <Button label={t('Enregistrer')} onPress={() => ok && onSave(value.trim())} disabled={!ok} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: paper.page },
  page: { borderTopWidth: 2, borderColor: paper.ink },
  content: { paddingLeft: 46, paddingRight: 20, paddingTop: space.lg, gap: space.md, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.xs },
  family: { ...font.medium, color: paper.inkSoft, fontSize: 15 },
  hello: { ...font.bold, color: paper.ink, fontSize: 30 },
  pageTitle: { ...font.bold, color: paper.ink, fontSize: 32, marginTop: space.xs },
  start: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: 18, paddingHorizontal: 16, marginVertical: space.sm },
  startIcon: { width: 54, height: 54, borderRadius: 27, borderWidth: 2.5, borderColor: paper.ink, backgroundColor: paper.card, alignItems: 'center', justifyContent: 'center' },
  startTitle: { ...font.bold, color: paper.ink, fontSize: 22 },
  startSub: { ...font.medium, color: paper.ink, fontSize: 14 },
  caption: { ...font.hand, color: paper.blueInk, fontSize: 24 },
  group: { backgroundColor: paper.card, borderRadius: 10, borderWidth: 2, borderColor: paper.ink, ...hardShadow(4) },
  pad: { padding: space.md, gap: space.md },
  rowBetween: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
  rowTitle: { ...font.bold, color: paper.ink, fontSize: 17 },
  sub: { ...font.regular, color: paper.inkSoft, fontSize: 15, lineHeight: 20 },
  stats: { flexDirection: 'row', gap: space.sm, paddingVertical: 4 },
  stat: { flex: 1, borderWidth: 2, borderColor: paper.ink, borderRadius: 3, borderBottomRightRadius: 12, paddingVertical: 10, alignItems: 'center', ...hardShadow(3) },
  statValue: { ...font.bold, fontSize: 28 },
  statLabel: { ...font.semi, color: paper.ink, fontSize: 13 },
  report: { ...font.regular, color: paper.ink, fontSize: 16, lineHeight: 23 },
  link: { ...font.semi, color: paper.blueInk, fontSize: 15, textDecorationLine: 'underline' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: space.md, minHeight: 56 },
  rowIcon: { fontSize: 22, width: 30, textAlign: 'center' },
  rowLabel: { ...font.semi, color: paper.ink, fontSize: 17 },
  rowSub: { ...font.regular, color: paper.inkSoft, fontSize: 13, lineHeight: 17, marginTop: 2 },
  rowValue: { ...font.semi, color: paper.blueInk, fontSize: 16, maxWidth: 150 },
  chevron: { ...font.bold, color: paper.ink, fontSize: 20 },
  sep: { borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: '#C9D6E3', marginLeft: 58 },
  addDevice: { height: 54, borderRadius: 12, borderWidth: 2.5, borderStyle: 'dashed', borderColor: paper.ink, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.6)' },
  addDeviceText: { ...font.semi, color: paper.ink, fontSize: 16 },
  codeCard: { alignItems: 'center', gap: space.sm, padding: space.md, backgroundColor: paper.stickyYellow, borderRadius: 3, borderBottomRightRadius: 18, transform: [{ rotate: '-1deg' }] },
  codeLabel: { ...font.semi, color: paper.ink, fontSize: 18 },
  code: { ...font.bold, color: paper.ink, fontSize: 54, letterSpacing: 8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(45,49,66,0.45)' },
  sheet: {
    backgroundColor: paper.page,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 2,
    borderBottomWidth: 0,
    borderColor: paper.ink,
    paddingHorizontal: space.lg,
    paddingTop: 6,
    gap: space.md,
  },
  sheetTitle: { ...font.bold, color: paper.ink, fontSize: 24 },
  radio: { width: 26, height: 26, borderRadius: 13, borderWidth: 2.5, borderColor: paper.ink, backgroundColor: paper.card },
  radioOn: { borderWidth: 8, borderColor: paper.ink, backgroundColor: paper.yellow },
  input: {
    ...font.medium,
    backgroundColor: paper.card,
    color: paper.ink,
    borderWidth: 2,
    borderColor: paper.ink,
    borderRadius: 12,
    paddingHorizontal: space.md,
    minHeight: 54,
    fontSize: 19,
    boxShadow: 'inset 0px 3px 0px rgba(45,49,66,0.12)',
  },
});
