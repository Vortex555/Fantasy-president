import { seeded, clamp, round1 } from "./rng.js";
import { STATES } from "./states.js";
import { rollCall, consensusOf } from "./bills.js";
import { assignSeats } from "./stateCommittees.js";
import { canRunAgain, standing as termStanding } from "./termLimits.js";
import { nextChoices } from "./career.js";

/**
 * The bottom rung.
 *
 * A career used to begin in the United States House of Representatives, which
 * almost none of them do. It begins here: a chamber nobody outside the state
 * has heard of, in a job that does not pay enough to live on, doing the only
 * legislating in America that has to add up.
 *
 * Three facts make this a different game rather than a smaller one, and all
 * three are real.
 *
 * **It is part-time.** Most legislatures sit for three or four months a year.
 * The rest of the year you are at your other job, in your district, and not
 * legislating at all — which is why a state legislator's relationship with
 * their district is nothing like a congressman's. They live there. They are in
 * the hardware shop.
 *
 * **The budget has to balance.** Forty-nine states are required to pass a
 * balanced budget and cannot print money, so every dollar in a state bill comes
 * out of another line. Congress has never once had to do this, and it is the
 * single biggest difference in what a vote means.
 *
 * **The chambers are enormous or tiny.** New Hampshire has four hundred
 * representatives for 1.4 million people and pays them $100 a year. Delaware
 * has forty-one. Nebraska has forty-nine and no second chamber and no party
 * labels on the ballot at all. A body of 400 and a body of 41 are not the same
 * institution, and the roll call should not pretend they are.
 */

/**
 * Every lower chamber, at its real size, with its real term and its real
 * session.
 *
 * `session` is the months the legislature actually sits, which for most of them
 * is January to April. `full` marks the handful of genuinely full-time
 * legislatures — the ones with staff, year-round sessions and salaries somebody
 * could live on. `pay` is the real annual salary, rounded, because it is the
 * fact that explains everything else about the institution.
 */
export const STATE_HOUSE = {
  AL: { seats: 105, term: 4, session: [2, 5], pay: 53000 },
  AK: { seats: 40, term: 2, session: [1, 4], pay: 50400 },
  AZ: { seats: 60, term: 2, session: [1, 4], pay: 24000 },
  AR: { seats: 100, term: 2, session: [1, 4], pay: 44400 },
  CA: { seats: 80, term: 2, session: [1, 8], pay: 128200, full: true },
  CO: { seats: 65, term: 2, session: [1, 5], pay: 43900 },
  CT: { seats: 151, term: 2, session: [1, 5], pay: 28000 },
  DE: { seats: 41, term: 2, session: [1, 6], pay: 47300 },
  FL: { seats: 120, term: 2, session: [1, 3], pay: 29700 },
  GA: { seats: 180, term: 2, session: [1, 3], pay: 24300 },
  HI: { seats: 51, term: 2, session: [1, 5], pay: 74160 },
  ID: { seats: 70, term: 2, session: [1, 3], pay: 19900 },
  IL: { seats: 118, term: 2, session: [1, 5], pay: 89250, full: true },
  IN: { seats: 100, term: 2, session: [1, 3], pay: 30700 },
  IA: { seats: 100, term: 2, session: [1, 4], pay: 25000 },
  KS: { seats: 125, term: 2, session: [1, 4], pay: 30000 },
  KY: { seats: 100, term: 2, session: [1, 4], pay: 30000 },
  LA: { seats: 105, term: 4, session: [3, 6], pay: 22800 },
  ME: { seats: 151, term: 2, session: [1, 4], pay: 16250 },
  MD: { seats: 141, term: 4, session: [1, 4], pay: 50330 },
  MA: { seats: 160, term: 2, session: [1, 7], pay: 82000, full: true },
  MI: { seats: 110, term: 2, session: [1, 12], pay: 71685, full: true },
  MN: { seats: 134, term: 2, session: [1, 5], pay: 51750 },
  MS: { seats: 122, term: 4, session: [1, 4], pay: 23500 },
  MO: { seats: 163, term: 2, session: [1, 5], pay: 39000 },
  MT: { seats: 100, term: 2, session: [1, 4], pay: 12500 },
  /** Unicameral, and the only legislature in the country elected without party labels. */
  NE: { seats: 49, term: 4, session: [1, 4], pay: 12000, unicameral: true, nonpartisan: true },
  NV: { seats: 42, term: 2, session: [2, 6], pay: 10000 },
  NH: { seats: 400, term: 2, session: [1, 6], pay: 100 },
  NJ: { seats: 80, term: 2, session: [1, 12], pay: 49000 },
  NM: { seats: 70, term: 2, session: [1, 3], pay: 0 },
  NY: { seats: 150, term: 2, session: [1, 6], pay: 142000, full: true },
  NC: { seats: 120, term: 2, session: [1, 7], pay: 13950 },
  ND: { seats: 94, term: 4, session: [1, 4], pay: 20100 },
  OH: { seats: 99, term: 2, session: [1, 12], pay: 71100, full: true },
  OK: { seats: 101, term: 2, session: [2, 5], pay: 47500 },
  OR: { seats: 60, term: 2, session: [1, 6], pay: 35100 },
  PA: { seats: 203, term: 2, session: [1, 12], pay: 106400, full: true },
  RI: { seats: 75, term: 2, session: [1, 6], pay: 18500 },
  SC: { seats: 124, term: 2, session: [1, 5], pay: 10400 },
  SD: { seats: 70, term: 2, session: [1, 3], pay: 14300 },
  TN: { seats: 99, term: 2, session: [1, 4], pay: 27000 },
  TX: { seats: 150, term: 2, session: [1, 5], pay: 7200 },
  UT: { seats: 75, term: 2, session: [1, 3], pay: 19000 },
  VT: { seats: 150, term: 2, session: [1, 5], pay: 15000 },
  VA: { seats: 100, term: 2, session: [1, 3], pay: 17640 },
  WA: { seats: 98, term: 2, session: [1, 4], pay: 61000 },
  WV: { seats: 100, term: 2, session: [1, 3], pay: 20000 },
  WI: { seats: 99, term: 2, session: [1, 12], pay: 57400, full: true },
  WY: { seats: 62, term: 2, session: [2, 3], pay: 15000 },
  DC: { seats: 13, term: 4, session: [1, 12], pay: 145000, full: true },
};

