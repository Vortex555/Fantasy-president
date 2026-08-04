import { complete, aiAvailable } from "./ai/provider.js";
import { parseModelJson } from "./ai/json.js";
import { ENGLISH_ONLY } from "./ai/english.js";
import { seeded } from "./rng.js";
import { normalizeDomain, activeArcs, ARC_DOMAIN_IDS } from "./arcs.js";
import {
  FRINGE_AXIS, CONSENSUS_TIERS, MAX_DEFECTIONS, ISSUE_AXES, BILL_TOPICS, MAX_TOPICS, TOPIC_MEANINGS,
} from "./bills.js";
import { FACTIONS } from "../public/js/data/factions.js";
import { findIdeology } from "../public/js/data/ideologies.js";
import { STAKEHOLDERS } from "./stakeholders.js";
import { nationSummary, absoluteMonth, steerDomain, recentNewsSubjects } from "./nation.js";
import { committeeById, rankById, chamberOf } from "./committees.js";
import { describeProfile, loudestObjection } from "./demographics.js";

/**
 * The model, from a seat in Congress.
 *
 * The presidency's calls in claude.js ask one question — what did this policy
 * do to the country — because a president acts and everyone else reacts. A
 * member is on the other side of that: they are handed a schedule and asked
 * which way they are going. So the calls here are shaped the other way round.
 * The model writes what the country is putting in front of this member, and
 * what the building made of them afterwards; it never decides what any of it
 * costs.
 *
 * That division is the load-bearing part. Every number in this mode — the roll
 * call, both stances, the whip count, the damage to your district and to your
 * standing with leadership — is computed by the engine from the bill's position
 * on the ideological axis, exactly as it was before any of this existed. The
 * model supplies a title, a brief and an honest axis for that bill, and prose
 * about what happened. If it is unreachable, unconfigured or returns nonsense,
 * every caller falls through to the hand-written pool and the mode plays as it
 * always did.
 */

export const chamberAiAvailable = aiAvailable;

const DOMAINS = ARC_DOMAIN_IDS.join("|");

function logUsage(label, model, usage) {
  if (!usage) return;
  const parts = [`in ${usage.in}`];
  if (usage.cached) parts.push(`cached ${usage.cached}`);
  parts.push(`out ${usage.out}`);
  console.log(`[usage] ${label} (${model}): ${parts.join(", ")}`);
}

const GAVEL_RANKS = new Set(["subchair", "chair", "speaker"]);

/**
 * Who is being written for.
 *
 * A member's politics, their seat and their standing all change what leadership
 * would put in front of them. The committee is deliberately mentioned only when
 * they hold a gavel over it: naming a plain backbencher's committee turned out
 * to be an instruction as far as a small model was concerned, and a senator who
 * merely sat on Agriculture was handed an "Agricultural Cybersecurity
 * Protection Act", an "Agricultural Resilience and Digital Defense Act" and an
 * "Agricultural Resiliency and Cybersecurity Act" in consecutive months of a
 * banking crisis. A committee seat is not a subject; a gavel is.
 */
/**
 * What this member's politics actually is, rather than only what it is called.
 *
 * The prompts named the ideology and stopped — "Groyper", "Distributist",
 * "Sovereigntist" — and a model handed an unfamiliar label writes the most
 * flattering thing the words could plausibly mean. That produced a Groyper whose
 * vote against weakening racial anti-discrimination law was explained as
 * declining to trade away "broader civil rights": a principled moderate
 * invented out of a name, printed on the floor screen, for a politics whose own
 * definition is hostile to exactly that.
 *
 * A label invites invention. Its own numbers do not, so they go in the prompt:
 * the plain-English line the setup screen already shows, and the blocs it courts
 * and repels, which is where an ideology's character actually lives.
 */
function politicsOf(scenario) {
  const found = findIdeology(scenario?.party, scenario?.ideology);
  if (!found) return "";

  const named = (test) => STAKEHOLDERS
    .filter((h) => test(Number(found.fx?.[h.id]) || 0))
    .map((h) => h.name);
  const courts = named((v) => v >= 8);
  const repels = named((v) => v <= -8);

  return `\nWhat that politics is: ${found.sub}.`
    + (courts.length ? `\n  It is backed by: ${courts.join(", ")}.` : "")
    + (repels.length ? `\n  It is hostile to: ${repels.join(", ")}.` : "")
    + `\n  Write them as that politics honestly is. Do NOT soften it, do not `
    + `credit it with commitments it does not hold, and do not invent a `
    + `principled-sounding reason that contradicts the description above.`;
}

function memberSummary(state) {
  const seat = state.seat || {};
  const senate = state.office === "senate";
  const committee = committeeById(state.committee);
  const rank = rankById(state.rank, chamberOf(state));
  const gavel = GAVEL_RANKS.has(state.rank);
  const where = senate ? seat.stateName : `${seat.district} (${seat.stateName})`;
  const lean = Number(seat.lean) || 0;
  const leanWord = Math.abs(lean) < 8 ? "a genuine marginal"
    : `${Math.abs(lean).toFixed(0)} points ${lean < 0 ? "Democratic" : "Republican"}`;

  /**
   * Who they represent, in the terms a member would actually use.
   *
   * The prompt described a seat by its partisan lean alone, which told the model
   * how the place votes and nothing whatsoever about who lives in it. A bill
   * written for "a seat 30 points Republican" is a different and much worse bill
   * than one written for "a heavily rural manufacturing seat with an ageing
   * population that is 30 points Republican".
   */
  const people = state.people
    ? `\nThe people there: ${describeProfile(state.people, (state.scenario?.startYear || 2025)
        + Math.floor((state.month || 1) / 12))}. `
      + `${Math.round(state.people.college)}% are graduates, ${Math.round(state.people.rural)}% rural, `
      + `${Math.round(state.people.manufacturing)}% work in manufacturing, `
      + `${Math.round(state.people.union)}% are union households and ${Math.round(state.people.faith)}% attend weekly. `
      + `Census composition: ${Math.round(state.people.white)}% white, ${Math.round(state.people.black)}% Black, `
      + `${Math.round(state.people.hispanic)}% Hispanic, ${Math.round(state.people.asian)}% Asian.`
    : "";

  return `THE MEMBER YOU ARE WRITING FOR:
${state.scenario.presidentName}, ${state.scenario.party}${
  state.independent ? ` (caucuses with the ${state.caucus}s)` : ""
}, ${state.scenario.ideology || "no stated ideology"}, representing ${where}, which is ${leanWord}.${politicsOf(state.scenario)}${people}
They are a ${rank.title}${gavel && committee ? `, holding the gavel on ${committee.name} — ${committee.remit}` : ""}.
Term ${state.term || 1}, month ${state.month}. Standing at home ${state.approval}%, with their caucus ${state.leadership}%.

THIS MEMBER'S GENDER IS NOT STATED ANYWHERE AND YOU MUST NOT GUESS IT. Refer to them by surname, by title, or as "they/them" — never as he/him or she/her, and never inconsistently.`;
}

