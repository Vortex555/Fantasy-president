import { STATES, STATE_CODES, TOTAL_EV } from "./states.js";
import { hashString, mulberry32, seeded, clamp, round1 } from "./rng.js";
import {
  advanceArcs, detonationEvent, mockJudgeArcs, activeArcs, inferDomain, MAX_ACTIVE_ARCS,
} from "./arcs.js";
import { scoreAll, selectSpeakers } from "./personas.js";
import { buildFirstLady, tickFirstLady } from "./firstLady.js";
import { buildInstitutions, tickInstitutions } from "./institutions.js";
import { emptyLedger, tickSpecialActions } from "./specialActions.js";
import { buildForeign, applyForeign } from "./foreign.js";
import { buildSociety, applySociety } from "./society.js";
import { buildDeployments, tickDeployments } from "./deployments.js";
import { buildCovert, tickCovert } from "./covert.js";
import { rememberEvent } from "./eventPool.js";
import { buildCourt, cabinetIdeology } from "../public/js/data/government.js";
import { originateBills, ageBills } from "./bills.js";
import { tickJeopardy, emptyJeopardy } from "./impeachment.js";
import {
  runMidterms, runPresidential, fundraise, challengerFor, totalSpend, WAR_CHEST_START,
} from "./elections.js";
import {
  canSucceed, succeed, tickTwentyFifth, hasTieBreak, vpSupports,
} from "./succession.js";
import { PRIMARY_MONTH, primaryThreat, primaryChallenger, runPrimary } from "./primary.js";
import { buildGovernors, tickGovernors, defianceDrag } from "./governors.js";
import { courtRuling } from "./court.js";
import { createHouseCareer } from "./house.js";
import { createSenateCareer } from "./senate.js";

export const TERM_LENGTH = 48; // months
export const MIDTERM_MONTH = 24;
export const CAMPAIGN_MONTH = 46; // general-election campaign season begins

/** How many terms a president may serve, unless the 22nd is repealed. */
export const TERM_LIMIT = 2;

/**
 * `state.month` is the month *within the current term*, because that is what
 * every mechanic keys off — midterms at 24, campaign season at 46. The calendar
 * date needs the whole presidency, so it runs off this instead.
 */
export function absoluteMonth(state) {
  const clock = pacing(state);
  return ((state.term || 1) - 1) * clock.termLength + state.month;
}

/**
 * Whether this president is allowed to seek another term. Two is the limit
 * until the 22nd Amendment is repealed, at which point it is whatever the
 * country will tolerate.
 */
export function canServeAnotherTerm(state) {
  if (state.specialActions?.termLimitGone) return true;

  // A president who inherited the office part-way through somebody else's term
  // only has that term counted against them if they served more than half of
  // it. Serve two years and a day of a predecessor's term and it costs you an
  // election; take the oath late enough and it costs you nothing.
  const clock = pacing(state);
  const inherited = state.succeeded
    ? clock.termLength - state.succeeded.month + 1
    : 0;
  const limit = inherited > 0 && inherited <= clock.termLength / 2
    ? TERM_LIMIT + 1
    : TERM_LIMIT;

  return (state.term || 1) < limit;
}

/** Weekly pacing keeps the same four-year term at a finer grain. */
export const pacing = (state) => {
  const weekly = state.scenario?.weekly === true;
  const scale = weekly ? 52 / 12 : 1;
  return {
    weekly,
    unit: weekly ? "week" : "month",
    termLength: Math.round(TERM_LENGTH * scale),
    midterm: Math.round(MIDTERM_MONTH * scale),
    campaignStart: Math.round(CAMPAIGN_MONTH * scale),
  };
};

export const STAKEHOLDERS = [
  { id: "wall_street", name: "Wall Street",       lean:  1 },
  { id: "big_business", name: "Big Business",     lean:  1 },
  { id: "pentagon",     name: "The Pentagon",     lean:  0.5 },
  { id: "labor",        name: "Labor Unions",     lean: -1 },
  { id: "greens",       name: "Environmentalists", lean: -1 },
  { id: "civil_rights", name: "Civil Rights Orgs", lean: -1 },
  { id: "gun_owners",   name: "Gun Owners",       lean:  1 },
  { id: "faith",        name: "Faith Communities", lean:  0.7 },
];


// party sign: Democrat = -1, Republican = +1. Used to align leans.
function partySign(party) {
  return party === "Republican" ? 1 : party === "Democrat" ? -1 : 0;
}

/**
 * Where the president sits on the left–right spectrum, −1…+1.
 *
 * Their chosen ideology is the real answer. Careers saved before ideologies
 * carried a position — and any scenario without one — fall back to a moderate
 * position on their own party's side.
 */
/**
 * Re-seat the bench after the balance changes. Names are drawn from a stable
 * pool, so a shift replaces a justice rather than appearing to change one's
 * mind. Call this anywhere `court` moves.
 */
export function refreshCourt(next) {
  next.justices = buildCourt({
    seed: next.rosterSeed || next.scenario?.presidentName || "court",
    court: next.court,
    radical: next.scenario?.radicals === true,
  });
}

export function presidentAxis(scenario) {
  const axis = Number(scenario?.ideologyAxis);
  if (Number.isFinite(axis)) return Math.max(-1, Math.min(1, axis));
  return partySign(scenario?.party) * 0.45;
}

/**
 * How far a state sits from the national number for structural reasons — a
 * president is more popular where the electorate already agrees with them.
 * This is the same gap `createGame` opens on day one, and it is what a state
 * is pulled back toward rather than to the bare national figure.
 */
export function structuralOffset(scenario, code) {
  const lean = STATES[code]?.lean ?? 0;
  const home = (scenario?.homeStates || []).includes(code) ? 7 : 0;
  return round1(presidentAxis(scenario) * lean * 0.55 + home);
}

/** How hard each month pulls a state back toward the country. */
const NATIONAL_PULL = 0.3;

/**
 * Start a career.
 *
 * The presidency is one office among several now. A House scenario builds a
 * completely different state — a seat, a district and a president who is
 * somebody else — and shares only the country. Everything below this line is
 * the presidential game, unchanged.
 */
export function createGame(scenario) {
  if (scenario?.office === "house") return createHouseCareer(scenario);
  if (scenario?.office === "senate") return createSenateCareer(scenario);
  const sign = partySign(scenario.party);

  // Seed state-by-state approval from where the president actually stands, not
  // merely which party they ran under. Using the party alone left every
  // independent with a dead-flat map — Massachusetts and Wyoming identical, and
  // a Communist indistinguishable from a Theocrat.
  const axis = presidentAxis(scenario);
  const stateApproval = {};
  for (const code of STATE_CODES) {
    const lean = STATES[code].lean; // + = Republican
    // A president is more popular where the electorate agrees with them.
    const alignment = axis * lean; // positive when state agrees with president
    stateApproval[code] = clamp(Math.round(scenario.startApproval + alignment * 0.55));
  }

  // Seed stakeholder support from ideological alignment with the president,
  // then apply who the president actually is — background, wealth, faith and
  // the rest all decide which blocs start warm.
  const fx = scenario.profileEffects || {};
  const stakeholders = {};
  for (const s of STAKEHOLDERS) {
    const alignment = sign * s.lean; // positive when stakeholder agrees with president
    stakeholders[s.id] = clamp(Math.round(50 + alignment * 18 + (fx[s.id] || 0)));
  }

  // A president's home region starts friendlier than the partisan maths says.
  for (const code of scenario.homeStates || []) {
    if (stateApproval[code] != null) stateApproval[code] = clamp(stateApproval[code] + 7);
  }

  // Congress: either the composition the player picked, or the party default.
  const congress = scenario.congress
    ? seatsFromComposition(scenario.congress, sign)
    : seedCongress(sign);

  const state = {
    office: "president",
    scenario,
    month: 1,
    term: 1,
    approval: clamp(round1(scenario.startApproval + (fx.approval || 0))),
    stability: clamp(Math.round((scenario.stability ?? 72) + (fx.stability || 0))),
    economy: {
      gdpGrowth: 2.4,
      unemployment: 4.1,
      inflation: 3.0,
      debt: 34.2, // trillions
    },
    stakeholders,
    stateApproval,
    congress,
    // The Supreme Court is inherited, not chosen — a standing constraint.
    court: scenario.court ?? { conservative: 6, liberal: 3 },
    // Congress is 535 named members with ideologies of their own, derived from
    // this seed on demand rather than stored — see data/government.js.
    rosterSeed: `${scenario.presidentName}|${scenario.startYear}|${scenario.party}`,
    cabinet: buildCabinet(scenario),
    firstLady: buildFirstLady(scenario),
    institutions: buildInstitutions(scenario),
    specialActions: emptyLedger(),
    foreign: buildForeign(scenario),
    // Ongoing situations that carry across months. See arcs.js.
    arcs: [],
    history: [],
    seenEvents: [],
    // Congress starts finding its feet; bills arrive from month two.
    bills: [],
    billHistory: [],
    billLog: [],
    // Investigation, articles, and the Senate trial. See impeachment.js.
    jeopardy: emptyJeopardy(),
    // Money, in $M. It accrues every month from approval and the blocs, and it
    // is the only thing a president can spend on a map they cannot otherwise
    // reach. See elections.js.
    warChest: WAR_CHEST_START,
    // Which term's midterms have already been held, so a second term gets its
    // own. Null until the first one is fought.
    midtermTerm: null,
    // How hard each statehouse is resisting. The governors themselves are
    // derived from rosterSeed; only this moves. See governors.js.
    governors: null,
    over: false,
    ending: null,
  };

  // Optional subsystems, only present when their rule is switched on.
  if (scenario.society) state.society = buildSociety(scenario);
  if (scenario.war && scenario.war !== "off") state.deployments = buildDeployments(scenario);
  if (scenario.covert) state.covert = buildCovert(scenario);

  // Every appointee has politics of their own — a Secretary of the Treasury is
  // somebody's kind of Republican, not a neutral instrument.
  const rosterSeed = state.rosterSeed;
  for (const member of state.cabinet) {
    if (member.id === "vp" && scenario.vp?.ideology) {
      // The running mate's ideology was chosen by the player, not drawn.
      Object.assign(member, { ideology: scenario.vp.ideology, fringe: false });
      continue;
    }
    Object.assign(member, cabinetIdeology(rosterSeed, member.id, scenario.party, scenario.radicals === true));
  }

  // Fifty governors the president did not pick and cannot remove.
  state.governors = buildGovernors(state);

  // The bench, named, so the court is nine people rather than two numbers.
  state.justices = buildCourt({
    seed: rosterSeed, court: state.court, radical: scenario.radicals === true,
  });

  // The spouse in the cabinet and the spouse in the East Wing are one person.
  const spouse = state.cabinet.find((c) => c.id === "spouse");
  if (spouse && state.firstLady) {
    spouse.name = state.firstLady.name;
    spouse.role = state.firstLady.title;
    spouse.persona = `${spouse.persona}. ${state.firstLady.bio} Their signature cause is ${state.firstLady.cause}.`;
  }

  return state;
}

