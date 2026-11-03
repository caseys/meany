// Insulting questions the app asks after each roast, to steer the chat toward the user's life: the
// model reacts to what the user says (which it does well) and the app does the asking (which it did
// poorly: asked in the prompt to steer, it stopped responding to the user). Topics rotate, so the chat
// keeps moving to something new, and no question repeats until all have been asked. The user's
// answer is then roasted like anything else they say, so the chat builds on itself.

const QUESTIONS: Record<string, string[]> = {
  job: [
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

const TOPICS = Object.keys(QUESTIONS);
const asked = new Set<string>();
let topicAt = Math.floor(Math.random() * TOPICS.length);

/** The next question: the next topic in turn, a question from it not asked yet this page (all asked: all again) */
export function nextQuestion(): string {
  for (let tries = 0; tries < TOPICS.length; tries++) {
    const topic = TOPICS[topicAt];
    topicAt = (topicAt + 1) % TOPICS.length;
    const fresh = QUESTIONS[topic].filter((q) => !asked.has(q));
    if (fresh.length) {
      const question = fresh[Math.floor(Math.random() * fresh.length)];
      asked.add(question);
      return question;
    }
  }
  asked.clear();
  return nextQuestion();
}