export const chamberFor = (code) => STATE_HOUSE[code] || STATE_HOUSE.OH;

/**
 * The other chamber, and the two numbers that decide how much a governor is
 * worth.
 *
 * `seats` is the real size of each state senate, which is far smaller than the
 * house — thirty-one in Texas against a hundred and fifty, twenty-four in New
 * Hampshire against four hundred. A bill that sailed through a chamber of four
 * hundred meets twenty-four people who all know each other.
 *
 * `override` is the share of the legislature needed to override the governor's
 * veto, and it is the most under-appreciated number in American government. It
 * is two thirds in most states — but in six of them a veto falls to a *simple
 * majority*, which means the governor of West Virginia, Kentucky or Arkansas
 * can be overridden by exactly the same vote that passed the bill in the first
 * place. Those governorships are weak for that reason and no other, and the
 * game should feel the difference between vetoing in Texas and vetoing in
 * Tennessee.
 */
export const STATE_SENATE = {
  AL: { seats: 35, override: 0.5 }, AK: { seats: 20, override: 2 / 3 },
  AZ: { seats: 30, override: 2 / 3 }, AR: { seats: 35, override: 0.5 },
  CA: { seats: 40, override: 2 / 3 }, CO: { seats: 35, override: 2 / 3 },
  CT: { seats: 36, override: 2 / 3 }, DE: { seats: 21, override: 0.6 },
  FL: { seats: 40, override: 2 / 3 }, GA: { seats: 56, override: 2 / 3 },
  HI: { seats: 25, override: 2 / 3 }, ID: { seats: 35, override: 2 / 3 },
  IL: { seats: 59, override: 0.6 }, IN: { seats: 50, override: 0.5 },
  IA: { seats: 50, override: 2 / 3 }, KS: { seats: 40, override: 2 / 3 },
  KY: { seats: 38, override: 0.5 }, LA: { seats: 39, override: 2 / 3 },
  ME: { seats: 35, override: 2 / 3 }, MD: { seats: 47, override: 0.6 },
  MA: { seats: 40, override: 2 / 3 }, MI: { seats: 38, override: 2 / 3 },
  MN: { seats: 67, override: 2 / 3 }, MS: { seats: 52, override: 2 / 3 },
  MO: { seats: 34, override: 2 / 3 }, MT: { seats: 50, override: 2 / 3 },
  NV: { seats: 21, override: 2 / 3 }, NH: { seats: 24, override: 2 / 3 },
  NJ: { seats: 40, override: 2 / 3 }, NM: { seats: 42, override: 2 / 3 },
  NY: { seats: 63, override: 2 / 3 }, NC: { seats: 50, override: 0.6 },
  ND: { seats: 47, override: 2 / 3 }, OH: { seats: 33, override: 0.6 },
  OK: { seats: 48, override: 2 / 3 }, OR: { seats: 30, override: 2 / 3 },
  PA: { seats: 50, override: 2 / 3 }, RI: { seats: 38, override: 0.6 },
  SC: { seats: 46, override: 2 / 3 }, SD: { seats: 35, override: 2 / 3 },
  TN: { seats: 33, override: 0.5 }, TX: { seats: 31, override: 2 / 3 },
  UT: { seats: 29, override: 2 / 3 }, VT: { seats: 30, override: 2 / 3 },
  VA: { seats: 40, override: 2 / 3 }, WA: { seats: 49, override: 2 / 3 },
  WV: { seats: 34, override: 0.5 }, WI: { seats: 33, override: 2 / 3 },
  WY: { seats: 31, override: 2 / 3 },
};