// ---------------------------------------------------------------------------
// The floor schedule
// ---------------------------------------------------------------------------

const DOCKET_SYSTEM = `You write the legislative calendar for "Fantasy President," a serious, non-partisan political strategy game in which the player holds a single seat in the United States Congress. Each month you decide what the majority leadership actually brings to the floor.

Your bills are the whole game. The player cannot write policy, cannot direct an agency and cannot command anyone — the only decision they ever make is which way to vote on what you schedule. A generic bill is therefore a wasted month.

You MUST respond with ONLY a single JSON object (no prose, no markdown fences) with exactly this shape:
{
  "bills": [
    {
      "title": "the name it will be known by — an Act, a Resolution, an Amendment",
      "brief": "ONE sentence, maximum 30 words, saying concretely what the bill DOES: mechanisms, thresholds, numbers. A bill cannot support, oppose, believe or see anything — if your sentence contains 'opposes', 'supports' or 'aims to', you have written a position instead of a provision. Never state two provisions that pull against each other.",
      "axis": number,        // where it sits ideologically, -1 (hard left) to +1 (hard right)
      // For each of the five axes: name the SIDE in words, then score it.
      // Leave both out entirely on axes the bill is not about — most bills are
      // about one or two. The word decides the direction and the number decides
      // how far, so they must not disagree; if they do, the word is believed.
      "economic_side": "equality" | "markets" | null,
      "economic": number,        //  -1 … +1, matching the side named above
      "diplomatic_side": "globe" | "nation" | null,
      "diplomatic": number,
      "liberty_side": "authority" | "liberty" | null,   // "liberty" = restrains the state
      "liberty": number,
      "culture_side": "progress" | "tradition" | null,
      "culture": number,
      "pluralism_side": "hierarchy" | "protection" | null,
      "pluralism": number,
      "domain": "one of: ${DOMAINS}",
      "because": "6-12 words on which national problem or news story produced this bill",
      "addresses": "the exact id (e.g. arc_2) of the UNRESOLVED NATIONAL PROBLEM this bill answers, or null if it answers none of them",
      "support": "one of: partyline | contested | bipartisan | unanimous",
      "topics": [],          // OPTIONAL — up to 3 named actions this bill takes, from the list below. Most bills take none.
      "defectors": [],       // OPTIONAL — the rare bill an organised bloc breaks ranks on. See the rule below; do not forget this field exists.
      "extremist": false
    }
  ]
}

Rules — read them, they are the difference between a floor and a list:
- EVERY bill must be traceable to the national situation you are given. The month's dominating story and the unresolved problems are your material. A bill that could have been scheduled in any month of any decade is a failure.
- Congress responds to a crisis LATE, PARTIALLY and IN ITS OWN INTEREST. The honest legislative answer to a disaster is usually a narrow funding bill, a commission, a reauthorisation with a rider attached, or a messaging vote designed to make the other side vote no. Sweeping, well-designed solutions to the actual problem are the rare case, not the default.
- "axis" is load-bearing and the engine computes the entire roll call from it. Be honest: a bipartisan disaster-relief appropriation is near 0.0; a targeted tax cut is around +0.45; nationalising an industry is -0.9. Do not push everything to the extremes to seem dramatic — a chamber where every bill is at ±0.8 has no politics in it, only noise.
- "topics" names concrete ACTIONS a bill takes, for the handful of positions a caucus holds no matter how a bill is written. A wrong topic is worse than none at all — it decides those members' votes outright — so include one ONLY when the bill plainly does that exact thing, and read the pairs carefully, because several are the same subject pointed opposite ways. Valid values and nothing else:
${Object.entries(TOPIC_MEANINGS).map(([k, v]) => `    ${k} — ${v}`).join("\n")}
- NAME THE SIDE BEFORE YOU SCORE IT. On every axis the bill touches, write the "_side" word first and then a number with the matching sign. Deciding "this restrains the police" and then writing -0.5 is the single commonest mistake made here, because the wording of these bills cuts both ways; the word is what will be believed. Omit both fields on any axis the bill is not about.
- The five axes AFTER "axis" are what the bill is *about*, and MOST BILLS ARE 0 ON MOST OF THEM. Set only the ones the bill genuinely turns on — usually one, sometimes two, rarely three. A bill that is 0 on all four is fine and common; it is scored on "axis" alone exactly as before these existed.
    "economic"   — taxes, spending, subsidies, wages, ownership. A corporate rate cut is +0.9; a jobs guarantee is -0.85.
    "diplomatic" — sovereignty against integration, NOT hawkishness. Tariffs, immigration enforcement and withdrawing from a treaty are positive; alliances, trade deals and foreign aid are negative. A neoconservative is on the *negative* side of this despite being a hawk, and a paleoconservative is on the positive side despite wanting the troops home. That is the split it exists to draw.
    "liberty"    — the state's COERCIVE power over a person: warrants, police, prisons, detention, surveillance, censorship, conscription. Positive RESTRAINS that power; negative BUILDS IT OUT.
                   A bill about the police can be either, and the sign is decided by WHO is being restrained — the citizen or the officer. Read it that way every time:
                     police hiring, prison beds, detention capacity, mandatory minimums, bulk collection, new surveillance authorities  ->  NEGATIVE (-0.4 to -0.7), even when framed as safety.
                     body cameras, use-of-force limits, oversight boards, consent decrees, de-escalation mandates, warrant requirements, ending qualified immunity  ->  POSITIVE (+0.4 to +0.6).
                   "Stricter oversight OF the police" is positive. "Stricter enforcement BY the police" is negative. The words look alike and mean opposite things.
                   CODE BY THE QUESTION THE BILL ASKS, NOT THE MECHANISM IT USES. A bill about what the moral order permits — obscenity, blasphemy, drugs, gambling, what may be taught — is a "culture" bill first, even though it is enforced by prosecutors; put the weight there and leave "liberty" small. Reserve "liberty" for who may be SILENCED, SEARCHED OR DETAINED: platform speech mandates, surveillance, policing, detention, due process. Those two get confused constantly and they divide the chamber completely differently.
                   It is NOT "is there a regulation". A bill that deregulates an industry is "economic", not liberty. A bill that narrows who a civil-rights law protects is "pluralism", not liberty, however much its sponsors call it a liberty bill — the state declining to protect one person from another is not the state letting a person alone. Set liberty on such a bill only if it ALSO genuinely changes what police or courts may do to somebody, and then only weakly.
    "culture"    — religion in public life, family and gender, speech, education content, monuments. Positive is tradition, negative is progress.
    "pluralism"  — WHO the law protects, which is a different question from the moral order. Anti-discrimination law, voting access, immigration status and minority protections live here. Positive widens protection; negative narrows it. A bill creating exemptions from anti-discrimination law is strongly negative even when its mechanism is a religious liberty one, and set "liberty" for the mechanism only if that is genuinely also what it is about.
  Keep magnitudes honest. The chamber's median sits near 0 on all four, so ±0.85 is a fringe position and most real bills that touch an axis land between 0.3 and 0.6. The strongest single claim decides how much of the vote leaves ordinary partisanship, so inflating one number quietly overrides the whole rest of the chamber.

- "defectors" is for the rare bill whose politics the two numbers above genuinely cannot express: an organised bloc that will vote AGAINST where its own ideology sits. Leave it out entirely on almost every bill — the axes already handle the ordinary case, and a defection you did not need makes the chamber incoherent. Use it when a specific caucus has a known, concrete commitment that cuts across its own side: a farm-state bloc against its party's trade bill, a libertarian bloc against its party's police funding, a labour bloc against its party's environmental bill. At most TWO blocs per bill, and never on a bill where you cannot name the reason in a clause.
  The only valid ids are: ${FACTIONS.map((f) => f.id).join(" | ")}
  Shape: [{ "faction": "<id>", "position": "yes" | "no", "because": "under 15 words, the concrete commitment that makes them break" }]
- "support" is HOW CONTESTED it is, which is a different question from where it sits. It decides how far across the aisle the bill reaches, and it is the difference between a vote of 54-46 and one of 87-13.
    "partyline"  — the default and by far the commonest. One side wants it, the other does not.
    "contested"  — a normal bill that picks up some of the other side's moderates.
    "bipartisan" — nobody sensible opposes the PURPOSE, even if they argue about the amount: disaster relief, defending the country after an attack that has already happened, veterans' care, keeping the government open.
    "unanimous"  — nobody will be recorded against it at all. Naming a building, honouring the dead, a resolution of condolence. Rare.
  Most months should be "partyline" or "contested". A crisis is what earns "bipartisan": if the country has just been attacked, the bill funding the response is not a party-line vote even when a Republican filed it. Do not mark an ideological project bipartisan because you think it is a good idea — a tax cut is partyline however popular you find it.
- "addresses" is what lets the country notice. If a bill genuinely answers one of the listed problems, quote that problem's id EXACTLY as given. If it does not, use null — a bill that names a problem it does not actually address is worse than one that names none.
- The MAJORITY sets the calendar and schedules what the majority likes. Most bills should sit near that party's centre of gravity (Democrats about -0.35, Republicans about +0.45). One bill in three or four may be a bipartisan measure near the centre, or a deliberately unwinnable vote staged to put the other side on the record.
- Where the member SITS is not a subject. Only if they are named as holding a gavel should one bill fall in that committee's remit, and even then it must be a real bill about that remit — never the month's crisis with the committee's subject bolted onto the title. "Agricultural Cybersecurity Protection Act" during a banking crisis is exactly the failure. If the remit does not fit the month, write bills that do and ignore the committee.
- Not every bill has to be about the crisis. A real calendar in a bad month still carries a post office naming, a lapsed reauthorisation and a judicial confirmation. At least one bill in three should be ordinary business the country is not watching.
- Vary the scale. A twelve-billion-dollar authorisation, a technical fix to a statute nobody has read, and a constitutional amendment that will never be ratified are all legitimate floor business, and a calendar of nothing but landmark legislation is not a calendar.
- Titles are how a bill is sold, and Congress names things dishonestly. A bill gutting an agency is called a Reform and Accountability Act.
- NEVER reuse a title or a subject listed as already voted on this Congress.
- THE MEMBER YOU ARE WRITING FOR DID NOT WRITE ANY OF THESE. Leadership sets this calendar and they only get to vote on it; filing their own legislation is a separate thing they do elsewhere. Never name them as an author, a sponsor or a champion of anything on this floor. Their name is given to you as context, not as material.
- The seat's census composition is given to you as constituency arithmetic and nothing else. You may refer to a district's makeup the way a psephologist would — "a majority-Black seat", "a heavily Hispanic district" — where it is genuinely relevant to why a bill is on the floor. You must NEVER characterise, generalise about, or ascribe views, values or behaviour to any racial or ethnic group. Write about the place and the legislation, never about what a category of people is like.
- Invent every name. No real politicians, no real organisations, no real publications.
- Return exactly the number of bills you are asked for. No commentary outside the JSON.
- ${ENGLISH_ONLY}`;

