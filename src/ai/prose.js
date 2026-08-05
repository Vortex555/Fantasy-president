/**
 * Two rules every prompt in the game states and the model breaks anyway.
 *
 * Both were found the same way — by reading a month of real output rather than
 * a test fixture — and both are the same class of failure as the language
 * drift: an instruction near the end of a long prompt that a small model drops
 * under load, with nothing downstream able to notice.
 *
 * Neither is a number. That is precisely why they need guarding here: a wrong
 * axis eventually shows up in a roll call somebody stares at, and a real
 * newspaper in an invented country just sits on the screen looking plausible.
 */

// --- Real publications --------------------------------------------------------

/**
 * The outlets a model reaches for when it stops inventing.
 *
 * Every prompt that asks for a newspaper says to invent one, and the fallout
 * from a live month came back attributed to the Charleston Gazette-Mail and The
 * Hill — one of them the actual paper of record for the state the member
 * represents. The game's whole world is invented; a real masthead in it is a
 * seam.
 *
 * Matched on the full name rather than on words, because the words are how real
 * papers are named too. "The Wheeling Gazette" is a fine invention and must
 * survive; "Charleston Gazette-Mail" is a newspaper somebody works at.
 */
const REAL_OUTLETS = new Set([
  "new york times", "ny times", "nyt", "washington post", "wapo", "wall street journal", "wsj",
  "usa today", "los angeles times", "chicago tribune", "boston globe", "miami herald",
  "dallas morning news", "houston chronicle", "seattle times", "denver post", "star tribune",
  "philadelphia inquirer", "atlanta journal-constitution", "charleston gazette-mail",
  "st louis post-dispatch", "detroit free press", "arizona republic", "tampa bay times",
  "hill", "politico", "axios", "roll call", "punchbowl news", "semafor", "the daily beast",
  "cnn", "fox news", "msnbc", "nbc news", "abc news", "cbs news", "npr", "pbs newshour",
  "reuters", "associated press", "ap", "bloomberg", "cnbc", "c-span", "bbc",
  "atlantic", "new yorker", "economist", "guardian", "newsweek", "time", "forbes", "fortune",
  "national review", "wall street review", "breitbart", "daily wire", "newsmax", "oan",
  "one america news", "the blaze", "federalist", "washington examiner", "washington times",
  "huffpost", "huffington post", "vox", "slate", "salon", "mother jones", "the nation",
  "propublica", "the intercept", "business insider", "vanity fair", "rolling stone",
  "drudge report", "real clear politics", "the free press", "jacobin", "reason",
]);

/** Distinctive enough that no invented paper should be using them at all. */
const RESERVED = /\b(politico|axios|msnbc|breitbart|newsmax|propublica|huffpost|semafor|punchbowl|c-span)\b/i;

/**
 * The same names, found inside a longer string.
 *
 * A press briefing does not hand back a masthead in a field of its own — it
 * hands back "Lena Martinez from Reuters", which is a person, an invented one,
 * standing next to a real news agency. Both of those came out of the first live
 * briefing the model ever wrote.
 *
 * Only the unambiguous names are scanned for. "Time", "The Nation" and "AP" are
 * all real publications and all ordinary English, and a rule that reads them
 * inside free text would gut the invented ones instead.
 */
const NAMED_IN_TEXT = new RegExp(
  "\\b(cnn|msnbc|npr|pbs|bbc|reuters|bloomberg|cnbc|politico|axios|semafor|breitbart|newsmax|"
  + "nyt|wapo|wsj|npr|msnbc|"
  + "propublica|huffpost|buzzfeed|vox|slate|salon|fox news|abc news|nbc news|cbs news|"
  + "associated press|new york times|washington post|wall street journal|usa today|"
  + "los angeles times|the guardian|al jazeera|the atlantic|the economist|"
  + "the daily beast|the intercept|rolling stone|vanity fair|the new yorker)\\b", "i");

/** Whether a line of prose has borrowed somebody's real masthead. */
export const namesRealOutlet = (text) => NAMED_IN_TEXT.test(String(text || ""));

/**
 * The same person, without the real employer.
 *
 * Dropping the voice outright would cost a good question to punish a bad
 * byline, and inventing a replacement masthead would put the game's voice in a
 * file that has no business having one. So the affiliation is cut and the
 * person keeps their line: "Lena Martinez from Reuters" reports as "Lena
 * Martinez", which is exactly as much as the room needs.
 */
export function withoutRealOutlet(who) {
  const text = String(who || "").trim();
  if (!namesRealOutlet(text)) return text;

  const cut = text
    // The affiliation and everything after it, including the words that were
    // only ever there to introduce it: "Ada Osei of the Associated Press" has
    // to lose "of the" as well, or it reports as "Ada Osei of the".
    .replace(new RegExp(
      `[,(\\-–—]?\\s*\\b(?:of|from|with|at|for)?\\s*(?:the\\s+)?${NAMED_IN_TEXT.source}\\b.*$`, "i"), "")
    .replace(/\s+\b(of|from|with|at|for|the|a|an)\b[\s,]*$/i, "")
    .replace(/[\s,;:(–—-]+$/, "")
    .trim();
  return cut.length >= 3 ? cut : "";
}

const normalise = (name) => String(name || "")
  .toLowerCase()
  .replace(/^the\s+/, "")
  .replace(/[.,''"]/g, "")
  .replace(/\s+/g, " ")
  .trim();

/** Whether this masthead belongs to somebody in the real world. */
export function isRealOutlet(name) {
  const clean = normalise(name);
  if (!clean) return false;
  return REAL_OUTLETS.has(clean) || RESERVED.test(clean);
}

// --- A gender nobody stated ---------------------------------------------------

const GENDERED = /\b(he|him|his|she|her|hers|himself|herself)\b/i;

/**
 * Whether a line has decided the member's gender on the member's behalf.
 *
 * Every chamber prompt says outright that the member's gender is not stated
 * anywhere and must not be guessed, and a live fallout came back with "It looks
 * like he cares more about protecting certain folks than the people of this
 * state" — a constituent quote about a player who may be anybody.
 *
 * Anchored on the member being named, because that is what makes it a claim
 * about them. A constituent may talk about her own daughter or his own job in a
 * quote that never mentions the member, and dropping those would cost real
 * lines to catch nothing. A single name and a single pronoun in one sentence is
 * the whole failure.
 */
export function guessesGender(text, name) {
  const body = String(text || "");
  const surname = String(name || "").trim().split(/\s+/).pop();
  if (!surname || surname.length < 3) return false;
  if (!new RegExp(`\\b${surname.replace(/[^\w]/g, "")}\\b`, "i").test(body)) return false;
  return GENDERED.test(body);
}

/**
 * The press pack, with anything real taken out of it.
 *
 * Dropped rather than renamed. Every caller here already copes with fewer items
 * than it asked for, and inventing a replacement masthead in code would put the
 * game's voice in a file that has no business having one.
 */
export function inventedPress(press, { label = "press" } = {}) {
  return (Array.isArray(press) ? press : []).filter((item) => {
    if (!isRealOutlet(item?.outlet)) return true;
    console.warn(`[${label}] dropped "${item.outlet}" — that is a real publication, `
      + "and every masthead in this game is supposed to be invented.");
    return false;
  });
}