// ---------------------------------------------------------------------------
// Cabinet & inner circle — the people the player can consult before deciding.
// ---------------------------------------------------------------------------

export const CABINET_ROLES = [
  { id: "vp",       role: "Vice President",           emoji: "🎖️", focus: "politics & the next election",
    persona: "a seasoned political operator: loyal in public but always thinking two elections ahead, occasionally protecting your own future" },
  { id: "spouse",   role: "First Spouse",             emoji: "💐", focus: "you, your family & your legacy",
    persona: "the President's spouse — candid and personal, protective of the President's health, family and legacy, and largely unmoved by polls" },
  { id: "chief",    role: "Chief of Staff",           emoji: "🗂️", focus: "what's actually possible",
    persona: "a blunt pragmatist who manages what is politically possible and tells the President hard truths about the votes and the clock" },
  { id: "state",    role: "Secretary of State",       emoji: "🌐", focus: "allies & the world",
    persona: "a career diplomat focused on allies, adversaries and the international fallout of any decision" },
  { id: "defense",  role: "Secretary of Defense",     emoji: "🪖", focus: "security & the military",
    persona: "a measured but hawkish former general focused on national security, military options and their risks" },
  { id: "treasury", role: "Secretary of the Treasury", emoji: "💵", focus: "the economy & the deficit",
    persona: "a markets-and-numbers economist focused on cost, the deficit, inflation and how Wall Street will react" },
  { id: "ag",       role: "Attorney General",         emoji: "⚖️", focus: "the law & the courts",
    persona: "the nation's top lawyer, focused on what is legal and what will survive a challenge at the Supreme Court" },
  { id: "dhs",      role: "Homeland Security",        emoji: "🛂", focus: "the border, disasters & domestic threats",
    persona: "a career security administrator focused on the border, disaster response and threats inside the country" },
  { id: "hhs",      role: "Health & Human Services",  emoji: "🏥", focus: "public health & the safety net",
    persona: "a public-health administrator focused on coverage, outbreaks, drug pricing and the safety net" },
  { id: "hud",      role: "Housing & Urban Development", emoji: "🏘️", focus: "housing costs & cities",
    persona: "an urban-policy specialist focused on housing supply, rents, homelessness and the health of cities" },
  { id: "energy",   role: "Energy",                   emoji: "⚡", focus: "power, fuel prices & the grid",
    persona: "an energy technocrat focused on the grid, fuel prices, permitting and the transition to cleaner power" },
  { id: "press",    role: "Press Secretary",          emoji: "🎤", focus: "optics & messaging",
    persona: "a sharp communications strategist focused entirely on optics, messaging and how a decision will play on the news" },
];

const FIRST_NAMES = ["Margaret", "James", "Elena", "Marcus", "Priya", "David", "Sofia", "Nathan", "Yuki", "Andre", "Rachel", "Tomás", "Grace", "Omar", "Nina", "Caleb", "Dana", "Ibrahim"];
const LAST_NAMES = ["Whitfield", "Okafor", "Castellano", "Nguyen", "Brennan", "Al-Rashid", "Sundqvist", "Delgado", "Harrington", "Petrov", "Osei", "Kaplan", "Romano", "Fairbanks", "Mbeki", "Larsson"];

export function buildCabinet(scenario) {
  const rng = mulberry32(hashString(scenario.presidentName + scenario.party));
  const usedFirst = new Set();
  const usedLast = new Set();
  const pick = (pool, used) => {
    let n;
    do { n = pool[Math.floor(rng() * pool.length)]; } while (used.has(n) && used.size < pool.length);
    used.add(n);
    return n;
  };
  return CABINET_ROLES.map((r) => {
    const member = {
      id: r.id,
      role: r.role,
      emoji: r.emoji,
      focus: r.focus,
      persona: r.persona,
      name: `${pick(FIRST_NAMES, usedFirst)} ${pick(LAST_NAMES, usedLast)}`,
      loyalty: Math.round(45 + rng() * 45),     // 45-90
      competence: Math.round(45 + rng() * 50),  // 45-95
    };
    // The player picks their own running mate, so the VP is not randomised.
    if (r.id === "vp" && scenario.vp) {
      const vp = scenario.vp;
      return {
        ...member,
        name: vp.name,
        loyalty: vp.loyalty,
        competence: vp.competence,
        focus: vp.portfolio ? `${vp.portfolio}, politics & the next election` : member.focus,
        persona: `${member.persona}. Specifically: ${vp.bio || `a ${vp.region} ${vp.background}`}`,
      };
    }
    return member;
  });
}

/**
 * Turn "seats my party holds" into a D/R split. `sign` is +1 for a Republican
 * president, -1 for a Democrat.
 */
function seatsFromComposition({ house, senate }, sign) {
  const houseMine = Math.max(0, Math.min(435, Math.round(house)));
  const senateMine = Math.max(0, Math.min(100, Math.round(senate)));
  if (sign >= 0) {
    return {
      houseR: houseMine, houseD: 435 - houseMine,
      senateR: senateMine, senateD: 100 - senateMine,
    };
  }
  return {
    houseD: houseMine, houseR: 435 - houseMine,
    senateD: senateMine, senateR: 100 - senateMine,
  };
}

function seedCongress(sign) {
  // sign +1 Republican president. Give the president's party a modest edge or
  // deficit at random-ish but deterministic-by-party baseline.
  if (sign >= 0) {
    return { houseR: 221, houseD: 214, senateR: 51, senateD: 49 };
  }
  return { houseR: 220, houseD: 215, senateR: 49, senateD: 51 };
}

/** The caucus the President belongs to, or null if they have no party. */
const presidentCaucus = (state) =>
  state.scenario?.party === "Republican" ? "Republican"
    : state.scenario?.party === "Democrat" ? "Democrat" : null;

/**
 * Who controls each chamber.
 *
 * A 50–50 Senate is not a majority for anybody — except that the Vice
 * President breaks the tie, which is the constitutional power the running-mate
 * pick has always implied and never actually had. With no Vice President in
 * post a tied Senate goes the other way, because the President has no way to
 * carry a vote through it. There is no casting vote in the House.
 */
export function partyControl(state) {
  const c = state.congress;
  const winner = (d, r) => (r > d ? "Republican" : d > r ? "Democrat" : null);
  const mine = presidentCaucus(state);
  const theirs = mine === "Republican" ? "Democrat" : "Republican";

  const house = winner(c.houseD, c.houseR);
  const senate = winner(c.senateD, c.senateR);

  return {
    house: house ?? (mine ? theirs : "Democrat"),
    senate: senate ?? (mine ? (hasTieBreak(state) ? mine : theirs) : "Democrat"),
    senateTied: senate === null,
  };
}

export function electoralCount(state) {
  let win = 0, lose = 0, tossup = 0;
  for (const code of STATE_CODES) {
    const a = state.stateApproval[code];
    if (a >= 52) win += STATES[code].ev;
    else if (a <= 48) lose += STATES[code].ev;
    else tossup += STATES[code].ev;
  }
  return { win, lose, tossup, total: TOTAL_EV };
}

