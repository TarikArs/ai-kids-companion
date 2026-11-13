// Privacy policy and terms of use, shown in the app (/privacy, /terms) and on the web app.
// Draft written for the publisher; it must be reviewed by a lawyer before public launch.
// Keep it true: every sentence must match what the code does (retention: supabase/functions/purge-old,
// deletion: supabase/functions/delete-account, consent: features/parent/setup.tsx).

export const LEGAL_VERSION = '2026-11-11';
export const COMPANY = 'Due Intelegence';
export const COMPANY_PLACE = 'Arizona, USA';
export const CONTACT_EMAIL = 'aintelegence@kids.com';
export const RETENTION_DAYS = 30;

export type LegalDoc = { title: string; updated: string; intro: string; sections: { h: string; p: string[] }[] };
export type LegalKind = 'privacy' | 'terms';

const PRIVACY_FR: LegalDoc = {
  title: 'Politique de confidentialité',
  updated: 'Dernière mise à jour : 11 novembre 2026',
  intro:
    `Silia est une application d’aide aux devoirs pour les enfants de l’école primaire, publiée par ${COMPANY} (${COMPANY_PLACE}). ` +
    'Cette page explique quelles données nous utilisons, pourquoi, avec qui, combien de temps, et comment les supprimer.',
  sections: [
    {
      h: '1. Qui est responsable',
      p: [`${COMPANY}, ${COMPANY_PLACE}, est responsable des données traitées par Silia.`, `Pour toute question ou demande : ${CONTACT_EMAIL}.`],
    },
    {
      h: '2. Le parent d’abord',
      p: [
        'Seul un parent ou tuteur légal peut créer un compte. Un enfant ne crée pas de compte et ne donne aucune information lui-même.',
        'Avant la première utilisation, le parent confirme qu’il est le parent ou le tuteur de l’enfant et qu’il accepte cette politique et les conditions d’utilisation. Nous enregistrons la date de cet accord.',
        'L’enfant utilise Silia sur les appareils que le parent a reliés à son compte, sous sa responsabilité.',
      ],
    },
    {
      h: '3. Les données que nous utilisons',
      p: [
        'Compte du parent : adresse e-mail et mot de passe (le mot de passe est géré par notre prestataire d’authentification, nous ne le voyons pas).',
        'Famille et enfant : nom de famille choisi, prénom de l’enfant, classe, langues choisies, réglages (voix, Solution, un seul téléphone).',
        'Appareils reliés : nom de l’appareil (par exemple « Mac · Chrome »), rôle (Tableau ou Caméra), date de dernière connexion.',
        'Devoirs : les photos de la page prises dans l’application quand l’enfant appuie sur « Silia, regarde ».',
        'Ce que l’enfant dit ou écrit à Silia : la voix est envoyée pour être transformée en texte, puis seul le texte est gardé. Nous ne gardons pas l’enregistrement de la voix.',
        'Ce que Silia répond : messages, corrections, explications, exercices similaires.',
        'Bilans de séance : date, durée, nombre de réponses justes et à revoir, court texte pour le parent.',
        'Données techniques : temps de réponse, erreurs, modèle utilisé, signaux de qualité (par exemple « l’enfant a corrigé la lecture »).',
        'Nous ne collectons pas : la position, les contacts, les photos de la galerie, des données de publicité.',
      ],
    },
    {
      h: '4. Pourquoi',
      p: [
        'Lire la page, vérifier les réponses et guider l’enfant ; produire la voix de Silia ; montrer les bilans au parent ; relier et sécuriser les appareils ; corriger les erreurs et améliorer la qualité de Silia.',
        'Pas de publicité, pas de vente de données, pas de profil commercial de l’enfant.',
      ],
    },
    {
      h: '5. Intelligence artificielle',
      p: [
        'Silia est une IA. Elle peut mal lire une photo ou se tromper. Ses corrections sont une aide : vérifiez-les. Silia ne remplace ni l’enseignant ni le parent.',
        'Aucune décision importante concernant l’enfant (note, orientation, sanction) n’est prise automatiquement par Silia.',
      ],
    },
    {
      h: '6. Nos prestataires',
      p: [
        'Supabase : hébergement, base de données, stockage des photos, connexion.',
        'OpenAI : lecture des photos, vérification des réponses, transcription de la voix, rédaction des bilans. Selon les conditions de son API, les données envoyées par l’API ne servent pas par défaut à entraîner les modèles d’OpenAI.',
        'ElevenLabs : voix de Silia. Nous lui envoyons seulement le texte que Silia doit dire (il peut contenir le prénom de l’enfant), jamais la photo ni la voix de l’enfant.',
        'Ces prestataires peuvent traiter les données aux États-Unis ou dans d’autres pays. Nous leur envoyons seulement ce qui est nécessaire au service.',
      ],
    },
    {
      h: '7. Combien de temps',
      p: [
        `Photos, ce que l’enfant a dit ou écrit, messages de Silia et données techniques : supprimés automatiquement après ${RETENTION_DAYS} jours.`,
        'Compte, profil de l’enfant, réglages et bilans de séance : gardés tant que le compte existe.',
        'Quand le parent supprime le compte, toutes les données de la famille sont supprimées. Les sauvegardes de notre hébergeur sont effacées selon leur cycle normal.',
      ],
    },
    {
      h: '8. Qui voit les données',
      p: [
        'Les photos et messages sont dans un stockage privé. Seuls les parents de la famille et les appareils qu’ils ont reliés y ont accès.',
        'Les échanges sont chiffrés pendant le transport (HTTPS).',
      ],
    },
    {
      h: '9. Vos droits',
      p: [
        'Le parent peut à tout moment : voir les données, les corriger, demander une copie, retirer son accord, s’opposer à un traitement, et supprimer le compte (Réglages → Supprimer mon compte).',
        `Pour toute demande : ${CONTACT_EMAIL}. Nous répondons dans un délai de 30 jours.`,
        'Si vous habitez dans l’Union européenne ou au Royaume-Uni, vous pouvez aussi saisir votre autorité de protection des données ; au Maroc, la CNDP.',
      ],
    },
    {
      h: '10. Enfants de moins de 13 ans',
      p: [
        'Silia s’adresse à des enfants de moins de 13 ans. Nous ne collectons leurs informations qu’avec l’accord du parent, et seulement ce qui est utile au service.',
        'Le parent peut consulter les informations de son enfant, les faire supprimer et refuser que nous continuions à les collecter, en écrivant à l’adresse ci-dessus ou en supprimant le compte.',
      ],
    },
    {
      h: '11. Changements',
      p: ['Si cette politique change de façon importante, nous le dirons dans l’application avant que le changement s’applique.'],
    },
  ],
};

