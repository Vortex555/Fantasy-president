import { seeded, hashString, clamp, round1 } from "./rng.js";
import { STATES } from "./states.js";
import { rollCall } from "./bills.js";
import { buildCongress } from "../public/js/data/government.js";

/**
 * Committees, and the ladder above them.
 *
 * The House mode starts as a game about being acted upon: leadership schedules
 * the floor and you vote on what arrives. This is the machinery that inverts
 * it. A backbencher votes; a chair decides whether a bill in their domain ever
 * reaches a vote; a whip can see the count and move it; a Speaker decides what
 * the floor is.
 *
 * Climbing costs the thing a district wants you to spend elsewhere. Rank comes
 * from seniority *and* standing with your caucus, and standing is bought by
 * voting the party line — the exact votes your district is punishing you for.
 * That is the point: the ladder is not a reward for playing well, it is the
 * other side of the trade the whole mode is built on.
 */

export const COMMITTEES = [
  { id: "ways_means", name: "Ways and Means", prestige: 5, domains: ["economy"],
    remit: "Taxes, trade and everything that raises revenue. The oldest committee in the House." },
  { id: "appropriations", name: "Appropriations", prestige: 5, domains: ["economy", "security"],
    remit: "Who gets the money. Nothing is funded without going through this room." },
  { id: "rules", name: "Rules", prestige: 5, domains: ["economy", "health", "justice", "social", "security"],
    remit: "Decides the terms of debate on everything. The Speaker's own committee." },
  { id: "energy_commerce", name: "Energy and Commerce", prestige: 4, domains: ["health"],
    remit: "Health, energy and the grid. The broadest jurisdiction in the House." },
  { id: "judiciary", name: "Judiciary", prestige: 4, domains: ["justice"],
    remit: "Courts, crime, civil liberties — and impeachment, when it comes to that." },
  { id: "armed_services", name: "Armed Services", prestige: 4, domains: ["security"],
    remit: "The military, the bases, and the procurement everybody wants in their district." },
  { id: "financial_services", name: "Financial Services", prestige: 3, domains: ["economy"],
    remit: "Banks, markets and housing. Where the fundraising is easiest." },
  { id: "education_workforce", name: "Education and the Workforce", prestige: 3, domains: ["social"],
    remit: "Schools, labour law and the workforce." },
  { id: "oversight", name: "Oversight and Accountability", prestige: 3, domains: ["justice", "social"],
    remit: "Investigating the executive branch. A platform more than a legislature." },
  { id: "agriculture", name: "Agriculture", prestige: 2, domains: ["economy", "health"],
    remit: "Farms, food and rural districts. Unglamorous and quietly powerful." },
  { id: "veterans", name: "Veterans' Affairs", prestige: 2, domains: ["security", "social"],
    remit: "The one committee nobody attacks you for sitting on." },
];

export const committeeById = (id) => COMMITTEES.find((c) => c.id === id) || null;

/**
 * The ladder. Each rung is a different verb: you vote, then you shape, then you
 * decide whether anybody votes at all, then you decide what the vote is about.
 */
export const RANKS = [
  { id: "member", title: "Member", power: "You vote. That is the whole of it." },
  { id: "subchair", title: "Subcommittee Chair", power: "You can amend a bill in your domain before it reaches the floor." },
  { id: "chair", title: "Committee Chair", power: "You can bury a bill in your domain, or send it out amended. Nothing in your jurisdiction reaches the floor without you." },
  { id: "whip", title: "Majority Whip", power: "You see the whip count before every vote, and you can spend favours to move it." },
  { id: "speaker", title: "Speaker of the House", power: "You set the floor schedule. Nothing is voted on that you did not choose." },
];

export const rankIndex = (id) => Math.max(0, RANKS.findIndex((r) => r.id === id));
export const rankById = (id) => RANKS.find((r) => r.id === id) || RANKS[0];

/** Favours banked per party-line vote, spent later on whipping. */
export const CAPITAL_PER_VOTE = 3;

const partySign = (party) => (party === "Republican" ? 1 : party === "Democrat" ? -1 : 0);

/** Does the member's caucus actually run the chamber? */
function holdsMajority(state) {
  const caucus = state.caucus || state.scenario?.party;
  const c = state.congress || {};
  return caucus === "Republican" ? c.houseR > c.houseD : c.houseD > c.houseR;
}

// --- Committees -------------------------------------------------------------

/**
 * Where you sit.
 *
 * Assignments are handed out by leadership, so they track standing and years —
 * a freshman gets Veterans' Affairs and likes it. Stable per career, because
 * waking up on a different committee would make the whole thing arbitrary.
 */