// ---------------------------------------------------------------------------
// Checks & balances — does Congress pass it, and do the courts let it stand?
// Returns human-readable statuses plus an effectMultiplier the mock engine
// uses to dampen the impact of a blocked or struck-down policy.
// ---------------------------------------------------------------------------

export function classifyPolicy(text) {
  const t = text.toLowerCase();
  const executive = /executive order|executive action|by executive|i will direct|i'll direct|instruct the|order the|directive|by decree|emergency power|unilateral/.test(t);
  const legislation =
    /\b(legislation|bill|statute|laws?|fund|funding|budget|appropriations?|taxes?|repeal|amendment)\b/.test(t) ||
    /through congress|pass (a|the|this|new|my|it through|legislation)|sign(ed)? into law|act of congress|get congress to/.test(t);
  const aggressive = executive && /\b(ban|mandate|seize|nationaliz|suspend|ignore|bypass|bypassing|emergency|shut down|override|unilateral(ly)?)\b/.test(t);
  const bipartisan = /bipartisan|across the aisle|both parties|compromise|work with (congress|republicans|democrats|the other)/.test(t);
  const appointsJustice = /(nominat|appoint)/.test(t) && /(justice|supreme court|the court)/.test(t);
  return { executive, legislation, aggressive, bipartisan, appointsJustice };
}

// Simulate a roll-call vote in each chamber, party by party.
export function computeRollCall(state, bipartisan) {
  const party = state.scenario.party;
  const approvalFactor = (state.approval - 50) / 100; // ~ -0.3..+0.2
  const c = state.congress;

  const chamber = (dSeats, rSeats, { tieBreak = false } = {}) => {
    let dYes, rYes;
    if (party === "Democrat") {
      dYes = Math.round(dSeats * clamp(0.82 + approvalFactor, 0.45, 0.98));
      rYes = Math.round(rSeats * clamp(0.08 + (bipartisan ? 0.32 : 0) + approvalFactor * 0.5, 0.02, 0.7));
    } else if (party === "Republican") {
      rYes = Math.round(rSeats * clamp(0.82 + approvalFactor, 0.45, 0.98));
      dYes = Math.round(dSeats * clamp(0.08 + (bipartisan ? 0.32 : 0) + approvalFactor * 0.5, 0.02, 0.7));
    } else {
      const rate = clamp(0.34 + (bipartisan ? 0.22 : 0) + approvalFactor, 0.1, 0.75);
      dYes = Math.round(dSeats * rate);
      rYes = Math.round(rSeats * rate);
    }
    const total = dSeats + rSeats;
    const yes = dYes + rYes;
    const threshold = Math.floor(total / 2) + 1;
    // The Vice President breaks an exact tie for the administration.
    const passed = yes >= threshold || (tieBreak && yes * 2 === total);
    return { dYes, rYes, yes, no: total - yes, total, threshold, passed, brokenByVp: passed && yes < threshold };
  };

  const house = chamber(c.houseD, c.houseR);
  const senate = chamber(c.senateD, c.senateR, { tieBreak: hasTieBreak(state) });
  let status;
  if (house.passed && senate.passed) status = "passed";
  else if (house.passed || senate.passed) status = "compromised";
  else status = "blocked";
  return { house, senate, status };
}

// Which cabinet secretary owns the implementation of this policy?
export function leadDepartment(policyText) {
  const t = policyText.toLowerCase();
  if (/\b(health|hospital|medicare|medicaid|vaccine|outbreak|pandemic|drug pric|insurance|opioid)\b/.test(t)) return "hhs";
  if (/\b(housing|rent|mortgage|homeless|zoning|tenant|landlord|urban)\b/.test(t)) return "hud";
  if (/\b(energy|oil|gas|grid|pipeline|solar|wind|nuclear power|emissions|drilling|blackout)\b/.test(t)) return "energy";
  if (/\b(border|immigrat|deport|asylum|customs|fema|hurricane|wildfire|disaster|homeland)\b/.test(t)) return "dhs";
  if (/\b(tax|budget|deficit|spend|stimulus|econom|jobs|wage|trade|market|inflation|bank|debt)\b/.test(t)) return "treasury";
  if (/\b(war|troops|military|defense|deploy|strike|security|nuclear|invade|weapons)\b/.test(t)) return "defense";
  if (/\b(ally|allies|foreign|diplomat|treaty|nato|sanction|embassy|summit|negotiat)\b/.test(t)) return "state";
  if (/\b(law|legal|court|justice|crime|police|prosecut|executive order|constitution|regulation)\b/.test(t)) return "ag";
  return "chief"; // general implementation
}

export function computeChecks(state, policyText) {
  const sign = partySign(state.scenario.party);
  const kind = classifyPolicy(policyText);
  const control = partyControl(state);
  const party = state.scenario.party;
  const roll = hashString(policyText + state.month) % 100; // deterministic 0-99

  const checks = {
    congress: { status: "executive", note: "" },
    court: { status: "none", note: "" },
    effectMultiplier: 1,
  };

  // Checks & balances switched off in setup: nothing blunts the president.
  if (state.scenario.checks === false) {
    checks.congress.note = "Checks and balances are switched off — your decision takes effect as written.";
    return checks;
  }

  // With Congress dissolved there is no chamber left to pass or block anything.
  if (state.congressDissolved) {
    checks.congress = {
      status: "executive",
      note: "There is no Congress. The decree took effect the moment you signed it.",
    };
    return checks;
  }

  // --- Congress ---
  if (kind.legislation) {
    const roll = computeRollCall(state, kind.bipartisan);
    const h = roll.house, s = roll.senate;
    if (roll.status === "passed") {
      checks.congress = { status: "passed", tally: roll,
        note: `Passed both chambers — House ${h.yes}–${h.no}, Senate ${s.yes}–${s.no}.` };
    } else if (roll.status === "compromised") {
      const cleared = h.passed ? "House" : "Senate";
      const stuck = h.passed ? "Senate" : "House";
      checks.congress = { status: "compromised", tally: roll,
        note: `Cleared the ${cleared} but stalled in the ${stuck}; a watered-down compromise limped through.` };
      checks.effectMultiplier *= 0.65;
    } else {
      checks.congress = { status: "blocked", tally: roll,
        note: `Died in Congress — failed the House ${h.yes}–${h.no} and the Senate ${s.yes}–${s.no}.` };
      checks.effectMultiplier *= 0.35;
    }
  } else if (kind.executive) {
    checks.congress = { status: "executive", note: "You acted by executive authority, sidestepping Congress entirely — faster, but on shakier legal ground." };
  } else {
    checks.congress = { status: "executive", note: "Implemented through the powers of the office; no act of Congress was required." };
  }

  // --- Supreme Court ---
  //
  // Nine justices, each deciding the case on its own merits, exactly as both
  // chambers of Congress already vote seat by seat. The 6–3 count on the
  // dashboard is a summary of who sits there, not the ruling itself: a bench
  // with two institutionalists on it upholds things its politics dislike, and
  // a 5–4 is genuinely uncertain until the votes are counted. See court.js.
  const ruling = courtRuling(state, policyText);
  if (ruling.heard) {
    checks.court = {
      status: ruling.struck ? "struck_down" : "upheld",
      note: ruling.opinion,
      ruling,
    };
    if (ruling.struck) {
      // A unanimous rebuke costs more than a 5–4 the White House can spin.
      const decisiveness = ruling.strikes / ruling.votes.length;
      checks.effectMultiplier *= round1(0.55 - decisiveness * 0.25);
      checks.courtPenalty = -round1(1.5 + decisiveness * 3);
    }
  }

  return checks;
}

/**
 * Difficulty settings. Hard is the design baseline; the easier tiers cushion
 * bad months and flatter good ones, and forgive more at the ballot box.
 */
const DIFFICULTY = {
  hard:   { loss: 1,   gain: 1,    winApproval: 46 },
  medium: { loss: 0.8, gain: 1.1,  winApproval: 44 },
  easy:   { loss: 0.6, gain: 1.25, winApproval: 42 },
};

const difficultyOf = (name) => DIFFICULTY[name] || DIFFICULTY.hard;

function softenByDifficulty(change, difficulty) {
  const d = difficultyOf(difficulty);
  return round1(change * (change < 0 ? d.loss : d.gain));
}

