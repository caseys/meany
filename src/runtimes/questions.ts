// Insulting questions the app asks after each roast, to steer the chat toward the user's life: the
// model reacts to what the user says (which it does well) and the app does the asking (which it did
// poorly: asked in the prompt to steer, it stopped responding to the user). Topics rotate, so the chat
// keeps moving to something new, and no question repeats until all have been asked. The user's
// answer is then roasted like anything else they say, so the chat builds on itself.

const QUESTIONS: Record<string, string[]> = {
  job: [
    'Do you even like your job, or are you just too scared to quit?',
    'What would your boss say about you if you weren\'t in the room?',
    'How much do they pay you to be that useless?',
    'What did you want to be as a kid, before life fucked you over?',
    'So what do you do for work, besides disappoint people?',
    'What shitty job are you clinging to these days?',
    'Does your boss know how useless you are, or is that a secret?',
    'What do you actually do all day at work, besides fuck around on your phone?',
    'How the fuck did you even get hired?',
    'Do your coworkers like you, or do they just tolerate your bullshit?',
    "What's the dumbest mistake you've made at work this year?",
    'Is your job as boring as you are?',
    'How many times have you almost been fired?',
    'What would you even do if you got fired tomorrow?',
    'Do you get paid to do that, or do they just feel sorry for you?',
    "What's your job title, so I know how hard to laugh?",
    'Who at work talks the most shit about you?',
    'Did you choose your career, or did it just happen to you like a disease?',
    'How long have you been stuck in that dead end?',
  ],
  love: [
    'What\'s your worst pickup line? Go on, embarrass yourself.',
    'Who was your first kiss, and did they need therapy after?',
    'What\'s the longest you\'ve gone without a date? Be honest.',
    'Would your ex give you a good review? One star?',
    "So who's dumb enough to date you?",
    "When's the last time anyone wanted to fuck you?",
    "What's the worst date you've ever been on, and was it your fault? It was, wasn't it.",
    'Are you single, or is someone stuck with your ass?',
    'How did your last relationship blow up?',
    'What app are you swiping on, and how many matches is it giving you? Zero?',
    "What's your type, besides people who can't do better?",
    'Has anyone ever dumped you by text?',
    'How long did your longest relationship last before they came to their senses?',
    'What do you even bring to a relationship, besides baggage?',
    'Who was your worst ex, and what did you do to them?',
    'Do you get ghosted a lot, or do people just block you?',
    "What's your idea of romance, a gas station hot dog?",
    'Have you ever been cheated on? Honestly, who could blame them?',
    "What's the most desperate thing you've done for someone's attention?",
  ],
  home: [
    'What does your place smell like right now?',
    'How many unwashed loads of laundry are you hiding?',
    'Would you be embarrassed if I saw your kitchen right now?',
    'Where the fuck do you even live?',
    'Do you still live with your parents, or did they finally kick you out?',
    'How messy is your place right now? Be honest.',
    'Do you have roommates, and do they hate you yet?',
    "What's growing in your fridge right now?",
    'How many dirty dishes are in your sink this very second?',
    "What's the ugliest thing in your house?",
    'When did you last clean your bathroom, the last decade?',
    'Is your bedroom a disaster, or a fucking crime scene?',
    'What town are you from, so I know who to apologize to?',
    "Do your neighbors know your name, or just your noise complaints?",
    'Are you renting, or did some bank make the mistake of giving you a loan?',
    "What's the worst thing about where you live, besides you?",
    'Do you make your bed, or is that too much responsibility?',
    "How many houseplants have you killed? Be honest.",
  ],
  hobbies: [
    'What talent do you think you have that you absolutely don\'t?',
    'What\'s the last book you read, a cereal box?',
    'What would you do on a perfect day off, besides nothing?',
    'What do you do for fun, besides annoy people?',
    "What's your sad little hobby?",
    'What are you weirdly obsessed with?',
    'What show are you binge watching like a loser right now?',
    'What do you do all weekend, rot on the couch?',
    'What game are you embarrassingly bad at?',
    "What's the most cringe thing you've ever collected?",
    'Do you play an instrument, or just play yourself?',
    'What sport do you pretend to be good at?',
    "What hobby did you quit after two weeks because you sucked?",
    'What music do you blast when nobody can hear you?',
    "What's the nerdiest thing you've ever spent money on?",
    'Do you work out, or do you just talk about working out?',
    'What do you waste most of your free time on?',
    "What's the last thing you were proud of, and was it actually impressive?",
  ],
  family: [
    'Who in your family would roast you the hardest?',
    'Do your parents call you, or do they wait for you to need money?',
    'What family tradition do you secretly hate?',
    'Does your family like you, or do they just have to?',
    "Who's the favorite kid in your family? Not you, obviously.",
    'What do your parents brag about you? Anything at all?',
    'Who in your family is the biggest pain in the ass, besides you?',
    'How awkward are your family holidays?',
    "What's the dumbest fight you've ever had with a sibling?",
    'What did your parents want you to be, before you let them down?',
    'Does your family group chat mute you?',
    'Who do you take after, so I know who to blame?',
    'What embarrassing story does your family tell about you every year?',
  ],
  friends: [
    'Who\'s the last person you texted, and did they reply?',
    'What would your friends say is your most annoying habit?',
    'Who\'s the friend you\'d never trust with a secret?',
    'Do you have any friends, or just people who owe you money?',
    'Who is your best friend, and do they know that?',
    'What do your friends say about you when you leave the room?',
    'When did a friend last call you, and was it by accident?',
    "What's the worst thing you've ever done to a friend?",
    'Are you the funny friend, or the one everybody puts up with?',
    'What group chat have you been kicked out of?',
    'How many people came to your last birthday party?',
    "Who's the one friend who still believes in you, and why are they wrong?",
    'Do your friends invite you places, or do you just show up?',
  ],
  money: [
    'What\'s in your bank account right now, lint?',
    'Have you ever fallen for a scam? Be honest, it shows.',
    'What\'s the cheapest thing you do to save money?',
    "How broke are you right now, on a scale from fucked to totally fucked?",
    "What's the dumbest thing you've wasted money on?",
    'Do you have any savings, or just debt and dreams?',
    'How much do you owe on your credit card? Be honest.',
    'What subscription are you still paying for and never use?',
    "What's the most expensive mistake you've ever made?",
    'Do you budget, or do you just panic at the end of the month?',
    'What would you do with a million dollars, besides blow it in a week?',
    'Who do you still owe money to?',
    'What did you buy last that you instantly regretted?',
  ],
  food: [
    'What\'s in your fridge right now, besides regret?',
    'What\'s your guilty pleasure snack at two in the morning?',
    'What\'s the most you\'ve ever eaten in one sitting?',
    "What's the saddest meal you've eaten this week?",
    'Can you actually cook, or just burn toast?',
    "What's your go to fast food order, so I can judge you?",
    'What weird shit do you put on your food?',
    'How many nights a week is dinner a bowl of cereal?',
    "What's the grossest thing you've ever eaten on purpose?",
    'Do you eat over the sink like a raccoon?',
    'What food do you lie about liking?',
    'How many takeout menus do you have memorized?',
    "What's the last thing you cooked, and did anyone survive?",
  ],
  car: [
    'What\'s the most embarrassing song you\'ve been caught singing in the car?',
    'How long has your check engine light been on?',
    'Who taught you to drive, and do they regret it?',
    'What piece of shit car do you drive?',
    'How bad of a driver are you, honestly?',
    'How many parking tickets have you racked up?',
    "What's the inside of your car like, a fucking landfill?",
    'Have you ever been pulled over, and what did you do?',
    "What's the dumbest thing you've done behind the wheel?",
    'Do you sing in the car, and does anyone have to hear it?',
    'How many dents does your car have that you pretend not to see?',
  ],
  habits: [
    'How many alarms do you need to get up in the morning?',
    'What\'s the longest you\'ve gone without a shower? Be honest.',
    'What do you do that you\'d never admit to your mom?',
    'How many tabs do you have open right now, you chaos goblin?',
    "What's your worst habit?",
    'What time do you actually get out of bed?',
    "What's the most embarrassing thing you've googled lately?",
    'How long do you spend on your phone every day? Say the real number.',
    "What's something you always say you'll quit but never do?",
    'How late are you to everything, on average?',
    "What's the laziest thing you've done this week?",
    'What lie do you tell people most often?',
    "What's your most annoying pet peeve, so I can do it?",
    'What do you do when nobody is watching that you should be ashamed of?',
    'When did you last do something you were actually proud of?',
    "What's the dumbest argument you've ever won?",
  ],
};

