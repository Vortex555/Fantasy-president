import { seeded, clamp, round1 } from "./rng.js";
import { STATES, STATE_CODES } from "./states.js";
import { BILL_POOL, rollCall, consensusOf } from "./bills.js";
import { senateCycle, senateRaces, nationalEnvironment, runCongressionalCycle } from "./elections.js";
import { buildCongress } from "../public/js/data/government.js";
import {
  partyLine, districtView, caucusOf, districtAxis, seedCongress,
  driftPresident, electionIndex, isElectionMonth, applyCycle, floorPool, votedThisCongress,
  seatFringe, closeTheMonth,
} from "./house.js";
import { assignCommittee, earnCapital, evaluateLadder, committeeById, isWrecker } from "./committees.js";
import { emptyArticles, tickArticles } from "./articles.js";
import { nextChoices } from "./career.js";
import { emptyNomination, tickNomination } from "./confirmations.js";
import { seedNation, advanceNation } from "./nation.js";
import { activeArcs } from "./arcs.js";
import { stateProfile, seedCountry } from "./demographics.js";
import { buildSociety } from "./society.js";
import { applyConsequence, applyMigration } from "./consequence.js";
import { noteEvent, EVENT } from "./chronicle.js";
import {
  convictionView, recordConviction, describeConviction, baseTurnout, primaryThreat,
  INTEGRITY_START, signatureBonus,
} from "./conviction.js";
import {
  factionOf, factionLine, blocDelta, describeBloc, ownBloc, BLOC_START,
} from "./factions.js";
import {
  buildCoalition, applyVoteToCoalition, coalitionTurnout,
} from "./coalition.js";

/**
 * A seat in the Senate.
 *
 * Everything the House mode taught applies — leadership schedules, you vote,
 * your state and your caucus want different things — but three facts change the
 * game completely, and they are the whole reason this is a separate chamber
 * rather than a longer House career.
 *
 * **Six years.** A member of the House is always eighteen months from the
 * voters and can never take a vote the district will remember. A senator can,
 * because by the time they are on the ballot the vote is four years old and the
 * state has half forgotten it. Unpopular votes decay here. That is not a
 * kindness — it is what makes the chamber capable of doing unpopular things.
 *
 * **A hundred people.** One vote in a hundred is worth four and a third of one
 * in four hundred and thirty-five, and fifty-fifty is a real number rather than
 * a rounding error. You will personally decide things.
 *
 * **You can stop the chamber on your own.** Any senator can filibuster. It is
 * the only power in either mode that a first-term backbencher holds outright,
 * and it costs exactly what you would expect.
 */

export const SENATE_TERM = 72;          // months — six years
export const CLOTURE = 60;              // votes to break a filibuster

/**
 * How fast a state forgets a vote it disliked.
 *
 * The single most important number in the mode. At zero a senator is a House
 * member with a longer wait; too high and nothing they do matters. This decays
 * roughly two thirds of an unpopular vote's damage over a six-year term, which
 * leaves early bravery survivable and late bravery fatal.
 */
const MEMORY_DECAY = 0.045;

const partySign = (party) => (party === "Republican" ? 1 : party === "Democrat" ? -1 : 0);

// --- Getting a seat ---------------------------------------------------------

export function seatForState(state, code) {
  const info = STATES[code];
  if (!info || code === "DC") return null;
  return {
    state: code,
    stateName: info.name,
    district: code,          // a senator's constituency is the whole state
    lean: info.lean,
    axis: districtAxis(info.lean),
    seniority: 1,
    class: null,             // filled in at creation, from the cycle
    committee: null,
  };
}

/**
 * States worth choosing between. Same three games as the House — safe, marginal
 * and hostile ground — but a statewide constituency is far harder to be extreme
 * in, because you cannot be drawn a district that agrees with you.
 */
