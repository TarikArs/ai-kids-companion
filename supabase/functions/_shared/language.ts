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

/**
 * Silia talks to a little girl: very, very easy everyday words, short sentences, no hard school words (or explained in
 * easy words), and lovely, concrete examples. Added to every prompt that writes something she hears.
 */
export const KID_WORDS =
  'very, very easy everyday words that a little girl knows, short sentences (max 10 words), one idea per sentence; ' +
  'no difficult school words (if one is in her exercise, say what it means with easy words); ' +
  'when an example helps, its objects can be lovely things she knows (kittens, little birds, teddy bears, flowers, apples, ' +
  'cupcakes), but ONLY as the real objects of the example (« 3 paniers de 4 pommes : 4, 8, 12 pommes »), never an animal ' +
  'that just "shows" or "says" something; if no such object fits naturally, use none; every sentence must make sense on its own; ' +
  'never start with your name or « Silia est là »; warm and gentle, like a kind big sister';

/** How the tutor must write, given to the model. The child is a girl: feminine forms in Arabic. */
export const SPEAKING_STYLE: Record<Lang, string> = {
  fr: `French, with ${KID_WORDS}`,
  ar: `Moroccan Darija (not Modern Standard Arabic), written in Arabic script, speaking to a girl (feminine forms), with ${KID_WORDS}`,
  fus: `simple Modern Standard Arabic (Fusha) in Arabic script, speaking to a girl (feminine forms), with ${KID_WORDS}`,
  en: `English, with ${KID_WORDS}`,
};

export type PhraseKind = 'praise' | 'encourage' | 'hint' | 'explain' | 'filler' | 'greeting' | 'pause' | 'resume' | 'end' | 'ask' | 'read_good' | 'nudge';

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
    nudge: ['Tu es là ? Je t’attends.', 'Tu as besoin d’aide ? Appuie sur Expliquer.', 'Prends ton temps, je suis là.'],
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
    nudge: ['واش نتي هنا؟ أنا كنتسناك.', 'خاصك شي مساعدة؟ ورّكي على شرح.', 'خدي الوقت ديالك، أنا هنا.'],
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
    nudge: ['هل أنتِ هنا؟ أنا أنتظركِ.', 'هل تحتاجين مساعدة؟ اضغطي على اشرحي.', 'خذي وقتكِ، أنا هنا.'],
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
    nudge: ['Are you there? I am waiting for you.', 'Do you need help? Press Explain.', 'Take your time, I am here.'],
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

/** Verdicts and the exercise choice: fixed sentences (no AI), cached as audio after the first time. */
export const VERDICT_TEXT: Record<
  Lang,
  {
    allGood: string;
    rightPrefix: (n: number) => string;
    unsure: (q: string, a: string) => string;
    notStarted: (n: string) => string;
    pick: (count: number, n: string) => string;
    next: (n: string) => string;
    guide: string;
    practiceDone: string;
    solution: string;
    solutionOff: string;
  }
