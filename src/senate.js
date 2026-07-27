import { seeded, clamp, round1 } from "./rng.js";
import { STATES, STATE_CODES } from "./states.js";
import { BILL_POOL, rollCall } from "./bills.js";
import { senateCycle, senateRaces, nationalEnvironment, runCongressionalCycle } from "./elections.js";
import { buildCongress } from "../public/js/data/government.js";
import {
  partyLine, districtView, caucusOf, districtAxis, seedCongress,
  driftPresident, electionIndex, isElectionMonth, applyCycle,
} from "./house.js";
import { assignCommittee, earnCapital, evaluateLadder, committeeById } from "./committees.js";
import { emptyArticles, tickArticles } from "./articles.js";
import { nextChoices } from "./career.js";
import { emptyNomination, tickNomination } from "./confirmations.js";

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
    leadership: clamp(Math.round(52 + r.between(-8, 8))),
    economy: { gdpGrowth: 2.4, unemployment: 4.1, inflation: 3.0, debt: 34.2 },
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
  return career;
}

// --- The floor --------------------------------------------------------------

export function floorBills(state) {
  const r = seeded(`${state.rosterSeed}|senatefloor|${state.term || 1}|${state.month}`);
  const gavel = ["subchair", "chair", "speaker"].includes(state.rank);
  const count = r.chance(0.28) ? 0 : r.chance(0.68) ? 1 : 2;
  if (!count) return [];

  const voted = new Set((state.voteLog || []).map((v) => v.id));
  const radical = state.scenario?.radicals === true;
  const pool = BILL_POOL.filter((b) => (radical || !b.fringe) && !voted.has(b.id));
  if (!pool.length) return [];

  const majority = state.congress.senateR > state.congress.senateD ? "Republican" : "Democrat";
  const anchor = majority === "Republican" ? 0.45 : -0.35;
  const mine = gavel ? new Set(committeeById(state.committee)?.domains || []) : null;
  const weights = pool.map((b) => {
    const nearness = 1 / (0.18 + Math.abs(b.axis - anchor));
    return mine?.has(b.domain) ? nearness * 4.5 : nearness;
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
  return out;
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
  if ((state.voteLog || []).some((v) => v.id === bill.id)) {
    return { state, rejected: true, note: "You have already voted on that." };
  }

  const next = structuredClone(state);
  const party = partyLine(state, bill);
  const home = districtView(state, bill);
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

  // A vote the state disliked becomes a grudge, which fades. This is the whole
  // difference between the two chambers.
  if (homeDelta < -0.5) {
    next.grudges = [...(next.grudges || []), {
      id: bill.id, title: bill.title, weight: Math.abs(homeDelta),
      month: next.month, term: next.term || 1,
    }];
  }

  const roster = buildCongress(next, STATES);
  const tally = rollCall(roster.senate, bill.axis);
  const swung = (next.swung || {})[bill.id] || 0;
  const yourYes = vote === "yes" ? 1 : 0;
  const yes = tally.yes + swung + yourYes;
  const filibustered = (next.filibusters || []).some((f) => f.id === bill.id);
  const bar = filibustered ? CLOTURE : tally.threshold;
  const passed = yes >= bar;
  const decisive = yes === bar && vote === "yes";

  next.voteLog = [...(next.voteLog || []), {
    id: bill.id, title: bill.title, axis: bill.axis, vote,
    month: next.month, term: next.term || 1,
    withDistrict: withHome, withParty, passed,
  }];

  const result = {
    bill, yourVote: vote, passed, decisive, filibustered, bar,
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
  if ((state.voteLog || []).some((v) => v.id === bill.id)) {
    return { state, rejected: true, note: "That vote has already happened." };
  }

  const next = structuredClone(state);
  const party = partyLine(state, bill);
  const home = districtView(state, bill);
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

  const margin = round1(ground + personal + wave + incumbency + remembered);
  return {
    margin, won: margin > 0,
    ground: round1(ground), personal: round1(personal), wave: round1(wave),
    incumbency: round1(incumbency), remembered,
    seniority: seat.seniority || 1, sameParty,
  };
}

export function advanceSenateMonth(state) {
  let next = structuredClone(state);

  const decayed = decayGrudges(next);
  next = decayed.state;
  next.leadership = clamp(round1(next.leadership + (52 - next.leadership) * 0.04));

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