const PRIVACY_EN: LegalDoc = {
  title: 'Privacy policy',
  updated: 'Last updated: 11 November 2026',
  intro:
    `Silia is a homework-help app for primary-school children, published by ${COMPANY} (${COMPANY_PLACE}). ` +
    'This page explains what data we use, why, with whom, for how long, and how to delete it.',
  sections: [
    {
      h: '1. Who is responsible',
      p: [`${COMPANY}, ${COMPANY_PLACE}, is responsible for the data processed by Silia.`, `Questions or requests: ${CONTACT_EMAIL}.`],
    },
    {
      h: '2. Parents first',
      p: [
        'Only a parent or legal guardian can create an account. A child does not create an account and does not give any information directly.',
        'Before first use, the parent confirms they are the child’s parent or guardian and accepts this policy and the terms of use. We record the date of that consent.',
        'The child uses Silia on devices the parent has linked to their account, under the parent’s responsibility.',
      ],
    },
    {
      h: '3. The data we use',
      p: [
        'Parent account: email address and password (the password is handled by our sign-in provider; we never see it).',
        'Family and child: the family name you choose, the child’s first name, school grade, chosen languages, settings (voice, Solution, one phone).',
        'Linked devices: device name (for example “Mac · Chrome”), role (Board or Camera), last seen date.',
        'Homework: the photos of the page taken in the app when the child presses “Silia, look”.',
        'What the child says or types to Silia: the voice is sent to be turned into text, then only the text is kept. We do not keep the voice recording.',
        'What Silia answers: messages, corrections, explanations, similar exercises.',
        'Session summaries: date, duration, number of right answers and answers to review, a short text for the parent.',
        'Technical data: response times, errors, model used, quality signals (for example “the child corrected the reading”).',
        'We do not collect: location, contacts, photos from the gallery, advertising data.',
      ],
    },
    {
      h: '4. Why',
      p: [
        'To read the page, check the answers and guide the child; to produce Silia’s voice; to show summaries to the parent; to link and secure devices; to fix errors and improve Silia’s quality.',
        'No advertising, no sale of data, no commercial profile of the child.',
      ],
    },
    {
      h: '5. Artificial intelligence',
      p: [
        'Silia is an AI. She can misread a photo or make mistakes. Her corrections are a help: check them. Silia does not replace the teacher or the parent.',
        'Silia makes no significant decision about the child (grades, school choices, discipline) automatically.',
      ],
    },
    {
      h: '6. Our service providers',
      p: [
        'Supabase: hosting, database, photo storage, sign-in.',
        'OpenAI: reading photos, checking answers, transcribing the voice, writing summaries. Under its API terms, data sent through the API is not used to train OpenAI’s models by default.',
        'ElevenLabs: Silia’s voice. We send it only the text Silia must say (it may contain the child’s first name), never the photo or the child’s voice.',
        'These providers may process data in the United States or other countries. We send them only what the service needs.',
      ],
    },
    {
      h: '7. How long',
      p: [
        `Photos, what the child said or typed, Silia’s messages and technical data: deleted automatically after ${RETENTION_DAYS} days.`,
        'Account, child profile, settings and session summaries: kept while the account exists.',
        'When the parent deletes the account, all the family’s data is deleted. Our host’s backups are overwritten on their normal cycle.',
      ],
    },
    {
      h: '8. Who can see the data',
      p: [
        'Photos and messages are in private storage. Only the family’s parents and the devices they linked can access them.',
        'Data is encrypted in transit (HTTPS).',
      ],
    },
    {
      h: '9. Your rights',
      p: [
        'The parent can at any time: see the data, correct it, ask for a copy, withdraw consent, object to processing, and delete the account (Settings → Delete my account).',
        `Requests: ${CONTACT_EMAIL}. We answer within 30 days.`,
        'If you live in the European Union or the United Kingdom, you can also contact your data protection authority; in Morocco, the CNDP.',
      ],
    },
    {
      h: '10. Children under 13',
      p: [
        'Silia is meant for children under 13. We collect their information only with the parent’s consent, and only what the service needs.',
        'The parent can review the child’s information, have it deleted and refuse further collection, by writing to the address above or by deleting the account.',
      ],
    },
    {
      h: '11. Changes',
      p: ['If this policy changes in an important way, we will say so in the app before the change applies.'],
    },
  ],
};