export function stateOptions(state, party = state.scenario?.party) {
  const sign = partySign(party) || -1;
  const favour = (code) => sign * (STATES[code].lean ?? 0);
  const codes = STATE_CODES.filter((c) => c !== "DC");

  const pick = (list, kind, n) => list.slice(0, n).map((code) => ({
    kind, state: code, stateName: STATES[code].name,
    lean: STATES[code].lean, ev: STATES[code].ev, favour: round1(favour(code)),
  }));

  const byFavour = [...codes].sort((a, b) => favour(b) - favour(a));
  const marginal = [...codes].sort((a, b) => Math.abs(favour(a)) - Math.abs(favour(b)));

  return [
    ...pick(byFavour, "safe", 2),
    ...pick(marginal, "marginal", 3),
    ...pick([...byFavour].reverse(), "hostile", 2),
  ];
}

const FIRST = ["Marguerite", "Clay", "Rosalind", "Emeka", "Hollis", "Verna", "Sterling", "Otis"];
const LAST = ["Kirkland", "Thorne", "Mercer", "Prentice", "Winthrop", "Ashford", "Calloway"];

function buildPresident(scenario) {
  const r = seeded(`${scenario.presidentName}|${scenario.startYear}|potus`);
  const party = r.chance(0.55)
    ? (scenario.party === "Republican" ? "Democrat" : "Republican")
    : scenario.party;
  return {
    name: `${r.pick(FIRST)} ${r.pick(LAST)}`,
    party,
    axis: round1((party === "Republican" ? 0.45 : -0.35) + (r.next() - 0.5) * 0.3),
    approval: r.between(38, 58),
  };
}

export function createSenateCareer(scenario) {
  const rosterSeed = `${scenario.presidentName}|${scenario.startYear}|${scenario.party}`;
  const base = { rosterSeed, scenario, term: 1 };
  const seat = seatForState(base, scenario.seatState) || seatForState(base, "OH");
  const r = seeded(`${rosterSeed}|senate`);

  // Which class the seat sits in decides when it is next contested.
  const cycle = senateCycle(base);
  seat.class = cycle;

  const fit = 1 - Math.abs(seat.axis - (Number(scenario.ideologyAxis) || 0)) / 2;
  const career = {
    office: "senate",
    scenario,
    rosterSeed,
    month: 1,
    term: 1,
    seat,
    caucus: caucusOf(scenario),
    independent: scenario.party !== "Democrat" && scenario.party !== "Republican",
    committee: null,
    rank: "member",
    capital: 0,
    committeeLog: [],
    swung: {},
    jeopardy: emptyArticles(),
    // Advice and consent: whoever is on the floor waiting, and everybody the
    // chamber has already dealt with. See confirmations.js.
    nomination: emptyNomination(),
    confirmations: [],
    president: buildPresident(scenario),
    approval: clamp(Math.round(48 + fit * 16 + r.between(-4, 4))),
    leadership: isWrecker(scenario)
      ? clamp(Math.round(16 + r.between(-6, 6)))
      : clamp(Math.round(52 + r.between(-8, 8))),
    // How often you vote like the person you said you were, and the blocs your
    // ideology brought with you. See conviction.js and coalition.js.
    integrity: INTEGRITY_START,
    // The running tally the number is derived from. See conviction.js.
    convictionKept: 0,
    convictionWeight: 0,
    // Your standing with the wing of the party you actually sit in.
    /**
     * The other half of a wrecker's arrangement.
     *
     * Leadership standing is crushed and bloc standing is enormous, and those
     * are the same fact: the wing adores this member *because* it goes after the
     * establishment. Every other ideology trades between its caucus and its
     * wing; this one has already made the trade and cannot untrade it.
     */
    bloc: isWrecker(scenario) ? 92 : BLOC_START,
    coalition: buildCoalition(scenario),
    /**
     * The people of the whole state, and who they were at the oath. A senator
     * represents every kind of place at once, which is why a statewide seat is
     * so much harder to be extreme in. See demographics.js.
     */
    people: stateProfile(seat.state, scenario.startYear || 2025),
    peopleAtOath: stateProfile(seat.state, scenario.startYear || 2025),
    leanAtOath: seat.lean,
    // The country, and the migration setting the chamber's statutes have left.
    country: seedCountry(scenario.startYear || 2025),
    countryAtOath: seedCountry(scenario.startYear || 2025),
    migration: 1,
    economy: { gdpGrowth: 2.4, unemployment: 4.1, inflation: 3.0, debt: 34.2 },
    // The eight national statistics at the era's real baseline, and what they
    // were on the day of the oath. Six years is long enough to move them.
    society: buildSociety(scenario),
    baseline: buildSociety(scenario),
    chronicle: [],
    congress: seedCongress(scenario),
    stateApproval: {},
    voteLog: [],
    sponsored: [],
    // What the state is still angry about, and how angry. Decays monthly.
    grudges: [],
    filibusters: [],
    over: false,
    ending: null,
  };
  career.committee = assignCommittee(career);
  // The country a senator is sworn into, and the first problem already on it.
  return seedNation(career);
}

