import { seeded, clamp, round1 } from "./rng.js";
import { STATES } from "./states.js";
import { buildCongress } from "../public/js/data/government.js";
import { earnCapital } from "./committees.js";

/**
 * Advice and consent.
 *
 * The House writes the money bills and the Senate has the filibuster, but the
 * power that genuinely belongs to one chamber and not the other is this one: a
 * president can nominate whoever they like and it means nothing until fifty-one
 * senators say so. It is also the only vote in the game whose consequences
 * outlive everybody voting — a justice confirmed at forty-eight is still there
 * when the senator who confirmed them is a plaque.
 *
 * The bind is the same one the rest of the mode runs on, with a third axis that
 * changes its shape. An ordinary bill splits your caucus from your state on
 * politics. A nomination adds **whether the nominee can do the job**, and that
 * is what makes it interesting: a president's own senator, facing a transparent
 * hack, cannot vote against them without breaking ranks and cannot vote for
 * them without owning it for as long as the appointment lasts. The caucus knows
 * it too, which is why it whips less hard for somebody indefensible.
 */

/**
 * The offices worth a floor vote. `weight` is how much of a career this vote
 * becomes — a Supreme Court seat is the vote a senator is remembered for, and a
 * Surgeon General is a Tuesday.
 */
export const POSTS = [
  {
    id: "scotus", title: "Associate Justice of the Supreme Court", kind: "court",
    lifetime: true, weight: 1.45, tenure: "for life",
    remit: "one of nine votes on everything the country cannot agree on",
  },
  {
    id: "circuit", title: "Judge of the Court of Appeals", kind: "court",
    lifetime: true, weight: 1.0, tenure: "for life",
    remit: "the last word on federal law for a fifth of the country",
  },
  {
    id: "attorney_general", title: "Attorney General", kind: "cabinet",
    lifetime: false, weight: 1.2, tenure: "at the President's pleasure",
    remit: "the Justice Department, and every investigation that touches this administration",
  },
  {
    id: "secretary_state", title: "Secretary of State", kind: "cabinet",
    lifetime: false, weight: 1.1, tenure: "at the President's pleasure",
    remit: "the State Department and every negotiation the country is in the middle of",
  },
  {
    id: "secretary_defense", title: "Secretary of Defense", kind: "cabinet",
    lifetime: false, weight: 1.1, tenure: "at the President's pleasure",
    remit: "the Pentagon, the posture and the chain of command below the President",
  },
  {
    id: "fed", title: "Chair of the Federal Reserve", kind: "institution",
    lifetime: false, weight: 1.15, tenure: "for a four-year term",
    remit: "interest rates, inflation and how expensive it is to borrow money in this country",
  },
  {
    id: "fbi", title: "Director of the FBI", kind: "institution",
    lifetime: false, weight: 1.05, tenure: "for a ten-year term",
    remit: "federal law enforcement, for two and a half presidencies",
  },
  {
    id: "ambassador_un", title: "Ambassador to the United Nations", kind: "cabinet",
    lifetime: false, weight: 0.8, tenure: "at the President's pleasure",
    remit: "the country's public argument with the rest of the world",
  },
  {
    id: "surgeon_general", title: "Surgeon General", kind: "institution",
    lifetime: false, weight: 0.7, tenure: "for a four-year term",
    remit: "public-health guidance the country may or may not follow",
  },
];

/** Court seats do not come up often, and everything else comes up more. */
const RARITY = { court: 0.7, cabinet: 1.25, institution: 1 };

/** Confirmation is a simple majority of the whole chamber. */
export const CONFIRM_THRESHOLD = 51;
const SEATS = 100;

/** Roughly one vacancy a year. Over six years that is a handful, not a queue. */
const VACANCY_CHANCE = 0.09;

const FIRST = ["Beatriz", "Alastair", "Nkechi", "Roderick", "Simone", "Idris", "Marisol",
  "Thaddeus", "Yusuf", "Coretta", "Lachlan", "Ingrid", "Amara", "Desmond", "Rosalind"];