/** Nebraska has one chamber, so there is no far chamber to send anything to. */
export const senateFor = (code) => STATE_SENATE[code] || null;

/**
 * The upper chamber's own membership.
 *
 * Drawn on the same politics as the house and from the same seed, because it is
 * the same state — but a state senate district covers three or four house
 * districts, which makes the chamber slightly less lopsided and noticeably
 * older, and both of those show up as a narrower spread around each party.
 */
export function buildStateSenate(state) {
  const code = state.seat?.state || "OH";
  const senate = senateFor(code);
  if (!senate) return [];

  const lean = STATES[code]?.lean ?? 0;
  const r = seeded(`${state.rosterSeed || "seat"}|statesenate|${code}`);
  const share = clamp(50 + lean * 0.75, 22, 78) / 100;

  const members = [];
  for (let i = 0; i < senate.seats; i += 1) {
    const republican = r.next() < share;
    members.push({
      id: i,
      party: republican ? "Republican" : "Democrat",
      axis: round1(clamp((republican ? 0.48 : -0.38) + (r.next() - 0.5) * 0.7, -1, 1)),
    });
  }
  return members;
}

/** Twelve months a year, whether or not the legislature is sitting. */
export const STATEHOUSE_TERM = 24;

/**
 * Whether the legislature is actually sitting this month.
 *
 * The fact that changes what the job is. A Texas representative legislates for
 * five months every two years and is a lawyer, a rancher or a teacher for the
 * other nineteen, and a game that let them vote every month of a career would
 * be modelling a legislature that does not exist anywhere.
 */
export function inSession(state) {
  const chamber = chamberFor(state.seat?.state);
  const [from, to] = chamber.session;
  // The career's month runs 1-24 across a two-year term; the calendar month is
  // what the legislature keeps.
  const month = ((state.month || 1) - 1) % 12 + 1;
  return month >= from && month <= to;
}

/** What you do when it is not sitting, which is most of the year. */
const DAY_JOBS = [
  "a personal-injury practice", "a family farm", "an insurance agency",
  "a high school civics classroom", "a funeral home", "a contracting business",
  "a pharmacy", "a car dealership", "a cattle operation", "a small accountancy",
];

export function dayJob(state) {
  const chamber = chamberFor(state.seat?.state);
  if (chamber.full) return null;
  const r = seeded(`${state.rosterSeed || "seat"}|job`);
  return {
    what: r.pick(DAY_JOBS),
    pay: chamber.pay,
    /**
     * The honest version of the trade. A legislature that pays $7,200 is a
     * legislature whose members are all doing something else, which decides who
     * can afford to serve in it — and that is the fact the salary is in here to
     * make visible.
     */
    note: chamber.pay <= 100
      ? "The seat pays $100 a year. Everybody here has another life, and nobody pretends otherwise."
      : chamber.pay < 25000
        ? `The seat pays $${chamber.pay.toLocaleString()}. You cannot live on it and neither can anybody else in the chamber.`
        : `The seat pays $${chamber.pay.toLocaleString()}, which is most of a living and not all of one.`,
  };
}

// --- The chamber --------------------------------------------------------------

/**
 * The other members, built the way the congressional roster is: a real number
 * of seats, split by the state's own politics rather than the nation's.
 *
 * A state legislature is far more lopsided than Congress. Safe states have
 * supermajorities that make the minority party procedurally irrelevant, which
 * is the single most important thing to know about legislating in one.
 */