// Fold a TurnResult (from Claude or the mock engine) into a new game state.
export function applyResult(state, policy, result) {
  const next = structuredClone(state);

  // Ensure a checks-and-balances narrative exists (AI may omit it). With the
  // rule switched off in setup, nothing blocks the president at all.
  if (state.scenario.checks === false) delete result.checks;
  else if (!result.checks) result.checks = computeChecks(state, policy);

  // A Supreme Court appointment shifts the bench toward the president.
  const kind = classifyPolicy(policy);
  if (kind.appointsJustice) {
    const s = partySign(state.scenario.party);
    if (s > 0 && next.court.liberal > 0) { next.court.conservative++; next.court.liberal--; }
    else if (s < 0 && next.court.conservative > 0) { next.court.liberal++; next.court.conservative--; }
    refreshCourt(next);
  }

  // The competence of the responsible secretary shapes the rollout.
  const deptId = leadDepartment(policy);
  const lead = (state.cabinet || []).find((a) => a.id === deptId);
  if (lead) {
    const mod = round1((lead.competence - 68) / 9); // ~ -2.6 .. +3
    result.approvalChange = (result.approvalChange || 0) + mod;
    result.rollout = {
      role: lead.role,
      name: lead.name,
      competence: lead.competence,
      note: lead.competence >= 80 ? "executed the rollout crisply — barely a hitch"
        : lead.competence >= 60 ? "managed a serviceable rollout"
        : "fumbled the rollout; implementation was messy and slow",
    };
  }

  // Story arcs advance before approval is banked, so their drag, detonations
  // and payoffs are part of the same month's swing rather than a separate one.
  const arcOutcome = advanceArcs({
    arcs: next.arcs || [],
    verdicts: result.arcs,
    proposal: result.newArc,
    checks: result.checks,
    policy,
    month: state.month,
  });
  next.arcs = arcOutcome.arcs;
  result.arcEvents = arcOutcome.events;
  result.approvalChange = round1((result.approvalChange || 0) + arcOutcome.approvalChange);
  // A detonated arc seizes next month's briefing from whatever was lined up.
  if (arcOutcome.detonation) {
    result.nextEvent = detonationEvent(arcOutcome.detonation);
    result.detonation = {
      id: arcOutcome.detonation.arc.id,
      title: arcOutcome.detonation.arc.title,
      monthsActive: arcOutcome.detonation.monthsActive,
    };
  }

  // Difficulty only ever bends the swing — it never rewrites what happened.
  result.approvalChange = softenByDifficulty(result.approvalChange || 0, state.scenario.difficulty);
  next.approval = clamp(round1(next.approval + result.approvalChange));

  // With the economic simulation switched off the numbers simply hold still.
  if (state.scenario.economy !== false) {
    const eco = result.economy || {};
    next.economy.gdpGrowth = clamp(round1(next.economy.gdpGrowth + (eco.gdpGrowth || 0)), -7, 7);
    next.economy.unemployment = clamp(round1(next.economy.unemployment + (eco.unemployment || 0)), 1.5, 25);
    next.economy.inflation = clamp(round1(next.economy.inflation + (eco.inflation || 0)), -3, 40);
    next.economy.debt = round1(next.economy.debt + (eco.debt || 0));
  }

  // Track every delta by id as it is applied — the focus group reads these to
  // work out how thirty individual voters feel about the month.
  const stakeDeltas = {};
  const stateDeltas = {};

  for (const s of result.stakeholders || []) {
    const id = resolveStakeholder(s.name);
    if (id && next.stakeholders[id] != null) {
      stakeDeltas[id] = (stakeDeltas[id] || 0) + (s.change || 0);
      next.stakeholders[id] = clamp(Math.round(next.stakeholders[id] + (s.change || 0)));
    }
  }

  // Arc damage lands on the stakeholders and states its domain actually touches.
  for (const [id, delta] of Object.entries(arcOutcome.stakeholders)) {
    if (next.stakeholders[id] != null) {
      stakeDeltas[id] = (stakeDeltas[id] || 0) + delta;
      next.stakeholders[id] = clamp(Math.round(next.stakeholders[id] + delta));
    }
  }

  // A policy is only worth what the state actually implements. A hostile
  // governor slow-walks it, litigates it and refuses to staff it — so the same
  // announcement lands harder in a friendly state than a defiant one.
  for (const se of result.stateEffects || []) {
    const code = (se.code || "").toUpperCase();
    if (next.stateApproval[code] != null) {
      const raw = se.change || 0;
      // Only the good a president is trying to do gets blunted. Damage lands
      // wherever it lands — a governor cannot refuse to implement a disaster.
      const change = raw > 0
        ? round1(raw * defianceDrag((next.governors || {})[code] ?? 0))
        : raw;
      stateDeltas[code] = (stateDeltas[code] || 0) + change;
      next.stateApproval[code] = clamp(round1(next.stateApproval[code] + change));
    }
  }
  for (const [code, delta] of Object.entries(arcOutcome.states)) {
    if (next.stateApproval[code] != null) {
      stateDeltas[code] = (stateDeltas[code] || 0) + delta;
      next.stateApproval[code] = clamp(round1(next.stateApproval[code] + delta));
    }
  }

  // The focus group. Every one of the thirty reacts, deterministically, from
  // what actually happened to them — no model call is involved in a mood.
  // Only the rotating cast in `speakers` will be given words.
  const scored = scoreAll({
    approvalChange: result.approvalChange || 0,
    stakeholders: stakeDeltas,
    states: stateDeltas,
    approval: next.approval,
    // Where the president actually stands, and how hard it splits the room.
    presidentAxis: presidentAxis(state.scenario),
    intensity: state.scenario.ideologyIntensity ?? 1,
    // Anyone stripped of the vote is no longer polled.
    electorate: next.electorate,
  });
  result.personas = scored;
  result.speakers = selectSpeakers(scored, state.month);
  // Every state is pulled back toward the national number.
  //
  // Without this the map is free to drift away from reality entirely: a
  // president can fall to 15% nationally while fifty states still read 53,
  // because a monthly swing of a few tenths rounds away to nothing. States
  // hold their own structural gap from the country — a president is always
  // stronger where the electorate agrees with them — but the country is the
  // anchor, and a local shock decays back toward it over a few months.
  for (const code of STATE_CODES) {
    const target = clamp(next.approval + structuralOffset(state.scenario, code));
    const now = next.stateApproval[code];
    next.stateApproval[code] = clamp(round1(now + (target - now) * NATIONAL_PULL));
  }

  // Stability reflects approval, stakeholder average and economic pain.
  const stakeAvg = Object.values(next.stakeholders).reduce((a, b) => a + b, 0) / STAKEHOLDERS.length;
  const miseryIndex = next.economy.unemployment + next.economy.inflation;
  next.stability = clamp(Math.round(
    0.5 * next.approval + 0.35 * stakeAvg + 0.15 * (100 - miseryIndex * 2) + arcOutcome.stabilityChange
  ));

  // --- The subsystems that run whether or not the president looked at them ---
  // Each is optional; each mutates `next` and reports what the player should
  // be told, which the client renders alongside the month's consequences.
  tickFirstLady(next);
  tickInstitutions(next);
  // Congress writes its own legislation. Bills left unsigned expire and make
  // the President look like a bystander in their own government.
  result.expiredBills = ageBills(next);
  next.bills = [...(next.bills || []), ...originateBills(next)];
  result.newBills = next.bills.filter((b) => b.arrivedMonth === next.month);
  result.amendment = tickSpecialActions(next);
  result.governorMoves = tickGovernors(next, policy);
  result.foreignMoves = applyForeign(next, policy, result);
  if (next.society) result.societyMoves = applySociety(next, policy, result);
  if (next.deployments) result.warEvents = tickDeployments(next, policy);
  if (next.covert) result.covertOutcome = tickCovert(next, policy, result.covertAction);
  // The Bureau, the articles, the House and the Senate.
  result.jeopardyEvents = tickJeopardy(next, policy);

  // Approval may have moved again since it was banked; keep the reported
  // number honest rather than letting the subsystems change it silently.
  result.approvalChange = round1(next.approval - state.approval);

  next.history.push({
    month: state.month,
    term: state.term || 1,
    policy,
    headline: result.press?.[0]?.headline || result.analysis?.slice(0, 90),
    approval: next.approval,
    approvalChange: result.approvalChange,
  });
  rememberEvent(next, result.usedEvent);

  // A month of fundraising. Popularity and a warm coalition both pay.
  result.raised = fundraise(next);
  next.warChest = round1((next.warChest ?? WAR_CHEST_START) + result.raised);

  const clock = pacing(state);

  next.month = state.month + 1;

  // Endings & phases.
  if (result.flags?.removedFromOffice) {
    next.over = true;
    next.ending = { type: "removed", reason: result.flags.reason || "You were forced from office." };
  } else if (next.stability <= 8) {
    next.over = true;
    next.ending = { type: "collapse", reason: "Government stability collapsed. You were removed from power." };
  } else if (next.congressDissolved) {
    // There is no election to hold and no legislature to hold it. The only
    // question left is whether the army is still carrying the government.
    if (next.stakeholders.pentagon < 55) {
      next.over = true;
      next.ending = {
        type: "removed",
        reason: `The generals stopped taking your calls. With the Capitol padlocked there was no lawful ` +
          `way to remove you and no lawful way to protect you either, so they did it themselves.`,
      };
    } else if (next.month > clock.termLength) {
      next.over = true;
      next.ending = {
        type: "autocrat",
        reason: `Four years passed and no election was held, because there was nobody left to call one. ` +
          `You are still in office, the army is still behind you, and the republic you were handed no ` +
          `longer exists.`,
      };
    }
  } else if (next.month >= clock.campaignStart && next.phase !== "campaign"
             && canServeAnotherTerm(next)) {
    // The re-election campaign begins — the debate decides the term. A
    // term-limited president is not on the ballot, so there is nothing to run.
    next.phase = "campaign";
    next.campaign = createCampaign(next);
  } else if (next.month === PRIMARY_MONTH && !next.primaryHeld
             && primaryThreat(next).serious) {
    // Your own party comes first. A president has to be renominated before
    // there is any point thinking about the other side.
    next.phase = "primary";
    next.primary = { challenger: primaryChallenger(next), threat: primaryThreat(next) };
  } else if (next.month === clock.midterm && next.midtermTerm !== (next.term || 1)
             && !next.congressDissolved) {
    // Midterm season. The whole House and a third of the Senate are on the
    // ballot, and the president is not — which is the point. It runs as its own
    // phase rather than silently inside a turn, because the chamber that comes
    // out of it decides what is possible for the rest of the presidency.
    next.phase = "midterms";
    next.midtermCampaign = { spend: {}, challenger: challengerFor(next) };
  } else if (next.month > clock.termLength) {
    next.over = true;
    next.ending = evaluateReelection(next);
  }

  // The cabinet's own option, considered only while the presidency is still
  // running. A declaration under the Twenty-Fifth takes over the month.
  if (!next.over && !next.phase) {
    result.twentyFifth = tickTwentyFifth(next);
  }

  // A presidency ending is not the career ending: if there is a Vice President
  // and a constitution still standing, the office passes to them.
  return maybeSucceed(next, result);
}