// --- The floor --------------------------------------------------------------

/**
 * How much reaches the Senate floor. Less than the House, because a chamber
 * that debates for a week at a time gets through less of it. Exported for the
 * same reason as the House's: a written calendar is paced by the engine, not by
 * the model that writes the bills on it.
 */
export function docketSize(state) {
  const r = seeded(`${state.rosterSeed}|senatefloor|${state.term || 1}|${state.month}`);
  return r.chance(0.28) ? 0 : r.chance(0.68) ? 1 : 2;
}

export function floorBills(state) {
  const r = seeded(`${state.rosterSeed}|senatefloor|${state.term || 1}|${state.month}`);
  const gavel = ["subchair", "chair", "speaker"].includes(state.rank);
  const count = docketSize(state);
  if (!count) return [];

  const pool = floorPool(state, BILL_POOL);
  if (!pool.length) return [];

  const majority = state.congress.senateR > state.congress.senateD ? "Republican" : "Democrat";
  const anchor = majority === "Republican" ? 0.45 : -0.35;
  const mine = gavel ? new Set(committeeById(state.committee)?.domains || []) : null;

  // A crisis drags the calendar toward itself here too. See floorBills in
  // house.js — without it the country's problems are unaddressable offline.
  const urgency = new Map();
  for (const arc of activeArcs(state)) {
    urgency.set(arc.domain, Math.max(urgency.get(arc.domain) || 0, arc.severity));
  }

  const weights = pool.map((b) => {
    const nearness = 1 / (0.18 + Math.abs(b.axis - anchor));
    const crisis = 1 + (urgency.get(b.domain) || 0) * 0.8;
    return (mine?.has(b.domain) ? nearness * 4.5 : nearness) * crisis;
  });

  const out = [];
  const remaining = [...pool];
  const remainingWeights = [...weights];
  for (let i = 0; i < count && remaining.length; i++) {
    const chosen = r.weighted(remaining, remainingWeights);
    const idx = remaining.indexOf(chosen);
    remaining.splice(idx, 1);
    remainingWeights.splice(idx, 1);
    out.push({
      id: chosen.id, title: chosen.title, brief: chosen.brief,
      axis: chosen.axis, domain: chosen.domain, fringe: Boolean(chosen.fringe),
    });
  }
  return seatFringe(state, out);
}

export { partyLine, districtView };

const STATE_SWING = 8;
const LEADERSHIP_SWING = 7;

/**
 * Cast your vote.
 *
 * A hundred senators, so the roll call is close far more often and a tie is a
 * real outcome rather than an arithmetic curiosity. Damage to your standing at
 * home is recorded as a grudge rather than applied outright, because the point
 * of a six-year term is that the state forgets.
 */
