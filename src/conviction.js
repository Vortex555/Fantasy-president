import { clamp, round1 } from "./rng.js";
import { consensusOf, stanceFit, voiceFor, reflexVote } from "./bills.js";
import {
  findIdeology, ideologyEffects, ISSUE_KEYS, issueKey,
} from "../public/js/data/ideologies.js";
import { stakeholderById } from "./stakeholders.js";

/**
 * What you actually believe, as a pressure in its own right.
 *
 * The chamber modes were built on one tension: your district and your caucus
 * want different things, and every vote spends one to buy the other. It is a
 * good tension and it was the whole game — which is precisely the problem,
 * because the third party to every vote was missing. Your own convictions were
 * not in the room.
 *
 * You pick one of fifty-eight ideologies at character creation and it decided
 * your starting approval, which way you amended bills, and one line in a prompt.
 * It did not decide anything about how you were expected to vote. `partyLine`
 * reads the caucus's anchor and `districtView` reads the seat's axis; neither
 * has ever read yours. So a Progressive Firebrand and a Blue Dog Moderate in the
 * same district, in the same party, faced identical pressure on every bill in
 * the game and paid identical costs — the choice at creation was cosmetic from
 * the first roll call onward.
 *
 * Now it is a third stance and a third meter. Integrity is how often you vote
 * like the person you told everyone you were, and it behaves like a real
 * reputation: slow to build, quick to lose, and the thing your own side checks
 * before deciding whether to protect you or replace you.
 */

/**
 * Consensus widening, the axis blend and the agreement curve all live in
 * bills.js now — one copy, shared by the four stance cards and the roll call,
 * because the last time two of them computed a fit separately the panel and the
 * tally disagreed about the same vote on screen. See `stanceFit`.
 */

/**
 * How hard a fringe believer feels it.
 *
 * A mainstream ideology is a set of preferences; a fringe one is a conviction,
 * and betraying it costs more. `ideologyPosition` already draws this distinction
 * for the focus group, so it is the same 1.7 here rather than a new number.
 */
export function convictionWeight(scenario) {
  const found = findIdeology(scenario?.party, scenario?.ideology);
  return found?.fringe ? 1.7 : 1;
}

/**
 * Where you stand on a bill, as opposed to where your party and your voters do.
 *
 * Deliberately the same shape as `partyLine` and `districtView` so the floor can
 * lay all three side by side and the player can see, in one glance, which of the
 * three they are about to disappoint.
 */
/**
 * The bar you personally would vote at.
 *
 * The same one `rollCall` holds every other member of the chamber to, and
 * deliberately not the looser 0.72 that `partyLine` and `districtView` use for a
 * caucus and an electorate. Those are aggregates — a caucus of two hundred
 * tolerates a wider range than any individual in it — whereas this is one person
 * deciding whether they believe in a bill, which is exactly the question the roll
 * call asks of the other four hundred and thirty-four. At 0.72 a Blue Dog
 * Moderate would have voted for a bill at -0.65, which is no kind of Blue Dog.
 */
const CONVICTION_THRESHOLD = 0.78;

/** What a reflex feels like. High, because it is definitional rather than a preference. */
const REFLEX_INTENSITY = 78;

export function convictionView(state, bill) {
  /**
   * Both of your numbers, not just the economic one.
   *
   * A politics is a position on who gets what *and* a position on what the state
   * may do about it, and reading only the first made every member of a wing
   * interchangeable on the votes where the second is the whole question. A
   * Constitutionalist and a Law & Order Conservative sit a tenth apart on money
   * and at opposite poles on a warrant requirement; until this they cast the
   * same vote on it, with the same sentence underneath.
   */
  const found = findIdeology(state?.scenario?.party, state?.scenario?.ideology);
  const mine = { axis: Number(state?.scenario?.ideologyAxis) || 0 };
  for (const id of ISSUE_KEYS) {
    const carried = Number(state?.scenario?.[issueKey(id)]);
    mine[id] = Number.isFinite(carried) && carried !== 0 ? carried : (found?.[id] ?? 0);
  }
  const weight = convictionWeight(state?.scenario);
  const fit = stanceFit(mine, bill, consensusOf(bill));

  /**
   * A position held regardless of how the bill is built decides before the
   * arithmetic runs, and decides hard — a reflex is not a preference. See
   * BILL_TOPICS in bills.js.
   */
  const reflex = reflexVote(found, bill);
  const position = reflex || (fit >= CONVICTION_THRESHOLD ? "yes" : "no");
  const intensity = reflex
    ? clamp(Math.round(REFLEX_INTENSITY * weight), 5, 100)
    : clamp(Math.round(Math.abs(fit - CONVICTION_THRESHOLD) * 240 * weight), 5, 100);

  return {
    position,
    fit: round1(fit),
    intensity,
    ideology: state?.scenario?.ideology || "your own politics",
    fringe: weight > 1,
    reason: voiceFor(bill, "conviction", position) || (position === "yes"
      ? `This is what you came here to do.`
      : `You have spent your career arguing against this.`),
  };
}