export function buildChamber(state) {
  const code = state.seat?.state || "OH";
  const chamber = chamberFor(code);
  const lean = STATES[code]?.lean ?? 0;
  const r = seeded(`${state.rosterSeed || "seat"}|statehouse|${code}`);

  /**
   * State legislatures over-represent whichever party wins the state, through
   * districting and through nobody contesting hopeless seats. A ten-point state
   * routinely produces a two-to-one chamber.
   */
  const share = clamp(50 + lean * 0.85, 18, 82) / 100;
  const members = [];
  for (let i = 0; i < chamber.seats; i += 1) {
    const republican = r.next() < share;
    members.push({
      id: i,
      party: chamber.nonpartisan ? "Nonpartisan" : (republican ? "Republican" : "Democrat"),
      // Individual members sit around their party's own centre, spread wider
      // than Congress because primaries here are decided by a few hundred votes.
      axis: round1(clamp((republican ? 0.5 : -0.4) + (r.next() - 0.5) * 0.9, -1, 1)),
    });
  }
  return members;
}

export const chamberSplit = (members) => ({
  R: members.filter((m) => m.party === "Republican").length,
  D: members.filter((m) => m.party === "Democrat").length,
  N: members.filter((m) => m.party === "Nonpartisan").length,
  total: members.length,
});

// --- What a state legislature actually votes on -------------------------------

/**
 * The docket.
 *
 * Nothing here is a national issue and that is the point. A state legislature
 * does roads, schools, Medicaid, occupational licensing, the sentencing code
 * and the budget — and then, four or five times a session, something that gets
 * on the national news and that every member will be asked about for the rest
 * of their career.
 *
 * `axis` and the issue axes are the same scale the congressional pool uses, so
 * every stance, faction and conviction calculation in the game works on these
 * unchanged. `cost` is what it does to a budget that has to balance, which is
 * the field Congress never needs.
 */
export const STATE_BILLS = [
  { id: "s_roads", title: "Highway and Bridge Reauthorisation", axis: 0.05, domain: "economy", cost: 34,
    brief: "Resurfaces 900 miles of state route and replaces eleven bridges rated structurally deficient." },
  { id: "s_teacher_pay", title: "Teacher Pay Raise Act", axis: -0.3, domain: "social", cost: 48, economic: -0.4,
    brief: "Raises the state minimum teacher salary by $6,000 and funds it from the general revenue fund." },
  { id: "s_medicaid", title: "Medicaid Expansion", axis: -0.55, domain: "health", cost: 62, economic: -0.5,
    brief: "Accepts federal expansion dollars to cover 210,000 adults under 138% of the poverty line." },
  { id: "s_licensing", title: "Occupational Licensing Reform", axis: 0.4, domain: "economy", cost: -6, economic: 0.5,
    brief: "Abolishes state licences for eleven trades, including barbers, florists and interior designers." },
  { id: "s_sentencing", title: "Sentencing Reform Act", axis: -0.35, domain: "justice", cost: -18, liberty: 0.55,
    brief: "Ends mandatory minimums for non-violent drug offences and funds diversion instead of two new prison wings." },
  { id: "s_school_choice", title: "Education Savings Accounts", axis: 0.6, domain: "social", cost: 40, culture: 0.5,
    brief: "Gives every family $7,400 a year of state money to spend at a private or home school." },
  { id: "s_abortion", title: "Fetal Heartbeat Act", axis: 0.85, domain: "justice", cost: 0, culture: 0.9, pluralism: -0.5,
    brief: "Bans abortion after cardiac activity is detected, with no exception for rape or incest." },
  { id: "s_permitless", title: "Constitutional Carry Act", axis: 0.7, domain: "justice", cost: -2, liberty: 0.3,
    brief: "Removes the permit requirement to carry a concealed handgun anywhere in the state." },
  { id: "s_minimum_wage", title: "State Minimum Wage Increase", axis: -0.6, domain: "economy", cost: 8, economic: -0.7,
    brief: "Raises the state minimum wage to $15 over four years and indexes it to inflation afterwards." },
  { id: "s_tax_cut", title: "Income Tax Reduction", axis: 0.65, domain: "economy", cost: 85, economic: 0.75,
    brief: "Cuts the top rate of state income tax by 1.2 points, phased over three years." },
  { id: "s_broadband", title: "Rural Broadband Authority", axis: -0.1, domain: "economy", cost: 26,
    brief: "Creates a state authority to lay fibre in the 41 counties no carrier will serve." },
  { id: "s_water", title: "Drinking Water Infrastructure Act", axis: -0.15, domain: "health", cost: 30,
    brief: "Replaces lead service lines in fourteen towns under a consent decree." },
  { id: "s_prevailing", title: "Prevailing Wage Repeal", axis: 0.55, domain: "economy", cost: -12, economic: 0.6,
    brief: "Ends the requirement that state construction contracts pay local union scale." },
  { id: "s_redistrict", title: "Independent Redistricting Commission", axis: -0.2, domain: "justice", cost: 3, pluralism: 0.5,
    brief: "Takes the drawing of legislative maps away from this chamber and gives it to a citizens' commission." },
  { id: "s_budget", title: "The General Appropriations Act", axis: 0, domain: "economy", cost: 0, support: "bipartisan",
    brief: "The budget. It has to pass, it has to balance, and everything anybody wants is in it." },
];