export function castVote(state, bill, vote) {
  if (!["yes", "no", "abstain"].includes(vote)) {
    return { state, rejected: true, note: "Vote yes, vote no, or abstain." };
  }
  if (votedThisCongress(state, bill.id)) {
    return { state, rejected: true, note: "You have already voted on that this Congress." };
  }

  const next = structuredClone(state);
  const party = partyLine(state, bill);
  const home = districtView(state, bill);
  const conviction = convictionView(state, bill);
  // And the bloc you sit with, which is more disciplined than either of them.
  const bloc = factionLine(state, bill);
  const withHome = vote === home.position;
  const withParty = vote === party.position;

  const homeDelta = vote === "abstain"
    ? -round1(home.intensity / 100 * 2)
    : round1((withHome ? 1 : -1) * (home.intensity / 100) * STATE_SWING);
  const leadershipDelta = vote === "abstain"
    ? -round1(party.intensity / 100 * 2.5)
    : round1((withParty ? 1 : -1) * (party.intensity / 100) * LEADERSHIP_SWING);

  next.approval = clamp(round1(next.approval + homeDelta));
  next.leadership = clamp(round1(next.leadership + leadershipDelta));

  /**
   * Six years is long enough for a state to forget a vote, and not nearly long
   * enough for anybody to forget what you turned out to believe. Integrity does
   * not decay the way a grudge does — which is the point of it.
   */
  const integrityMove = recordConviction(next, conviction, vote);
  /**
   * What your own wing makes of it.
   *
   * Steeper than crossing party leadership. A caucus of two hundred forgives a
   * defection; a bloc of forty organised around a shared conviction is only able
   * to hold a Speaker to ransom because it does not. See factions.js.
   */
  const blocMove = blocDelta(bloc, vote);
  next.bloc = clamp(round1((next.bloc ?? BLOC_START) + blocMove));
  const blocsOnVote = applyVoteToCoalition(next, bill, vote);

  // A vote the state disliked becomes a grudge, which fades. This is the whole
  // difference between the two chambers.
  if (homeDelta < -0.5) {
    next.grudges = [...(next.grudges || []), {
      id: bill.id, title: bill.title, weight: Math.abs(homeDelta),
      month: next.month, term: next.term || 1,
    }];
  }

  const roster = buildCongress(next, STATES);
  const tally = rollCall(roster.senate, bill.axis, { consensus: consensusOf(bill) });
  const swung = (next.swung || {})[bill.id] || 0;
  const yourYes = vote === "yes" ? 1 : 0;
  const yes = tally.yes + swung + yourYes;
  const filibustered = (next.filibusters || []).some((f) => f.id === bill.id);
  const bar = filibustered ? CLOTURE : tally.threshold;
  const passed = yes >= bar;
  const decisive = yes === bar && vote === "yes";

  next.voteLog = [...(next.voteLog || []), {
    id: bill.id, title: bill.title, axis: bill.axis, vote,
    // What the country will notice about this having passed. See nation.js.
    domain: bill.domain || null,
    addresses: bill.addresses || null,
    month: next.month, term: next.term || 1,
    withDistrict: withHome, withParty, passed,
  }];

  // A bill that carried changes the country, exactly as in the House. See
  // consequence.js — this is where a vote becomes something you can point at on
  // a chart six years later.
  const moved = passed ? applyConsequence(next, bill) : {};
  const migration = passed ? applyMigration(next, bill) : 0;
  next.pending = [...(next.pending || []), noteEvent(passed ? EVENT.PASSED : EVENT.FAILED, {
    title: bill.title, domain: bill.domain, moved, vote,
    tally: `${yes}-${tally.total - yes}`,
  })];

  const result = {
    bill, yourVote: vote, passed, decisive, filibustered, bar, moved,
    bloc: bloc && {
      ...bloc, delta: blocMove, total: next.bloc,
      note: describeBloc(bloc, vote, blocMove),
    },
    migration: migration ? { change: migration, now: next.migration } : null,
    conviction: {
      ...conviction,
      delta: integrityMove,
      note: describeConviction(conviction, vote, integrityMove),
      total: next.integrity,
    },
    blocs: blocsOnVote,
    tally: { ...tally, yes, no: tally.total - yes },
    district: { ...home, delta: homeDelta },
    party: { ...party, delta: leadershipDelta },
    note: describeVote({ withHome, withParty, vote, passed, decisive, filibustered, bar, yes }),
  };

  const banked = earnCapital(next, result);
  next.capital = Math.max(0, round1((next.capital || 0) + banked));
  result.capital = { banked, total: next.capital };

  return { state: next, result };
}

