import { seeded, hashString, clamp, round1 } from "./rng.js";
import { STATES } from "./states.js";
import { rollCall, consensusOf } from "./bills.js";
import { buildCongress } from "../public/js/data/government.js";
import { findIdeology } from "../public/js/data/ideologies.js";

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
 *
 * **Both chambers run on this file**, which is why almost everything here takes
 * a whole career rather than a number: the rungs, the committee list, the
 * majority that hands out gavels and the size of the room a whip is counting
 * are all different in the Senate, and answering a House question on a
 * senator's behalf produced a Speaker of the House who had never been elected
 * to it. The shape of the ladder is genuinely shared; every quantity on it is
 * not.
 */

/** Which chamber a career is being played in. */
export const chamberOf = (state) => (state?.office === "senate" ? "senate" : "house");

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

/**
 * The Senate's own rooms. Not the House list with different labels — the
 * jurisdictions genuinely differ, and one of them exists in only one chamber:
 * Foreign Relations, where treaties and ambassadors live and where a senator
 * can build a reputation on something the House never gets to vote on.
 */
export const SENATE_COMMITTEES = [
  { id: "s_finance", name: "Finance", prestige: 5, domains: ["economy", "health"],
    remit: "Taxes, trade, Social Security and Medicare. The Senate's answer to Ways and Means." },
  { id: "s_appropriations", name: "Appropriations", prestige: 5, domains: ["economy", "security"],
    remit: "Who gets the money. Every dollar the government spends is written in this room." },
  { id: "s_foreign", name: "Foreign Relations", prestige: 5, domains: ["security"],
    remit: "Treaties, ambassadors and the wars nobody declared. The committee the other chamber does not have." },
  { id: "s_judiciary", name: "Judiciary", prestige: 4, domains: ["justice"],
    remit: "Courts, crime, civil liberties — and every judge the President nominates." },
  { id: "s_armed_services", name: "Armed Services", prestige: 4, domains: ["security"],
    remit: "The military, the bases, and the promotions that do not happen without this room." },
  { id: "s_help", name: "Health, Education, Labor and Pensions", prestige: 4, domains: ["health", "social"],
    remit: "Health, schools and labour law. Broad, and quietly enormous." },
  { id: "s_intelligence", name: "Intelligence", prestige: 4, domains: ["security", "justice"],
    remit: "What the agencies are actually doing, in a room with no windows." },
  { id: "s_banking", name: "Banking, Housing and Urban Affairs", prestige: 3, domains: ["economy"],
    remit: "Banks, markets, housing — and the Fed chair's confirmation hearing." },
  { id: "s_commerce", name: "Commerce, Science and Transportation", prestige: 3, domains: ["economy", "health"],
    remit: "Trade, transport, telecoms and the sciences." },
  { id: "s_rules", name: "Rules and Administration", prestige: 3, domains: ["justice", "social"],
    remit: "The chamber's own procedure, and the federal elections it runs." },
  { id: "s_agriculture", name: "Agriculture, Nutrition and Forestry", prestige: 2, domains: ["economy", "health"],
    remit: "Farms, food and the states everybody flies over. Unglamorous and quietly powerful." },
  { id: "s_veterans", name: "Veterans' Affairs", prestige: 2, domains: ["security", "social"],
    remit: "The one committee nobody attacks you for sitting on." },
];

/** The rooms this member could possibly sit in. */
export const committeesFor = (state) =>
  (chamberOf(state) === "senate" ? SENATE_COMMITTEES : COMMITTEES);

/**
 * Ids are unique across both tables, so a committee resolves without being told
 * which chamber asked. That matters for saved careers: a senator stored on a
 * House committee before the two lists were separated still renders, and
 * `evaluateLadder` moves them off it at the next term.
 */
const ALL_COMMITTEES = [...COMMITTEES, ...SENATE_COMMITTEES];

export const committeeById = (id) => ALL_COMMITTEES.find((c) => c.id === id) || null;

/**
 * The ladder. Each rung is a different verb: you vote, then you shape, then you
 * decide whether anybody votes at all, then you decide what the vote is about.
 *
 * The rungs are the same in both chambers because the powers are the same. The
 * names are not: the Senate has no Speaker, and its top job is held by somebody
 * the whole chamber has to keep tolerating rather than formally elect.
 */
export const RANKS = [
  { id: "member", title: "Member", power: "You vote. That is the whole of it." },
  { id: "subchair", title: "Subcommittee Chair", power: "You can amend a bill in your domain before it reaches the floor." },
  { id: "chair", title: "Committee Chair", power: "You can bury a bill in your domain, or send it out amended. Nothing in your jurisdiction reaches the floor without you." },
  { id: "whip", title: "Majority Whip", power: "You see the whip count before every vote, and you can spend favours to move it." },
  { id: "speaker", title: "Speaker of the House", power: "You set the floor schedule. Nothing is voted on that you did not choose." },
];