const TERMS_FR: LegalDoc = {
  title: 'Conditions d’utilisation',
  updated: 'Dernière mise à jour : 11 novembre 2026',
  intro: `Ces conditions s’appliquent à l’application Silia, publiée par ${COMPANY} (${COMPANY_PLACE}). En créant un compte, vous les acceptez.`,
  sections: [
    {
      h: '1. Le service',
      p: [
        'Silia aide un enfant à faire ses devoirs : elle lit la photo de la page, vérifie les réponses, explique et propose des exercices, par la voix et à l’écran.',
        'Silia est une IA. Elle peut mal lire une photo ou se tromper. C’est une aide aux devoirs : elle ne remplace ni l’enseignant, ni le parent, ni un professionnel de l’éducation. Vérifiez ses corrections.',
      ],
    },
    {
      h: '2. Le compte',
      p: [
        'Le compte est créé par un parent ou tuteur légal majeur, qui reste responsable de l’usage fait par l’enfant et des appareils reliés.',
        'Gardez votre mot de passe secret. Si vous pensez qu’un appareil n’est plus sûr, déliez-le dans l’espace parent.',
      ],
    },
    {
      h: '3. Utilisation correcte',
      p: [
        'Utilisez Silia pour les devoirs de vos enfants seulement.',
        'Ne photographiez pas de documents d’autres personnes, d’informations sensibles ou de contenus illégaux.',
        'N’essayez pas de contourner la sécurité, de copier le service ou de le surcharger.',
      ],
    },
    {
      h: '4. Vos contenus',
      p: [
        'Les photos et réponses restent à vous. Vous nous autorisez à les traiter seulement pour fournir le service, comme expliqué dans la politique de confidentialité.',
      ],
    },
    {
      h: '5. Offre gratuite et payante',
      p: [
        'Une offre gratuite avec des limites peut être proposée. Si une offre payante est proposée, son prix et ce qu’elle comprend sont affichés avant l’achat.',
        'Un abonnement peut être arrêté à tout moment ; il reste actif jusqu’à la fin de la période payée. Les remboursements suivent les règles du magasin d’applications ou du moyen de paiement utilisé, et la loi applicable.',
      ],
    },
    {
      h: '6. Disponibilité',
      p: [
        'Nous faisons de notre mieux pour que Silia fonctionne, mais le service peut être interrompu, changer ou s’arrêter. Le service est fourni « en l’état ».',
      ],
    },
    {
      h: '7. Responsabilité',
      p: [
        'Dans la mesure permise par la loi, nous ne sommes pas responsables des notes, résultats scolaires ou décisions prises à partir des réponses de Silia, ni des dommages indirects.',
        'Rien dans ces conditions ne limite les droits que la loi de votre pays vous donne en tant que consommateur.',
      ],
    },
    {
      h: '8. Fin du compte',
      p: [
        'Vous pouvez supprimer votre compte à tout moment (Réglages → Supprimer mon compte). Nous pouvons suspendre un compte qui ne respecte pas ces conditions.',
      ],
    },
    {
      h: '9. Loi applicable',
      p: [
        'Ces conditions sont régies par la loi de l’État de l’Arizona (États-Unis), sauf si la loi de votre pays de résidence vous donne d’autres droits impératifs.',
      ],
    },
    {
      h: '10. Changements et contact',
      p: [
        'Si ces conditions changent de façon importante, nous le dirons dans l’application avant que le changement s’applique.',
        `Contact : ${CONTACT_EMAIL}.`,
      ],
    },
  ],
};

