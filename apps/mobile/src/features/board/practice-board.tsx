import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { t } from '@/lib/i18n';

export interface PracticeView {
  index: number;
  title: string;
  instr?: string;
  kind?: 'copy' | 'fill' | 'other';
  items: { q: string; m?: string; slots?: number }[];
  language: string;
}

const CHALK = '#F4F1E8';

/**
 * "Exercice similaire" written on the chalkboard, in the same layout as the notebook page:
 * copy = model letter then dotted slots; fill = the item with a dotted blank; other = numbered lines.
 */
export function PracticeBoard({ practice }: { practice: PracticeView }) {
  const rtl = practice.language === 'ar' || practice.language === 'fus';
  const dir = rtl ? styles.rtl : null;
  const blank = (q: string) => q.replace(/\?/g, ' ………… ');
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <Text style={[styles.tag, dir]}>{t('Exercice similaire')}</Text>
      <Text style={[styles.instr, dir]}>{practice.instr || practice.title}</Text>

      {practice.kind === 'copy'
        ? practice.items.map((it, i) => (
            <View key={i} style={[styles.copyRow, rtl && { flexDirection: 'row-reverse' }]}>
              <Text style={styles.model}>{it.m}</Text>
              {Array.from({ length: it.slots ?? 3 }, (_, k) => (
                <View key={k} style={styles.slot}>
                  <Text style={styles.dot}>·</Text>
                </View>
              ))}
            </View>
          ))
        : practice.items.map((it, i) => (
            <Text key={i} style={[styles.item, dir]}>
              {i + 1}. {practice.kind === 'fill' ? blank(it.q) : it.q}
            </Text>
          ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { alignSelf: 'stretch', flex: 1 },
  content: { padding: 24, gap: 18 },
  tag: { color: '#7FD3FF', fontSize: 16, fontWeight: '900', letterSpacing: 2, textTransform: 'uppercase' },
  instr: { color: CHALK, fontSize: 30, fontWeight: '800', lineHeight: 40 },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(244,241,232,0.25)',
    paddingBottom: 6,
    minHeight: 78,
  },
  model: { color: CHALK, fontSize: 52, fontWeight: '900', width: 90 },
  slot: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  dot: { color: CHALK, fontSize: 44, lineHeight: 52, fontWeight: '900' },
  item: { color: CHALK, fontSize: 32, fontWeight: '800', lineHeight: 44 },
  rtl: { writingDirection: 'rtl', textAlign: 'right' },
});