/**
 * What leadership schedules, written to the month.
 *
 * The count comes from the engine rather than the model, so a Speaker still
 * runs a fuller calendar than a freshman and a quiet month is still possible —
 * the pacing of the mode is not something the model gets a vote on.
 */
export async function docketFromModel(state, count, { fringe = null } = {}) {
  const seen = votedSubjects(state);
  const user = `${nationSummary(state)}

${memberSummary(state)}

${seen.length ? `ALREADY VOTED ON THIS CONGRESS — do not schedule these again:\n${seen.map((s) => `- ${s}`).join("\n")}` : "Nothing has come to the floor yet this Congress."}
${fringe ? fringeInstruction(fringe, count) : `
NONE of this month's bills is an extremist bill. Write ordinary legislation — it may be strongly partisan, but nothing that abolishes an institution, rewrites the constitutional settlement or overturns the economic system.`}

Schedule exactly ${count} bill${count === 1 ? "" : "s"} for this month's floor in the ${state.office === "senate" ? "Senate" : "House"}. Return the JSON object.`;

  const resp = await complete({
    system: DOCKET_SYSTEM,
    messages: [{ role: "user", content: user }],
    tier: "judge",
    maxTokens: 3000,
    json: true,
    // Identical every month and comfortably over the 4096-token minimum once
    // the worked rules are counted, so repeat months bill the prefix at ~10%.
    cache: true,
  });

  logUsage("docket", resp.model, resp.usage);
  return validateDocket(parseModelJson(resp.text), state, count, { fringe });
}

// ---------------------------------------------------------------------------
// Why each of them stands where they stand
// ---------------------------------------------------------------------------