export const stateBillById = (id) => STATE_BILLS.find((b) => b.id === id) || null;

/**
 * What is on the floor this month — nothing at all, unless the chamber is
 * sitting.
 *
 * A legislature that met every month would be the thing this mode exists not to
 * be. Out of session there is no docket, and the months are spent in the
 * district and at the job that pays.
 */
export function stateFloor(state) {
  if (!inSession(state)) return [];
  const r = seeded(`${state.rosterSeed || "seat"}|statefloor|${state.term || 1}|${state.month}`);
  const seen = new Set((state.voteLog || []).map((v) => v.id));
  const pool = STATE_BILLS.filter((b) => !seen.has(b.id));
  if (!pool.length) return [];

  /**
   * The budget is the one bill that has to happen, and it happens at the end of
   * the session, every year, whatever else is on the calendar.
   */
  const [, closes] = chamberFor(state.seat?.state).session;
  const month = ((state.month || 1) - 1) % 12 + 1;
  if (month === closes && !seen.has("s_budget")) return [{ ...stateBillById("s_budget") }];

  const count = r.chance(0.35) ? 1 : 2;
  const out = [];
  const left = [...pool].filter((b) => b.id !== "s_budget");
  for (let i = 0; i < count && left.length; i += 1) {
    const pick = left.splice(Math.floor(r.next() * left.length), 1)[0];
    out.push({ ...pick });
  }
  return out;
}

// --- The budget ---------------------------------------------------------------

/**
 * The line every state bill is drawn against.
 *
 * Forty-nine states are constitutionally required to balance the budget and
 * none of them can print money, so a spending bill in a state legislature is
 * never a question of whether the money exists — it is a question of which
 * other line it comes out of. Congress has never faced this, and it is the
 * biggest single difference in what a vote here means.
 */
export const BUDGET_START = 0;

export function budgetOf(state) {
  const balance = round1(state.budget ?? BUDGET_START);
  return {
    balance,
    // The reserve every state keeps and every state raids.
    balanced: balance >= 0,
    note: balance >= 60 ? "A surplus, which everybody in the building already has plans for."
      : balance >= 0 ? "In balance, which is the only condition the constitution permits."
        : balance >= -60
          ? "In deficit. Something gets cut before the session ends, and it will be somebody's district."
          : "Badly in deficit. The bond rating is a news story and the governor is briefing against the chamber.",
  };
}

/**
 * What a bill does to the balance.
 *
 * A state cannot run a deficit, so the debt figure a national bill carries has
 * to mean something else here: it is the hole this bill leaves in the budget,
 * and the chamber has to fill it before it rises.
 */
export function applyBudget(next, bill) {
  const cost = Number(bill?.cost ?? 0);
  if (!cost) return 0;
  next.budget = round1((next.budget ?? BUDGET_START) - cost);
  return round1(-cost);
}

// --- A seat in it -------------------------------------------------------------

/**
 * A district inside one state, rather than one of 435 across the country.
 *
 * State house districts are small — a New Hampshire seat is about 3,300 people
 * and a California one is half a million — and the number in the name is all
 * anybody outside the state ever knows about them. The lean is the state's own,
 * spread much wider than a congressional district's, because state seats are
 * drawn tighter and a legislature contains both the safest and the most
 * marginal ground in the country.
 */
export function seatsIn(code) {
  const chamber = chamberFor(code);
  const stateLean = STATES[code]?.lean ?? 0;
  const r = seeded(`${code}|statedistricts`);
  const out = [];

  for (let i = 1; i <= Math.min(chamber.seats, 12); i += 1) {
    const lean = round1(clamp(stateLean + (r.next() - 0.5) * 70, -95, 95));
    out.push({
      seat: `${code}-${i}`,
      state: code,
      stateName: STATES[code]?.name || code,
      lean,
      kind: Math.abs(lean) < 8 ? "marginal" : (lean > 0) === (stateLean > 0) ? "safe" : "hostile",
      people: Math.round(chamber.seats > 200 ? 3400 : 40000 + r.next() * 90000),
    });
  }
  return out;
}