/**
 * Hand the office to the Vice President where the Constitution provides for
 * it, instead of closing the career. Returns the state unchanged when this
 * ending has no successor — an election defeat, or a coup that already
 * dissolved the government that would have carried anyone into office.
 */
export function maybeSucceed(state, result = null) {
  if (!state.over || !canSucceed(state, state.ending)) return state;
  const departed = state.ending;
  const next = succeed(state, departed);
  next.succession = {
    from: departed,
    president: next.scenario.presidentName,
    month: next.month,
    term: next.term || 1,
  };
  if (result) result.succession = next.succession;
  return next;
}

const clampSeats = (v, total) => Math.max(0, Math.min(total, v));

/**
 * Hold the midterms.
 *
 * `spend` is the map the player drew with their war chest — dollars per state,
 * trimmed to what is actually in the bank. What comes back is a new Congress
 * and the night that produced it, which the client renders as a results screen
 * rather than a number that quietly changed.
 */
export function finishMidterms(state, spend = {}) {
  const next = structuredClone(state);
  const result = runMidterms(next, { spend });

  next.congress = result.congress;
  next.warChest = round1(Math.max(0, (next.warChest ?? 0) - totalSpend(result.spend)));
  next.midtermTerm = next.term || 1;
  next.phase = null;
  next.midtermCampaign = null;
  next.midterms = [...(next.midterms || []), {
    term: next.term || 1,
    month: absoluteMonth(next),
    env: result.env,
    houseSwing: result.house?.swing ?? 0,
    senateSwing: result.senate?.swing ?? 0,
    congress: result.congress,
  }];

  // A midterm is a verdict, and the country reacts to its own verdict: a
  // rebuked president is weaker the morning after, a vindicated one steadier.
  const net = (result.house?.swing ?? 0) + (result.senate?.swing ?? 0);
  next.stability = clamp(Math.round(next.stability + Math.max(-10, Math.min(6, net / 4))));

  next.history.push({
    month: next.month,
    term: next.term || 1,
    midterm: true,
    headline: result.held ? result.note : "No midterms were held.",
    approval: next.approval,
    approvalChange: 0,
  });

  return { state: next, result };
}

function evaluateReelection(next) {
  // A president who has run out of terms is not on the ballot at all.
  if (!canServeAnotherTerm(next)) return termLimitedEnding(next);

  // The safety net for a career that reaches the end of a term without ever
  // entering campaign season. It votes on the same map as election night.
  const result = runPresidential(next, { bonus: difficultyBonus(next) });
  const ending = describeElection(next, result, "The country voted");
  ending.election = result;
  return ending;
}

/**
 * Difficulty as points of national margin rather than a threshold. The easier
 * tiers put the president a little ahead of where the map says they are; Hard,
 * the design baseline, gives them nothing.
 */
function difficultyBonus(state) {
  const { winApproval } = difficultyOf(state.scenario.difficulty);
  return round1((46 - winApproval) * 2);
}

/**
 * Turn an election result into an ending. Split decisions get their own
 * language, because losing while winning more votes is a different kind of
 * defeat and the game should say so.
 */
function describeElection(state, result, opener) {
  const { ev, popular } = result;
  const pv = `${popular.you.toFixed(1)}–${popular.them.toFixed(1)}`;

  if (result.won && result.split) {
    return {
      type: "reelected", electoral: ev.you,
      reason: `${opener}, and the two verdicts disagreed. ${result.challenger?.name || "Your challenger"} ` +
        `won the popular vote ${popular.them.toFixed(1)}–${popular.you.toFixed(1)}, and you won the ` +
        `presidency ${ev.you}–${ev.them}. You have a second term and half the country thinks you should not.`,
    };
  }
  if (result.won) {
    const landslide = ev.you >= 375;
    return {
      type: "reelected", electoral: ev.you,
      reason: landslide
        ? `${opener} and it was not close. ${ev.you} electoral votes, ${pv} in the popular vote, and a ` +
          `mandate nobody can argue with. A second term begins.`
        : `${opener}. You held on — ${ev.you} electoral votes to ${ev.them}, ${pv} in the popular vote. ` +
          `Not a mandate, but four more years.`,
    };
  }
  if (result.split) {
    return {
      type: "narrow", electoral: ev.you,
      reason: `${opener}, and you won more votes than the winner — ${pv} — and lost anyway, ` +
        `${ev.you} electoral votes to ${ev.them}. The result is legitimate, and it will be argued ` +
        `about for a generation.`,
    };
  }
  if (ev.them - ev.you <= 40) {
    return {
      type: "narrow", electoral: ev.you,
      reason: `${opener} and nobody can call it. ${ev.you}–${ev.them} with ${result.tooClose.length} ` +
        `states still inside the margin, and the recounts have only just begun.`,
    };
  }
  return {
    type: "defeated", electoral: ev.you,
    reason: `${opener}, and the country turned the page. ${result.challenger?.name || "Your challenger"} ` +
      `won ${ev.them} electoral votes to your ${ev.you}, ${pv} in the popular vote.`,
  };
}

const ordinal = (n) => ["", "first", "second", "third", "fourth", "fifth", "sixth"][n] || `${n}th`;

function termLimitedEnding(next) {
  const terms = next.term || 1;
  return {
    type: "term_limited",
    reason: `You served ${terms === 1 ? "a full term" : `${ordinal(terms)} terms`} and the ` +
      `Twenty-Second Amendment sent you home. Your name was never on the ballot, and the ` +
      `country chose a successor with you standing behind them on the platform.`,
  };
}

/**
 * Swear in the next term.
 *
 * Almost everything carries: the arcs still festering, the scars, the
 * stakeholders, the economy, the courts and the institutional clocks that have
 * been running down since day one. What resets is the calendar and the
 * legislative slate. What changes is the room — a presidential election drags
 * Congress with it, and second-term cabinets empty out.
 */
export function beginNextTerm(state, ending) {
  const next = structuredClone(state);
  const clock = pacing(next);
  const r = seeded(`${next.scenario.presidentName}|term|${next.term + 1}`);

  next.elections = [...(next.elections || []), {
    term: next.term,
    endedMonth: absoluteMonth(next),
    approval: next.approval,
    electoral: ending.electoral ?? electoralCount(next).win,
  }];

  next.term = (next.term || 1) + 1;
  next.month = 1;
  next.phase = null;
  next.campaign = null;
  next.over = false;
  next.ending = null;
  // A new Congress means a clean legislative slate; the old desk expires.
  next.bills = [];

  // Coattails: a president who wins comfortably drags their party with them.
  if (!next.congressDissolved) {
    const sign = partySign(next.scenario.party);
    const swing = Math.round((next.approval - 50) / 3);
    if (sign !== 0 && swing !== 0) {
      const houseKey = sign > 0 ? "houseR" : "houseD";
      const otherHouse = sign > 0 ? "houseD" : "houseR";
      const senateKey = sign > 0 ? "senateR" : "senateD";
      const otherSenate = sign > 0 ? "senateD" : "senateR";
      next.congress[houseKey] = clampSeats(next.congress[houseKey] + swing, 435);
      next.congress[otherHouse] = 435 - next.congress[houseKey];
      next.congress[senateKey] = clampSeats(next.congress[senateKey] + Math.round(swing / 5), 100);
      next.congress[otherSenate] = 100 - next.congress[senateKey];
    }
  }

  // Second terms empty out. A couple of secretaries go home, and their
  // replacements are loyal but green.
  const replaceable = next.cabinet.filter((c) => c.id !== "vp" && c.id !== "spouse");
  const leaving = new Set();
  const departures = r.between(1, 3);
  for (let i = 0; i < departures && replaceable.length; i++) {
    leaving.add(replaceable[Math.floor(r.next() * replaceable.length)].id);
  }
  for (const member of next.cabinet) {
    if (!leaving.has(member.id)) continue;
    member.name = `${r.pick(FIRST_NAMES)} ${r.pick(LAST_NAMES)}`;
    member.loyalty = r.between(60, 92);
    member.competence = r.between(40, 78);
  }
  next.cabinetChanges = [...leaving];

  // An inauguration is a fresh start, briefly.
  next.approval = clamp(round1(next.approval + 2.5));
  next.stability = clamp(next.stability + 6);

  next.history.push({
    month: clock.termLength,
    term: state.term,
    inauguration: true,
    headline: `Sworn in for a ${ordinal(next.term)} term`,
    approval: next.approval,
    approvalChange: 0,
  });

  return next;
}