const LAST = ["Halloran", "Whitlock", "Adeyemi", "Cardoza", "Brightwater", "Nakashima",
  "Stroud", "Ferreira", "Okonjo", "Lindqvist", "Pemberton", "Ashcombe", "Delacroix"];

export const emptyNomination = () => null;

export const nominationPending = (state) => Boolean(state?.nomination?.post);

const isSenate = (state) => state?.office === "senate";

// --- Somebody has to fill it ------------------------------------------------

/**
 * A vacancy, and the President's answer to it.
 *
 * Seeded per month, so a career either has a Supreme Court fight in it or does
 * not, and a given seed always produces the same one. A nomination sits on the
 * floor until it is voted on — the Senate can take its time, but it cannot make
 * the seat go away by ignoring it, and no second nomination arrives while one is
 * pending.
 */
export function tickNomination(state) {
  if (!isSenate(state)) return { state, event: null };
  if (nominationPending(state)) return { state, event: null };

  const r = seeded(`${state.rosterSeed}|nomination|${state.term || 1}|${state.month}`);
  const posts = POSTS.filter((p) => postAvailable(state, p));
  if (!posts.length) return { state, event: null };

  const weights = posts.map((p) => RARITY[p.kind] ?? 1);
  if (!r.chance(VACANCY_CHANCE)) return { state, event: null };

  const post = r.weighted(posts, weights);
  const nominee = buildNominee(state, post, r);
  const nomination = { post, nominee, month: state.month, term: state.term || 1 };

  return {
    state: { ...state, nomination },
    event: {
      kind: "nomination",
      title: `${nominee.name} for ${post.title}`,
      detail: `President ${state.president?.name} has sent up ${nominee.name} to serve as ` +
        `${post.title}. The Senate will vote, and nothing happens until it does.`,
      unqualified: nominee.unqualified,
    },
  };
}

/**
 * Whether this seat can come up now.
 *
 * A confirmed office is gone for the rest of the career — a senator does not
 * confirm four Fed chairs. A *rejected* one genuinely does come back, because
 * the seat is still empty and the President still has to fill it, but not the
 * following month: they have to go and find somebody the chamber will take, and
 * that takes the better part of a year.
 */
const REFILL_DELAY = 9;

/** Months into the career, so a delay survives a term boundary. */
const careerMonth = (state, month = state.month, term = state.term) =>
  ((term || 1) - 1) * 72 + (month || 1);

export function postAvailable(state, post) {
  const log = (state.confirmations || []).filter((c) => c.postId === post.id);
  if (log.some((c) => c.confirmed)) return false;
  const last = log[log.length - 1];
  if (!last) return true;
  return careerMonth(state) - careerMonth(state, last.month, last.term) >= REFILL_DELAY;
}

/**
 * Who the President sends up.
 *
 * Mostly their own politics, sometimes further out than that, and occasionally
 * somebody who has no business in the room — which is the nomination worth
 * playing. Competence and ideology are drawn separately on purpose: a brilliant
 * ideologue and an incompetent moderate are both real, and they are opposite
 * problems.
 */
function buildNominee(state, post, r) {
  const potus = state.president || {};
  const party = potus.party === "Republican" ? "Republican" : "Democrat";
  const sign = party === "Republican" ? 1 : -1;

  // How far past the President the pick sits. Occasionally a long way.
  const stretch = r.chance(0.24) ? r.between(20, 48) / 100 : r.between(0, 16) / 100;
  const axis = round1(clamp((potus.axis ?? sign * 0.4) + sign * stretch, -1, 1));

  // Roughly one nominee in six is indefensible on the merits.
  const unqualified = r.chance(0.17);
  const competence = unqualified ? r.between(12, 38) : r.between(58, 96);

  return {
    name: `${r.pick(FIRST)} ${r.pick(LAST)}`,
    party, axis,
    competence,
    independence: unqualified ? r.between(4, 26) : r.between(30, 82),
    unqualified,
    pitch: unqualified
      ? `A political appointment, and not a subtle one. ${post.kind === "court" ? "They have never tried a case." : "They have never run anything."}`
      : `A serious pick. Whether that makes them easier or harder to vote against depends on where you sit.`,
  };
}