const TERMS_EN: LegalDoc = {
  title: 'Terms of use',
  updated: 'Last updated: 11 November 2026',
  intro: `These terms apply to the Silia app, published by ${COMPANY} (${COMPANY_PLACE}). By creating an account, you accept them.`,
  sections: [
    {
      h: '1. The service',
      p: [
        'Silia helps a child with homework: she reads the photo of the page, checks the answers, explains and suggests exercises, by voice and on screen.',
        'Silia is an AI. She can misread a photo or make mistakes. She is a homework help: she does not replace the teacher, the parent or an education professional. Check her corrections.',
      ],
    },
    {
      h: '2. The account',
      p: [
        'The account is created by an adult parent or legal guardian, who remains responsible for the child’s use and for the linked devices.',
        'Keep your password secret. If you think a device is no longer safe, unlink it in the parent space.',
      ],
    },
    {
      h: '3. Fair use',
      p: [
        'Use Silia for your own children’s homework only.',
        'Do not photograph other people’s documents, sensitive information or illegal content.',
        'Do not try to bypass security, copy the service or overload it.',
      ],
    },
    {
      h: '4. Your content',
      p: ['Photos and answers remain yours. You allow us to process them only to provide the service, as explained in the privacy policy.'],
    },
    {
      h: '5. Free and paid plans',
      p: [
        'A free plan with limits may be offered. If a paid plan is offered, its price and what it includes are shown before purchase.',
        'A subscription can be cancelled at any time; it stays active until the end of the paid period. Refunds follow the rules of the app store or payment method used, and the applicable law.',
      ],
    },
    {
      h: '6. Availability',
      p: ['We do our best to keep Silia working, but the service may be interrupted, change or stop. The service is provided “as is”.'],
    },
    {
      h: '7. Liability',
      p: [
        'To the extent allowed by law, we are not responsible for grades, school results or decisions made from Silia’s answers, nor for indirect damages.',
        'Nothing in these terms limits the rights your country’s law gives you as a consumer.',
      ],
    },
    {
      h: '8. Ending the account',
      p: ['You can delete your account at any time (Settings → Delete my account). We may suspend an account that does not follow these terms.'],
    },
    {
      h: '9. Governing law',
      p: ['These terms are governed by the law of the State of Arizona (USA), unless the law of your country of residence gives you other mandatory rights.'],
    },
    {
      h: '10. Changes and contact',
      p: ['If these terms change in an important way, we will say so in the app before the change applies.', `Contact: ${CONTACT_EMAIL}.`],
    },
  ],
};

/** French and English texts; the Arabic app shows the French text (with a note in Arabic). */
export function legalDoc(kind: LegalKind, lang: 'fr' | 'en' | 'ar'): LegalDoc {
  const en = lang === 'en';
  if (kind === 'privacy') return en ? PRIVACY_EN : PRIVACY_FR;
  return en ? TERMS_EN : TERMS_FR;
}