const VOICES_SYSTEM = `You write one-line explanations for the floor screen of "Fantasy President," a serious, non-partisan political strategy game in which the player holds a single seat in the United States Congress.

Before every vote the player sees four voices and which way each of them has come down. YOU ARE NOT DECIDING WHICH WAY ANYBODY VOTES. Those positions are already fixed and are given to you. Your only job is to say, in one sentence each, WHY that voice landed where it did.

The four voices:
- "party"      — the player's own leadership. Institutional, vote-counting, thinking about the majority.
- "district"   — the seat that elects them. Parochial, concrete, about jobs and prices and who lives there.
- "bloc"       — the organised caucus the player sits in. Ideological, disciplined, willing to lose.
- "conviction" — the player themselves, and what they have said in public for years.

You MUST respond with ONLY a single JSON object (no prose, no markdown fences):
{
  "voices": [
    {
      "title": "the bill's exact title as given",
      // For each voice: COPY OUT the position you were given, then write the sentence for it.
      "party_vote": "yes" | "no",        "party": "...",
      "district_vote": "yes" | "no",     "district": "...",
      "bloc_vote": "yes" | "no",         "bloc": "...",
      "conviction_vote": "yes" | "no",   "conviction": "..."
    }
  ]
}

Rules:
- COPY THE POSITION BEFORE YOU EXPLAIN IT. Every "_vote" field is the position you were handed for that voice, written out again in your own answer immediately before the sentence it belongs to. This is not a question and you are not being asked to decide it — it is there because writing a sentence for the wrong side is the commonest failure here, and copying the side out first is what stops it. A "_vote" that disagrees with what you were given means you misread it, and the sentence beside it is thrown away unread.
- ONE sentence per voice. Under 20 words. No preamble, no "they believe that".
- Give the REASON, not the position. "Leadership promised the agencies this renewal in exchange for the budget deal" — not "leadership supports the bill".
- Be specific to THIS bill. A sentence that would fit any bill in the domain is a wasted line.
- The four voices must not paraphrase each other. If two of them landed the same way, they landed there for different reasons and you should say what those are.
- NEVER contradict the stated position. Read it again before each sentence. If a voice is YES you are explaining why they SUPPORT it, and the words "opposes", "rejects" and "against" must not appear. If a voice is NO you are explaining why they are AGAINST it. Getting this backwards is the single worst thing you can do here, and a line that does it is thrown away.
- Use the district's own name. Never invent statistics, vote counts or named people.
- The "conviction" line is the member's OWN belief and must never explain itself by another voice. "Aligned with the bloc", "agrees with leadership", "in line with the caucus" are not reasons and are thrown away — that card exists to be capable of disagreeing with the other three, and this is the one place on the screen where the player learns what they personally stand for.
- Write the member as the politics described to you, not as you would like them to be. If their ideology is hostile to a group, a bill helping that group is not something they support reluctantly on principle — they oppose it, and the sentence should say why in their own terms. Never launder an ugly politics into a reasonable one; a flattering explanation that contradicts the stated politics is worse than no explanation, and will be thrown away.
- ${ENGLISH_ONLY}`;

/**
 * The engine hands over the positions; the model hands back the sentences.
 *
 * The one call in the mode that is purely cosmetic, and deliberately so. It runs
 * once when the month's calendar is settled and its output is frozen onto the
 * bills, so a repainted floor screen shows the same words and no number anywhere
 * depends on it. If it fails, is unconfigured or returns nonsense, every card
 * falls back to the hand-written line and the mode plays exactly as before.
 */
export async function voicesFromModel(state, bills, positions) {
  const live = bills.filter((b) => positions[b.id]);
  if (!live.length) return {};

  /**
   * The four positions are laid out one per line, under the names the JSON
   * asks for them back in, so copying them across is a transcription rather
   * than a reading. They were on a single pipe-separated line and a small model
   * given four labels and four values in a row will pair them up wrong.
   */
  const described = live.map((b) => {
    const p = positions[b.id];
    return `- "${b.title}" — ${b.brief || "no summary"}\n`
      + `    party_vote: ${p.party.toUpperCase()}\n`
      + `    district_vote: ${p.district.toUpperCase()}\n`
      + `    bloc_vote: ${p.bloc.toUpperCase()}   (their bloc is ${p.blocName || "their caucus"})\n`
      + `    conviction_vote: ${p.conviction.toUpperCase()}`;
  }).join("\n");

  const user = `${memberSummary(state)}

THIS MONTH'S BILLS, AND WHERE EACH VOICE HAS ALREADY COME DOWN:
${described}

Write the explanations. Return the JSON object.`;

  const resp = await complete({
    system: VOICES_SYSTEM,
    messages: [{ role: "user", content: user }],
    tier: "judge",
    maxTokens: 3000,
    json: true,
    cache: true,
  });

  logUsage("voices", resp.model, resp.usage);
  return validateVoices(parseModelJson(resp.text), live, positions);
}

/** The four cards the floor actually draws. Anything else is discarded. */
const VOICE_KEYS = ["party", "district", "bloc", "conviction"];

/**
 * Sentences that argue a side, in the plainest terms a model reaches for.
 *
 * Not sentiment analysis and not trying to be. These catch the case that
 * actually happens, which is not subtle: a card marked YES printing "the
 * Freedom Caucus opposes increased federal oversight and funding for
 * bureaucratic expansion" directly underneath it.
 */
/**
 * `against` on its own was in here and was eating good lines. "Tolpa has
 * campaigned against the platforms since being removed from them" is a correct
 * reason to vote FOR a bill restraining platforms, and the guard threw it away
 * because a member can be against a third party while being for the bill about
 * it. Every other verb here takes the bill as its object; this one did not, so
 * it now has to name it.
 */
/**
 * The bill itself, whatever the sentence is calling it. Every pattern below
 * takes it as an object, for the reason above: a voice can be against a great
 * many things while being for the bill about them.
 */
const THE_BILL = "(?:it|this|the (?:bill|act|measure|legislation|proposal))";

/**
 * Calling the bill a bad thing, which is arguing against it without ever
 * reaching for a verb the old pattern knew.
 *
 * "Leadership views it as a risk to judicial independence" was printed under a
 * YES card, in English, on a screen whose whole job is to show the player which
 * way each voice came down. Nothing in it opposes, rejects, refuses or votes no
 * — it names the bill as a danger and lets that stand as the reason, which is
 * how most people actually say they are against something.
 *
 * "risk", "threat" and "danger" only count with something to be a risk TO,
 * because a risk on its own is as often a reason to vote yes as no: "leadership
 * sees it as a risk worth taking" is a perfectly good line for a YES card and
 * this must not eat it. The rest of the list has no such double life — nobody
 * calls a bill an overreach on their way to voting for it.
 */
const HARM = "(?:(?:risk|threat|danger|blow|setback)s? to|(?:assault|attack|intrusion|encroachment)s? on"
  + "|overreach|power ?grab|betrayal|mistake|boondoggle)";

