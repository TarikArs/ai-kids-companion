/** The tutor's name, in every language. */
export const TUTOR_NAME = 'Silia';

// Tutor language follows the exercise: French, Arabic (spoken as Moroccan Darija) or English.
// 'auto' on an Arabic page means standard Arabic (Fusha, 'fus'); Darija ('ar') only when the parent chooses it.

export type Lang = 'fr' | 'ar' | 'fus' | 'en';

/** Arabic script, right-to-left. */
export const isArabic = (l: Lang) => l === 'ar' || l === 'fus';

/** The child's setting wins; 'auto' (or missing) follows the exercise's language, Arabic pages in standard Arabic. */
export function tutorLang(setting: string | null | undefined, exerciseLang: string | null | undefined): Lang {
  if (setting && setting !== 'auto') return langOf(setting);
  const page = langOf(exerciseLang);
  return page === 'ar' ? 'fus' : page;
}

export const LANGUAGE_NAME: Record<Lang, string> = {
  fr: 'French',
  ar: 'Moroccan Darija (in Arabic script, not Modern Standard Arabic)',
  fus: 'Modern Standard Arabic (Fusha), simple and clear, in Arabic script',
  en: 'English',
};

export function langOf(code: string | undefined | null): Lang {
  const c = (code ?? '').toLowerCase();
  if (c === 'fus' || c === 'msa' || c === 'ar-msa') return 'fus';
  if (c.startsWith('ar')) return 'ar';
  if (c.startsWith('en')) return 'en';
  return 'fr';
}

/** How the tutor must write, given to the model. The child is a girl: feminine forms in Darija. */
export const SPEAKING_STYLE: Record<Lang, string> = {
  fr: 'simple French that a 6-year-old understands',
  ar: 'Moroccan Darija (not Modern Standard Arabic), written in Arabic script, simple words a 6-year-old in Morocco understands, speaking to a girl (feminine forms)',
  fus: 'simple Modern Standard Arabic (Fusha) in Arabic script, short clear words a young child understands, speaking to a girl (feminine forms)',
  en: 'simple English that a 6-year-old understands',
};

export type PhraseKind = 'praise' | 'encourage' | 'hint' | 'explain' | 'filler' | 'greeting' | 'pause' | 'resume' | 'end' | 'ask' | 'read_good';

/** "grade 3 (about 8 years old)": used in every prompt. 7 = collège. */
export function gradeLabel(grade: number | null | undefined): string {
  const g = Math.min(7, Math.max(1, Number(grade) || 1));
  return g === 7 ? 'middle school (collège, about 12-14 years old)' : `primary school year ${g} (about ${g + 5} years old)`;
}

/** Familiar phrases: generated once (warm-phrases) and replayed from the cache. */
export const PHRASES: Record<Lang, Record<PhraseKind, string[]>> = {
  fr: {
    praise: ['Bravo !', 'Super, c’est juste !', 'Très bien !', 'Génial, continue !', 'Oui, bien joué !'],
    encourage: ['Continue comme ça !', 'Tu travailles bien.', 'Je regarde, tu avances bien !'],
    hint: ['Regarde bien celui-ci. On vérifie ensemble ?'],
    explain: ['Lis bien la consigne avec moi, puis essaie le premier.'],
    filler: ['Hmm…', 'Je regarde…', 'Voyons voir…'],
    greeting: ['Bonjour ! Je suis Silia. Montre-moi ton cahier.'],
    pause: ['Pause. Je t’attends.'],
    resume: ['C’est reparti !'],
    end: ['Bravo ! Les devoirs sont finis.'],
    ask: ['Quel exercice veux-tu que je t’explique ? Touche son numéro.'],
    read_good: ['Bravo, tu as très bien lu !', 'Super lecture, continue !', 'Très bonne lecture !'],
  },
  ar: {
    praise: ['برافو عليك!', 'مزيان بزاف!', 'واعرة! كمّلي هكا.'],
    encourage: ['كمّلي، راك خدّامة مزيان.', 'زيدي هكا، برافو!'],
    hint: ['شوفي مزيان هادي. نحسبوها مع بعض؟'],
    explain: ['قراي معايا السؤال مزيان، ومن بعد جربي الأول.'],
    filler: ['ممم…', 'خليني نشوف…', 'تسناي شوية…'],
    greeting: ['السلام! أنا سيليا. ورّيني الكونّاش ديالك.'],
    pause: ['ريّحي شوية، أنا كنتسناك.'],
    resume: ['يالاه نكمّلو!'],
    end: ['سالينا! برافو عليك اليوم.'],
    ask: ['شمن تمرين بغيتي نشرح ليك؟ ورّكي على الرقم ديالو.'],
    read_good: ['برافو، قريتي مزيان بزاف!', 'واعرة القراية ديالك، كمّلي!'],
  },
  fus: {
    praise: ['أحسنتِ!', 'ممتاز!', 'رائع، استمري!'],
    encourage: ['استمري، أنتِ تعملين جيدًا.', 'أحسنتِ، واصلي هكذا!'],
    hint: ['انظري جيدًا إلى هذا. هل نتحقق معًا؟'],
    explain: ['لنقرأ السؤال معًا، ثم جربي الأول.'],
    filler: ['ممم…', 'دعيني أرى…', 'لحظة…'],
    greeting: ['مرحبًا! أنا سيليا. أريني دفترك.'],
    pause: ['استراحة. أنا في انتظارك.'],
    resume: ['هيا نكمل!'],
    end: ['أحسنتِ! انتهت الواجبات.'],
    ask: ['أي تمرين تريدين أن أشرحه لكِ؟ المسي رقمه.'],
    read_good: ['أحسنتِ، قراءة رائعة!', 'قراءة ممتازة، واصلي!'],
  },
  en: {
    praise: ['Well done!', 'Great job!', 'Yes, that’s right!'],
    encourage: ['Keep going!', 'You are doing great.'],
    hint: ['Look carefully at this one. Shall we check it together?'],
    explain: ['Let’s read the question together, then try the first one.'],
    filler: ['Hmm…', 'Let me look…', 'Let’s see…'],
    greeting: ['Hello! I’m Silia. Show me your notebook.'],
    pause: ['Pause. I’m waiting for you.'],
    resume: ['Here we go again!'],
    end: ['Well done! Homework is finished.'],
    ask: ['Which exercise should I explain? Tap its number.'],
    read_good: ['Great reading!', 'Lovely reading, keep going!'],
  },
};