> = {
  fr: {
    allGood: 'Tout est juste, bravo !',
    rightPrefix: (n) => (n === 1 ? 'Une juste, bravo !' : `${n} justes, bravo !`),
    unsure: (q, a) => `Je lis « ${a} » pour ${q}. C’est bien ça ? Dis-le-moi ou écris-le.`,
    notStarted: (n) => `Tu n’as pas encore commencé l’exercice ${n}. Tu veux que je te l’explique ?`,
    pick: (c, n) => `Je vois ${c} exercices sur ta page. On commence par le ${n} ?`,
    next: (n) => `Quand tu veux, on passe à l’exercice ${n}.`,
    guide: 'Dis-moi ta réponse, ou écris-la.',
    practiceDone: 'Bravo, l’exercice similaire est tout juste ! Quand tu veux, montre-moi ta page.',
    solution: 'Voici les bonnes réponses, écrites au tableau.',
    solutionOff: 'La solution n’est pas activée. Demande à papa ou maman.',
  },
  ar: {
    allGood: 'كلشي صحيح، برافو عليك!',
    rightPrefix: (n) => (n === 1 ? 'وحدة صحيحة، برافو!' : `${n} صحاح، برافو!`),
    unsure: (q, a) => `كنقرا «${a}» ف ${q}. واش هادشي اللي كتبتي؟ قوليها ليا ولا كتبيها.`,
    notStarted: (n) => `مازال ما بديتي التمرين ${n}. بغيتي نشرحو ليك؟`,
    pick: (c, n) => `كنشوف ${c} ديال التمارين فالصفحة ديالك. نبداو بالتمرين ${n}؟`,
    next: (n) => `ملي تبغي، ندوزو للتمرين ${n}.`,
    guide: 'قولي ليا الجواب ديالك، ولا كتبيه.',
    practiceDone: 'برافو، التمرين اللي بحالو كلو صحيح! ملي تبغي، ورّيني الصفحة ديالك.',
    solution: 'ها هي الأجوبة الصحيحة، مكتوبة فالسبورة.',
    solutionOff: 'الحل ما مفعّلش. طلبي من بابا ولا ماما.',
  },
  fus: {
    allGood: 'كل الأجوبة صحيحة، أحسنتِ!',
    rightPrefix: (n) => (n === 1 ? 'جواب صحيح، أحسنتِ!' : `${n} أجوبة صحيحة، أحسنتِ!`),
    unsure: (q, a) => `أقرأ «${a}» في ${q}. هل هذا ما كتبتِ؟ قوليه لي أو اكتبيه.`,
    notStarted: (n) => `لم تبدئي التمرين ${n} بعد. هل تريدين أن أشرحه لكِ؟`,
    pick: (c, n) => `أرى ${c} تمارين في صفحتكِ. هل نبدأ بالتمرين ${n}؟`,
    next: (n) => `عندما تكونين مستعدة، ننتقل إلى التمرين ${n}.`,
    guide: 'قولي لي جوابكِ، أو اكتبيه.',
    practiceDone: 'أحسنتِ، التمرين المشابه كله صحيح! عندما تريدين، أريني صفحتكِ.',
    solution: 'هذه هي الأجوبة الصحيحة، مكتوبة على السبورة.',
    solutionOff: 'الحل غير مفعّل. اطلبي من أبيكِ أو أمكِ.',
  },
  en: {
    allGood: 'Everything is right, well done!',
    rightPrefix: (n) => (n === 1 ? 'One right, well done!' : `${n} right, well done!`),
    unsure: (q, a) => `I read “${a}” for ${q}. Is that right? Say it or type it.`,
    notStarted: (n) => `You haven’t started exercise ${n} yet. Shall I explain it?`,
    pick: (c, n) => `I can see ${c} exercises on your page. Shall we start with number ${n}?`,
    next: (n) => `When you are ready, let’s go to exercise ${n}.`,
    guide: 'Tell me your answer, or type it.',
    practiceDone: 'Well done, the practice exercise is all right! Show me your page when you are ready.',
    solution: 'Here are the right answers, written on the board.',
    solutionOff: 'The solution is turned off. Ask mum or dad.',
  },
};

/**
 * « Bravo ! » -> « Bravo Lina ! »: the child's first name in the first cheer of a sentence Silia makes now (never in the
 * familiar phrases recorded once for everyone).
 */
export function withName(text: string, name: string | null | undefined, lang: Lang): string {
  if (!name) return text;
  const cheer: Record<Lang, RegExp> = {
    fr: /(bravo|super)(\s*[!,.])/i,
    en: /(well done|great job)(\s*[!,.])/i,
    fus: /(أحسنتِ)(\s*[!،.])/,
    ar: /(برافو(?: عليك)?)(\s*[!،.])/,
  };
  return text.replace(cheer[lang], (_m, word: string, end: string) =>
    lang === 'en' ? `${word}, ${name}${end.trim()}` : isArabic(lang) ? `${word} يا ${name}${end}` : `${word} ${name}${end}`,
  );
}

type Act = 'explain' | 'solve' | 'correct' | 'similar' | 'solution';
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
    /** A hand or object hides the page. */
    hand: string;
    noExercise: string;
    askWhich: (action: Act | null) => string;
    notFound: (missing: number, available: string[]) => string;
    askAction: (n: string, title: string) => string;
  }
