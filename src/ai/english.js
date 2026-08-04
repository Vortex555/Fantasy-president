/**
 * The month the floor screen came back in Chinese.
 *
 * Three of the four stance cards on a judicial ethics bill were printed in
 * Mandarin — the district, the caucus and the player's own conviction — under
 * English headings, beside an English title, on an English screen. Nothing was
 * broken: the JSON was well formed, every field was present, the positions all
 * matched the engine's. The model had simply answered in another language.
 *
 * That is a small local model's most ordinary failure and the game had no
 * defence against it. Qwen, GLM and DeepSeek weights are trained heavily on
 * Chinese and drift back to it under load — a long system prompt, a full
 * context, a JSON shape to hold together — and they drift *partway*, which is
 * what makes it nasty: one field in English, three not, no error anywhere.
 *
 * So two things happen. Every system prompt says which language to write in,
 * because most of the time asking is enough. And `complete` reads what came
 * back, because asking is not always enough and a prompt rule is not a
 * guarantee. See `driftedFromEnglish`.
 */

/**
 * A letter belonging to no Latin alphabet.
 *
 * Deliberately not a list of scripts. Enumerating Han, Hangul, Cyrillic and the
 * rest means the one you forgot is the one you get, and the game has no use for
 * any of them; asking the opposite question — is this letter Latin — covers
 * every writing system at once and stays true when a new model drifts somewhere
 * new.
 *
 * It is letters and nothing else, which is the point. Accents are Latin, so
 * "José" and "café" are untouched. Digits, currency, em dashes, quotation marks
 * and emoji are not letters at all, so none of them can trip this.
 */
const FOREIGN_RUN = /(?:(?!\p{Script=Latin})\p{L})+/gu;
const ANY_LETTER = /\p{L}/gu;

/**
 * How much of an answer the model wrote in another language.
 *
 * The second argument is everything the model was *given*, and leaving it out
 * was a bug found the first time this ran against the real model rather than a
 * stub. Asked for explanations of a bill whose title was Chinese, qwen2.5:14b
 * wrote four sentences of perfectly good English and copied the title back
 * verbatim — exactly as the prompt demands, since the title is how the engine
 * matches an explanation to its bill. Nine characters of our own material,
 * handed straight back to us, read as drift. The reply was discarded, the retry
 * copied the title back too, and the whole call was lost.
 *
 * It is not a contrived case. Titles, district names and the president's own
 * free-written policy are all echoed somewhere, so a single drifted title
 * stored on a bill would have made every later call about that bill fail
 * forever — a worse fault than the one this exists to catch, and silent.
 *
 * So a run of foreign letters counts only if the model produced it. Anything
 * that already appears in the prompt is our word coming back, not its own.
 *
 * @returns {{ count: number, letters: number, share: number, sample: string }}
 */
export function foreignScript(text, given = "") {
  const body = String(text ?? "");
  const runs = body.match(FOREIGN_RUN) || [];
  const source = String(given ?? "");
  const novel = runs.filter((run) => !source.includes(run));
  const count = novel.reduce((n, run) => n + [...run].length, 0);
  const letters = (body.match(ANY_LETTER) || []).length;

  return {
    count,
    letters,
    share: letters ? count / letters : 0,
    sample: novel.join(" ").slice(0, 12),
  };
}

/**
 * Whether an answer has left English, on the evidence rather than a guess.
 *
 * Two thresholds, because the two failures look different. A drifted *sentence*
 * anywhere in a reply is four or more foreign letters and is never an accident
 * — no English sentence in this game contains a Chinese word. A drifted *short
 * field* can be shorter than that, so a couple of characters count when they
 * are a tenth of everything written.
 *
 * Both are floors rather than hair triggers, and that matters: a single foreign
 * character surviving somewhere in a 5,000-token turn is not worth throwing the
 * turn away over, and this is the one guard in the game that can cost a player
 * a whole month rather than one sentence.
 */
export function driftedFromEnglish(text, given = "") {
  const { count, share } = foreignScript(text, given);
  return count >= 4 || (count >= 2 && share > 0.1);
}

/**
 * Everything the model was given, as one string to check its answer against.
 * The system prompt included: it carries the bill titles, the district and the
 * member's own name, which are the words most likely to come back verbatim.
 */
export const promptText = (req) => [
  req?.system,
  ...(Array.isArray(req?.messages) ? req.messages.map((m) => m?.content) : []),
].filter((part) => typeof part === "string").join("\n");

/**
 * What every system prompt says, as one more of the rules each of them already
 * carries. Worded as a consequence rather than a preference, because a model
 * that drops instructions under load keeps the ones that name a cost.
 */
export const ENGLISH_ONLY = "WRITE IN ENGLISH. Every word you return is printed on an "
  + "English-language screen: every field, every sentence, every invented name. Do not "
  + "switch language partway through and do not answer in the language of anything you were "
  + "given. A reply in any other language is thrown away and the player is shown a "
  + "hand-written fallback instead.";

/** What it is told on the second attempt, once it has already drifted once. */
export const ENGLISH_RETRY = "YOUR PREVIOUS ANSWER WAS NOT IN ENGLISH AND WAS DISCARDED. "
  + "Answer the same question again, identically in every respect except that every single "
  + `word of it is in English. ${ENGLISH_ONLY}`;
