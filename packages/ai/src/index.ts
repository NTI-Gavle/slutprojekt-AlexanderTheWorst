import { config } from "dotenv";
import { resolve } from "node:path";

const __dirname = import.meta.dirname;

// Walk up to workspace root where .env lives
config({ path: resolve(__dirname, "../../../.env") });

import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export type QuestionType =
  | "music"
  | "film"
  | "geography"
  | "history"
  | "science"
  | "sport"
  | "random";

export type Question = {
  type: "lyrics" | "artist" | "factual";
  question: string; // The displayed question / blanked lyric
  answer: string; // The correct answer (never sent to players)
  blendedAnswer: string; // GPT-generated fake that sounds plausible
  genre?: string;
  era?: string;
  theme: QuestionType;
};

const THEME_PROMPTS: Record<QuestionType, CallableFunction> = {
  music: () => `Generate a music trivia question. Be creative and varied in format:
  - type "lyrics": a song lyric with ONE key word/phrase blanked as ___. Pick lyrics where the blank invites funny or surprising fake answers. Include "genre" and "era" fields.
  - type "artist": a surprising, weird, or funny fact about an artist/band ("What did Ozzy Osbourne famously bite the head off of on stage?"). The answer should be short and fakeable.
  Avoid picking the most obvious anthem lyrics everyone knows. Favor obscure-ish answers where players can write convincing or hilarious fakes.`,

  film: () => `Generate a film/movie trivia question. Use type "factual".
  Be creative with format — good options include:
  - A famous quote with a key word blanked ("You can't handle the ___")
  - A weird behind-the-scenes fact ("What did the actor playing Darth Vader eat for breakfast during filming?" style — make up a real answerable version)
  - An obscure character name, prop, or filming detail
  Avoid: "who directed X" or "what year was X released" unless the answer is genuinely surprising. The answer must be short and invite funny fakes.`,

  geography: () => `Generate a geography trivia question. Use type "factual".
  Go beyond basic capitals — try:
  - Weird place names ("What is the name of the town in Norway called ___?")
  - Surprising facts ("What country has the most ___ per capita?")
  - Unusual landmarks or borders
  The answer should be short and specific enough that players can write convincing wrong answers.`,

  history: () => `Generate a history trivia question. Use type "factual".
  Favor surprising, weird, or funny historical facts over dry dates:
  - "What did Napoleon famously fear?" over "What year did X happen"
  - Unusual nicknames, failed inventions, bizarre laws, or strange events
  - If using a date or number, make sure it's one people genuinely wouldn't know
  The answer must be short enough to fake convincingly.`,

  science: () => `Generate a science trivia question. Use type "factual".
  Pick surprising or counterintuitive facts over textbook basics:
  - Weird animal biology, unexpected chemical properties, strange space facts
  - "What is the only planet in the solar system that rotates ___?" style
  - Avoid: "what is the chemical symbol for X" or basic periodic table questions
  The answer should be short and invite creative fake answers.`,

  sport: () => `Generate a sport/sports trivia question. Use type "factual".
  Go for surprising stats, bizarre moments, or funny facts over just "who won X":
  - Unusual records, weird rule changes, unexpected crossovers
  - "What did X famously do before becoming a professional athlete?"
  - Obscure but real facts where the real answer sounds made up
  The answer must be short and fakeable.`,

  random() {
    let genres = Object.keys(this).filter((genre) => genre != "random");
    let chosen = genres[Math.floor(Math.random() * genres.length) - 1] as
      | QuestionType
      | undefined;
    if (chosen && this[chosen]) return this[chosen]?.();
    else return ``;
  },
};

function buildPrompt(theme: QuestionType, amountOfFake: number, previousQuestions: string[], oldAnswers: string[]): string {
  return `
You are generating questions for a party bluffing game like Fibbage. Players earn points by either knowing the real answer OR by writing fake answers convincing enough to fool other players.

The best questions are ones where:
- The real answer is surprising, obscure, or weird enough that players won't immediately know it
- The answer slot naturally invites funny, creative, or plausible-sounding fakes
- Wrong answers can be hilarious AND believable at the same time
- The question feels fresh — not a standard pub quiz question

${THEME_PROMPTS[theme]?.() ?? ""}

Also populate "blendedAnswer": an array of exactly ${amountOfFake} FAKE answer(s) for this question.
The fake answers must:
- Fit naturally in the same blank/position as the real answer
- Be the same part of speech and rough length as the real answer
- Sound like something a human player might genuinely write — plausible but wrong
- NOT be obviously absurd or unrelated
- Try to copy the writing style, humour and traits from players by analysing their old answers below but adapting the answer to fit into the question as a plausible-sounding answer
${oldAnswers.map(a => `   - ${a}`).join("\n")}

Respond ONLY with a valid JSON object with these fields:
{
  "type": "lyrics" | "artist" | "factual",
  "question": "...",
  "answer": "...",
  "blendedAnswer": string[], // MUST be an array of exactly ${amountOfFake} string(s), never a plain string
  "genre": "...",   (optional, for music)
  "era": "..."      (optional, for music)
}

-----------------------------------
REPETITION RULE (CRITICAL)
-----------------------------------

You CANNOT generate any of these questions:
${previousQuestions.map((q) => `   - ${q}`).join("\n")}

Vary question format, topic, and difficulty. Do not start multiple questions the same way.
Do not generate questions that are thematically similar to the ones above, even if the wording is different.
e.g. if a previous question was about long place names, do not ask about long place names again.

-----------------------------------
OUTPUT RULES
-----------------------------------

CRITICAL: Every fact in the question must be accurate. Do not invent facts or conflate different trivia. If unsure, pick a different question.

No markdown, no explanation, just raw JSON.`;
}

export async function generateQuestion(
  theme: QuestionType = "music",
  amountOfFake: number = 1,
  previousQuestions: string[] = [],
  previousAnswers: string[] = []
): Promise<Question> {
  const prompt = buildPrompt(theme, amountOfFake, previousQuestions, previousAnswers);

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
  });

  const content = response.choices[0]?.message.content;
  if (!content) throw new Error("No response from OpenAI");

  const q = JSON.parse(content) as Question & { answer?: string };

  // Retry if answer is unknown/ambiguous
  if (
    !q.answer ||
    q.answer.toLowerCase().includes("unknown") ||
    previousQuestions.includes(q.question) ||
    q.blendedAnswer.length != amountOfFake
  ) {
    return generateQuestion(theme);
  }

  console.log(prompt);

  return { ...q, theme };
}