// --- Where everybody stands -------------------------------------------------

const AGREEMENT = (a, b) => 1 - Math.abs(a - b) / 2;

/**
 * The three pressures, named.
 *
 * The caucus cares whose President it is and almost nothing else — except that
 * an indefensible nominee is one they will not spend capital on, which is the
 * gap a senator of the President's own party can walk through.
 */
export function nominationStance(state) {
  const nom = state.nomination;
  if (!nom) return null;
  const { post, nominee } = nom;
  const potus = state.president || {};
  const caucus = state.caucus || state.scenario?.party;
  const ownParty = potus.party === caucus;

  // How hard the caucus is leaning, discounted by how defensible the pick is.
  const defensibility = clamp((nominee.competence - 30) / 60, 0, 1);
  const partyIntensity = clamp(Math.round((58 + defensibility * 34) * post.weight), 20, 100);

  const homeAxis = state.seat?.axis ?? 0;
  const fit = AGREEMENT(homeAxis, nominee.axis);
  // A state forgives a distant nominee who is plainly good at the job.
  const forgiveness = (nominee.competence - 55) / 100 * 0.12;
  const position = fit + forgiveness >= 0.72 ? "yes" : "no";
  const homeIntensity = clamp(
    Math.round(Math.abs(fit + forgiveness - 0.72) * 220 * post.weight), 10, 100);

  return {
    post, nominee, ownParty,
    party: {
      position: ownParty ? "yes" : "no",
      intensity: partyIntensity,
      reason: ownParty
        ? nominee.unqualified
          ? `${potus.name} wants them confirmed. Leadership is asking rather than telling, which tells you something.`
          : `The President is yours, and this is what a President's own majority is for.`
        : nominee.unqualified
          ? `The caucus intends to make an example of this one, and has the material.`
          : `The caucus will not hand ${potus.name} ${post.kind === "court" ? "a seat for thirty years" : "this department"} without a fight.`,
    },
    district: {
      position,
      intensity: homeIntensity,
      reason: position === "yes"
        ? `${state.seat?.stateName} has no objection to ${nominee.name}.`
        : `${state.seat?.stateName} did not ask for somebody at ${nominee.axis > 0 ? "that end" : "this end"} of the spectrum.`,
      pressureNote: post.lifetime
        ? `This one is ${post.tenure}. Your state will still be living with it when you are not.`
        : `An appointment ${post.tenure}.`,
    },
    qualification: {
      competence: nominee.competence,
      unqualified: Boolean(nominee.unqualified),
      note: nominee.unqualified
        ? `On the merits there is no case for them, and everybody in the room knows it. ` +
          `Voting for them is a thing you own.`
        : `They can do the job. That is not the same as agreeing with them, and it is the ` +
          `argument you would have to answer.`,
    },
  };
}

// --- The roll call ----------------------------------------------------------

/**
 * The rule, on its own, because a fifty-fifty confirmation is the whole reason
 * anybody cares who the Vice President is.
 */
export function resolveConfirmation(yes, seats = SEATS) {
  const no = seats - yes;
  const tied = yes === no;
  return {
    yes, no, total: seats, threshold: CONFIRM_THRESHOLD,
    confirmed: yes >= CONFIRM_THRESHOLD || tied,
    brokenByVp: tied,
  };
}

/**
 * The other ninety-nine.
 *
 * You are one of a hundred, not the hundred and first, so a seat on your own
 * side is taken out of the roster and replaced by your actual vote. That is
 * what makes fifty-fifty reachable and your own vote decisive rather than
 * decorative.
 */