export function assignCommittee(state) {
  const seniority = state.seat?.seniority || 1;
  const standing = state.leadership ?? 50;
  // What leadership thinks you have earned, on the same 1–5 scale as prestige.
  const earned = 1 + Math.min(4, Math.floor((standing - 30) / 18) + Math.floor(seniority / 2));

  const eligible = COMMITTEES.filter((c) => c.prestige <= earned);
  const pool = eligible.length ? eligible : COMMITTEES.filter((c) => c.prestige <= 2);
  const r = seeded(`${state.rosterSeed}|committee|${state.seat?.district}`);

  // Prefer the best you can get, but not deterministically the same one.
  const best = Math.max(...pool.map((c) => c.prestige));
  const top = pool.filter((c) => c.prestige >= best - 1);
  return r.pick(top).id;
}

/** Whether this bill is yours to touch. */
export function inYourDomain(state, bill) {
  const c = committeeById(state.committee);
  if (!c || !bill?.domain) return false;
  return c.domains.includes(bill.domain);
}

// --- The ladder -------------------------------------------------------------

/**
 * What rank this member has earned.
 *
 * Both currencies are required and neither substitutes for the other: years
 * without standing is a backbencher nobody trusts, standing without years is a
 * freshman nobody owes. The top three rungs additionally require your caucus to
 * run the chamber, because a minority has no gavels to hand out.
 */
export function rankOf(state) {
  const seniority = state.seat?.seniority || 1;
  const standing = state.leadership ?? 50;
  const majority = holdsMajority(state);

  if (majority && seniority >= 5 && standing >= 88) return "speaker";
  if (majority && seniority >= 4 && standing >= 78) return "whip";
  if (majority && seniority >= 3 && standing >= 66) return "chair";
  if (seniority >= 2 && standing >= 56) return "subchair";
  return "member";
}

/**
 * Work out the rank between terms and say what changed.
 *
 * Demotion is as real as promotion. Losing the majority takes the gavel with
 * it, and a member who spent a term voting their district back into a safe
 * seat will find the caucus has noticed.
 */
export function evaluateLadder(state) {
  const next = structuredClone(state);
  const was = next.rank || "member";
  const wasCommittee = next.committee;
  const now = rankOf(next);
  next.rank = now;

  if (!next.committee) {
    next.committee = assignCommittee(next);
  } else if (rankIndex(now) > rankIndex(was)) {
    // A member who has clearly outgrown their committee moves to a better one.
    // Seniority in the House is spent on assignments as much as on gavels, and
    // nobody chairs Agriculture for twenty years by choice.
    const current = committeeById(next.committee);
    const offered = committeeById(assignCommittee(next));
    if (offered && current && offered.prestige > current.prestige) next.committee = offered.id;
    // The Speaker runs Rules. That is what Rules is for.
    if (now === "speaker") next.committee = "rules";
  }

  const movedCommittee = next.committee !== wasCommittee;
  const promoted = rankIndex(now) > rankIndex(was);
  const demoted = rankIndex(now) < rankIndex(was);
  const committee = committeeById(next.committee);

  const note = promoted
    ? `You are ${rankById(now).title === "Member" ? "a Member" : `the ${rankById(now).title}`}` +
      `${now === "chair" || now === "subchair" ? ` of ${committee.name}` : ""}. ${rankById(now).power}` +
      `${movedCommittee && now !== "chair" && now !== "subchair" ? ` You moved to ${committee.name}.` : ""}`
    : demoted
      ? holdsMajority(next)
        ? `The caucus has taken it off you. You are back to ${rankById(now).title}.`
        : `Your party lost the House, and the gavels went with it. You are ${rankById(now).title} now.`
      : `No change — still ${rankById(now).title}${now === "chair" || now === "subchair" ? ` of ${committee.name}` : ""}.`;

  return {
    state: next,
    change: { from: was, to: now, promoted, demoted, movedCommittee, committee: next.committee, note },
  };
}

// --- What a gavel is for ----------------------------------------------------

const CHAIR_RANKS = new Set(["chair", "speaker"]);
const AMEND_RANKS = new Set(["subchair", "chair", "speaker"]);

/**
 * Do something to a bill before anybody votes on it.
 *
 * `bury` kills it in committee — the purest form of power in the House and the
 * least visible. `amend` drags it toward your own politics, which is slower and
 * makes enemies more slowly too.
 */