/**
 * What a vote does to your integrity.
 *
 * Asymmetric on purpose, and by a wide margin. Voting your convictions is what
 * you are supposed to be doing, so it earns very little; voting against them is
 * the thing people remember, so it costs a lot. A reputation for standing for
 * something cannot be farmed one easy vote at a time — it is only worth having
 * because it is expensive to keep.
 *
 * Abstaining is its own small betrayal when you cared. Everyone can see you
 * ducked it.
 */
/**
 * Integrity is a proportion, not a balance.
 *
 * It began as an accumulator — a little for every vote you kept faith on, a lot
 * for every betrayal — and measuring a full term showed why that cannot work.
 * Most votes align with your convictions whatever strategy you play, because a
 * left-winger in a left caucus agrees with it most of the time. So the small
 * gains compounded across thirty roll calls and *every* member drifted upward
 * into the seventies and eighties regardless of how they had actually behaved.
 * A meter that says 80 for a purist and 78 for an opportunist measures nothing.
 *
 * So it is the weighted share of your votes that matched what you claim to
 * believe. It cannot be farmed, because voting your conscience on a vote you
 * barely care about adds almost nothing to either side of the fraction. And it
 * means exactly what it appears to mean, which the accumulator never did.
 *
 * Weighted by how much you cared, so the votes that were hard to take count and
 * the ones that cost nothing barely register.
 */

/** Abstaining is not keeping faith, but it is not quite a betrayal either. */
const ABSTAIN_CREDIT = 0.3;

/** How much record it takes before it outweighs the benefit of the doubt. */
const EVIDENCE_FOR_A_VERDICT = 3.6;

export function recordConviction(state, conviction, vote) {
  const heat = conviction.intensity / 100;
  /**
   * Squared, so the votes that were hard dominate and the ones that cost nothing
   * barely enter the record.
   *
   * Measured over a full term, a member and their own caucus genuinely disagree
   * on only about one bill in seven — a left-winger in a left party agrees with
   * it most of the time, which is realistic and is the whole reason the caucus
   * holds together. But with linear weighting those twenty-four easy agreements
   * drowned the four votes that actually defined the career, and a firebrand who
   * had folded on every one of them still read 93 against a purist's 100.
   *
   * At this weighting a vote you felt strongly about counts for roughly sixteen
   * times one you shrugged at, which is also how anybody afterwards would
   * describe the record: by the four hard ones.
   */
  const weight = heat * heat * (conviction.fringe ? 1.4 : 1);
  const credit = vote === "abstain"
    ? ABSTAIN_CREDIT
    : (vote === conviction.position ? 1 : 0);

  state.convictionKept = round1((state.convictionKept || 0) + credit * weight);
  state.convictionWeight = round1((state.convictionWeight || 0) + weight);
  const before = state.integrity ?? INTEGRITY_START;
  state.integrity = integrityOf(state);
  return round1(state.integrity - before);
}

/**
 * The number itself. Blended against the starting value by how much record
 * exists, so a freshman's first hard vote does not put them at zero or a hundred
 * — and by the end of a term the record is all of it.
 */
export function integrityOf(state) {
  const weight = state?.convictionWeight || 0;
  if (!weight) return state?.integrity ?? INTEGRITY_START;
  const ratio = (state.convictionKept || 0) / weight;
  const evidence = Math.min(1, weight / EVIDENCE_FOR_A_VERDICT);
  return round1(clamp(INTEGRITY_START * (1 - evidence) + ratio * 100 * evidence));
}

/** What this one vote moved it by, for the card. */
export function integrityDelta(conviction, vote, state) {
  const probe = {
    integrity: state?.integrity ?? INTEGRITY_START,
    convictionKept: state?.convictionKept || 0,
    convictionWeight: state?.convictionWeight || 0,
  };
  return recordConviction(probe, conviction, vote);
}

/**
 * A line naming what this vote was, in the terms that will be used against you.
 *
 * Only the betrayals get a sentence. Voting your beliefs is not news, and a
 * congratulatory note every time you did the obvious thing would drown the
 * moments that matter.
 */
export function describeConviction(conviction, vote, delta) {
  if (vote === "abstain" && conviction.intensity > 35) {
    return `You did not vote on something you have strong views about. That reads as a calculation, because it was one.`;
  }
  if (delta >= 0) return null;
  if (conviction.intensity > 70) {
    return `You voted for a bill you have spent your career calling a betrayal. Somebody will find the quote.`;
  }
  if (conviction.intensity > 35) {
    return `That is not how a ${conviction.ideology} votes, and the people who backed you for being one noticed.`;
  }
  return `A small departure from your stated politics. Nobody will build an advertisement out of it.`;
}