/** The three seats worth choosing between, as the other modes offer. */
export function districtOptions(code) {
  const all = seatsIn(code);
  const pick = (kind) => all.find((s) => s.kind === kind) || all[0];
  return [pick("safe"), pick("marginal"), pick("hostile")]
    .filter((s, i, list) => s && list.indexOf(s) === i);
}

// --- A career in it -----------------------------------------------------------

/**
 * Sworn in to a chamber nobody has heard of.
 *
 * Deliberately thinner than a congressional career: there is no committee
 * ladder here worth modelling, no whip count a backbencher can see, and no
 * national coalition. What there is instead is a chamber, a district you
 * actually live in, a governor who can veto everything, a budget that has to
 * balance and a job that pays the bills between sessions.
 */
export function createStatehouseCareer(scenario) {
  const code = String(scenario.seatState || "OH").toUpperCase();
  const chamber = chamberFor(code);
  const options = districtOptions(code);
  const seat = options.find((s) => s.seat === scenario.district) || options[0];

  const base = {
    office: "statehouse",
    scenario,
    rosterSeed: `${scenario.presidentName}|${scenario.startYear}|${code}`,
    month: 1,
    term: 1,
    seat: { ...seat, seniority: 1, axis: round1(clamp(seat.lean / 90, -1, 1)) },
    caucus: scenario.party === "Democrat" ? "Democrat" : "Republican",
    independent: chamber.nonpartisan === true,
    approval: clamp(Math.round(52 + (scenario.startApproval ? 0 : 0))),
    leadership: 50,
    integrity: 70,
    convictionKept: 0,
    convictionWeight: 0,
    bloc: 60,
    capital: 0,
    casework: 0,
    budget: BUDGET_START,
    voteLog: [],
    pending: [],
    chronicle: [],
    history: [],
    docket: null,
  };

  const members = buildChamber(base);
  const split = chamberSplit(members);
  // Three or four rooms rather than one, which is how a small chamber with a
  // large workload staffs itself. See stateCommittees.js.
  const committees = assignSeats(base);

  return {
    ...base,
    committees,
    committeeLog: [],
    chamber: {
      seats: chamber.seats,
      term: chamber.term,
      pay: chamber.pay,
      full: Boolean(chamber.full),
      unicameral: Boolean(chamber.unicameral),
      nonpartisan: Boolean(chamber.nonpartisan),
      session: chamber.session,
      R: split.R,
      D: split.D,
      majority: split.R === split.D ? "tied" : split.R > split.D ? "Republican" : "Democrat",
    },
    governor: buildGovernor(base),
    job: dayJob(base),
  };
}

/**
 * The seat votes, and so does the chamber.
 *
 * The stances are the game's own — the caucus, the district and the member's
 * conviction are computed by exactly the machinery every other chamber uses —
 * and what differs is the room they are counted in and the line the bill is
 * drawn against. Every bill that passes moves the budget, and the budget is the
 * one number in this mode that cannot be argued with.
 */
export function applyStateVote(next, bill, vote, stances) {
  const withDistrict = vote === stances.district.position;
  const withParty = vote === stances.party.position;

  const districtDelta = vote === "abstain"
    ? -round1(stances.district.intensity / 100 * 2)
    : round1((withDistrict ? 1 : -1) * (stances.district.intensity / 100) * 9);
  const leadershipDelta = vote === "abstain"
    ? -round1(stances.party.intensity / 100 * 2.5)
    : round1((withParty ? 1 : -1) * (stances.party.intensity / 100) * 7);

  next.approval = clamp(round1(next.approval + districtDelta));
  next.leadership = clamp(round1(next.leadership + leadershipDelta));

  const tally = stateRollCall(next, bill);
  const yourYes = vote === "yes" ? 1 : 0;
  const passed = tally.yes + yourYes >= tally.threshold;

  /**
   * And then the rest of the building, which this mode shipped without.
   *
   * A bill used to go from this floor straight to the governor, which is how
   * legislating works in exactly one state. Forty-nine of them have a second
   * chamber, and a state senate is a far harder room than the house it came
   * from: thirty-one people in Texas against a hundred and fifty, twenty-four
   * in New Hampshire against four hundred. A bill that sailed through a chamber
   * of four hundred meets two dozen people who all know each other.
   */
  const onward = passed ? throughTheBuilding(next, bill) : null;
  const enacted = Boolean(onward?.enacted);
  const budget = enacted ? applyBudget(next, bill) : 0;

  next.voteLog = [...(next.voteLog || []), {
    id: bill.id, title: bill.title, axis: bill.axis, vote,
    domain: bill.domain || null, month: next.month, term: next.term || 1,
    withDistrict, withParty, passed, enacted,
  }];

  return {
    bill,
    yourVote: vote,
    passed,
    onward,
    enacted,
    tally: { ...tally, yes: tally.yes + yourYes, no: tally.total - tally.yes - yourYes },
    budget: { moved: budget, ...budgetOf(next) },
    district: { ...stances.district, delta: districtDelta },
    party: { ...stances.party, delta: leadershipDelta },
    note: !passed ? "It failed on this floor."
      : onward.note,
  };
}