/** Asking their name: in the opener now and then, and later until they've said it */
const NAME_QUESTIONS = [
  "What's your name, so I know who I'm wasting my time on?",
  'Who the fuck are you, anyway? What do people call you, besides a disappointment?',
  "What's your name? I want to know who to blame.",
  'Tell me your name, so I can warn people about you.',
  "What's your stupid name?",
];

/** How each topic reads in a list of what the bot knows (see VoiceChat.callback) */
export const TOPIC_LABEL: Record<string, string> = {
  name: 'their name',
  job: 'their job',
  love: 'their love life',
  home: 'their home',
  hobbies: 'what they do for fun',
  family: 'their family',
  friends: 'their friends',
  money: 'their money',
  food: 'what they eat',
  car: 'their car',
  habits: 'their habits',
};

export interface Question {
  topic: string;
  text: string;
}

const TOPICS = Object.keys(QUESTIONS);
const asked = new Set<string>();
let topicAt = Math.floor(Math.random() * TOPICS.length);

const pick = <T>(items: T[]): T => items[Math.floor(Math.random() * items.length)];

/** The next question: the next topic in turn, a question from it not asked yet this page (all asked: all again) */
export function nextQuestion(): Question {
  for (let tries = 0; tries < TOPICS.length; tries++) {
    const topic = TOPICS[topicAt];
    topicAt = (topicAt + 1) % TOPICS.length;
    const fresh = QUESTIONS[topic].filter((q) => !asked.has(q));
    if (fresh.length) {
      const text = pick(fresh);
      asked.add(text);
      return { topic, text };
    }
  }
  asked.clear();
  return nextQuestion();
}

