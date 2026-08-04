import { seeded, hashString, clamp, round1 } from "./rng.js";
import { STATES } from "./states.js";
import { BILL_POOL, billById, rollCall, FRINGE_BILLS, fringeChance, consensusOf, stanceFit, voiceFor, scheduledBill } from "./bills.js";
import { houseRaces, nationalEnvironment, runCongressionalCycle } from "./elections.js";
import { buildCongress } from "../public/js/data/government.js";
import { assignCommittee, earnCapital, evaluateLadder, committeeById } from "./committees.js";
import { emptyArticles, tickArticles } from "./articles.js";
import { nextChoices } from "./career.js";
import { seedNation, advanceNation, absoluteMonth } from "./nation.js";
import { activeArcs } from "./arcs.js";
import {
  districtProfile, stateProfile, driftProfile, leanDriftFor, describeProfile, seedCountry,
} from "./demographics.js";
import { buildSociety } from "./society.js";
import {
  applyConsequence, applyDetonationDamage, driftSociety, applyMigration, migrationPopulation,
} from "./consequence.js";
import { recordMonth, noteEvent, EVENT } from "./chronicle.js";
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

/** The most a hoard of favours can add to a bill's chance of a hearing. */
export const FAVOUR_PUSH_CAP = 30;

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
 * And where each party's *leadership* sits on state power.
 *
 * Both negative, and that is not a thumb on the scale — it is the most reliably
 * bipartisan fact about a legislature. Leadership is the wing that has to
 * govern, so it is the wing that reauthorises the surveillance programme,
 * funds the agency and votes down the warrant amendment, whichever party holds
 * the gavel. The organised wings on both flanks are the ones that vote against
 * it, which is why a liberty bill produces the one pattern the old single axis
 * could never draw: leadership alone on one side, and both ends of the chamber
 * together on the other.
 */
/**
 * Where each party's *leadership* sits on the four.
 *
 * Both negative on `liberty`, and that is not a thumb on the scale — it is the
 * most reliably bipartisan fact about a legislature. Leadership is the wing that
 * has to govern, so it is the wing that reauthorises the programme, funds the
 * agency and votes down the warrant amendment, whichever party holds the gavel.
 * Both lean `globe` for the same reason: running the government means keeping
 * the alliances and the trade deals, and the insurgents on both flanks are the
 * ones who do not have to.
 */
const PARTY_ISSUES = {
  Democrat:   { economic: -0.4, diplomatic: -0.45, liberty: -0.3,  culture: -0.35, pluralism:  0.45 },
  Republican: { economic:  0.6, diplomatic: -0.15, liberty: -0.25, society:  0.45 },
};

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
  // Nobody is sworn in to an empty country: one story in the news and one
  // problem already outstanding, both of which the floor will be about.
  return seedNation(career);
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
    /**
     * Your three numbers now. The first two are the old tension — district
     * against caucus — and the third is the one that was missing: how often you
     * vote like the person you told everyone you were.
     */
    integrity: INTEGRITY_START,
    // The running tally the number is derived from. See conviction.js.
    convictionKept: 0,
    convictionWeight: 0,
    // Your standing with the wing of the party you actually sit in.
    bloc: BLOC_START,
    /**
     * The people you represent, and who they were the day you were sworn in.
     *
     * A seat used to be a code and a lean. Keeping the founding profile beside
     * the current one is what lets a twenty-year career see that the district
     * which first elected it has quietly stopped existing. See demographics.js.
     */
    people: districtProfile(scenario.district, seat.lean, scenario.startYear || 2025),
    peopleAtOath: districtProfile(scenario.district, seat.lean, scenario.startYear || 2025),
    leanAtOath: seat.lean,
    /**
     * The country itself, as a thing legislation can change.
     *
     * National composition used to be a pure function of the year, which made it
     * a backdrop no statute could reach. Stored, it can be bent — and immigration
     * law is the lever that bends it. See consequence.js.
     */
    country: seedCountry(scenario.startYear || 2025),
    countryAtOath: seedCountry(scenario.startYear || 2025),
    // 1 is wherever history left the flow. Statutes move it and it stays moved.
    migration: 1,
    // And the blocs your ideology actually brought with you. See coalition.js.
    coalition: buildCoalition(scenario),
    approval,
    leadership: clamp(Math.round(52 + r.between(-8, 8))),
    // The country, carried over wholesale from the presidential game.
    economy: { gdpGrowth: 2.4, unemployment: 4.1, inflation: 3.0, debt: 34.2 },
    /**
     * The eight national statistics, at the era's real baseline.
     *
     * Always on for a legislator, unlike the presidency where they are a rule
     * of play you switch on. For a member they are not a flourish — they are
     * the only lasting evidence that any of the voting mattered, and the thing
     * a career is finally read against.
     */
    society: buildSociety(scenario),
    // What the country looked like on the day they were sworn in, kept so it
    // can drift back toward it and be compared against for thirty years.
    baseline: buildSociety(scenario),
    chronicle: [],
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
 * How much reaches the floor this month.
 *
 * The pacing of the mode lives here and nowhere else. A Speaker sets the
 * schedule, so more reaches the floor and they choose from it; everybody else
 * takes what they are given, and some months that is nothing. Exported because
 * a written docket has to be paced by the same rule as a drawn one — the model
 * writes the bills, it does not get to decide how busy the chamber is.
 */