function describeVote({ withHome, withParty, vote, passed, decisive, filibustered, bar, yes }) {
  if (decisive) return "Fifty-one to fifty. Yours was the vote, and the gallery knew it before the clerk finished.";
  if (filibustered && !passed) return `Cloture failed — ${yes} of the ${bar} needed. It dies on the floor.`;
  if (vote === "abstain") return "You did not vote. In a chamber of a hundred that is noticed immediately.";
  if (withHome && withParty) return "Nobody had to be disappointed today.";
  if (withHome) return "You went with your state against the caucus. Leadership will remember it.";
  if (withParty) return "You held with the caucus. Your state will remember it — though perhaps not for six years.";
  return "You voted against both of them, which in this chamber is called independence.";
}

// --- The filibuster ---------------------------------------------------------

/**
 * Any senator can stop the chamber.
 *
 * The only outright power in either mode that does not have to be earned, and
 * the cost is exactly what you would expect: leadership loathes it, and doing
 * it repeatedly marks you as somebody who cannot be worked with.
 */
export function filibuster(state, bill) {
  if ((state.filibusters || []).some((f) => f.id === bill.id)) {
    return { state, rejected: true, note: "You are already holding the floor on that." };
  }
  if (votedThisCongress(state, bill.id)) {
    return { state, rejected: true, note: "That vote has already happened." };
  }

  const next = structuredClone(state);
  const party = partyLine(state, bill);
  const home = districtView(state, bill);
  const conviction = convictionView(state, bill);
  // And the bloc you sit with, which is more disciplined than either of them.
  const bloc = factionLine(state, bill);
  // Blocking something your own caucus wanted is the expensive version.
  const againstCaucus = party.position === "yes";
  const used = (next.filibusters || []).length;

  next.filibusters = [...(next.filibusters || []), {
    id: bill.id, title: bill.title, month: next.month, term: next.term || 1, againstCaucus,
  }];
  next.leadership = clamp(round1(next.leadership - (againstCaucus ? 11 : 3) - used * 1.5));
  // A state that hated the bill is delighted; one that wanted it is not.
  next.approval = clamp(round1(next.approval + (home.position === "no" ? 4 : -5)));

  return {
    state: next,
    result: {
      bill, againstCaucus, cloture: CLOTURE,
      note: againstCaucus
        ? `You are filibustering your own caucus's bill. It now needs ${CLOTURE} votes, and leadership ` +
          `will not forget who made them find them.`
        : `You are holding the floor. The ${bill.title} needs ${CLOTURE} votes to proceed.`,
    },
  };
}

// --- The long memory --------------------------------------------------------

/**
 * A month passing. Grudges fade, which is the mechanical expression of a
 * six-year term: a vote taken in year one is nearly forgotten by year six, and
 * one taken in year six is not forgotten at all.
 */
export function decayGrudges(state) {
  const next = structuredClone(state);
  let recovered = 0;
  next.grudges = (next.grudges || []).map((g) => {
    const faded = g.weight * (1 - MEMORY_DECAY);
    recovered += g.weight - faded;
    // Full precision on the weight. Rounding to a tenth here traps a decaying
    // grudge forever — 1.1 × 0.955 rounds straight back to 1.1 — and the state
    // never finishes forgetting. Round only where it is displayed.
    return { ...g, weight: faded };
  }).filter((g) => g.weight > 0.15);

  if (recovered > 0) next.approval = clamp(round1(next.approval + recovered));
  return { state: next, recovered: round1(recovered) };
}

/** What the state still holds against you, worst first. */
export const liveGrudges = (state) =>
  [...(state.grudges || [])].sort((a, b) => b.weight - a.weight);

// --- Re-election ------------------------------------------------------------