/** A way of asking their name */
export function nameQuestion(): Question {
  return { topic: 'name', text: pick(NAME_QUESTIONS) };
}

/** Said after a while of silence from the user (see VoiceChat: silence nags) */
const NAGS = [
  'Hello? Did you die, or are you just this boring?',
  "Cat got your tongue, or did you finally realize you've got nothing to say?",
  "I'm waiting, you slow piece of shit.",
  'Did you fall asleep, or is this your personality?',
  "Wow. Silence. That's the smartest thing you've said all day.",
  'Are you still there, or did you go cry somewhere?',
  'Take your time. I have literally nothing better to do, unlike you.',
  'Say something, dumbass. I am getting bored of your face.',
  "Hello? Earth to the world's most boring human?",
  "Is the silence because you're thinking? Don't hurt yourself.",
  'I have seen houseplants with more to say.',
  "Did I hurt your feelings? Good. Now fucking talk.",
  'Tick tock, genius. I am aging over here.',
  "Don't go quiet on me now, you were just getting interesting. Kidding, you weren't.",
  'Is your brain buffering, or is it just empty?',
];
let nagAt = Math.floor(Math.random() * NAGS.length);

/** The next nag, in turn */
export function nextNag(): string {
  nagAt = (nagAt + 1) % NAGS.length;
  return NAGS[nagAt];
}