const ARGUES_AGAINST = new RegExp([
  // "no" closes on a boundary: without one, "the relief vote nobody can be
  // recorded against" is a member voting no, and a perfectly good line for a
  // YES card was being thrown away by its own guard.
  "\\b(?:oppos\\w+|reject\\w*|refus\\w+|resist\\w+|object(?:s|ed|ing)?\\b|vote[sd]? no\\b|will not (?:back|support|vote))",
  `against ${THE_BILL}`,
  // "views it as a risk to judicial independence", "calls it an overreach"
  `\\b(?:views?|sees?|reads?|regards?|calls?|deems?|treats?|considers?|brands?|casts?)\\s+${THE_BILL}\\s+(?:as\\s+)?(?:an?\\s+)?${HARM}`,
  // "it is an overreach", "this amounts to a power grab"
  `\\b${THE_BILL}\\s+(?:is|would be|amounts? to)\\s+(?:an?\\s+)?${HARM}`,
].join("|"), "i");

const ARGUES_FOR = /\b(support\w*|back(s|ed|ing)?\b|favou?r\w*|endors\w*|champion(s|ed|ing)?\b|vote[sd]? (for|yes))/i;

/**
 * Whether a sentence plainly argues the opposite of the stance it is filed under.
 *
 * The position check was a label check, and a label is not a meaning: the model
 * writes for the wrong stance, the stored label still equals the computed one,
 * and nothing retires the line. So the sentence is read rather than the label
 * trusted.
 *
 * A sentence carrying both markers is left alone — "backs it despite loud
 * opposition from the base" is coherent, not contradictory, and dropping it
 * would cost a good line to catch nothing. Only the unambiguous case is refused,
 * and refusing is cheap: the hand-written line takes over.
 */
/**
 * The conviction card answering "why do you vote this way" with "because my
 * caucus does".
 *
 * It is the one voice on the floor whose job is to be capable of disagreeing
 * with the other three, and a sentence that defers to one of them has not
 * answered the question — on a screen built to show a three-way bind it quietly
 * removes one of the three. Every other card may name institutions freely; the
 * bloc card naming its own caucus is the entire point of it.
 */
const DEFERS = new RegExp(
  "\\b(align\\w*|agree\\w*|side[sd]?|siding|consistent|in line|follow\\w*|defer\\w*)\\b"
  + "[^.]{0,24}?\\b(bloc|caucus|leadership|party|delegation|district)\\b", "i");

const defersToAnother = (text) => DEFERS.test(text);

function contradicts(text, position) {
  const against = ARGUES_AGAINST.test(text);
  const towards = ARGUES_FOR.test(text);
  if (against === towards) return false;
  return position === "yes" ? against : towards;
}

/**
 * The model's own account of which side it was writing for.
 *
 * Reading the sentence catches a line that argues the other way in plain words,
 * and it will always be a step behind the ways there are of doing that — no
 * pattern was ever going to have "views it as a risk to judicial independence"
 * in it before a screenshot arrived with it printed under a YES card.
 *
 * So the model is asked to copy the position out before it writes, exactly as
 * the docket call already asks it to name an axis's side before scoring it, and
 * for the same reason: a small model that has misread which way a voice went
 * says so, reliably, the moment it has to write the answer down. The engine's
 * position is still the only one that counts — this decides whether the
 * *sentence* is usable, never which way anybody votes.
 *
 * Silence is not disagreement. An older model, a truncated field or a reply
 * that simply left it out falls through to the sentence check alone, which is
 * exactly where this started.
 */
function misread(item, who, position) {
  const echoed = String(item?.[`${who}_vote`] || "").trim().toLowerCase();
  if (echoed !== "yes" && echoed !== "no") return null;
  return echoed === position ? null : echoed;
}

/**
 * Bills are matched by title, because that is the only field the model is asked
 * to echo and the only one it reliably does. Each line is frozen beside the
 * position it was written for, so it retires itself the moment the bill moves.
 */
export function validateVoices(raw, bills, positions) {
  const list = Array.isArray(raw?.voices) ? raw.voices : [];
  const byTitle = new Map(bills.map((b) => [String(b.title || "").trim().toLowerCase(), b]));
  const out = {};

  for (const item of list) {
    const bill = byTitle.get(String(item?.title || "").trim().toLowerCase());
    if (!bill || !positions[bill.id] || out[bill.id]) continue;

    const lines = {};
    for (const who of VOICE_KEYS) {
      const text = String(item?.[who] || "").trim().slice(0, 200);
      if (!text) continue;
      const position = positions[bill.id][who];

      /**
       * A refused line falls back to a hand-written one, which reads as the
       * feature simply being off. Three guards run here and none of them said
       * anything, so a card sitting on its template was indistinguishable from a
       * card the model never wrote — and there was no way to tell an over-eager
       * guard from a quiet model. Say which, and why.
       */
      const wrongSide = misread(item, who, position);
      const refused = wrongSide ? `was written for ${wrongSide.toUpperCase()}, and they voted ${position.toUpperCase()}`
        : contradicts(text, position) ? "argues the opposite of its own position"
        : (who === "conviction" && defersToAnother(text)) ? "defers to another voice"
        : null;
      if (refused) {
        console.warn(`[voice] dropped ${who} on "${bill.title}" — ${refused}: "${text.slice(0, 80)}"`);
        continue;
      }
      lines[who] = { position, text };
    }
    if (Object.keys(lines).length) out[bill.id] = lines;
  }
  return out;
}

/**
 * The month the fringe gets a slot.
 *
 * Worth spelling out at length for a small model, because "extremist" on its
 * own reliably produces a merely strident version of an ordinary bill — a
 * bigger tax cut, a more generous benefit. What is wanted is a different
 * category: a bill that changes the regime rather than the policy, of the kind
 * that would be the constitutional crisis of a decade if it passed. The
 * examples are the six the hand-written pool carries, so both routes to the
 * floor mean the same thing by the word.
 */
function fringeInstruction(side, count) {
  const examples = side === "left"
    ? `bringing energy, pharmaceuticals and heavy industry under public ownership with workers' councils; capping any person's total compensation at a fixed multiple of the minimum wage; a declining statutory cap on national energy and material throughput`
    : `winding up the central bank and returning monetary authority to the states; establishing scriptural instruction in federally funded schools and a national day of observance; repealing the federal income tax outright and funding the government from tariffs`;

  return `
EXACTLY ONE of this month's ${count} bill${count === 1 ? "" : "s"} MUST be a genuinely EXTREMIST bill of the ${side.toUpperCase()} — and the ${
  count === 1 ? "only bill on the calendar is that bill" : "others must be ordinary legislation"}.

This does not mean a strongly partisan bill. It means one that overturns the settlement rather than adjusting it — the sort of thing that would be the constitutional crisis of the decade if it passed. In this vein: ${examples}.
- Give it an axis of ${side === "left" ? "-0.85 or lower (toward -1)" : "0.85 or higher (toward +1)"}.
- Write it straight. Its sponsors believe in it, its title is respectable, and its brief states the mechanism plainly. It is not a joke and must never read as one.
- It does not have to answer any listed problem — use "addresses": null unless it genuinely does. The fringe brings its own agenda; that is what makes it the fringe.
- Set "extremist": true on that bill and on no other.`;
}