/**
 * The second chamber, the desk, and the override — resolved together.
 *
 * Not a ledger across months as the congressional pipeline is, and deliberately
 * so: a state legislature sits for three or four months and disposes of a bill
 * in days, not in the leisurely quarters Congress takes. What matters here is
 * not the waiting, it is that there are three gates rather than one and that
 * the last of them is a different height in every state.
 */
export function throughTheBuilding(next, bill) {
  const code = next.seat?.state || "OH";
  const senate = senateFor(code);
  const governor = next.governor;

  // Nebraska: one chamber, so the bill is on the governor's desk already.
  const upper = senate ? stateRollCall(next, bill, buildStateSenate(next)) : null;
  if (upper && !upper.passed) {
    return {
      enacted: false,
      stage: "senate",
      senate: upper,
      note: `It passed here and died in the state senate ${upper.yes}–${upper.no}, `
        + `which is ${senate.seats} people who did not have to explain themselves to your district.`,
    };
  }

  if (!governor || governorSigns(governor, bill)) {
    return {
      enacted: true,
      stage: "signed",
      senate: upper,
      note: `${upper ? `Through the senate ${upper.yes}–${upper.no}, and s` : "S"}igned by `
        + `${governor?.name || "the governor"}.`,
    };
  }

  /**
   * The veto, and the number that decides what a governor is worth.
   *
   * Two thirds in most states — and a simple majority in six of them, which
   * means the governor of West Virginia, Kentucky or Arkansas can be overridden
   * by exactly the vote that passed the bill. Those governorships are weak for
   * that reason and no other.
   */
  const share = senate?.override ?? 2 / 3;
  const need = Math.ceil(stateRollCall(next, bill).total * share);
  const have = stateRollCall(next, bill).yes;
  const overridden = have >= need;

  return {
    enacted: overridden,
    stage: overridden ? "overridden" : "vetoed",
    senate: upper,
    override: { need, have, share },
    note: overridden
      ? `${governor.name} vetoed it and this chamber overrode ${have}–${need} — `
        + (share <= 0.5
          ? "which takes a simple majority here, and is why this governorship is worth so little."
          : "which almost never happens.")
      : `${governor.name} vetoed it. An override needs ${need} votes and there are ${have}.`,
  };
}

/** Whether a governor of this politics signs a bill of that politics. */
export function governorSigns(governor, bill) {
  const sign = governor.party === "Republican" ? 1 : -1;
  return sign * (Number(bill?.axis) || 0) >= -0.25;
}

// --- The roll call ------------------------------------------------------------

/**
 * How the chamber votes, on the same arithmetic the congressional roll call
 * uses and against a very different room.
 *
 * The two facts that make a state roll call feel unlike a congressional one are
 * both in here. The chamber is frequently lopsided enough that the minority
 * cannot affect anything — a two-to-one supermajority is ordinary — and the
 * members are spread wider than Congress, because a state primary is decided by
 * a few hundred votes and produces people a national party would never
 * nominate.
 *
 * Nebraska is the exception the game should honour rather than smooth: no party
 * labels, so a bill is carried by where members actually sit and nothing else.
 */
export function stateRollCall(state, bill, members = buildChamber(state)) {
  /**
   * The chamber's own engine, not a second one.
   *
   * This counted raw distance on the partisan axis and nothing else, which put
   * it out of step with every stance card on the screen — those are computed by
   * `stanceFit`, which reads the issue axes too. A live session produced a
   * coal-subsidy bill whose caucus card said YES and whose roll call came back
   * 15–85, because the card had read the bill's economics and the count had
   * read only its axis. Two halves of one screen disagreeing about the same
   * vote is the exact failure this codebase has fixed twice before.
   *
   * So the state chamber is counted by the same `rollCall` that counts
   * Congress. The room is different — smaller, more lopsided, spread wider —
   * and the arithmetic performed on it is identical.
   */
  return rollCall(members, bill, { consensus: consensusOf(bill) });
}