// --- What integrity is worth ------------------------------------------------

/** A career starts with the benefit of the doubt, and not much more. */
export const INTEGRITY_START = 68;

/**
 * How your own base turns out for you, as a multiplier on the personal vote.
 *
 * This is where integrity is finally priced. A member whose base believes them
 * has an operation: volunteers, small donations, people who knock doors in
 * February. One whose base thinks they are a fraud has a primary and a turnout
 * problem, and both of those are worth real points in a close seat.
 */
export function baseTurnout(state) {
  const integrity = state?.integrity ?? INTEGRITY_START;
  // Centred so the starting value is roughly neutral, and bounded so it is a
  // real factor without ever being the only one that matters.
  return round1(clamp((integrity - INTEGRITY_START) * 0.14, -8, 6));
}

/**
 * Whether your own side is looking for somebody else.
 *
 * A primary threat is the specific punishment for having no convictions anybody
 * can name — it comes from your own party, in a seat you would otherwise hold
 * comfortably, and it is what a safe seat's danger actually looks like.
 */
export function primaryThreat(state) {
  const integrity = state?.integrity ?? INTEGRITY_START;
  if (integrity >= 45) return null;
  const severity = integrity < 25 ? "serious" : "gathering";
  return {
    severity,
    integrity,
    note: severity === "serious"
      ? `Your own side is recruiting against you. Nobody can say what you stand for, and in a seat this safe that is the only way to lose it.`
      : `There is talk of a primary. You have taken too many votes that need explaining.`,
  };
}

// --- What an ideology lets you do, and what it never will -------------------


/**
 * The signature of a politics.
 *
 * Two ideologies at the same point on the spectrum with similar bloc effects
 * were mechanically the same object — a Syndicalist and a Degrowth Advocate both
 * sat near -0.9 and played identically. A politics is not only a position; it is
 * a set of things you can do that others cannot and a set you will never do.
 *
 * Hand-authored where an ideology has a distinctive one, derived from its own
 * bloc effects otherwise, so every one of the seventy-eight carries something
 * rather than a favoured handful.
 */
export function traitFor(party, ideology) {
  const found = findIdeology(party, ideology);
  if (found?.trait) return { ...found.trait, authored: true };

  /**
   * Derived from whichever bloc an ideology brings and whichever it drives off.
   *
   * Not as good as a written one and much better than nothing: it is still true
   * about the ideology, because it is read from the same numbers that seed the
   * coalition.
   */
  const fx = ideologyEffects(party, ideology);
  const ranked = Object.entries(fx)
    .filter(([id]) => stakeholderById(id))
    .sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;

  const best = ranked[0];
  const worst = ranked[ranked.length - 1];
  return {
    authored: false,
    strength: best[1] > 0
      ? `${stakeholderById(best[0]).name} open doors for you that stay shut for everybody else.`
      : `You owe nobody anything, which is its own kind of freedom.`,
    limit: worst[1] < 0
      ? `${stakeholderById(worst[0]).name} will never be with you, whatever you offer them.`
      : `Nobody is against you, and nobody is especially for you either.`,
    files: SIGNATURE_DOMAIN[bandOf(found?.axis)] || "economy",
  };
}

/** Which subject a politics is assumed to own, when nobody has said otherwise. */
const SIGNATURE_DOMAIN = {
  left: "social", centreLeft: "health", centre: "economy", centreRight: "security", right: "justice",
};

const bandOf = (axis) => {
  const a = Number(axis) || 0;
  if (a <= -0.55) return "left";
  if (a <= -0.15) return "centreLeft";
  if (a < 0.15) return "centre";
  if (a < 0.55) return "centreRight";
  return "right";
};

/**
 * Whether a bill is the kind this politics was built to write.
 *
 * The concrete half of a trait, and the one that changes a decision: filing in
 * the area your ideology owns is markedly easier than filing outside it, which
 * gives a member a reason to specialise and a reason the specialism was worth
 * choosing at creation.
 */
export const SIGNATURE_BONUS = 16;

export function signatureBonus(scenario, domain) {
  const trait = traitFor(scenario?.party, scenario?.ideology);
  if (!trait?.files) return 0;
  return matchesSignature(trait.files, domain) ? SIGNATURE_BONUS : 0;
}

/**
 * The authored `files` values are subjects rather than the five engine domains,
 * because "antitrust" and "veterans" say something "economy" and "security" do
 * not. This is the bridge.
 */
const SIGNATURE_TO_DOMAIN = {
  agriculture: "economy", housing: "social", antitrust: "economy", veterans: "security",
  health: "health", ethics: "justice", education: "social", defence: "security",
  energy: "health", family: "social", procedure: "justice", trade: "economy",
  warpowers: "security", landuse: "economy", industry: "economy", budget: "economy",
};

export const matchesSignature = (files, domain) =>
  (SIGNATURE_TO_DOMAIN[files] || files) === domain;