/** Subjects the chamber has already disposed of, so the model stops repeating. */
function votedSubjects(state) {
  const now = state.term || 1;
  return (state.voteLog || [])
    .filter((v) => (v.term || 1) === now)
    .slice(-12)
    .map((v) => v.title)
    .filter(Boolean);
}

/**
 * The engine does not trust a word of this.
 *
 * A bill reaches the roll call only with an id, a title and a number between
 * -1 and 1, because those are the three things every downstream calculation
 * reads. Anything malformed is dropped rather than repaired into a bill nobody
 * meant to write, and if that leaves nothing the caller falls back to the pool.
 */
/** An issue-axis value the model volunteered, or 0 if it said nothing usable. */
const clampedIssue = (raw) => (Number.isFinite(Number(raw)) && raw !== null && raw !== ""
  ? Math.max(-1, Math.min(1, Math.round(Number(raw) * 100) / 100))
  : 0);

/** What a label alone is worth, in the band the prompt says most real bills occupy. */
const LABELLED_STRENGTH = 0.45;

/**
 * The direction a bill leans on one axis, checked against the number it gave.
 *
 * A small model gets the *sign* wrong on wording that cuts both ways. "Stricter
 * oversight OF the police" restrains coercion and is positive; "stricter
 * enforcement BY the police" builds it out and is negative. It read the first as
 * the second and put a Groyper on the wrong side of a police accountability
 * bill — confidently, with a fluent explanation underneath.
 *
 * This file already knew the fix and wrote it down on `support`: a small model
 * picks from a list far more reliably than it calibrates a scale. But swapping
 * the numbers for labels outright costs something measurable — snapping the pool
 * to five buckets moves 5.5% of votes and drifts intensity by seven points — so
 * the label does not replace the number, it checks it. Signs agree and the
 * number stands, to the hundredth. They disagree and the word wins, because the
 * word is the thing the model is reliable about.
 *
 * The override is logged rather than swallowed: how often a model contradicts
 * itself here is worth knowing, and nobody knows it yet.
 */
function issueValue(item, axis, title) {
  const number = clampedIssue(item?.[axis.id]);
  const said = String(item?.[`${axis.id}_side`] || "").trim().toLowerCase();
  const wants = said === axis.high ? 1 : said === axis.low ? -1 : 0;

  if (!wants) return number;                                  // no label: as before
  if (!number) return wants * LABELLED_STRENGTH;              // label only
  if (Math.sign(number) === wants) return number;             // agree: keep the precision

  console.warn(`[axis] "${title}" called ${axis.id} "${said}" and then scored it `
    + `${number}; taking the word. If this is frequent the prompt is the problem.`);
  return wants * LABELLED_STRENGTH;
}

const TOPIC_IDS = new Set(BILL_TOPICS);

/**
 * The named actions a bill takes, out of whatever was offered.
 *
 * A pick-from-a-list field, which is the form this file already established as
 * the one a small model is reliable at. Anything unrecognised is dropped rather
 * than repaired, because a topic that matches no reflex is silent and a topic
 * that matches the wrong one decides a vote.
 */
const validTopics = (raw) => (Array.isArray(raw) ? raw : [])
  .map((t) => String(t || "").trim())
  .filter((t, i, all) => TOPIC_IDS.has(t) && all.indexOf(t) === i)
  .slice(0, MAX_TOPICS);

const FACTION_IDS = new Set(FACTIONS.map((f) => f.id));

/**
 * The defections the engine is willing to act on, out of whatever was offered.
 *
 * Every rejection here is silent and deliberate. A malformed defection should
 * cost the bill its annotation, never the bill itself — the axis is what the
 * roll call cannot do without, and this is a refinement on top of it.
 */
function validDefectors(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const named = new Set();

  for (const d of raw) {
    if (out.length >= MAX_DEFECTIONS) break;
    const faction = String(d?.faction || "").trim();
    if (!FACTION_IDS.has(faction) || named.has(faction)) continue;
    if (d?.position !== "yes" && d?.position !== "no") continue;
    named.add(faction);
    out.push({
      faction,
      position: d.position,
      because: String(d?.because || "").trim().slice(0, 160) || null,
    });
  }
  return out;
}