> = {
  fr: {
    noPhoto: 'Je n’ai pas encore de photo de ta page. Appuie sur « Silia, regarde ».',
    unreadable: 'Je ne vois pas bien la page : elle est trop sombre, floue ou coupée. Reprends une photo bien droite, avec de la lumière.',
    hand: 'Oh, une main cache la page ! Enlève-la doucement et appuie encore sur « Silia, regarde ».',
    noExercise: 'Je ne trouve pas d’exercice sur cette photo. Montre-moi la page de plus près.',
    askWhich: (a) =>
      `Quel exercice ${a === 'solve' ? 'veux-tu qu’on résolve ensemble' : a === 'correct' ? 'veux-tu que je corrige' : a === 'similar' ? 'veux-tu refaire avec un exercice pareil' : a === 'solution' ? 'veux-tu la solution' : 'veux-tu que je t’explique'} ? Dis son numéro ou touche-le.`,
    notFound: (m, av) => `Je ne vois pas l’exercice ${m} sur la photo. Je vois ${av.length > 1 ? 'les exercices' : 'l’exercice'} ${list('fr', av)}. Lequel veux-tu ?`,
    askAction: (n, t) => `D’accord, l’exercice ${n} : ${t}. Je te l’explique, on le résout ensemble, ou je le corrige ?`,
  },
  ar: {
    noPhoto: 'مازال ما عنديش تصويرة ديال الصفحة. ورّكي على «سيليا، شوفي».',
    unreadable: 'ما كنشوفش الصفحة مزيان: ظلمة ولا مضبّبة ولا مقطوعة. صوّري مرة أخرى مقابلة ومع الضو.',
    hand: 'اليد مخبّية الصفحة! بعّديها شوية وعاودي ضغطي على « سيليا، شوفي ».',
    noExercise: 'ما لقيتش تمرين فهاد التصويرة. قرّبي ليا الصفحة.',
    askWhich: (a) =>
      `شمن تمرين ${a === 'solve' ? 'بغيتي نحلّوه مع بعض' : a === 'correct' ? 'بغيتي نصحّح ليك' : a === 'similar' ? 'بغيتي نعطيك بحالو' : a === 'solution' ? 'بغيتي الحل ديالو' : 'بغيتي نشرح ليك'}؟ قولي الرقم ديالو ولا ورّكي عليه.`,
    notFound: (m, av) => `ما كنشوفش التمرين ${m} فالتصويرة. كنشوف ${list('ar', av)}. شمن واحد بغيتي؟`,
    askAction: (n, t) => `واخا، التمرين ${n}: ${t}. نشرحو ليك، نحلّوه مع بعض، ولا نصحّحو ليك؟`,
  },
  fus: {
    noPhoto: 'ليست لديّ صورة لصفحتكِ بعد. اضغطي على «سيليا، انظري».',
    unreadable: 'لا أرى الصفحة جيدًا: إنها مظلمة أو غير واضحة أو مقطوعة. التقطي صورة أخرى مستقيمة وفي الضوء.',
    hand: 'يدٌ تُخفي الصفحة! أبعديها قليلًا واضغطي مرة أخرى على « سيليا، انظري ».',
    noExercise: 'لا أجد تمرينًا في هذه الصورة. قرّبي الصفحة قليلًا.',
    askWhich: (a) =>
      `أيّ تمرين ${a === 'solve' ? 'تريدين أن نحلّه معًا' : a === 'correct' ? 'تريدين أن أصحّحه' : a === 'similar' ? 'تريدين تمرينًا مشابهًا له' : a === 'solution' ? 'تريدين حلّه' : 'تريدين أن أشرحه لكِ'}؟ قولي رقمه أو المسيه.`,
    notFound: (m, av) => `لا أرى التمرين ${m} في الصورة. أرى ${av.length > 1 ? 'التمارين' : 'التمرين'} ${list('fus', av)}. أيّها تريدين؟`,
    askAction: (n, t) => `حسنًا، التمرين ${n}: ${t}. هل أشرحه لكِ، أم نحلّه معًا، أم أصحّحه؟`,
  },
  en: {
    noPhoto: 'I don’t have a photo of your page yet. Press “Silia, look”.',
    unreadable: 'I can’t see the page well: it is too dark, blurry or cut off. Take another photo, straight and in the light.',
    hand: 'Oh, a hand is hiding the page! Move it away and press « Silia, look » again.',
    noExercise: 'I can’t find an exercise on this photo. Show me the page closer.',
    askWhich: (a) =>
      `Which exercise ${a === 'solve' ? 'shall we solve together' : a === 'correct' ? 'should I correct' : a === 'similar' ? 'do you want a similar one for' : a === 'solution' ? 'do you want the answers for' : 'should I explain'}? Say its number or tap it.`,
    notFound: (m, av) => `I can’t see exercise ${m} on the photo. I can see exercise${av.length > 1 ? 's' : ''} ${list('en', av)}. Which one?`,
    askAction: (n, t) => `OK, exercise ${n}: ${t}. Shall I explain it, solve it with you, or correct it?`,
  },
};