/** Reading feedback when some words were misread: kind start, then the words to repeat. No AI needed. */
export function readingFix(lang: Lang, wordsToFix: string[]): string {
  const w = wordsToFix.join(lang === 'ar' || lang === 'fus' ? '، ' : ', ');
  switch (lang) {
    case 'ar':
      return `مزيان! ردّي البال لهاد الكلمة: ${w}. عاودي معايا: ${w}.`;
    case 'fus':
      return `أحسنتِ! انتبهي لهذه الكلمة: ${w}. كرّري معي: ${w}.`;
    case 'en':
      return `Good reading! Watch this word: ${w}. Say it with me: ${w}.`;
    default:
      return `C’est bien ! Attention à ${wordsToFix.length > 1 ? 'ces mots' : 'ce mot'} : ${w}. Répète après moi : ${w}.`;
  }
}

/** "Corriger" answers that are not familiar phrases (generated once, then cached by text). */
export const CHECK_TEXT: Record<Lang, { allGood: string; cannotCheck: string; noAnswer: string }> = {
  fr: {
    allGood: 'J’ai tout vérifié : tout est juste, bravo !',
    cannotCheck: 'Je ne peux pas vérifier cet exercice seule. Demande à papa ou maman de regarder avec toi.',
    noAnswer: 'Je ne vois pas encore de réponse. Écris ta réponse, puis appuie sur Corriger.',
  },
  ar: {
    allGood: 'شفت كلشي: كلشي صحيح، برافو عليك!',
    cannotCheck: 'ما نقدرش نصحح هاد التمرين بوحدي. طلبي من بابا ولا ماما يشوفو معاك.',
    noAnswer: 'مازال ما شفت حتى جواب. كتبي الجواب ديالك، ومن بعد ورّكي على صحّح.',
  },
  fus: {
    allGood: 'تحققتُ من كل شيء: كل الأجوبة صحيحة، أحسنتِ!',
    cannotCheck: 'لا أستطيع تصحيح هذا التمرين وحدي. اطلبي من أبيكِ أو أمكِ أن ينظرا معكِ.',
    noAnswer: 'لا أرى أي جواب بعد. اكتبي جوابكِ، ثم اضغطي على صحّح.',
  },
  en: {
    allGood: 'I checked everything: it is all correct, well done!',
    cannotCheck: 'I can’t check this exercise by myself. Ask mum or dad to look with you.',
    noAnswer: 'I don’t see an answer yet. Write your answer, then press Check.',
  },
};

type Act = 'explain' | 'solve' | 'correct';
const list = (lang: Lang, ns: string[]) => {
  if (ns.length <= 1) return ns.join('');
  const and = { fr: ' et ', ar: ' و', fus: ' و', en: ' and ' }[lang];
  return `${ns.slice(0, -1).join(isArabic(lang) ? '، ' : ', ')}${and}${ns[ns.length - 1]}`;
};