export const SENATE_RANKS = [
  { id: "member", title: "Senator", power: "You vote — and you can stop the chamber on your own, which no backbencher in the other chamber can." },
  { id: "subchair", title: "Subcommittee Chair", power: "You can amend a bill in your domain before it reaches the floor." },
  { id: "chair", title: "Committee Chair", power: "You can bury a bill in your domain, or send it out amended. Nothing in your jurisdiction reaches the floor without you." },
  { id: "whip", title: "Majority Whip", power: "You see the count before every vote, and you can spend favours to move it." },
  { id: "speaker", title: "Senate Majority Leader", power: "You decide what the chamber votes on and when. Nothing is scheduled that you did not schedule." },
];

export const ranksFor = (state) =>
  ((typeof state === "string" ? state : chamberOf(state)) === "senate" ? SENATE_RANKS : RANKS);

/** The rungs are shared, so an index is chamber-independent. */
export const rankIndex = (id) => Math.max(0, RANKS.findIndex((r) => r.id === id));

export const rankById = (id, chamber = "house") => {
  const table = ranksFor(chamber);
  return table.find((r) => r.id === id) || table[0];
};

/** Favours banked per party-line vote, spent later on whipping. */
export const CAPITAL_PER_VOTE = 3;

const partySign = (party) => (party === "Republican" ? 1 : party === "Democrat" ? -1 : 0);

/**
 * Does the member's caucus actually run the chamber they sit in?
 *
 * *Their* chamber. A senator's gavel has nothing to do with who runs the House,
 * and reading the House columns for both meant a senator in a 55-seat majority
 * could be denied a committee because of an election in a building across the
 * road.
 */
function holdsMajority(state) {
  const caucus = state.caucus || state.scenario?.party;
  const c = state.congress || {};
  const [mine, theirs] = chamberOf(state) === "senate"
    ? [c.senateR, c.senateD]
    : [c.houseR, c.houseD];
  return caucus === "Republican" ? mine > theirs : theirs > mine;
}

/** What the chamber's name is, for the sentences that have to say it. */
const chamberName = (state) => (chamberOf(state) === "senate" ? "Senate" : "House");

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

  const table = committeesFor(state);
  const eligible = table.filter((c) => c.prestige <= earned);
  const pool = eligible.length ? eligible : table.filter((c) => c.prestige <= 2);
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
/**
 * The gates, per chamber: [terms served, standing with the caucus].
 *
 * The standing required is identical, because being trusted is being trusted.
 * The years are not, and cannot be: a House term is two years and a Senate term
 * is six, so the House's five-term Speakership would be thirty years in the
 * Senate — longer than any career here runs. Four Senate terms is twenty-four
 * years, which is about what leading the chamber has historically cost.
 */
const LADDER = {
  house: { speaker: [5, 88], whip: [4, 78], chair: [3, 66], subchair: [2, 56] },
  senate: { speaker: [4, 88], whip: [3, 78], chair: [2, 66], subchair: [2, 54] },
};

/** The three rungs that only exist for a caucus that runs the chamber. */
const GAVEL_RANKS = ["speaker", "whip", "chair"];