export function docketSize(state) {
  const r = seeded(`${state.rosterSeed}|floor|${state.term || 1}|${state.month}`);
  return state.rank === "speaker"
    ? (r.chance(0.5) ? 3 : 4)
    : (r.chance(0.22) ? 0 : r.chance(0.62) ? 1 : r.chance(0.7) ? 2 : 3);
}

/**
 * Is this a month the fringe gets a slot?
 *
 * One roll a month, at the rate the rules of play set: about one month in
 * twenty normally, one in two under a radicalised government. Decided here
 * rather than by whoever is writing the bills, for the same reason the size of
 * the calendar is — how strange the chamber gets is a property of the game, not
 * something a model is asked to judge, and it has to come out the same whether
 * the bills are drawn from the pool or written fresh.
 */
export function fringeMonth(state) {
  return seeded(`${state.rosterSeed}|fringe|${state.term || 1}|${state.month}`)
    .chance(fringeChance(state));
}

/**
 * Which end of the spectrum it comes from.
 *
 * Weighted toward the majority's own extreme, because the majority schedules
 * the floor and a fringe bill is usually its own flank being paid off. The
 * other third of the time it is the minority's, put up precisely because it
 * cannot pass — which is a real and much-used manoeuvre.
 */
export function fringeSide(state) {
  const r = seeded(`${state.rosterSeed}|fringeside|${state.term || 1}|${state.month}`);
  const senate = state.office === "senate";
  const majority = senate
    ? (state.congress.senateR > state.congress.senateD ? "Republican" : "Democrat")
    : (state.congress.houseR > state.congress.houseD ? "Republican" : "Democrat");
  const theirs = majority === "Republican" ? "right" : "left";
  return r.chance(0.68) ? theirs : (theirs === "right" ? "left" : "right");
}

/** The extremist bill this month would put up, drawn from the written six. */
export function fringeBillFor(state) {
  const side = fringeSide(state);
  const wanted = FRINGE_BILLS.filter((b) => (side === "left" ? b.axis < 0 : b.axis > 0));
  if (!wanted.length) return null;

  // Prefer one this Congress has not already disposed of.
  const fresh = wanted.filter((b) => !votedThisCongress(state, b.id));
  const from = fresh.length ? fresh : wanted;
  const r = seeded(`${state.rosterSeed}|fringepick|${state.term || 1}|${state.month}`);
  const chosen = from[Math.floor(r.next() * from.length)] || from[0];
  return scheduledBill(chosen, { fringe: true });
}

/**
 * What leadership actually schedules this month.
 *
 * Drawn from the same pool the presidential game uses, so a member is voting on
 * the identical legislation a president would be signing or vetoing. This is
 * the offline calendar: when a model is configured it writes the month's bills
 * out of the national situation instead, and this remains the fallback for a
 * key that is missing, a machine that is asleep and a Classic career.
 */