function othersInChamber(state) {
  const roster = buildCongress(state, STATES).senate;
  const caucus = state.caucus || state.scenario?.party;
  const seat = roster.findIndex((m) => m.party === caucus);
  return seat === -1 ? roster.slice(1) : [...roster.slice(0, seat), ...roster.slice(seat + 1)];
}

/**
 * How a senator who is not you votes on a nominee.
 *
 * Party first, because confirmations are more party-line than legislation.
 * Then distance, then the merits — and the merits are weighted far more heavily
 * across the aisle than within it. "Qualified" is the only argument that ever
 * moves an opposition vote; within the President's own party, an indefensible
 * nominee costs them the senators who were already furthest from the pick, and
 * a dozen of those is the difference between confirmed and not. It does not
 * cost them fifty — a party that abandoned its own President that completely
 * would not have nominated them.
 */
function supports(member, nominee) {
  const sameSide = member.party === nominee.party;
  const distance = Math.abs(member.axis - nominee.axis);
  const merit = (nominee.competence - 55) / 100;
  const score = sameSide
    ? 0.80 - distance * 0.30 + merit * 0.30
    : 0.10 - distance * 0.25 + merit * 1.40;
  return score >= 0.5;
}

/** The chamber's answer, with your vote in it. */
export function confirmationTally(state, vote = "abstain") {
  const nom = state.nomination;
  if (!nom) return null;
  const { nominee } = nom;

  let yes = 0, crossed = 0, defected = 0;
  for (const member of othersInChamber(state)) {
    const backs = supports(member, nominee);
    if (backs) yes += 1;
    if (backs && member.party !== nominee.party) crossed += 1;
    if (!backs && member.party === nominee.party) defected += 1;
  }
  if (vote === "yes") yes += 1;

  return { ...resolveConfirmation(yes), crossed, defected, yourVote: vote };
}

// --- Casting it -------------------------------------------------------------

const STATE_SWING = 11;
const LEADERSHIP_SWING = 9;

/**
 * Vote on the nomination.
 *
 * Heavier than an ordinary bill in both directions and scaled by the office —
 * a Supreme Court seat moves everything by half again — and, like every senate
 * vote, the damage at home is banked as a grudge that fades rather than a wound
 * that does not. Six years is long enough to be forgiven for a judge. It is not
 * long enough if you did it in year five.
 */