export function chairAction(state, bill, action) {
  const rank = state.rank || "member";
  if (!inYourDomain(state, bill)) {
    return { state, rejected: true, note: "That is not your committee's jurisdiction." };
  }
  if (action === "bury" && !CHAIR_RANKS.has(rank)) {
    return { state, rejected: true, note: "Only a chair can keep a bill from the floor." };
  }
  if (action === "amend" && !AMEND_RANKS.has(rank)) {
    return { state, rejected: true, note: "You do not hold a gavel." };
  }

  const next = structuredClone(state);
  const anchor = partySign(next.caucus || next.scenario.party) * 0.4;
  const caucusWanted = Math.abs(bill.axis - anchor) < 0.55;
  next.committeeLog = next.committeeLog || [];

  if (action === "bury") {
    // Killing something your own side wanted is remembered.
    const cost = caucusWanted ? 7 : -3;
    next.leadership = clamp(round1(next.leadership - cost));
    next.committeeLog.unshift({
      month: next.month, term: next.term || 1, action: "buried",
      id: bill.id, title: bill.title,
    });
    return {
      state: next,
      result: {
        buried: true, bill,
        note: caucusWanted
          ? `You killed the ${bill.title} in committee. Your own caucus wanted it, and they know where it died.`
          : `You killed the ${bill.title} in committee. Nobody on your side will miss it.`,
      },
    };
  }

  // Amend: drag it a third of the way toward your own politics.
  const own = Number(next.scenario.ideologyAxis) || anchor;
  const moved = round1(bill.axis + (own - bill.axis) * 0.34);
  next.leadership = clamp(round1(next.leadership + 1));
  next.committeeLog.unshift({
    month: next.month, term: next.term || 1, action: "amended",
    id: bill.id, title: bill.title, from: bill.axis, to: moved,
  });
  return {
    state: next,
    result: {
      buried: false,
      bill: { ...bill, axis: moved, amended: true },
      note: `You reported the ${bill.title} out of committee amended — moved from ${bill.axis} to ${moved}.`,
    },
  };
}

// --- The count --------------------------------------------------------------

const COUNT_RANKS = new Set(["whip", "speaker"]);

/**
 * The whip count.
 *
 * Everybody else votes on a guess. A whip walks in knowing the number, which is
 * the entire job — and knowing it three votes short is what makes spending
 * favours a decision rather than a formality.
 */
export function whipCount(state, bill) {
  if (!COUNT_RANKS.has(state.rank || "member")) {
    return { visible: false, note: "You will find out how it went when everybody else does." };
  }
  const roster = buildCongress(state, STATES);
  const tally = rollCall(roster.house, bill.axis);
  const swung = (state.swung || {})[bill.id] || 0;
  const yes = tally.yes + swung;

  return {
    visible: true,
    yes, no: tally.total - yes, total: tally.total,
    threshold: tally.threshold,
    shortBy: Math.max(0, tally.threshold - yes),
    passing: yes >= tally.threshold,
    note: yes >= tally.threshold
      ? `You have it — ${yes} of ${tally.threshold}.`
      : `${tally.threshold - yes} short. ${tally.threshold - yes <= 6 ? "That is a phone call or two." : "That is a real problem."}`,
  };
}

/** Roughly how many votes a favour moves. Diminishing, because they always are. */
const votesFor = (capital) => Math.floor(Math.sqrt(capital) * 1.35);

/**
 * Call in favours. Only a whip or a Speaker has any to call, and the currency
 * is the same standing that got them the job — so whipping a bill through
 * spends the thing that keeps you in the room.
 */
export function spendCapital(state, bill, amount) {
  if (!COUNT_RANKS.has(state.rank || "member")) {
    return { state, rejected: true, note: "Nobody owes you anything yet." };
  }
  const spend = Math.max(0, Math.round(Number(amount) || 0));
  if (spend <= 0) return { state, rejected: true, note: "Spend something or do not." };
  if ((state.capital ?? 0) < spend) {
    return { state, rejected: true, note: `You have ${Math.round(state.capital ?? 0)} favours to call in, not ${spend}.` };
  }

  const next = structuredClone(state);
  next.capital = round1((next.capital ?? 0) - spend);
  const moved = votesFor(spend);
  next.swung = { ...(next.swung || {}), [bill.id]: ((next.swung || {})[bill.id] || 0) + moved };

  return {
    state: next,
    result: {
      moved, spent: spend,
      note: `You worked the floor and moved ${moved} vote${moved === 1 ? "" : "s"}. It cost ${spend} favours you will not have next time.`,
    },
  };
}

/**
 * What a vote banks. Voting the caucus line is how favours accumulate, which is
 * exactly the vote a difficult district is punishing you for.
 */
export function earnCapital(state, voteResult) {
  if (!voteResult) return 0;
  if (voteResult.yourVote === "abstain") return 0;
  return voteResult.party?.delta > 0 ? CAPITAL_PER_VOTE : -1;
}