export function floorBills(state) {
  const r = seeded(`${state.rosterSeed}|floor|${state.term || 1}|${state.month}`);
  const count = docketSize(state);
  if (!count) return [];

  const pool = floorPool(state, BILL_POOL);
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

  /**
   * A crisis eventually drags the calendar toward itself.
   *
   * Without this the offline floor is drawn purely on party lines and takes no
   * notice of what is happening to the country — so the problems the nation is
   * carrying are, quite literally, unaddressable: no bill about them is ever
   * scheduled, every one of them escalates to the ceiling and breaks open, and
   * a Classic career watches six disasters it was never offered a chance to
   * prevent. A model-written calendar has answered the situation since it was
   * built; this is the pool doing the same with the material it has.
   *
   * Weighted by severity, so a simmering problem barely tilts the floor and an
   * acute one dominates it — which is how a legislature actually reprioritises.
   */
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
    out.push(scheduledBill(chosen));
  }
  return seatFringe(state, out);
}

/**
 * Whose name is on it.
 *
 * Derived from the actual chamber, never asked of the model — which had been
 * getting it wrong most of the time and in two different ways. It put the
 * *player* down as the sponsor of eleven of twenty bills, because the member's
 * own name was the only name in the prompt and a small model reaches for what
 * it has been given. And three more came back as the literal string "Sen.
 * Invented Name (D-XX)", copied straight out of the JSON example that was meant
 * to describe the field rather than fill it.
 *
 * Both were the same mistake on my part: asking the model for a fact the engine
 * already holds. The chamber has four hundred and thirty-five people in it with
 * names, parties, states and politics, and the bill's own position says which of
 * them would put their name to it.
 *
 * It is also a category error for the player to appear here at all. Leadership
 * schedules this calendar and the member votes on it; filing their own bill is
 * a separate act with its own cooldown, its own odds and its own screen. A floor
 * bill sponsored by the player is not a cosmetic slip, it is the mode describing
 * itself wrongly.
 */
export function sponsorFor(state, bill, salt = "") {
  const bench = buildCongress(state, STATES)[state.office === "senate" ? "senate" : "house"] || [];
  const me = state.scenario?.presidentName;
  const others = bench.filter((m) => m.name !== me);
  if (!others.length) return null;

  // The twelve members nearest the bill's politics, then one of them — so the
  // sponsor is always someone who plausibly believes in it, without being the
  // single closest every time.
  const near = [...others]
    .sort((a, b) => Math.abs(a.axis - bill.axis) - Math.abs(b.axis - bill.axis))
    .slice(0, 12);
  const r = seeded(`${state.rosterSeed}|billsponsor|${state.term || 1}|${state.month}|${bill.id}${salt}`);
  const pick = near[Math.floor(r.next() * near.length)] || near[0];

  return {
    name: `${pick.title} ${pick.name} (${pick.party[0]}-${pick.state})`,
    ideology: pick.ideology || "",
    axis: pick.axis,
  };
}

/**
 * Put a name to every bill on the calendar.
 *
 * Run once, where the month's calendar is settled, so both the drawn floor and
 * the written one are attributed the same way and the answer does not change
 * when the screen repaints.
 */
export function attributeSponsors(state, bills) {
  return bills.map((bill) => {
    const who = sponsorFor(state, bill);
    return who
      ? { ...bill, sponsor: who.name, sponsorIdeology: who.ideology }
      : { ...bill, sponsor: null };
  });
}

/**
 * Give the fringe its slot, if this is one of its months.
 *
 * It takes a place on the calendar rather than being added to it, so the
 * chamber's workload is unchanged and a fringe month is a month something
 * ordinary got bumped for — which is exactly what it costs in practice. On a
 * one-bill month that means the extremist bill *is* the month, which is the
 * right amount of alarming.
 */