/**
 * The governor, who is the other half of every state legislature.
 *
 * A state legislature is not a bicameral game the way Congress is — the second
 * chamber matters, but the governor matters more, because a governor's veto is
 * far harder to override than a president's and in most states a single party
 * holds everything or nothing. Drawn from the state's own politics.
 */
/**
 * One month forward.
 *
 * Out of session almost nothing happens, which is true and is the point: the
 * legislature is not sitting, you are at work, and the months pass. Both
 * standings drift back toward the middle, the rooms bill for their own neglect,
 * and at the end of the term the district votes.
 */
export function advanceStatehouseMonth(state, tick = null) {
  const next = structuredClone(state);

  next.approval = clamp(round1(next.approval + (50 - next.approval) * 0.04));
  next.leadership = clamp(round1(next.leadership + (52 - next.leadership) * 0.05));
  next.docket = null;

  const events = tick ? tick(next) : [];
  next.pending = [...(next.pending || []), ...events];

  if (next.month < STATEHOUSE_TERM) {
    return { state: { ...next, month: next.month + 1 }, reelection: null };
  }

  /**
   * The clock, before the voters get a say.
   *
   * Fifteen states will not let you file again however popular you are, and
   * that is the pressure this rung was added to create: the choice at the end
   * of a term becomes the ladder or the door. See termLimits.js.
   */
  const clock = canRunAgain(next);
  if (!clock.can) {
    /**
     * The ladder or the door, and not only the door.
     *
     * The whole reason this rung exists is that a limited legislator has to go
     * somewhere, which is why term-limited states send so many of their members
     * to Congress. So the clock ends the *seat*, offers whatever the career can
     * still reach, and only closes the career if there is nothing above it —
     * which for a career envelope that has not been built yet means the door.
     */
    const limited = { ...next, termLimited: true };
    const choices = limited.career ? nextChoices(limited.career, limited) : null;
    const canClimb = (choices || []).some((c) => c.office && c.office !== "statehouse" && c.eligible);

    return {
      state: canClimb ? limited : {
        ...limited,
        over: true,
        ending: { type: "term-limited", reason: clock.reason },
      },
      reelection: null,
      termLimited: clock,
      choices,
    };
  }

  /**
   * The district votes, on a seat far smaller than a congressional one — which
   * cuts both ways. A few thousand votes decide it, so a bad session is fatal
   * and a well-run office is very hard to dislodge.
   */
  const r = seeded(`${next.rosterSeed}|stateelection|${next.term || 1}`);
  const lean = next.seat.lean || 0;
  const sign = next.caucus === "Republican" ? 1 : -1;
  const margin = round1(sign * lean * 0.6 + (next.approval - 50) * 0.8 + (r.next() - 0.5) * 12);

  if (margin <= 0) {
    return {
      state: { ...next, over: true, ending: { type: "defeated", reason: `You lost ${next.seat.seat} by ${Math.abs(margin).toFixed(1)}.` } },
      reelection: { won: false, margin },
    };
  }

  return {
    state: {
      ...next,
      month: 1,
      term: (next.term || 1) + 1,
      seat: { ...next.seat, seniority: (next.seat.seniority || 1) + 1 },
      voteLog: [],
    },
    reelection: { won: true, margin },
  };
}

export function buildGovernor(state) {
  const code = state.seat?.state || "OH";
  const lean = STATES[code]?.lean ?? 0;
  const r = seeded(`${state.rosterSeed || "seat"}|governor|${code}`);
  // Governors run ahead of their state's lean far more often than legislators
  // do, which is why so many states have a governor of the other party.
  const party = r.chance(0.32) ? (lean > 0 ? "Democrat" : "Republican") : (lean > 0 ? "Republican" : "Democrat");

  return {
    name: `${r.pick(["Marguerite", "Clay", "Rosalind", "Emeka", "Hollis", "Verna", "Sterling"])} `
      + `${r.pick(["Kirkland", "Thorne", "Mercer", "Prentice", "Winthrop", "Ashford"])}`,
    party,
    approval: r.between(38, 62),
    /** Whether they will sign what this chamber sends them. */
    aligned: party === (lean > 0 ? "Republican" : "Democrat"),
  };
}