export function rankOf(state) {
  const seniority = state.seat?.seniority || 1;
  const standing = state.leadership ?? 50;
  const majority = holdsMajority(state);
  const gates = LADDER[chamberOf(state)];

  const earns = (id) => seniority >= gates[id][0] && standing >= gates[id][1];
  for (const id of GAVEL_RANKS) if (majority && earns(id)) return id;
  if (earns("subchair")) return "subchair";
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
  const chamber = chamberOf(next);
  const was = next.rank || "member";

  const wasCommittee = next.committee;
  const now = rankOf(next);
  next.rank = now;

  // A career that predates the two committee lists being separated can be
  // sitting in the other chamber's room. Put them where they actually work.
  const seated = committeesFor(next).some((c) => c.id === next.committee);

  if (!next.committee || !seated) {
    next.committee = assignCommittee(next);
  } else if (rankIndex(now) > rankIndex(was)) {
    // A member who has clearly outgrown their committee moves to a better one.
    // Seniority in the House is spent on assignments as much as on gavels, and
    // nobody chairs Agriculture for twenty years by choice.
    const current = committeeById(next.committee);
    const offered = committeeById(assignCommittee(next));
    if (offered && current && offered.prestige > current.prestige) next.committee = offered.id;
    // The Speaker runs Rules. That is what Rules is for — in the House. The
    // Senate's leader schedules the floor without owning a room to do it from,
    // so they keep whichever committee their seniority earned them.
    if (now === "speaker" && chamber === "house") next.committee = "rules";
  }

  const movedCommittee = next.committee !== wasCommittee;
  const promoted = rankIndex(now) > rankIndex(was);
  const demoted = rankIndex(now) < rankIndex(was);
  const committee = committeeById(next.committee);
  const title = (id) => rankById(id, chamber).title;

  const note = promoted
    ? `You are ${/^(Member|Senator)$/.test(title(now)) ? `a ${title(now)}` : `the ${title(now)}`}` +
      `${now === "chair" || now === "subchair" ? ` of ${committee.name}` : ""}. ${rankById(now, chamber).power}` +
      `${movedCommittee && now !== "chair" && now !== "subchair" ? ` You moved to ${committee.name}.` : ""}`
    : demoted
      ? holdsMajority(next)
        ? `The caucus has taken it off you. You are ${now === "member" ? "on the back bench" : `back to ${title(now)}`}.`
        : `Your party lost the ${chamberName(next)}, and the gavels went with it. ` +
          `You are ${now === "member" ? "a backbencher again" : `${title(now)} now`}.`
      : `No change — still ${title(now)}${now === "chair" || now === "subchair" ? ` of ${committee.name}` : ""}.`;

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
  /**
   * Both axes, or the gavel cannot touch the bills it most wants to.
   *
   * A chair amending a surveillance bill is not adjusting its economics — the
   * amendment *is* the warrant requirement. Moving only the axis left the one
   * dimension such a bill is actually about frozen, so the committee power
   * silently did nothing on exactly the legislation it matters most for.
   */
  const ownLiberty = Number(next.scenario.ideologyLiberty) || 0;
  const movedLiberty = round1((Number(bill.liberty) || 0)
    + (ownLiberty - (Number(bill.liberty) || 0)) * 0.34);
  next.leadership = clamp(round1(next.leadership + 1));
  next.committeeLog.unshift({
    month: next.month, term: next.term || 1, action: "amended",
    id: bill.id, title: bill.title, from: bill.axis, to: moved,
  });
  return {
    state: next,
    result: {
      buried: false,
      bill: { ...bill, axis: moved, liberty: movedLiberty, amended: true },
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
  // Count the room you are standing in. A senate whip walked in knowing a
  // House number, which was both wrong and 335 votes too large.
  const tally = rollCall(roster[chamberOf(state)], bill, { consensus: consensusOf(bill) });
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
/**
 * How far a member's debts actually reach.
 *
 * Favours were banked by every member on every party-line vote and could only
 * ever be spent by two ranks, so for most of a career the counter on the floor
 * was a number that went up and did nothing else — not promotion, not a hearing
 * for your own bill, not one line in your record. A committee chair could sit on
 * eighty of them and be told "nobody owes you anything yet".
 *
 * They are all spendable now, and rank decides reach rather than permission.
 * A backbencher can lean on the two or three colleagues who owe them personally
 * — which is genuinely what a member does, and enough to matter on a knife-edge
 * roll call and useless on a lopsided one. A whip is owed by the whole caucus
 * and can move a bloc. That difference is what the job *is*, and it survives
 * intact without pretending the backbencher has no hand to play at all.
 */
const REACH = {
  member: { pull: 0.35, cap: 3 },
  subchair: { pull: 0.5, cap: 4 },
  chair: { pull: 0.7, cap: 6 },
  whip: { pull: 1, cap: 24 },
  speaker: { pull: 1.15, cap: 28 },
};

export const reachOf = (rank) => REACH[rank] || REACH.member;

/**
 * Diminishing, so a hoard is worth less per favour than a handful — you are
 * calling in the willing first and the reluctant afterwards.
 */
export const votesFor = (capital, rank = "member") => {
  const { pull, cap } = reachOf(rank);
  return Math.min(cap, Math.floor(Math.sqrt(Math.max(0, capital)) * 1.35 * pull));
};

/** The cheapest spend that would actually move a vote at this rank. */
export function priceOfAVote(rank = "member") {
  for (let c = 1; c <= 400; c++) if (votesFor(c, rank) >= 1) return c;
  return 400;
}

/**
 * Call in favours. Only a whip or a Speaker has any to call, and the currency
 * is the same standing that got them the job — so whipping a bill through
 * spends the thing that keeps you in the room.
 */
export function spendCapital(state, bill, amount) {
  const rank = state.rank || "member";
  const spend = Math.max(0, Math.round(Number(amount) || 0));
  if (spend <= 0) return { state, rejected: true, note: "Spend something or do not." };
  if ((state.capital ?? 0) < spend) {
    return { state, rejected: true, note: `You have ${Math.round(state.capital ?? 0)} favours to call in, not ${spend}.` };
  }

  const moved = votesFor(spend, rank);
  // Refuse a spend that buys nothing rather than taking it and shrugging. At a
  // backbencher's reach a couple of favours genuinely will not move anybody, and
  // they should be told the price instead of losing them.
  if (moved < 1) {
    const need = priceOfAVote(rank);
    return {
      state, rejected: true,
      note: `${spend} favour${spend === 1 ? "" : "s"} will not move anybody at your rank. ` +
        `You would need about ${need}.`,
    };
  }

  const next = structuredClone(state);
  next.capital = round1((next.capital ?? 0) - spend);
  next.swung = { ...(next.swung || {}), [bill.id]: ((next.swung || {})[bill.id] || 0) + moved };

  const { cap } = reachOf(rank);
  return {
    state: next,
    result: {
      moved, spent: spend, cap,
      note: `You worked the floor and moved ${moved} vote${moved === 1 ? "" : "s"}. ` +
        `It cost ${spend} favours you will not have next time.` +
        (moved >= cap ? ` That is as far as ${rank === "member" ? "a backbencher's" : "your"} debts reach.` : ""),
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