export function runReelection(state) {
  const sign = partySign(state.scenario.party);
  const seat = state.seat;

  const ground = sign === 0
    ? round1(-Math.abs(seat.lean) * 0.15)
    : round1(sign * seat.lean * 0.42);
  const personal = ((state.approval ?? 50) - 50) * 0.9;
  const sameParty = sign !== 0 && state.president?.party === state.scenario.party;
  const env = nationalEnvironment({
    approval: state.president?.approval ?? 50,
    economy: state.economy, arcs: [], scenario: state.scenario,
  }, { midterm: sameParty });
  const wave = sameParty ? env : -env * 0.45;
  // Six years buys more incumbency than two.
  const incumbency = 4 + Math.min(seat.seniority || 1, 5) * 1.6;
  // Whatever the state has not yet forgotten still counts against you.
  const remembered = -round1((state.grudges || []).reduce((sum, g) => sum + g.weight, 0) * 0.5);

  /**
   * Whether your own side turns out. A state forgets a vote it disliked; it does
   * not forget deciding you never believed anything. See conviction.js.
   */
  const base = round1(baseTurnout(state) + coalitionTurnout(state));

  const margin = round1(ground + personal + wave + incumbency + remembered + base);
  return {
    margin, won: margin > 0,
    ground: round1(ground), personal: round1(personal), wave: round1(wave),
    incumbency: round1(incumbency), remembered, base,
    primary: primaryThreat(state),
    seniority: seat.seniority || 1, sameParty,
  };
}

export function advanceSenateMonth(state) {
  let next = structuredClone(state);

  const decayed = decayGrudges(next);
  next = decayed.state;
  next.leadership = clamp(round1(next.leadership + (52 - next.leadership) * 0.04));

  // The country first: what this chamber passed this month eases the problems
  // it was about, and what it ignored gets worse. See nation.js.
  advanceNation(next);
  next.docket = null;
  closeTheMonth(next);

  next.president = driftPresident(next);

  const trouble = tickArticles(next);
  Object.assign(next, trouble.state);

  // Seats fall vacant on their own schedule, and the President fills them with
  // whoever they like — until this chamber says otherwise.
  const nominated = tickNomination(next);
  Object.assign(next, nominated.state);

  /**
   * Every twenty-fourth month the country votes and this senator does not.
   *
   * This is the fact that makes the chamber different from the seat. Two of the
   * three elections in a six-year term are somebody else's, and they can still
   * cost you everything you have earned — a majority, a gavel, the floor
   * schedule — without your name appearing on a single ballot.
   */
  const polling = isElectionMonth(next);
  const cycle = polling
    ? runCongressionalCycle(next, { index: electionIndex(next) })
    : null;
  if (cycle) applyCycle(next, cycle);

  if (next.month < SENATE_TERM) {
    next.month += 1;
    // A new Congress picks new leadership, and a caucus in the minority has
    // none to pick — so the ladder is re-priced on any election night, not only
    // on the ones this senator was running in.
    const shuffled = cycle ? evaluateLadder(next) : null;
    return {
      state: shuffled ? shuffled.state : next,
      reelection: null,
      articles: trouble.event,
      nomination: nominated.event,
      recovered: decayed.recovered,
      ...(cycle ? { cycle, ladder: shuffled.change } : {}),
    };
  }

  const result = runReelection(next);
  next.reelection = result;
  if (!result.won) {
    next.over = true;
    next.ending = {
      type: "unseated",
      reason: `${next.seat.stateName} retired you by ${Math.abs(result.margin).toFixed(1)} points after ` +
        `${next.seat.seniority} term${next.seat.seniority === 1 ? "" : "s"} — ` +
        `${(next.seat.seniority || 1) * 6} years in the Senate.`,
    };
    return { state: next, reelection: result };
  }

  next.term = (next.term || 1) + 1;
  next.month = 1;
  next.seat = { ...next.seat, seniority: (next.seat.seniority || 1) + 1 };
  next.approval = clamp(round1(next.approval + 3));
  next.leadership = clamp(round1(next.leadership + 4));
  next.swung = {};
  next.grudges = [];   // six years is a long time; the slate is genuinely clean

  const ladder = evaluateLadder(next);
  return {
    state: ladder.state, reelection: result, ladder: ladder.change, cycle,
    // A term ending is where a career decides whether to stay where it is.
    choices: next.career ? nextChoices(next.career, ladder.state) : null,
  };
}
