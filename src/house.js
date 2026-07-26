import { seeded, hashString, clamp, round1 } from "./rng.js";
import { STATES } from "./states.js";
import { BILL_POOL, billById, rollCall } from "./bills.js";
import { houseRaces, nationalEnvironment, runCongressionalCycle } from "./elections.js";
import { buildCongress } from "../public/js/data/government.js";
import { assignCommittee, earnCapital, evaluateLadder, committeeById } from "./committees.js";
import { emptyArticles, tickArticles } from "./articles.js";

/**
 * A seat in the House.
 *
 * The presidency is a game about acting: you decide, and the country reacts.
 * This is a game about being acted upon. Leadership decides what reaches the
 * floor, the country decides the environment you run in, and the only thing
 * that is genuinely yours is which way you vote and what it costs you.
 *
 * The whole mode turns on one tension the presidency does not have. Your
 * district and your party want different things, constantly, and every vote
 * spends one to buy the other. Vote your district often enough and leadership
 * stops returning calls, your bills die in committee and the money goes
 * elsewhere. Vote the party line often enough and in two years a district that
 * never agreed with you gets to say so.
 *
 * Two years is the point. A senator can be brave for four years and hope it is
 * forgotten; a member of the House is always eighteen months from the voters.
 */

export const HOUSE_TERM = 24;          // months — two years, every time
export const SPONSOR_COOLDOWN = 4;     // months between bills you can file

/**
 * The Senate files less often, because a senator has fewer chances and takes
 * longer over each one. It lives here rather than in senate.js because senate.js
 * imports this module for the shared chamber machinery, and pointing the import
 * the other way as well would make the two files a cycle.
 */
const SENATE_SPONSOR_COOLDOWN = 6;

export const sponsorCooldown = (state) =>
  (state?.office === "senate" ? SENATE_SPONSOR_COOLDOWN : SPONSOR_COOLDOWN);

/**
 * Whether the member may file this month. Both floor endpoints ask this, so the
 * card is never offered on a month the filing would be refused — which is
 * exactly what the Senate floor used to do.
 */
export function canFileAgain(state) {
  const last = (state?.sponsored || []).slice(-1)[0];
  if (!last) return true;
  if ((last.term || 1) !== (state.term || 1)) return true;
  return state.month - last.month >= sponsorCooldown(state);
}

const partySign = (party) => (party === "Republican" ? 1 : party === "Democrat" ? -1 : 0);
const otherParty = (p) => (p === "Republican" ? "Democrat" : "Republican");

/** Where each party's caucus sits. Mirrors PARTY_ANCHOR in government.js. */
const PARTY_ANCHOR = { Democrat: -0.35, Republican: 0.45 };

/**
 * Which caucus a member actually sits in.
 *
 * An independent still has to organise with somebody — committee seats and the
 * floor schedule are handed out by a majority, not by principle — so they
 * caucus with whichever side is nearer their own politics. Without this, an
 * independent member has a "leadership" number that answers to nobody and
 * means nothing.
 */
export function caucusOf(scenario) {
  if (scenario?.party === "Democrat" || scenario?.party === "Republican") return scenario.party;
  const axis = Number(scenario?.ideologyAxis) || 0;
  return Math.abs(axis - PARTY_ANCHOR.Democrat) <= Math.abs(axis - PARTY_ANCHOR.Republican)
    ? "Democrat" : "Republican";
}

/**
 * A district's partisan lean, in points, on the same −1…+1 spectrum that bills
 * and ideologies use.
 *
 * The divisor is doing real work. Partisan lean and ideological extremity are
 * not the same thing — a district can be overwhelmingly Democratic without its
 * median voter sitting at the far end of the spectrum — and dividing too hard
 * makes every safe seat read as more radical than any bill ever written.
 */
export function districtAxis(lean) {
  return round1(Math.max(-1, Math.min(1, (Number(lean) || 0) / 90)));
}

const agreement = (a, b) => 1 - Math.abs(a - b) / 2;

// --- Getting a seat ---------------------------------------------------------

/** Every district, with the reference seed so the map is stable per career. */
function allDistricts(state) {
  return houseRaces(state.rosterSeed ? state : { ...state, rosterSeed: "house" });
}

export function seatFor(state, district) {
  const race = allDistricts(state).find((r) => r.seat === district);
  if (!race) return null;
  return {
    district: race.seat,
    state: race.state,
    stateName: STATES[race.state]?.name || race.state,
    lean: race.lean,
    axis: districtAxis(race.lean),
    seniority: 1,
    committee: null,
  };
}