/** Exercise focus: fixed sentences (no AI), when something is missing or a choice is needed. */
export const FOCUS_TEXT: Record<
  Lang,
  {
    noPhoto: string;
    unreadable: string;
    noExercise: string;
    askWhich: (action: Act | null) => string;
    notFound: (missing: number, available: string[]) => string;
    askAction: (n: string, title: string) => string;
  }
> = {
  fr: {
    noPhoto: 'Je n’ai pas encore de photo de ta page. Montre-moi ton cahier, puis redis-moi.',
    unreadable: 'Je ne vois pas bien la page : elle est trop sombre, floue ou coupée. Reprends une photo bien droite, avec de la lumière.',
    noExercise: 'Je ne trouve pas d’exercice sur cette photo. Montre-moi la page de plus près.',
    askWhich: (a) =>
      `Quel exercice ${a === 'solve' ? 'veux-tu qu’on résolve ensemble' : a === 'correct' ? 'veux-tu que je corrige' : 'veux-tu que je t’explique'} ? Dis son numéro ou touche-le.`,
    notFound: (m, av) => `Je ne vois pas l’exercice ${m} sur la photo. Je vois ${av.length > 1 ? 'les exercices' : 'l’exercice'} ${list('fr', av)}. Lequel veux-tu ?`,
    askAction: (n, t) => `D’accord, l’exercice ${n} : ${t}. Je te l’explique, on le résout ensemble, ou je le corrige ?`,
  },
  ar: {
    noPhoto: 'مازال ما عنديش تصويرة ديال الصفحة. ورّيني الكونّاش، ومن بعد عاودي ليا.',
    unreadable: 'ما كنشوفش الصفحة مزيان: ظلمة ولا مضبّبة ولا مقطوعة. صوّري مرة أخرى مقابلة ومع الضو.',
    noExercise: 'ما لقيتش تمرين فهاد التصويرة. قرّبي ليا الصفحة.',
    askWhich: (a) =>
      `شمن تمرين ${a === 'solve' ? 'بغيتي نحلّوه مع بعض' : a === 'correct' ? 'بغيتي نصحّح ليك' : 'بغيتي نشرح ليك'}؟ قولي الرقم ديالو ولا ورّكي عليه.`,
    notFound: (m, av) => `ما كنشوفش التمرين ${m} فالتصويرة. كنشوف ${list('ar', av)}. شمن واحد بغيتي؟`,
    askAction: (n, t) => `واخا، التمرين ${n}: ${t}. نشرحو ليك، نحلّوه مع بعض، ولا نصحّحو ليك؟`,
  },
  fus: {
    noPhoto: 'ليست لديّ صورة لصفحتكِ بعد. أريني دفتركِ، ثم أعيدي طلبكِ.',
    unreadable: 'لا أرى الصفحة جيدًا: إنها مظلمة أو غير واضحة أو مقطوعة. التقطي صورة أخرى مستقيمة وفي الضوء.',
    noExercise: 'لا أجد تمرينًا في هذه الصورة. قرّبي الصفحة قليلًا.',
    askWhich: (a) =>
      `أيّ تمرين ${a === 'solve' ? 'تريدين أن نحلّه معًا' : a === 'correct' ? 'تريدين أن أصحّحه' : 'تريدين أن أشرحه لكِ'}؟ قولي رقمه أو المسيه.`,
    notFound: (m, av) => `لا أرى التمرين ${m} في الصورة. أرى ${av.length > 1 ? 'التمارين' : 'التمرين'} ${list('fus', av)}. أيّها تريدين؟`,
    askAction: (n, t) => `حسنًا، التمرين ${n}: ${t}. هل أشرحه لكِ، أم نحلّه معًا، أم أصحّحه؟`,
  },
  en: {
    noPhoto: 'I don’t have a photo of your page yet. Show me your notebook, then ask me again.',
    unreadable: 'I can’t see the page well: it is too dark, blurry or cut off. Take another photo, straight and in the light.',
    noExercise: 'I can’t find an exercise on this photo. Show me the page closer.',
    askWhich: (a) =>
      `Which exercise ${a === 'solve' ? 'shall we solve together' : a === 'correct' ? 'should I correct' : 'should I explain'}? Say its number or tap it.`,
    notFound: (m, av) => `I can’t see exercise ${m} on the photo. I can see exercise${av.length > 1 ? 's' : ''} ${list('en', av)}. Which one?`,
    askAction: (n, t) => `OK, exercise ${n}: ${t}. Shall I explain it, solve it with you, or correct it?`,
  },
};