function resolveStakeholder(name) {
  if (!name) return null;
  const n = name.toLowerCase();
  const s = STAKEHOLDERS.find((x) => x.id === n || x.name.toLowerCase() === n);
  if (s) return s.id;
  // fuzzy contains
  const f = STAKEHOLDERS.find((x) => n.includes(x.name.toLowerCase()) || x.name.toLowerCase().includes(n));
  return f ? f.id : null;
}

// ---------------------------------------------------------------------------
// Cabinet direct orders — dismiss and replace an advisor.
// ---------------------------------------------------------------------------

export function fireAdvisor(state, advisorId) {
  const next = structuredClone(state);
  const idx = next.cabinet.findIndex((a) => a.id === advisorId);
  if (idx === -1) return { state: next, note: "No such advisor." };
  const fired = next.cabinet[idx];
  if (fired.id === "spouse") return { state: next, note: "You cannot dismiss your own spouse.", rejected: true };

  const role = CABINET_ROLES.find((r) => r.id === advisorId);
  const rng = mulberry32(hashString(fired.name + next.month + "replace"));
  const usedFirst = new Set(next.cabinet.map((a) => a.name.split(" ")[0]));
  const usedLast = new Set(next.cabinet.map((a) => a.name.split(" ")[1]));
  const pick = (pool, used) => {
    let n, tries = 0;
    do { n = pool[Math.floor(rng() * pool.length)]; tries++; } while (used.has(n) && tries < 40);
    used.add(n);
    return n;
  };
  const replacement = {
    id: role.id, role: role.role, emoji: role.emoji, focus: role.focus, persona: role.persona,
    name: `${pick(FIRST_NAMES, usedFirst)} ${pick(LAST_NAMES, usedLast)}`,
    loyalty: Math.round(55 + rng() * 40),    // fresh appointees skew loyal to you
    competence: Math.round(45 + rng() * 50),
  };
  next.cabinet[idx] = replacement;

  // Churn is politically costly and unsettles the rest of the team — unless you
  // were clearly cleaning house of someone disloyal.
  const vpCost = advisorId === "vp" ? 2 : 0;
  next.approval = clamp(round1(next.approval - 1.5 - vpCost));
  const wasDisloyal = fired.loyalty < 50;
  for (const a of next.cabinet) {
    if (a.id === advisorId) continue;
    a.loyalty = clamp(a.loyalty + (wasDisloyal ? 2 : -3));
  }
  const stakeAvg = Object.values(next.stakeholders).reduce((x, y) => x + y, 0) / STAKEHOLDERS.length;
  const misery = next.economy.unemployment + next.economy.inflation;
  next.stability = clamp(Math.round(0.5 * next.approval + 0.35 * stakeAvg + 0.15 * (100 - misery * 2)));

  const note = `You dismissed ${fired.name} as ${fired.role}. ${replacement.name} is sworn in — loyalty ${replacement.loyalty}, competence ${replacement.competence}. ${wasDisloyal ? "Cleaning house of a disloyal aide steadied the rest of the team." : "The abrupt firing rattled the rest of your cabinet."}`;
  return { state: next, note, replacement, fired: { name: fired.name, role: fired.role } };
}

// ---------------------------------------------------------------------------
// Campaign season & the presidential debate.
// ---------------------------------------------------------------------------

// The challenger is drawn on day one and lives in elections.js, so the country
// has a face for the opposition long before the debate stage is built.

const DEBATE_TOPICS = [
  { topic: "The economy & cost of living", q: "Prices are still high and families are hurting. In one answer: why do you deserve four more years to run this economy?" },
  { topic: "Your record & broken promises", q: "You made big promises four years ago. Look into the camera and tell voters what you actually delivered — and where you fell short." },
  { topic: "The future & national security", q: "The world is more dangerous than when you took office. What is your closing argument for why you, not your opponent, should be trusted with it?" },
];

export function createCampaign(state) {
  return {
    // The same challenger the country has been hearing about all term, not a
    // stranger drawn on the eve of the debate.
    opponent: challengerFor(state),
    topics: DEBATE_TOPICS,
    round: 1,
    scores: [],
    // Whatever four years of fundraising actually left in the bank.
    warChest: round1(state.warChest ?? 0),
    spend: {},
  };
}

export function mockDebate(state, round, topic, playerLine) {
  const rng = mulberry32(hashString(playerLine + round));
  const words = playerLine.trim().split(/\s+/).filter(Boolean).length;
  let score = 0;
  if (words > 55) score += 4; else if (words > 25) score += 2; else if (words < 10) score -= 4;
  if (/\b(record|delivered|jobs|families|future|safe|freedom|together|results)\b/i.test(playerLine)) score += 2;
  if (/\b(my opponent|they|failed|weak|extreme|dangerous)\b/i.test(playerLine)) score += 1; // going on offense
  if (/[!?]/.test(playerLine)) score += 1;
  score += Math.round((rng() - 0.5) * 4);
  score = Math.max(-10, Math.min(10, score));

  const opp = state.campaign.opponent;
  // Careers saved by older builds may not carry an attack line; never let a
  // missing field surface as "undefined" on the debate stage.
  const attack = opp.attack || "four years of broken promises";
  const winning = score > 2;
  const lines = winning
    ? [`A fine speech, but the President's record speaks louder — ${attack} is what Americans have actually lived through.`,
       `You can dress it up, but the country knows the truth about ${attack}. It's time for a change.`]
    : [`Even you don't sound like you believe that. The President is dodging — this is exactly the ${attack} we've come to expect.`,
       `That's a non-answer, and the voters can hear it. My friends, we can do so much better than ${attack}.`];
  const opponentLine = lines[Math.floor(rng() * lines.length)];
  const pundit = winning
    ? "Snap polls give the President the edge on that exchange — crisp, on-message, and on offense."
    : score < -2 ? "A shaky answer. The pundits scored that round for the challenger."
    : "A wash — neither landed a knockout blow.";

  return { opponentLine, score, pundit };
}

/**
 * The nomination.
 *
 * Win it and the term simply carries on toward the general — bruised, because
 * a contested primary always costs something. Lose it and the career ends
 * here, without the other party ever having had to beat you.
 */
export function finishPrimary(state, strategyId = "record") {
  const next = structuredClone(state);
  const result = runPrimary(next, strategyId);

  next.primaryHeld = true;
  next.phase = null;
  next.primary = null;
  next.primaryResult = {
    strategy: result.strategy.id,
    challenger: result.challenger.name,
    delegates: result.delegates,
    won: result.won,
  };

  if (!result.won) {
    next.over = true;
    next.ending = {
      type: "primaried",
      reason: `Your own party denied you the nomination. ${result.challenger.name} took ` +
        `${result.delegates.them} delegates to your ${result.delegates.you}, and you will not be ` +
        `on the ballot in November. The other side never had to beat you.`,
      delegates: result.delegates.you,
    };
    return { state: next, result };
  }

  // A contested nomination is never free, however it is won.
  next.approval = clamp(round1(next.approval - 2));
  next.stability = clamp(next.stability - 3);

  if (result.strategy.id === "base") {
    // Adopting the wing's platform moves where the president stands — and the
    // general-election map is drawn off exactly that number.
    const anchor = presidentAxis(next.scenario);
    const shift = Math.sign(anchor || partySign(next.scenario.party)) * 0.18;
    next.scenario = {
      ...next.scenario,
      ideologyAxis: round1(Math.max(-1, Math.min(1, anchor + shift))),
    };
    // The base comes home; the centre does not.
    for (const [id, lean] of Object.entries(BLOC_ALIGNMENT)) {
      if (next.stakeholders[id] == null) continue;
      const aligned = Math.sign(lean) === partySign(next.scenario.party);
      next.stakeholders[id] = clamp(Math.round(next.stakeholders[id] + (aligned ? 7 : -5)));
    }
  }

  if (result.strategy.id === "deal") {
    // The challenger takes the ticket. They have their own base, their own
    // ambitions, and no reason whatever to be loyal to you — which is exactly
    // the profile that can invoke the Twenty-Fifth. See succession.js.
    const vp = next.cabinet.find((c) => c.id === "vp");
    if (vp) {
      vp.name = result.challenger.name;
      vp.loyalty = seeded(`${next.rosterSeed}|deal|${next.month}`).between(12, 34);
      vp.competence = seeded(`${next.rosterSeed}|dealc|${next.month}`).between(62, 92);
      vp.persona = `${vp.persona}. They ran against you for this party's nomination, ` +
        `withdrew in exchange for this office, and have not forgotten either fact.`;
    }
    next.stability = clamp(next.stability - 3);
  }

  next.history.push({
    month: next.month,
    term: next.term || 1,
    primary: true,
    headline: `Renominated — ${result.delegates.you} delegates to ${result.delegates.them}`,
    approval: next.approval,
    approvalChange: -2,
  });

  return { state: next, result };
}