/**
 * A handful of seats worth choosing between, rather than a list of 435.
 *
 * The three kinds are the three games: a safe seat where the only threat is a
 * primary, a marginal one where every vote is a calculation, and a hostile one
 * you have no business holding and will lose the moment you stop paying
 * attention.
 */
export function districtOptions(state, party = state.scenario?.party) {
  const sign = partySign(party) || -1;
  const districts = allDistricts(state);
  // Favour to this party: positive is friendly ground.
  const favour = (d) => sign * d.lean;

  const pick = (list, kind, n) => list.slice(0, n).map((d) => ({
    kind,
    district: d.seat,
    state: d.state,
    stateName: STATES[d.state]?.name || d.state,
    lean: d.lean,
    favour: round1(favour(d)),
  }));

  const byFavour = [...districts].sort((a, b) => favour(b) - favour(a));
  const marginal = [...districts].sort((a, b) => Math.abs(favour(a)) - Math.abs(favour(b)));

  return [
    ...pick(byFavour, "safe", 2),
    ...pick(marginal, "marginal", 3),
    ...pick([...byFavour].reverse(), "hostile", 2),
  ];
}

const FIRST = ["Marguerite", "Clay", "Rosalind", "Emeka", "Hollis", "Verna", "Sterling", "Otis"];
const LAST = ["Kirkland", "Thorne", "Mercer", "Prentice", "Winthrop", "Ashford", "Calloway"];

/**
 * The sitting president, as somebody else's problem.
 *
 * Whether they share your party is the single biggest fact about a House
 * career: it decides whether you run on their record or against it, and it is
 * drawn rather than chosen, because a member does not pick their president.
 */
function buildPresident(scenario) {
  const r = seeded(`${scenario.presidentName}|${scenario.startYear}|potus`);
  // Slightly more often the other party, because that is the more interesting
  // seat to hold and the one with something to push against.
  const party = r.chance(0.55) ? otherParty(scenario.party) : scenario.party;
  return {
    name: `${r.pick(FIRST)} ${r.pick(LAST)}`,
    party,
    axis: round1(PARTY_ANCHOR[party] + (r.next() - 0.5) * 0.3),
    approval: r.between(38, 58),
  };
}

export function createHouseCareer(scenario) {
  const career = buildCareer(scenario);
  // Committees are handed out by leadership, so this needs the finished career.
  career.committee = assignCommittee(career);
  return career;
}

function buildCareer(scenario) {
  const rosterSeed = `${scenario.presidentName}|${scenario.startYear}|${scenario.party}`;
  const base = { rosterSeed, scenario };
  const seat = seatFor(base, scenario.district) || seatFor(base, allDistricts(base)[0].seat);
  const r = seeded(`${rosterSeed}|seat`);

  // A freshman arrives having just won, so the district starts warm — but on a
  // seat that disagrees with them, not warm for long.
  const fit = agreement(seat.axis, Number(scenario.ideologyAxis) || 0);
  const approval = clamp(Math.round(46 + fit * 18 + r.between(-4, 4)));

  return {
    office: "house",
    scenario,
    rosterSeed,
    month: 1,
    term: 1,
    seat,
    // Independents caucus with somebody; this is who.
    caucus: caucusOf(scenario),
    // Where you sit, what you run, and who owes you. See committees.js.
    committee: null,
    rank: "member",
    capital: 0,
    committeeLog: [],
    swung: {},
    // The President's own trouble, which the House is eventually asked about.
    jeopardy: emptyArticles(),
    independent: scenario.party !== "Democrat" && scenario.party !== "Republican",
    president: buildPresident(scenario),
    // Your two numbers. Everything in this mode is spending one for the other.
    approval,
    leadership: clamp(Math.round(52 + r.between(-8, 8))),
    // The country, carried over wholesale from the presidential game.
    economy: { gdpGrowth: 2.4, unemployment: 4.1, inflation: 3.0, debt: 34.2 },
    congress: seedCongress(scenario),
    stateApproval: {},
    voteLog: [],
    sponsored: [],
    arcs: [],
    history: [],
    over: false,
    ending: null,
  };
}

/**
 * The Congress a member is sworn into.
 *
 * Setup asks which chamber you are arriving in and this used to throw the answer
 * away and roll dice instead — which mattered more here than it does for a
 * president, because for a member the majority *is* the game: it decides whether
 * their caucus schedules the floor and whether there is a gavel at the top of
 * the ladder for anybody on their side to hold.
 *
 * The composition is expressed as the player's own caucus's seats. An
 * independent has no bloc to size, so they get the seeded chamber.
 */