export function confirmVote(state, vote) {
  if (!["yes", "no", "abstain"].includes(vote)) {
    return { state, rejected: true, note: "Vote to confirm, vote to reject, or abstain." };
  }
  if (!nominationPending(state)) {
    return { state, rejected: true, note: "There is no nomination before the chamber." };
  }

  const next = structuredClone(state);
  const nom = next.nomination;
  const { post, nominee } = nom;
  const stance = nominationStance(next);
  const weight = post.weight;

  const withHome = vote === stance.district.position;
  const withParty = vote === stance.party.position;

  const homeDelta = vote === "abstain"
    ? -round1(stance.district.intensity / 100 * 3 * weight)
    : round1((withHome ? 1 : -1) * (stance.district.intensity / 100) * STATE_SWING * weight);
  const leadershipDelta = vote === "abstain"
    ? -round1(LEADERSHIP_SWING * 0.5 * weight)
    : round1((withParty ? 1 : -1) * (stance.party.intensity / 100) * LEADERSHIP_SWING * weight);

  next.approval = clamp(round1(next.approval + homeDelta));
  next.leadership = clamp(round1(next.leadership + leadershipDelta));

  const title = `${post.title}: ${nominee.name}`;
  if (homeDelta < -0.5) {
    next.grudges = [...(next.grudges || []), {
      id: `confirm-${post.id}`, title, weight: Math.abs(homeDelta),
      month: next.month, term: next.term || 1,
    }];
  }

  const tally = confirmationTally(next, vote);
  /**
   * Decisive means exactly one thing: without your vote this fails.
   *
   * Which is *not* the fifty-first vote. At 51–49 the chamber would have been
   * tied without you and the Vice President would have confirmed them anyway.
   * The vote that genuinely decides it is the fiftieth — the one that turns a
   * 49–51 defeat into a tie for the Vice President to break.
   */
  const decisive = vote === "yes" && tally.brokenByVp;

  next.confirmations = [...(next.confirmations || []), {
    postId: post.id, post: post.title, kind: post.kind, lifetime: post.lifetime,
    nominee: nominee.name, axis: nominee.axis, competence: nominee.competence,
    unqualified: Boolean(nominee.unqualified),
    vote, confirmed: tally.confirmed, withParty, withDistrict: withHome,
    month: next.month, term: next.term || 1,
  }];

  next.voteLog = [...(next.voteLog || []), {
    id: `confirm-${post.id}`, title, axis: nominee.axis, vote,
    month: next.month, term: next.term || 1,
    withDistrict: withHome, withParty, passed: tally.confirmed,
    confirmation: true, lifetime: post.lifetime,
  }];

  next.nomination = null;

  const result = {
    post, nominee, yourVote: vote, decisive,
    confirmed: tally.confirmed, tally, stance,
    district: { ...stance.district, delta: homeDelta },
    party: { ...stance.party, delta: leadershipDelta },
    note: describe({ vote, withParty, withHome, tally, post, nominee, decisive }),
  };

  const banked = earnCapital(next, result);
  next.capital = Math.max(0, round1((next.capital || 0) + banked));
  result.capital = { banked, total: next.capital };

  return { state: next, result };
}

function describe({ vote, withParty, withHome, tally, post, nominee, decisive }) {
  const outcome = tally.confirmed
    ? `${nominee.name} is confirmed ${tally.yes}–${tally.no}` +
      `${tally.brokenByVp ? ", the Vice President breaking the tie" : ""}.` +
      (post.lifetime
        ? ` They are ${post.title.replace(/^(An?|The) /, "")} ${post.tenure} — a decision with no expiry and no appeal.`
        : ` They run it ${post.tenure}.`)
    : `${nominee.name} is rejected ${tally.yes}–${tally.no}. The seat stays empty and the President ` +
      `has to find somebody the chamber will take.`;

  if (decisive) {
    return `${outcome} Yours was the vote that did it, and there is no version of the record ` +
      `where that is not the case.`;
  }
  if (vote === "abstain") {
    return `You did not vote on ${nominee.name}. ${outcome} Nobody accepts that as a position.`;
  }
  if (nominee.unqualified && vote === "yes" && withParty) {
    return `${outcome} You voted for somebody who cannot do the job because your President asked you ` +
      `to, and that is the version that gets read back to you.`;
  }
  if (nominee.unqualified && vote === "no" && !withParty) {
    return `${outcome} You broke with your own President over a nominee nobody could defend. ` +
      `Leadership is furious and everybody else understands exactly why you did it.`;
  }
  if (withParty && withHome) return `${outcome} Nobody had to be disappointed.`;
  if (withParty) return `${outcome} You held with the caucus, and your state noticed which way you went.`;
  if (withHome) return `${outcome} You voted your state against your caucus on a nomination, which ` +
    `leadership counts differently from a bill.`;
  return `${outcome} You voted against your caucus and your state at once. That is a position, at least.`;
}

/** What a career's advice and consent adds up to, for the record. */
export function confirmationRecord(state) {
  const log = state.confirmations || [];
  return {
    total: log.length,
    confirmed: log.filter((c) => c.confirmed).length,
    lifetime: log.filter((c) => c.lifetime && c.confirmed && c.vote === "yes").length,
    blocked: log.filter((c) => !c.confirmed && c.vote === "no").length,
    brokeRanks: log.filter((c) => !c.withParty && c.vote !== "abstain").length,
    hacks: log.filter((c) => c.unqualified && c.vote === "yes").length,
  };
}