export function seatFringe(state, bills) {
  if (!bills.length || !fringeMonth(state)) return bills;
  const fringe = fringeBillFor(state);
  if (!fringe) return bills;
  // Never twice on one calendar.
  if (bills.some((b) => b.id === fringe.id)) return bills;
  return [...bills.slice(0, -1), fringe];
}

/** Where your leadership stands, and how hard they are leaning on you. */
export function partyLine(state, bill) {
  const anchor = PARTY_ANCHOR[caucusOf(state.scenario)] ?? 0;
  /**
   * Consensus moves the caucus too, or the card contradicts the roll call.
   *
   * Without this, a bill nobody wants to be recorded against would show
   * "leadership: NO" and then pass 95-5 — the two halves of the same screen
   * disagreeing about the same vote.
   */
  const fit = stanceFit({ axis: anchor, ...(PARTY_ISSUES[caucusOf(state.scenario)] || {}) }, bill);
  const position = fit >= 0.72 ? "yes" : "no";
  const intensity = Math.round(Math.abs(fit - 0.72) * 240);

  return {
    position,
    fit: round1(fit),
    intensity: clamp(intensity, 5, 100),
    reason: voiceFor(bill, "party", position) || (position === "yes"
      ? intensity > 45 ? "A leadership priority. They are counting this one." : "The caucus is for it."
      : intensity > 45 ? "Leadership is whipping hard against it." : "The caucus is against, without much passion."),
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
  /**
   * The people at home are no keener than anybody else to be on the wrong side
   * of a bill about a disaster. Same widening as the caucus and the roll call.
   *
   * `liberty: null` is deliberate and is the one voice on the floor that gets
   * it. A seat's partisan lean genuinely tells you nothing about where its
   * voters stand on what the state may do to them — the two do not correlate in
   * any district in the country — so rather than invent a number the seat is
   * scored on the economic axis alone and the second dimension does not reach
   * it. Which is also true to how the pressure feels: surveillance is a caucus
   * and conscience fight, and almost never a doorstep one.
   */
  const fit = stanceFit({
    axis: state.seat.axis,
    economic: null, diplomatic: null, liberty: null, society: null,
  }, bill);
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
    reason: voiceFor(bill, "district", position) || (position === "yes"
      ? `${state.seat.district} wants this.`
      : `${state.seat.district} will not thank you for it.`),
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
  if (votedThisCongress(state, bill.id)) {
    return { state, rejected: true, note: "You have already voted on that this Congress." };
  }

  const next = structuredClone(state);
  const party = partyLine(state, bill);
  const district = districtView(state, bill);
  // The third party to every vote, and the only one that is actually you.
  const conviction = convictionView(state, bill);
  // And the bloc you sit with, which is more disciplined than either of them.
  const bloc = factionLine(state, bill);

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

  /**
   * And what it did to your reputation for standing for something.
   *
   * Cheap to keep and expensive to break, which is what makes it worth having.
   * See conviction.js.
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

  // The blocs who backed you watched this, whichever way it went.
  const blocsOnVote = applyVoteToCoalition(next, bill, vote);

  // The rest of the chamber, and then you.
  const roster = buildCongress(next, STATES);
  const tally = rollCall(roster.house, bill, { consensus: consensusOf(bill) });
  /**
   * The votes a whip actually moved.
   *
   * `spendCapital` has always banked these and `whipCount` has always shown
   * them, but the House roll call never read them — so a whip spent favours,
   * watched the count on screen go from four short to one up, and then lost the
   * vote anyway by exactly the margin they had just paid to close. The Senate
   * has read this since the day it was written; the House simply never did.
   *
   * It is the single most consequential thing a member can do to an outcome,
   * which makes it the thing that most needed to be real.
   */
  const swung = (next.swung || {})[bill.id] || 0;
  const yourYes = vote === "yes" ? 1 : 0;
  const passed = tally.yes + swung + yourYes >= tally.threshold;

  next.voteLog = [...(next.voteLog || []), {
    id: bill.id, title: bill.title, axis: bill.axis, vote,
    // What lets the country notice. A bill that passes eases the national
    // problem it was about; without this the chamber's whole output is
    // invisible to everything outside it. `addresses` names that problem
    // outright where a written bill claimed one, because matching on the domain
    // alone let a bank rescue tagged "security" ease nothing at all. See
    // nation.js.
    domain: bill.domain || null,
    addresses: bill.addresses || null,
    month: next.month, term: next.term || 1,
    withDistrict, withParty, passed,
  }];

  const decisive = tally.yes + swung + yourYes === tally.threshold && vote === "yes";

  /**
   * A bill that carried changes the country.
   *
   * The single largest gap in the mode until now: every bill in the pool has
   * carried effects since the day it was written, and a chamber career read
   * none of them. This is where a vote stops being a number on your own
   * dashboard and becomes something a player can point at on a chart in their
   * third term.
   */
  const moved = passed ? applyConsequence(next, bill) : {};
  // Immigration law changes who arrives, which is the only lever in the game
  // that reaches national composition. See consequence.js.
  const migration = passed ? applyMigration(next, bill) : 0;
  next.pending = [...(next.pending || []), noteEvent(passed ? EVENT.PASSED : EVENT.FAILED, {
    title: bill.title, domain: bill.domain, moved, vote,
    tally: `${tally.yes + swung + yourYes}-${tally.total - tally.yes - swung - yourYes}`,
  })];

  const result = {
    bill, yourVote: vote, passed, decisive, moved,
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
    /**
     * What the blocs make of *you*, which is not the same as how the law affects
     * them. Folding those together meant a member who voted against an
     * anti-labour bill that passed anyway saw "labour −2" on their own vote — the
     * bloc's interests had worsened, so the meter read as though they blamed the
     * member for it. They do not. This tracks whether they still back you; what
     * the law did to the country is the chronicle's business.
     */
    blocs: blocsOnVote,
    tally: { ...tally, yes: tally.yes + swung + yourYes, no: tally.total - tally.yes - swung - yourYes },
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
export function sponsorBill(state, { title, axis, domain, favours = 0 }) {
  const cooldown = sponsorCooldown(state);
  const last = (state.sponsored || []).slice(-1)[0];
  if (last && state.month - last.month < cooldown && (last.term || 1) === (state.term || 1)) {
    return { state, rejected: true, note: `You can file again in ${cooldown - (state.month - last.month)} months.` };
  }
  const billAxis = Math.max(-1, Math.min(1, Number(axis) || 0));

  /**
   * Favours, spent on getting your own bill heard.
   *
   * This is the join the two systems were missing. Voting the caucus line is
   * what banks favours and it is also what costs you at home — so the reason to
   * do it has to be something you can point at, and "a hearing for the bill with
   * my name on it" is the reason a real member gives. Before this, the currency
   * you paid for in district approval could only ever be spent by a Whip, on
   * somebody else's legislation.
   */
  const called = Math.max(0, Math.round(Number(favours) || 0));
  if (called > (state.capital ?? 0)) {
    return {
      state, rejected: true,
      note: `You have ${Math.round(state.capital ?? 0)} favours to call in, not ${called}.`,
    };
  }

  const next = structuredClone(state);
  const senate = next.office === "senate";
  const chamberName = senate ? "Senate" : "House";
  const roster = buildCongress(next, STATES);
  /**
   * Your own bill is a party-line proposition, and stays one.
   *
   * A member does not get to declare their own legislation uncontroversial — the
   * chamber decides that, and what it mostly decides is that a bill with one
   * backbencher's name on it is exactly as partisan as its politics. Consensus
   * is something a crisis or a national tragedy confers, not something you can
   * award yourself on the filing form.
   */
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
  /**
   * What the favours bought. Diminishing like everything else you call in — the
   * first few calls are to people glad to help and the rest are not — and capped
   * so no hoard makes a hearing a certainty. Getting heard is never a formality.
   */
  const push = called ? Math.min(FAVOUR_PUSH_CAP, Math.floor(Math.sqrt(called) * 3.2)) : 0;
  next.capital = Math.max(0, round1((next.capital ?? 0) - called));

  const odds = clamp(Math.round(
    8 + (next.leadership - 50) * 0.55 + Math.min(seniority, 8) * 5.5
    + (tally.passed ? 14 : 0) + (ownsIt ? 18 : 0) + push
    /**
     * And whether this is the subject your politics was built to write about.
     *
     * The concrete half of an ideology's signature: filing in the area it owns
     * is markedly easier than filing outside it, which gives a member a reason
     * to specialise and makes the choice at creation worth something on a screen
     * they use every four months. See conviction.js.
     */
    + signatureBonus(next.scenario, domain || "economy")
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
    favours: called,
  }];

  /**
   * Your own law, on the country.
   *
   * This is where a member has more agency than anywhere else in the mode, and
   * it was the one place nothing was connected. One vote in four hundred and
   * thirty-five almost never decides a roll call — which is honest, and which
   * means that if voting were all a career had, two members who voted opposite
   * ways on everything for twenty years would leave behind identical countries.
   * They did, before this: the same statistics to the decimal.
   *
   * A bill with your name on it is the answer to that. It is yours, it is rare,
   * getting one heard is the whole reason to spend a vote on your caucus, and
   * now it leaves a mark on the nation that outlives you.
   */
  let moved = {};
  if (passed) {
    next.approval = clamp(round1(next.approval + 4));
    next.leadership = clamp(round1(next.leadership + 6));
    moved = applyConsequence(next, { id: null, title, axis: billAxis, domain: domain || "economy" });
    next.pending = [...(next.pending || []), noteEvent(EVENT.PASSED, {
      title: `${title} (yours)`, domain: domain || "economy", moved, vote: "sponsor",
      tally: `${tally.yes}-${tally.no}`,
    })];
  } else if (reachedFloor) {
    next.approval = clamp(round1(next.approval + 1));
    next.leadership = clamp(round1(next.leadership - 1));
  }

  return {
    state: next,
    result: {
      title, axis: billAxis, odds, reachedFloor, passed, cosponsors, tally, chamberName, moved,
      favours: called, push, capital: next.capital,
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
 * Which Congress a given month belongs to.
 *
 * A Congress is two years, whatever office you hold — so a House term is one
 * and a Senate term is three. This is the same 24-month grid `electionIndex`
 * counts elections on, because a new Congress is exactly what an election
 * produces.
 */
export function congressIndex(state, month = state.month, term = state.term) {
  const perTerm = CYCLES_PER_TERM[state.office === "senate" ? "senate" : "house"];
  return ((term || 1) - 1) * perTerm + Math.ceil((month || 1) / 24);
}

/**
 * The bills this chamber can put on the floor this month.
 *
 * Two rules, and the second one is the safety net.
 *
 * A bill you have already voted on does not come back — *within the same
 * Congress*. Across one, it does: legislation that dies at the end of a
 * Congress is reintroduced in the next, which is both how it actually works and
 * the reason a career can run for twenty years against a pool of twenty-one
 * bills. Excluding everything ever voted on emptied the floor inside the first
 * term and left every month afterwards blank.
 *
 * And if that still leaves nothing — a long Congress, a small pool — the whole
 * pool comes back rather than the floor going dark. A chamber with nothing to
 * vote on is a bug in every situation; a chamber revisiting something is a
 * Tuesday.
 */
export function votedThisCongress(state, billId) {
  const now = congressIndex(state);
  return (state.voteLog || [])
    .some((v) => v.id === billId && congressIndex(state, v.month, v.term) === now);
}

export function floorPool(state, pool) {
  /**
   * The ordinary draw is always ordinary bills.
   *
   * The fringe reaches the floor through `seatFringe` and nowhere else, at one
   * governed probability a month. Letting a radicalised chamber also draw them
   * here — which is what used to happen — would stack the two routes and put
   * the real rate well above the one the rules of play promise.
   */
  const eligible = pool.filter((b) => !b.fringe);
  if (!eligible.length) return [];

  const thisCongress = congressIndex(state);
  const voted = new Set((state.voteLog || [])
    .filter((v) => congressIndex(state, v.month, v.term) === thisCongress)
    .map((v) => v.id));

  const fresh = eligible.filter((b) => !voted.has(b.id));
  return fresh.length ? fresh : eligible;
}

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

  /**
   * Whether your own side turns out for you.
   *
   * The payoff for the two things ideology now buys. Integrity is whether
   * voters believe you are who you said you were; the coalition is whether the
   * organisations that share your politics still bother knocking doors. Both are
   * bounded and deliberately smaller than the personal vote, because a career
   * should not come down to one statistic — but in a marginal seat they decide it.
   */
  const base = round1(baseTurnout(state) + coalitionTurnout(state));

  const margin = round1(ground + personal + wave + incumbency + base);
  return {
    margin,
    won: margin > 0,
    ground: round1(ground),
    personal: round1(personal),
    wave: round1(wave),
    incumbency: round1(incumbency),
    base,
    primary: primaryThreat(state),
    // The term this was computed for. A win increments seniority immediately,
    // so the screen must be told which number the bar actually reflects.
    seniority: seat.seniority || 1,
    sameParty,
  };
}

/**
 * Everything that happens to the country after the votes and before the entry.
 *
 * Shared by both chambers, because the country does not care which room the
 * member sits in. Order matters: the damage from anything that broke open lands
 * first, then the slow pull back toward the era's baseline, then the month is
 * written down as it finished.
 */
export function closeTheMonth(next) {
  const events = next.pending || [];
  next.pending = [];

  if (next.detonation) {
    const arc = next.detonation.arc;
    const moved = applyDetonationDamage(next, arc.domain);
    events.push(noteEvent(EVENT.DETONATED, {
      title: arc.title, domain: arc.domain, moved,
    }));
  }
  for (const settled of newlyResolved(next)) {
    events.push(noteEvent(EVENT.RESOLVED, { title: settled.title, domain: settled.domain }));
  }

  driftPeople(next);
  driftSociety(next, next.baseline);
  recordMonth(next, events);
  next.resolvedSeen = (next.resolved || []).length;
  return next;
}

/**
 * The seat's population, a month older.
 *
 * And then the lean follows it. This is the payoff of deriving a profile from
 * the politics rather than inventing one beside it: run the same correlation
 * forwards and a changing population produces a changing seat. A member can hold
 * the same district for twenty years and find it is no longer the district that
 * sent them — not because anyone changed their mind, but because the people did.
 */
function driftPeople(next) {
  if (!next.people || !next.seat) return;
  const startYear = next.scenario?.startYear || 2025;
  const year = startYear + Math.floor((absoluteMonth(next) - 1) / 12);
  const flow = { migration: next.migration ?? 1 };

  // The country first, then the seat inside it — both under whatever the
  // chamber's immigration statutes have done to the flow.
  if (next.country) driftProfile(next.country, year, flow);
  migrationPopulation(next);
  driftProfile(next.people, year, flow);

  const moved = leanDriftFor(next.people, next.peopleAtOath, year, startYear);
  const base = next.leanAtOath ?? next.seat.lean;
  const lean = round1(base + moved);
  next.seat = { ...next.seat, lean, axis: districtAxis(lean) };
}

/** Problems settled since the last entry, which the record has not yet noted. */
function newlyResolved(next) {
  const all = next.resolved || [];
  return all.slice(next.resolvedSeen || 0);
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

  /**
   * The country moves before the calendar does.
   *
   * This reads the votes just cast — so a bill that passed eases the problem it
   * was about, and one nobody scheduled lets that problem get worse — and then
   * walks the economy and leans on the President's approval accordingly. All of
   * it is deterministic; the model only ever writes the words on top.
   */
  advanceNation(next);
  // Next month is a new calendar. Whatever was scheduled for this one is spent.
  next.docket = null;
  closeTheMonth(next);

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
  return {
    state: ladder.state, reelection: result, ladder: ladder.change, cycle,
    // A term ending is where a career decides whether to stay where it is.
    choices: next.career ? nextChoices(next.career, ladder.state) : null,
  };
}