/** The eight blocs and which way they lean. Mirrors STAKEHOLDERS. */
const BLOC_ALIGNMENT = Object.fromEntries(STAKEHOLDERS.map((s) => [s.id, s.lean]));

/**
 * Election night.
 *
 * Four years of the map the player has been watching finally get counted. The
 * debate is a swing applied to every state at once, the war chest is a swing
 * applied only where it was spent, and the result is fifty-one separate calls
 * rather than a threshold — which is why the electoral college and the popular
 * vote can, and sometimes do, disagree.
 */
export function finishCampaign(state, debateScore, spend = {}) {
  const next = structuredClone(state);
  const adj = Math.max(-8, Math.min(8, round1(debateScore * 0.28)));
  next.approval = clamp(round1(next.approval + adj));
  // The debate ripples out to the states.
  for (const code of STATE_CODES) {
    next.stateApproval[code] = clamp(round1(next.stateApproval[code] + adj * 0.5));
  }

  const plan = { ...(next.campaign?.spend || {}), ...spend };
  const result = runPresidential(next, {
    swing: debateScore,
    bonus: difficultyBonus(next),
    spend: plan,
  });
  result.challenger = next.campaign?.opponent || challengerFor(next);

  next.warChest = round1(Math.max(0, (next.warChest ?? 0) - totalSpend(result.spend)));
  next.month = pacing(next).termLength + 1;
  next.phase = "concluded";
  next.over = true;
  next.election = result;

  const debateWord = debateScore > 8 ? "Your commanding debate performance"
    : debateScore > 0 ? "A solid debate showing"
    : debateScore < -8 ? "A disastrous debate"
    : "An uneven debate";

  // The alternative model skips the college: whoever wins more votes wins.
  // Some players simply want the number they have been watching to decide it.
  if (next.scenario.elections === "alternative") {
    const pv = result.popular;
    next.ending = pv.you > 50
      ? { type: "reelected",
          reason: `${debateWord} carried it. You took ${pv.you.toFixed(1)}% of the vote to ` +
            `${result.challenger.name}'s ${pv.them.toFixed(1)}%, and there is no college to argue with.` }
      : pv.you >= 49.4
        ? { type: "narrow",
            reason: `${debateWord} left it inside the margin — ${pv.you.toFixed(1)}% to ` +
              `${pv.them.toFixed(1)}%. Nobody will call it tonight.` }
        : { type: "defeated",
            reason: `${debateWord} could not close the gap. ${result.challenger.name} won the country ` +
              `${pv.them.toFixed(1)}% to ${pv.you.toFixed(1)}%, and the page turns.` };
    next.ending.electoral = result.ev.you;
    next.ending.popular = pv.you;
    if (next.ending.type === "reelected") return beginNextTerm(next, next.ending);
    return next;
  }

  // The debate's contribution is reported as points on the results screen, so
  // the ending itself stays about the country rather than the podium.
  next.ending = describeElection(next, result, "The country voted");
  next.ending.popular = result.popular.you;
  // Winning is not the end of the career — it is the start of the next term.
  if (next.ending.type === "reelected") return beginNextTerm(next, next.ending);
  return next;
}

// ---------------------------------------------------------------------------
// Local simulation fallback (used when no ANTHROPIC_API_KEY is configured).
// Keyword-driven so it still feels responsive to what the player writes.
// ---------------------------------------------------------------------------

const KEYWORDS = [
  { re: /\btax(es|ing)?\b|revenue/i, effA: -2, eco: { gdpGrowth: -0.1, debt: -0.3 }, stake: { wall_street: -6, big_business: -7, labor: 3 } },
  { re: /\btax cut|cut taxes|lower taxes\b/i, effA: 3, eco: { gdpGrowth: 0.3, debt: 0.5 }, stake: { wall_street: 8, big_business: 9, labor: -2 } },
  { re: /\bwar|invade|military strike|troops|deploy\b/i, effA: -3, eco: { debt: 0.6 }, stake: { pentagon: 10, faith: -3, civil_rights: -4 } },
  { re: /\bhealthcare|medicare|medicaid|insur/i, effA: 4, eco: { debt: 0.4 }, stake: { labor: 6, big_business: -4 } },
  { re: /\bgun|firearm|second amendment|assault weapon/i, effA: -1, stake: { gun_owners: -14, civil_rights: 6 } },
  { re: /\bimmigrat|border|deport|asylum/i, effA: -1, stake: { faith: 3, civil_rights: -6, big_business: 4 } },
  { re: /\bclimate|carbon|emissions|green|renewable/i, effA: 1, eco: { gdpGrowth: -0.1 }, stake: { greens: 12, wall_street: -4 } },
  { re: /\boil|drill|pipeline|fossil|coal\b/i, effA: 1, eco: { gdpGrowth: 0.2, inflation: -0.3 }, stake: { greens: -12, big_business: 6 } },
  { re: /\bjobs|infrastructure|manufactur|wages/i, effA: 4, eco: { gdpGrowth: 0.3, unemployment: -0.3, debt: 0.4 }, stake: { labor: 8 } },
  { re: /\bpolice|crime|law and order|law enforcement/i, effA: 2, stake: { civil_rights: -6, faith: 4 } },
  { re: /\babortion|reproductive|roe\b/i, effA: -1, stake: { faith: -8, civil_rights: 6 } },
  { re: /\bstimulus|spending|relief|bailout/i, effA: 3, eco: { gdpGrowth: 0.3, inflation: 0.4, debt: 0.9 } },
  { re: /\baustere|cut spending|deficit|balance the budget/i, effA: -3, eco: { gdpGrowth: -0.2, debt: -0.8 }, stake: { wall_street: 6, labor: -6 } },
];

const OUTLETS = [
  { outlet: "The National Ledger", lean: "left" },
  { outlet: "Centerline Wire", lean: "center" },
  { outlet: "The Standard Bearer", lean: "right" },
];

const EVENTS = [
  { title: "Refinery Explosion Spikes Gas Prices", brief: "A fire at a major Gulf Coast refinery has knocked out 8% of national fuel capacity. Prices at the pump are climbing by the hour and truckers are threatening a slowdown." },
  { title: "Supreme Court Vacancy", brief: "A sitting justice has announced sudden retirement, handing you a generational chance to reshape the Court — and a confirmation fight that will consume the capital." },
  { title: "Ally Requests Emergency Arms", brief: "A treaty ally on the far side of the world is under pressure from a hostile neighbor and is asking for weapons, intelligence, and a public show of support." },
  { title: "Data Breach Hits 90 Million Americans", brief: "A foreign-linked hack has exposed the financial records of nearly a third of the country. Congress and the public want to know what you'll do about it." },
  { title: "Historic Drought Threatens Harvest", brief: "The worst drought in fifty years is scorching the farm belt. Crop forecasts are collapsing and rural communities are demanding federal relief." },
  { title: "Wave of Factory Closures", brief: "Three major manufacturers announced plant closures this week, citing costs. Twenty thousand jobs are on the line in swing-state towns." },
];