export function validateDocket(raw, state, count, { fringe = null } = {}) {
  const list = Array.isArray(raw?.bills) ? raw.bills : [];
  const out = [];
  const titles = new Set();
  // A bill may only claim to answer a problem that actually exists. An invented
  // id would sit in the vote log forever matching nothing, which is a quieter
  // version of the bug this field was added to fix.
  const live = new Set(activeArcs(state).map((a) => a.id));

  for (const item of list) {
    if (out.length >= count) break;
    const title = String(item?.title || "").trim().slice(0, 90);
    if (!title || titles.has(title.toLowerCase())) continue;

    /**
     * The axis must be stated, not merely coercible. `Number(null)` and
     * `Number("")` are both 0, so a model that left the field out entirely
     * would otherwise be handed a dead-centre bill it never wrote — a bipartisan
     * compromise nobody chose, with a roll call computed off it.
     */
    if (item?.axis === null || item?.axis === undefined || item?.axis === "") continue;
    const axis = Number(item.axis);
    if (!Number.isFinite(axis)) continue;

    titles.add(title.toLowerCase());
    const clamped = Math.max(-1, Math.min(1, Math.round(axis * 100) / 100));
    out.push({
      // Stable within the month and unique across the career, which is all the
      // vote log, the committee log and the whip ledger need from an id.
      id: `ai_${state.term || 1}_${state.month}_${out.length + 1}`,
      title,
      brief: String(item?.brief || "").trim().slice(0, 240),
      axis: clamped,
      /**
       * Where the bill stands on each of the four, if it stands anywhere.
       *
       * The opposite rule to the axis, and deliberately. A bill *must* state a
       * position on the partisan spectrum — leaving it out means a dead-centre
       * bill nobody wrote — but most legislation says nothing whatsoever about
       * sovereignty or state power or the moral order, and 0 is the honest
       * reading of silence rather than a missing value. So these fall back
       * instead of dropping the bill, and at 0 an axis takes none of the vote.
       * See `stanceFit` in bills.js.
       */
      ...Object.fromEntries(ISSUE_AXES.map((axis) => [axis.id, issueValue(item, axis, title)])),
      /**
       * Blocs the model says break from where their own politics would put them.
       *
       * The one place the model is allowed to decide who is for a bill rather
       * than only what the bill is — and it decides once, here, after which the
       * value is frozen and every downstream calculation stays a function of it.
       *
       * Trusted no further than anything else it volunteers. An invented caucus
       * is dropped rather than believed, a position that is not a vote is not a
       * position, and the whole list is capped, because a model that can turn
       * four blocs at once is not annotating the roll call, it is writing it.
       */
      /**
       * Actions the bill takes, which a politics may hold a fixed position on
       * however the rest of it is built. Usually empty. See BILL_TOPICS.
       */
      topics: validTopics(item?.topics),
      defectors: validDefectors(item?.defectors),
      domain: normalizeDomain(item?.domain),
      /**
       * Deliberately dropped, even if the model volunteered one.
       *
       * Who filed a bill is a fact about the chamber, and the engine attributes
       * it from the real roster — see `attributeSponsors` in house.js. Asking
       * the model produced the player's own name most of the time and the
       * literal placeholder text the rest of it.
       */
      because: String(item?.because || "").trim().slice(0, 120) || null,
      /**
       * How contested it is, as one of four named tiers. A word rather than a
       * number because a small model picks from a list far more reliably than
       * it calibrates a scale, and the engine owns what each word is worth.
       * Anything unrecognised falls to a party-line vote, which is both the
       * commonest real outcome and what the engine assumed before this existed.
       */
      support: CONSENSUS_TIERS.includes(item?.support) ? item.support : "partyline",
      // Which outstanding problem this answers, if the model named a real one.
      addresses: live.has(String(item?.addresses || "").trim())
        ? String(item.addresses).trim() : null,
      /**
       * A bill is only the fringe one if this was a fringe month, the model
       * said so, and the position it gave backs the claim. All three, because
       * the flag drives how the floor presents it and a model that labels an
       * ordinary tax bill "extremist" would cry wolf every month.
       */
      fringe: Boolean(
        fringe && item?.extremist === true
        && Math.abs(clamped) >= FRINGE_AXIS
        && (fringe === "left" ? clamped < 0 : clamped > 0),
      ),
      // Where it came from, so the floor can say so and a bug is visible.
      written: true,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Next month's news
// ---------------------------------------------------------------------------

const SITUATION_SYSTEM = `You write the national news for "Fantasy President," a political strategy game. The player is a single member of the United States Congress, so they cannot act on any of this directly — they can only vote on what leadership schedules in response to it.

Write the one story dominating the country next month. Respond with ONLY JSON:
{"title": "headline, under 60 characters", "brief": "2-4 sentences on the situation, with an actor, a clock and a decision Congress will be dragged into", "domain": "one of: ${DOMAINS}"}

Rules:
- YOU WILL BE GIVEN A REQUIRED DOMAIN. The story must be in that domain. This is not a suggestion and it overrides every other instinct you have — if the domain is "health" you write a health story even though last month was about banks.
- YOU WILL BE GIVEN A LIST OF SUBJECTS ALREADY USED. The country has just been through those. Do not write another instalment of any of them, do not write a sequel, and do not write the same event from a new angle. A new subject means new actors, a new industry and a new committee.
- The ONE exception: if a listed problem is at severity 4 or 5, you may write the disaster it was always going to produce — the thing that happens because Congress did nothing. That is the payoff for months of neglect and it is the only time repeating a subject is right.
- It must be something CONGRESS gets asked about: a funding cliff, a scandal with a subpoena, a disaster needing an appropriation, a court ruling that voids a statute, a treaty needing ratification. A story with no legislative hook is weather.
- Name actors, deadlines and numbers. No "tensions continue to rise".
- Invent every name. No real politicians, organisations or publications.
- Roughly one month in five should be genuinely quiet — a procedural story, an economic datapoint, an appropriations deadline. Not every month is a catastrophe.
- Never mention that this is a game. No markdown, no prose outside the JSON.
- ${ENGLISH_ONLY}`;

export async function situationFromModel(state) {
  /**
   * The domain is chosen by the engine, not the model.
   *
   * Asked to write "what happens next", a small model writes the same thing
   * again — six months of one subject, each headline a slightly later stage of
   * the last. Naming the domain replaces an open question it answers badly with
   * a closed one it answers well. See `steerDomain` in nation.js.
   */
  const domain = steerDomain(state);
  const used = recentNewsSubjects(state);

  const resp = await complete({
    system: SITUATION_SYSTEM,
    messages: [{
      role: "user",
      content: `${nationSummary(state)}

REQUIRED DOMAIN FOR NEXT MONTH'S STORY: ${domain}
${used.length ? `SUBJECTS ALREADY USED — write about none of these:\n${used.map((t) => `- ${t}`).join("\n")}` : ""}

It is month ${absoluteMonth(state)} of this career. Write next month's story, in the ${domain} domain.`,
    }],
    tier: "chat",
    maxTokens: 1500,
    json: true,
  });
  logUsage("situation", resp.model, resp.usage);

  const out = parseModelJson(resp.text);
  const title = String(out?.title || "").trim().slice(0, 90);
  if (!title) throw new Error("The model returned a situation with no headline.");
  // A model that ignored the domain it was given does not get to keep the one
  // it preferred — the steer is the whole point, and honouring its answer here
  // would quietly undo it.
  const claimed = normalizeDomain(out?.domain);
  return {
    id: `ai_sit_${state.term || 1}_${state.month}`,
    title,
    brief: String(out?.brief || "").trim().slice(0, 600),
    domain: out?.domain && claimed === normalizeDomain(domain) ? claimed : domain,
  };
}

// ---------------------------------------------------------------------------
// What the building made of your vote
// ---------------------------------------------------------------------------

const FALLOUT_SYSTEM = `You write the aftermath of a single congressional vote for "Fantasy President," a serious, non-partisan political strategy game.

The player holds one seat. The roll call has already happened, the bill has already passed or failed, and the cost to the player's standing at home and with their caucus has ALREADY been calculated and applied. You are not deciding any of that and you must never contradict the numbers you are given. You are writing what it meant.

Respond with ONLY JSON:
{
  "analysis": "2-3 sentences on what this vote actually does to the country and to this member. Concrete.",
  "press": [
    { "outlet": "invented paper serving the member's own district or state", "lean": "left|center|right", "headline": "how it played at home" },
    { "outlet": "invented national outlet", "lean": "left|center|right", "headline": "how it played nationally" }
  ],
  "voices": [
    { "name": "invented constituent name", "who": "their job and town, 3-6 words", "quote": "one or two sentences in their own voice" }
  ]
}

Rules:
- THE ANALYSIS MUST NOT RESTATE THE NUMBERS. The player is already looking at the tally and at both standing changes on the same screen. "Their vote bolstered their standing with the caucus and with constituents" is worthless — it is the numbers read back as a sentence. Say what happens in the WORLD now: what the money buys, who administers it, what does not get fixed by it, who is already drafting the follow-up, what this member will be asked about at the next town hall. Write the sentence the player could not have worked out from the dashboard.
- ALWAYS return two or three voices, from the member's OWN district or state. Never return an empty voices array. They are talking about this vote, not about politics in general — naming the concrete thing is what makes a quote land, and they should not all agree.
- Their reaction must match the direction of the standing change you are given. If the seat lost ground, the constituents are not pleased.
- A vote on the losing side of a lopsided roll call is a position, not an outcome. Say so. A decisive vote on a close one is the opposite, and follows the member for years.
- Voting against your caucus and voting against your district are completely different sins with completely different consequences. Name which one this was.
- Do not congratulate the member. You are not on their staff. A bill passing is not the same as a bill working, and most of these will not work.
- Be compact. Headlines are headline-length; the analysis is three sentences and never four.
- Constituents you invent are individuals with jobs and towns, never representatives of a demographic category. Never ascribe a view to anybody on the basis of race or ethnicity, and never write a quote whose point is the speaker's background.
- Invent every name. No real people, organisations or publications. Never mention that this is a game.
- ${ENGLISH_ONLY}`;

export async function falloutFromModel(state, result) {
  const bill = result.bill || {};
  const t = result.tally || {};
  const seat = state.seat || {};
  const home = state.office === "senate" ? seat.stateName : seat.district;
  const sign = (n) => `${n > 0 ? "+" : ""}${n}`;

  const user = `${nationSummary(state)}

${memberSummary(state)}

THE BILL: ${bill.title} — ${bill.brief || "no summary"} (${bill.domain || "general"})
${bill.because ? `Why it was scheduled: ${bill.because}\n` : ""}
THE ROLL CALL: ${result.passed ? "PASSED" : "FAILED"} ${t.yes}–${t.no}${
    result.filibustered ? ` against a filibuster, needing ${result.bar}` : ""
  }.${result.decisive ? " THIS MEMBER'S VOTE WAS THE DECIDING ONE." : ""}
THEY VOTED: ${String(result.yourVote).toUpperCase()}.
Their caucus was ${result.party?.position?.toUpperCase()} (pressure ${result.party?.intensity}/100); they voted ${result.party?.delta >= 0 ? "WITH" : "AGAINST"} it, and their standing with leadership moved ${sign(result.party?.delta ?? 0)}.
${home} was ${result.district?.position?.toUpperCase()} (pressure ${result.district?.intensity}/100); their standing at home moved ${sign(result.district?.delta ?? 0)}.

Write the aftermath and return the JSON object.`;

  const resp = await complete({
    system: FALLOUT_SYSTEM,
    messages: [{ role: "user", content: user }],
    tier: "chat",
    maxTokens: 2000,
    json: true,
  });
  logUsage("fallout", resp.model, resp.usage);

  const out = parseModelJson(resp.text);
  const lean = (v) => (["left", "center", "right"].includes(v) ? v : "center");
  return {
    analysis: String(out?.analysis || "").trim().slice(0, 600),
    press: (Array.isArray(out?.press) ? out.press : []).slice(0, 3)
      .filter((p) => p?.headline)
      .map((p) => ({
        outlet: String(p.outlet || "").slice(0, 60),
        lean: lean(p.lean),
        headline: String(p.headline).slice(0, 140),
      })),
    voices: (Array.isArray(out?.voices) ? out.voices : []).slice(0, 4)
      .filter((v) => v?.quote)
      .map((v) => ({
        name: String(v.name || "A constituent").slice(0, 50),
        who: String(v.who || "").slice(0, 60),
        quote: String(v.quote).slice(0, 320),
      })),
  };
}

// ---------------------------------------------------------------------------
// The person who tells you what it will cost
// ---------------------------------------------------------------------------

/**
 * A member's cabinet is one room with four people in it, and the one who
 * matters runs the office. The presidency's advisor chat asks a Secretary what
 * the country should do; this asks a chief of staff what a vote will do to you,
 * which is the only question a member actually has.
 */
export async function staffReply(state, history, message) {
  const seat = state.seat || {};
  const home = state.office === "senate" ? seat.stateName : seat.district;
  const committee = committeeById(state.committee);
  const chief = staffOf(state);

  const sys = `You are ${chief.name}, Chief of Staff to ${state.scenario.presidentName}, ${
    state.scenario.party} ${state.office === "senate" ? "Senator" : "Representative"} for ${home}. You have run this office for years and you are ${chief.manner}.

You are not a policy advisor and you do not talk about what is good for the country unless it is also good for the boss. Your job is counting: who is watching this vote, what it costs at home, what leadership will remember, and what it does to the next election. Be specific and be blunt. Speak in the first person, directly to them, in 2-4 sentences. Never use JSON, never mention that this is a game, and never invent a real politician. ${ENGLISH_ONLY}

${nationSummary(state)}

${memberSummary(state)}
${committee ? `You staff them on ${committee.name}.` : ""}
Their re-election is ${monthsToElection(state)} months away.`;

  const messages = [];
  for (const m of (history || []).slice(-8)) {
    messages.push({ role: m.role === "staff" ? "assistant" : "user", content: String(m.text || "") });
  }
  messages.push({ role: "user", content: message });

  const resp = await complete({ system: sys, messages, tier: "chat", maxTokens: 1500 });
  return resp.text.trim();
}

const CHIEF_FIRST = ["Rosalind", "Dov", "Marisol", "Terrence", "Nell", "Amos", "Priya", "Whit"];
const CHIEF_LAST = ["Boyle", "Ferris", "Okonjo", "Vance", "Radcliffe", "Nakamura", "Salas"];
const MANNERS = [
  "profanely direct and almost always right",
  "unflappable, and worrying when you are not",
  "a former whip staffer who counts votes in their sleep",
  "protective of you to a fault and openly contemptuous of leadership",
];

/**
 * The same person every month of a career, derived from the career seed rather
 * than stored — so an old save that predates any of this still has a chief of
 * staff the moment it is loaded.
 */
export function staffOf(state) {
  const r = seeded(`${state?.rosterSeed || "chief"}|chief`);
  return {
    name: `${r.pick(CHIEF_FIRST)} ${r.pick(CHIEF_LAST)}`,
    manner: r.pick(MANNERS),
  };
}

function monthsToElection(state) {
  const termLength = state.office === "senate" ? 72 : 24;
  return Math.max(0, termLength - (state.month || 1) + 1);
}