export function seedCongress(scenario) {
  const chosen = scenario.congress;
  if (chosen && Number.isFinite(chosen.house) && Number.isFinite(chosen.senate)) {
    const mine = caucusOf(scenario) === "Republican" ? "R" : "D";
    const theirs = mine === "R" ? "D" : "R";
    const house = clamp(Math.round(chosen.house), 0, 435);
    const senate = clamp(Math.round(chosen.senate), 0, 100);
    return {
      [`house${mine}`]: house, [`house${theirs}`]: 435 - house,
      [`senate${mine}`]: senate, [`senate${theirs}`]: 100 - senate,
    };
  }

  const r = seeded(`${scenario.presidentName}|${scenario.startYear}|chamber`);
  const houseR = r.between(200, 235);
  const senateR = r.between(45, 55);
  return { houseR, houseD: 435 - houseR, senateR, senateD: 100 - senateR };
}

// --- The floor --------------------------------------------------------------

/**
 * What leadership actually schedules this month.
 *
 * Drawn from the same pool the presidential game uses, so a member is voting on
 * the identical legislation a president would be signing or vetoing.
 */
export function floorBills(state) {
  const r = seeded(`${state.rosterSeed}|floor|${state.term || 1}|${state.month}`);
  // A Speaker sets the schedule, so more reaches the floor and they choose from
  // it. Everybody else takes what they are given.
  const speaker = state.rank === "speaker";
  const count = speaker
    ? (r.chance(0.5) ? 3 : 4)
    : (r.chance(0.22) ? 0 : r.chance(0.62) ? 1 : r.chance(0.7) ? 2 : 3);
  if (!count) return [];

  const voted = new Set((state.voteLog || []).map((v) => v.id));
  const radical = state.scenario?.radicals === true;
  const pool = BILL_POOL.filter((b) => (radical || !b.fringe) && !voted.has(b.id));
  if (!pool.length) return [];

  // The majority schedules what the majority likes.
  const majority = state.congress.houseR > state.congress.houseD ? "Republican" : "Democrat";
  const anchor = PARTY_ANCHOR[majority];

  /**
   * A member holding a gavel pulls the schedule toward their own jurisdiction.
   *
   * This is not a courtesy — it is most of what a chairmanship *is*. Without it
   * the narrow committees are dead weight: Judiciary covers two bills in a pool
   * of twenty-seven, so a Judiciary chair would go a year at a time without a
   * single bill they were entitled to touch.
   */
  const gavel = ["subchair", "chair", "speaker"].includes(state.rank);
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

/** Where your leadership stands, and how hard they are leaning on you. */
export function partyLine(state, bill) {
  const anchor = PARTY_ANCHOR[caucusOf(state.scenario)] ?? 0;
  const fit = agreement(anchor, bill.axis);
  const position = fit >= 0.72 ? "yes" : "no";
  const intensity = Math.round(Math.abs(fit - 0.72) * 240);

  return {
    position,
    fit: round1(fit),
    intensity: clamp(intensity, 5, 100),
    reason: position === "yes"
      ? intensity > 45 ? "A leadership priority. They are counting this one." : "The caucus is for it."
      : intensity > 45 ? "Leadership is whipping hard against it." : "The caucus is against, without much passion.",
  };
}

/**
 * Where the people who actually elect you stand.
 *
 * Two seats can disagree with leadership equally often and mean opposite
 * things by it. A safe seat sits further out than the party and pulls you
 * toward the base; a marginal or hostile one sits nearer the centre, or across
 * it, and pulls you away. Naming which pressure you are under is most of what
 * makes the choice legible.
 */
export function districtView(state, bill) {
  const fit = agreement(state.seat.axis, bill.axis);
  const position = fit >= 0.72 ? "yes" : "no";
  const intensity = Math.round(Math.abs(fit - 0.72) * 240);

  const caucus = caucusOf(state.scenario);
  const anchor = PARTY_ANCHOR[caucus] ?? 0;
  const sign = partySign(caucus);
  // Is the district further out than the party, or nearer the middle?
  const beyond = sign * (state.seat.axis - anchor) > 0.12;
  const across = sign * state.seat.axis < -0.1;
  const pressure = across ? "hostile" : beyond ? "base" : "moderate";

  return {
    position,
    fit: round1(fit),
    intensity: clamp(intensity, 5, 100),
    pressure,
    reason: position === "yes"
      ? `${state.seat.district} wants this.`
      : `${state.seat.district} will not thank you for it.`,
    pressureNote: pressure === "base"
      ? "Your district sits further out than the caucus does. The pressure here is a primary."
      : pressure === "hostile"
        ? "Your district voted for the other party. Every caucus vote is one you defend at home."
        : "Your district sits nearer the centre than the caucus. The pressure here is November.",
  };
}

const DISTRICT_SWING = 9;
const LEADERSHIP_SWING = 7;

/**
 * Cast your vote.
 *
 * The chamber votes around you through the same roll-call engine the
 * presidential game uses, so the outcome is the outcome — your one vote matters
 * exactly as much as one vote does, which on a close bill is everything and on
 * a lopsided one is nothing. What always matters is who saw you cast it.
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
  const district = districtView(state, bill);

  // Voting with a side pays in proportion to how much they cared.
  const withDistrict = vote === district.position;
  const withParty = vote === party.position;

  const districtDelta = vote === "abstain"
    ? -round1(district.intensity / 100 * 2)
    : round1((withDistrict ? 1 : -1) * (district.intensity / 100) * DISTRICT_SWING);
  const leadershipDelta = vote === "abstain"
    ? -round1(party.intensity / 100 * 2.5)
    : round1((withParty ? 1 : -1) * (party.intensity / 100) * LEADERSHIP_SWING);

  next.approval = clamp(round1(next.approval + districtDelta));
  next.leadership = clamp(round1(next.leadership + leadershipDelta));

  // The rest of the chamber, and then you.
  const roster = buildCongress(next, STATES);
  const tally = rollCall(roster.house, bill.axis);
  const yourYes = vote === "yes" ? 1 : 0;
  const passed = tally.yes + yourYes >= tally.threshold;

  next.voteLog = [...(next.voteLog || []), {
    id: bill.id, title: bill.title, axis: bill.axis, vote,
    month: next.month, term: next.term || 1,
    withDistrict, withParty, passed,
  }];

  const decisive = Math.abs(tally.yes + yourYes - tally.threshold) === 0 && vote === "yes";

  const result = {
    bill, yourVote: vote, passed, decisive,
    tally: { ...tally, yes: tally.yes + yourYes, no: tally.total - tally.yes - yourYes },
    district: { ...district, delta: districtDelta },
    party: { ...party, delta: leadershipDelta },
    note: describeVote({ withDistrict, withParty, vote, passed, decisive, district, party }),
  };

  // Voting the caucus line banks the favours a whip later spends — the same
  // votes a difficult district is punishing you for. See committees.js.
  const banked = earnCapital(next, result);
  next.capital = Math.max(0, round1((next.capital || 0) + banked));
  result.capital = { banked, total: next.capital };

  return { state: next, result };
}

function describeVote({ withDistrict, withParty, vote, passed, decisive, district, party }) {
  if (decisive) return "Your vote was the one that carried it. Everybody knows whose it was.";
  if (vote === "abstain") return "You did not vote. Both sides read that as an answer.";
  if (withDistrict && withParty) return "The easy kind of vote — nobody had to be disappointed.";
  if (withDistrict) return `You went with ${district.reason.split(" ")[0]} and against the caucus. Leadership noticed.`;
  if (withParty) return "You held the line for the party. Your district will hear about it.";
  return "You voted against both of them, which is a choice.";
}

// --- Your own legislation ---------------------------------------------------

/**
 * File a bill, in either chamber.
 *
 * A freshman with no standing files bills that die in committee, and should:
 * the ability to get something heard is exactly what seniority and leadership
 * goodwill buy, and it is the reason to spend a vote on the caucus rather than
 * the district.
 *
 * The chamber matters twice. It decides which roll call the bill faces — a
 * senator's bill used to be counted by 435 people who had never seen it — and
 * it decides how often you get to try.
 */
export function sponsorBill(state, { title, axis, domain }) {
  const cooldown = sponsorCooldown(state);
  const last = (state.sponsored || []).slice(-1)[0];
  if (last && state.month - last.month < cooldown && (last.term || 1) === (state.term || 1)) {
    return { state, rejected: true, note: `You can file again in ${cooldown - (state.month - last.month)} months.` };
  }
  const billAxis = Math.max(-1, Math.min(1, Number(axis) || 0));

  const next = structuredClone(state);
  const senate = next.office === "senate";
  const chamberName = senate ? "Senate" : "House";
  const roster = buildCongress(next, STATES);
  const tally = rollCall(roster[senate ? "senate" : "house"], billAxis);

  // Getting a hearing at all is about clout, not merit.
  const seniority = next.seat.seniority || 1;
  /**
   * Legislation originates in one room, whichever chamber that room is in.
   * A member on the committee that owns the domain gets a real hearing;
   * everybody else is filing paper.
   */
  const committee = committeeById(next.committee);
  const ownsIt = committee?.domains.includes(domain || "economy");
  const odds = clamp(Math.round(
    8 + (next.leadership - 50) * 0.55 + Math.min(seniority, 8) * 5.5
    + (tally.passed ? 14 : 0) + (ownsIt ? 18 : 0)
  ), 2, 92);

  const r = seeded(`${next.rosterSeed}|sponsor|${next.term || 1}|${next.month}`);
  const reachedFloor = r.between(1, 100) <= odds;
  const passed = reachedFloor && tally.passed;
  const cosponsors = Math.round(tally.yes * (0.05 + (next.leadership / 100) * 0.12));

  next.sponsored = [...(next.sponsored || []), {
    title: String(title || "An Act").slice(0, 90),
    axis: billAxis, domain: domain || "economy",
    month: next.month, term: next.term || 1,
    reachedFloor, passed, cosponsors, ownCommittee: Boolean(ownsIt),
  }];

  // Filing costs nothing; passing something is the making of a career.
  if (passed) {
    next.approval = clamp(round1(next.approval + 4));
    next.leadership = clamp(round1(next.leadership + 6));
  } else if (reachedFloor) {
    next.approval = clamp(round1(next.approval + 1));
    next.leadership = clamp(round1(next.leadership - 1));
  }

  return {
    state: next,
    result: {
      title, axis: billAxis, odds, reachedFloor, passed, cosponsors, tally, chamberName,
      note: passed
        ? `It passed the ${chamberName} ${tally.yes}–${tally.no}. Your name is on a law.`
        : reachedFloor
          ? `It got a floor vote and failed ${tally.yes}–${tally.no}. That is further than most freshmen get.`
          : `It died in committee, like almost every bill. ${cosponsors} members signed on.`,
    },
  };
}

// --- The country, while you were in committee --------------------------------

/**
 * The President's own standing, month by month.
 *
 * A congressional career outlasts a news cycle and often a presidency, and this
 * number was written once at career creation and then never touched — which
 * made the national wave a constant. Every election night in a twenty-year
 * career blew in the same direction by the same amount.
 *
 * A seeded walk pulled gently back toward the middle: presidencies move, and
 * they move back, and none of it is up to you.
 */
export function driftPresident(state) {
  const potus = state.president;
  if (!potus) return potus;
  const r = seeded(`${state.rosterSeed}|potusdrift|${state.term || 1}|${state.month}`);
  const pull = (50 - (potus.approval ?? 50)) * 0.028;
  const shock = (r.next() - 0.5) * 3.4;
  return { ...potus, approval: clamp(round1((potus.approval ?? 50) + pull + shock)) };
}

/** Congressional elections are two years apart. Which one is this? */
const CYCLES_PER_TERM = { house: 1, senate: 3 };

export function electionIndex(state) {
  const perTerm = CYCLES_PER_TERM[state.office === "senate" ? "senate" : "house"];
  const within = Math.round((state.month || 0) / 24);
  return ((state.term || 1) - 1) * perTerm + within;
}

/** Is a congressional election held at the end of this month? Every 24 of them. */
export const isElectionMonth = (state) => (state.month || 0) % 24 === 0;

/**
 * Fold a night's result into the career. The baseline and the running deviation
 * travel with the state, because the next wave is measured from the chamber
 * this member was handed rather than from the last one they lived through.
 */
export function applyCycle(state, cycle) {
  state.congress = cycle.congress;
  state.congressStart = cycle.congressStart;
  state.congressDrift = cycle.congressDrift;
  return state;
}

// --- Re-election ------------------------------------------------------------

/**
 * Every two years, the district gets to answer.
 *
 * Three things decide it: the ground you are standing on, how the district
 * feels about you personally, and the national environment — which for a member
 * of the president's party is largely the president's problem landing on you.
 */
export function runReelection(state) {
  const sign = partySign(state.scenario.party);
  const seat = state.seat;

  /**
   * The district's own politics, discounted.
   *
   * A lean of eighty points is not an eighty-point margin: incumbents run well
   * ahead of their district's partisanship, which is the only reason anybody
   * ever holds a seat the other party wins at the top of the ticket. Taken at
   * face value it made safe seats unlosable and hostile ones unwinnable, so the
   * other three factors were decoration.
   *
   * An independent has no party's ground to stand on. A strongly partisan
   * district is mildly hostile to them whichever way it leans, and they run on
   * their own name instead.
   */
  const ground = sign === 0
    ? round1(-Math.abs(seat.lean) * 0.15)
    : round1(sign * seat.lean * 0.42);

  /**
   * Your personal standing, weighted heavily enough to matter.
   *
   * This is the whole game in a marginal seat and the only thing that holds a
   * hostile one: a member at eighty-five per cent at home can survive a
   * district that votes the other way at the top of the ticket.
   */
  const personal = ((state.approval ?? 50) - 50) * 0.9;
  // The national wave. A member of the president's party owns their record.
  const sameParty = sign !== 0 && state.president?.party === state.scenario.party;
  const env = nationalEnvironment({
    approval: state.president?.approval ?? 50,
    economy: state.economy,
    arcs: state.arcs,
    scenario: state.scenario,
  }, { midterm: sameParty });
  const wave = sameParty ? env : -env * 0.45;
  // Incumbency is worth a few points, and more of them the longer you have held it.
  const incumbency = 3 + Math.min(seat.seniority || 1, 6) * 0.9;

  const margin = round1(ground + personal + wave + incumbency);
  return {
    margin,
    won: margin > 0,
    ground: round1(ground),
    personal: round1(personal),
    wave: round1(wave),
    incumbency: round1(incumbency),
    // The term this was computed for. A win increments seniority immediately,
    // so the screen must be told which number the bar actually reflects.
    seniority: seat.seniority || 1,
    sameParty,
  };
}

/**
 * Roll the month forward. At the end of a term the district votes, and either
 * the career continues with another two years on the clock or it stops.
 */
export function advanceHouseMonth(state) {
  const next = structuredClone(state);

  // Both standings drift back toward the middle — a member who does nothing is
  // slowly forgotten by their district and by their leadership alike.
  next.approval = clamp(round1(next.approval + (50 - next.approval) * 0.04));
  next.leadership = clamp(round1(next.leadership + (52 - next.leadership) * 0.05));

  // The presidency moves whether or not it is yours, and the wave you run in is
  // made of it.
  next.president = driftPresident(next);

  // The President's difficulties accumulate whether or not you are watching.
  const trouble = tickArticles(next);
  Object.assign(next, trouble.state);

  if (next.month < HOUSE_TERM) {
    next.month += 1;
    return { state: next, reelection: null, articles: trouble.event };
  }

  // The other 434 districts vote on the same night you do.
  const cycle = runCongressionalCycle(next, { index: electionIndex(next) });
  applyCycle(next, cycle);

  const result = runReelection(next);
  next.reelection = result;
  next.history.push({
    month: next.month, term: next.term || 1, election: true,
    headline: result.won
      ? `Re-elected in ${next.seat.district} by ${Math.abs(result.margin).toFixed(1)}`
      : `Lost ${next.seat.district} by ${Math.abs(result.margin).toFixed(1)}`,
    approval: next.approval, approvalChange: 0,
  });

  if (!result.won) {
    next.over = true;
    next.ending = {
      type: "unseated",
      reason: `${next.seat.district} voted you out by ${Math.abs(result.margin).toFixed(1)} points ` +
        `after ${next.seat.seniority} term${next.seat.seniority === 1 ? "" : "s"}. ` +
        `You will be a lobbyist by spring.`,
    };
    return { state: next, reelection: result };
  }

  next.term = (next.term || 1) + 1;
  next.month = 1;
  next.seat = { ...next.seat, seniority: (next.seat.seniority || 1) + 1 };
  // A win is a mandate, briefly, and leadership rewards survivors.
  next.approval = clamp(round1(next.approval + 3));
  next.leadership = clamp(round1(next.leadership + 4));
  // Favours do not carry across a Congress; the debts are settled.
  next.swung = {};

  // Between terms the caucus works out what you are worth to it. This is where
  // two years of voting the party line — or not — is finally priced, and where
  // a caucus that has just lost the chamber discovers it has no gavels to hand
  // anybody.
  const ladder = evaluateLadder(next);
  return { state: ladder.state, reelection: result, ladder: ladder.change, cycle };
}