export function mockTurn(state, policy, publicMessage, event) {
  const text = `${policy} ${publicMessage || ""}`;
  const seed = hashString(text + state.month);
  const rng = mulberry32(seed);

  let approvalChange = (rng() - 0.5) * 6; // zero-mean noise
  const economy = { gdpGrowth: 0, unemployment: 0, inflation: 0, debt: 0 };
  const stakeDelta = {};

  const matched = [];
  for (const k of KEYWORDS) {
    if (k.re.test(text)) {
      matched.push(k);
      approvalChange += k.effA;
      for (const [key, val] of Object.entries(k.eco || {})) economy[key] += val;
      for (const [key, val] of Object.entries(k.stake || {})) stakeDelta[key] = (stakeDelta[key] || 0) + val;
    }
  }

  // Reward effort: a substantive, specific policy plays better than one line.
  const words = policy.trim().split(/\s+/).filter(Boolean).length;
  if (words > 40) approvalChange += 1.5;
  if (words < 8) approvalChange -= 2;
  if (publicMessage && publicMessage.trim().length > 20) approvalChange += 1;

  // Checks & balances: Congress and the courts can blunt or kill your policy.
  const checks = computeChecks(state, `${policy} ${publicMessage || ""}`);
  const mult = checks.effectMultiplier;
  approvalChange = approvalChange * mult + (checks.courtPenalty || 0);
  // Being blocked by your OWN party looks weak; blocked by the opposition is
  // expected and you can credibly blame them.
  if (checks.congress.status === "blocked") {
    const control = partyControl(state);
    const ownParty = control.house === state.scenario.party || control.senate === state.scenario.party;
    if (ownParty) approvalChange -= 1.5;
  }
  for (const key of Object.keys(economy)) economy[key] *= mult;
  for (const key of Object.keys(stakeDelta)) stakeDelta[key] = Math.round(stakeDelta[key] * mult);

  approvalChange = Math.max(-14, Math.min(14, round1(approvalChange)));

  const stakeholders = STAKEHOLDERS.map((s) => {
    const change = Math.round((stakeDelta[s.id] || 0) + (rng() - 0.5) * 4);
    return { name: s.name, change, note: describeStake(change) };
  });

  const press = OUTLETS.map((o) => ({
    outlet: o.outlet,
    lean: o.lean,
    headline: spinHeadline(o.lean, approvalChange, matched, state),
  }));

  // State effects: nudge a handful of swing-relevant states.
  const swingStates = ["PA", "MI", "WI", "GA", "AZ", "NV", "NC", "OH", "FL", "TX"];
  const stateEffects = swingStates
    .sort(() => rng() - 0.5)
    .slice(0, 6)
    .map((code) => ({ code, change: Math.round(approvalChange * 0.5 + (rng() - 0.5) * 5) }));

  const ev = EVENTS[Math.floor(rng() * EVENTS.length)];

  const analysis = buildMockAnalysis(policy, matched, approvalChange, economy);

  const flags = {};
  if (state.stability < 20 && approvalChange < -6) {
    flags.removedFromOffice = rng() < 0.4;
    if (flags.removedFromOffice) flags.reason = "With approval in free-fall and your own party in revolt, the machinery of government has turned against you.";
  }

  return {
    analysis,
    approvalChange,
    economy,
    stakeholders,
    press,
    stateEffects,
    checks: { congress: checks.congress, court: checks.court },
    arcs: mockJudgeArcs(state.arcs || [], text),
    newArc: mockProposeArc(state, event, approvalChange),
    nextEvent: { title: ev.title, brief: ev.brief },
    flags,
  };
}

// In local-sim mode, the crisis you fumbled is the one that lingers.
function mockProposeArc(state, event, approvalChange) {
  if (!event?.title || approvalChange > -1) return null;
  if (activeArcs(state).length >= MAX_ACTIVE_ARCS) return null;
  return {
    title: event.title,
    brief: `${event.brief || "The situation was left unresolved."} Your response landed badly and it is still sitting there.`,
    domain: inferDomain(`${event.title} ${event.brief || ""}`),
    severity: 2,
  };
}

// ---------------------------------------------------------------------------
// Advisor chat fallback (local sim). Role-flavored, lightly reactive.
// ---------------------------------------------------------------------------

const ADVISOR_LINES = {
  vp: [
    "Politically? Watch the map. This helps us in the suburbs but the base back home won't love it — and I have to run on this record too.",
    "I'll back you publicly, of course. But if we spend capital here, we won't have it for the midterms. Is this the hill?",
  ],
  spouse: [
    "Forget the polls for a second — is this the person you want to be remembered as? Do what you can defend to yourself at 2 a.m.",
    "You look exhausted. Whatever you decide, decide it and then actually sleep. The country needs you clear-headed, not frantic.",
  ],
  chief: [
    "Here's the reality: you don't have the votes for the clean version. Give me a week and I can get you 80% of it. Take the win.",
    "We can do this, but it eats the whole month. Everything else on the agenda slips. Say the word and I'll clear the schedule.",
  ],
  state: [
    "Our allies are watching this closely. Move too hard and we spook them; move too soft and our adversaries read it as weakness.",
    "I can get you a coalition on this, but it takes quiet diplomacy, not a podium speech. Let me work the phones first.",
  ],
  defense: [
    "Militarily it's feasible. The risk isn't the operation — it's the second and third move after the other side responds. Plan for those.",
    "I'd advise against tying our hands publicly. Keep options open. Once you say it out loud, you own every consequence.",
  ],
  treasury: [
    "The markets will read this in about four minutes. Expect a dip, then a recovery if the details are credible. The deficit hit is real, though.",
    "I can find the money, but not without borrowing or cutting elsewhere. There's no free version of this. Which pocket do we pick?",
  ],
  ag: [
    "If you do this by executive order, expect a lawsuit within the week. A 6–3 Court is not friendly ground. Legislation is slower but bulletproof.",
    "Constitutionally you're on the edge here. I can defend it, but I can't promise the Court sees it our way. Know the risk before you sign.",
  ],
  press: [
    "The headline writes itself either way — the question is who writes it first. Give me the message and I'll get ahead of it tonight.",
    "Optics are mixed. It plays great on one network, terribly on another. If we frame it around families, not policy, we win the morning.",
  ],
};

export function mockAdvisor(state, event, advisor, userMessage) {
  const rng = mulberry32(hashString((userMessage || "") + advisor.id + state.month));
  const lines = ADVISOR_LINES[advisor.id] || ["Let me look into it and get back to you, Mr./Madam President."];
  let line = lines[Math.floor(rng() * lines.length)];
  // A disloyal advisor is blunter; a loyal one softens the edges.
  if (advisor.loyalty < 55) line += " I'll say what others won't: think hard about whether this is worth it.";
  else if (advisor.loyalty > 80) line = "You know I'm with you. " + line;
  return line;
}

function describeStake(change) {
  if (change >= 6) return "strongly encouraged";
  if (change >= 2) return "warms to you";
  if (change <= -6) return "openly hostile";
  if (change <= -2) return "grumbling";
  return "unmoved";
}

function spinHeadline(lean, approvalChange, matched, state) {
  const topic = matched[0];
  const good = approvalChange > 1;
  const bank = {
    left: good
      ? ["A Bold Step Forward, and About Time", "The President Finally Delivers for Working Families"]
      : ["Half-Measures Won't Cut It, Critics Say", "A Cautious Move That Leaves the Base Cold"],
    center: good
      ? ["President's Gamble Appears to Pay Off — For Now", "A Pragmatic Play in a Divided Capital"]
      : ["Mixed Reaction Greets the President's Latest Move", "Analysts Split as White House Charts New Course"],
    right: good
      ? ["Even the Skeptics Admit: A Win for the President", "Common Sense Prevails at the White House"]
      : ["Overreach, Again: The President Tests the Nation's Patience", "Another Costly Experiment from an Embattled White House"],
  };
  const list = bank[lean];
  return list[Math.abs(hashString(topic ? topic.re.source : "" + approvalChange)) % list.length];
}

const QUOTES = {
  approve: [
    "Honestly? This is the first thing out of Washington that's made sense to me in a while.",
    "Finally, someone up there is actually looking out for people like us.",
    "I didn't vote for them, but credit where it's due — that was the right call.",
    "This is what leadership looks like. My family will feel the difference.",
  ],
  disapprove: [
    "They don't live in my world. This does nothing for people like me.",
    "More of the same. I'll believe it when I see it help my paycheck.",
    "This is exactly why nobody trusts these people anymore.",
    "Wrong priorities, plain and simple. They've lost the plot.",
  ],
  mixed: [
    "I'll wait and see. Talk is cheap — show me it actually works.",
    "Some good, some bad. Ask me again in six months.",
    "Better than doing nothing, I guess. Not what I'd have picked, though.",
    "It's complicated. Part of me likes it, part of me is nervous.",
  ],
};
// Local-sim voices. The engine has already decided each speaker's mood, so the
// offline fallback only has to supply words that fit it.
export function mockVoices(speakers, policy) {
  return (speakers || []).map((s, i) => {
    const rng = mulberry32(hashString(s.id + policy + i));
    const list = QUOTES[s.mood] || QUOTES.mixed;
    return { id: s.id, quote: list[Math.floor(rng() * list.length) % list.length] };
  });
}

function buildMockAnalysis(policy, matched, approvalChange, economy) {
  const topics = matched.length ? matched.map((m) => m.re.source.split("|")[0].replace(/\\b|\(.*/g, "")).slice(0, 3).join(", ") : "the broad thrust of your directive";
  const dir = approvalChange > 1 ? "landed well with the public" : approvalChange < -1 ? "provoked a sharp backlash" : "met a muted, wait-and-see response";
  const ecoNote = economy.debt > 0.5 ? " The Treasury flags a meaningful hit to the deficit." :
    economy.gdpGrowth > 0.2 ? " Early economic indicators tick upward." : "";
  return `Federal agencies have begun implementing your directive. Initial reaction touched on ${topics} and, on balance, ${dir}.${ecoNote} Field offices report the policy is workable, though full rollout will take months and the courts may yet weigh in.`;
}

// The opening event of a fresh game (mock; Claude generates a richer one live).
export function openingEvent() {
  return {
    title: "The First Crisis Lands",
    brief:
      "You are ten days into the job. Overnight, a mid-size regional bank failed, and this morning two more are teetering as depositors line up at the doors. Markets are jittery, cable news is in a frenzy, and your first real test as president has arrived before you've even finished hiring your staff. The country is watching to see what kind of leader you are.",
  };
}
