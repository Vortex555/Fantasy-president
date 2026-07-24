import { STATES, STATE_CODES, TOTAL_EV } from "./states.js";
import { hashString, mulberry32, clamp, round1 } from "./rng.js";
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

export const TERM_LENGTH = 48; // months
export const MIDTERM_MONTH = 24;
export const CAMPAIGN_MONTH = 46; // general-election campaign season begins

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

export function createGame(scenario) {
  const sign = partySign(scenario.party);

  // Seed state-by-state approval from partisan lean relative to the president.
  const stateApproval = {};
  for (const code of STATE_CODES) {
    const lean = STATES[code].lean; // + = Republican
    // A president is more popular where the electorate agrees with them.
    const alignment = sign * lean; // positive when state agrees with president
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
    scenario,
    month: 1,
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
    cabinet: buildCabinet(scenario),
    firstLady: buildFirstLady(scenario),
    institutions: buildInstitutions(scenario),
    specialActions: emptyLedger(),
    foreign: buildForeign(scenario),
    // Ongoing situations that carry across months. See arcs.js.
    arcs: [],
    history: [],
    seenEvents: [],
    over: false,
    ending: null,
  };

  // Optional subsystems, only present when their rule is switched on.
  if (scenario.society) state.society = buildSociety(scenario);
  if (scenario.war && scenario.war !== "off") state.deployments = buildDeployments(scenario);
  if (scenario.covert) state.covert = buildCovert(scenario);

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

export function partyControl(state) {
  const { congress } = state;
  return {
    house: congress.houseR > congress.houseD ? "Republican" : "Democrat",
    senate: congress.senateR > congress.senateD ? "Republican" : "Democrat",
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

  const chamber = (dSeats, rSeats) => {
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
    return { dYes, rYes, yes, no: total - yes, total, threshold: Math.floor(total / 2) + 1, passed: yes >= Math.floor(total / 2) + 1 };
  };

  const house = chamber(c.houseD, c.houseR);
  const senate = chamber(c.senateD, c.senateR);
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

  // --- Supreme Court --- (mainly scrutinizes aggressive executive action)
  if (kind.aggressive || (kind.executive && roll < 22)) {
    const conservativeCourt = state.court.conservative > state.court.liberal;
    // A court is more hostile when the action's ideological thrust opposes it.
    const opposesCourt = (conservativeCourt && sign < 0) || (!conservativeCourt && sign > 0);
    let strike = 42 + (opposesCourt ? 26 : -14) + (kind.aggressive ? 10 : 0);
    strike = Math.max(8, Math.min(88, strike));
    const margin = conservativeCourt
      ? `${state.court.conservative}–${state.court.liberal} conservative majority`
      : `${state.court.liberal}–${state.court.conservative} liberal majority`;
    if (roll < strike) {
      checks.court = { status: "struck_down", note: `The Supreme Court's ${margin} struck it down as executive overreach. A humiliating defeat.` };
      checks.effectMultiplier *= 0.4;
      checks.courtPenalty = -3;
    } else {
      checks.court = { status: "upheld", note: `Challenged all the way to the Supreme Court — but its ${margin} let it stand, at least for now.` };
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

  for (const se of result.stateEffects || []) {
    const code = (se.code || "").toUpperCase();
    if (next.stateApproval[code] != null) {
      stateDeltas[code] = (stateDeltas[code] || 0) + (se.change || 0);
      next.stateApproval[code] = clamp(Math.round(next.stateApproval[code] + (se.change || 0)));
    }
  }
  for (const [code, delta] of Object.entries(arcOutcome.states)) {
    if (next.stateApproval[code] != null) {
      stateDeltas[code] = (stateDeltas[code] || 0) + delta;
      next.stateApproval[code] = clamp(Math.round(next.stateApproval[code] + delta));
    }
  }

  // The focus group. Every one of the thirty reacts, deterministically, from
  // what actually happened to them — no model call is involved in a mood.
  // Only the rotating cast in `speakers` will be given words.
  const scored = scoreAll({
    approvalChange: result.approvalChange || 0,
    stakeholders: stakeDeltas,
    states: stateDeltas,
    presidentSign: partySign(state.scenario.party),
  });
  result.personas = scored;
  result.speakers = selectSpeakers(scored, state.month);
  // General drift of every state toward the new national number (small).
  const drift = (next.approval - state.approval) * 0.35;
  for (const code of STATE_CODES) {
    next.stateApproval[code] = clamp(Math.round(next.stateApproval[code] + drift));
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
  result.amendment = tickSpecialActions(next);
  result.foreignMoves = applyForeign(next, policy, result);
  if (next.society) result.societyMoves = applySociety(next, policy, result);
  if (next.deployments) result.warEvents = tickDeployments(next, policy);
  if (next.covert) result.covertOutcome = tickCovert(next, policy, result.covertAction);

  // Approval may have moved again since it was banked; keep the reported
  // number honest rather than letting the subsystems change it silently.
  result.approvalChange = round1(next.approval - state.approval);

  next.history.push({
    month: state.month,
    policy,
    headline: result.press?.[0]?.headline || result.analysis?.slice(0, 90),
    approval: next.approval,
    approvalChange: result.approvalChange,
  });
  rememberEvent(next, result.usedEvent);

  const clock = pacing(state);

  // Midterm elections reshuffle Congress.
  if (state.month === clock.midterm) {
    applyMidterms(next);
  }

  next.month = state.month + 1;

  // Endings & phases.
  if (result.flags?.removedFromOffice) {
    next.over = true;
    next.ending = { type: "removed", reason: result.flags.reason || "You were forced from office." };
  } else if (next.stability <= 8) {
    next.over = true;
    next.ending = { type: "collapse", reason: "Government stability collapsed. You were removed from power." };
  } else if (next.month >= clock.campaignStart && next.phase !== "campaign") {
    // The re-election campaign begins — the debate decides the term.
    next.phase = "campaign";
    next.campaign = createCampaign(next);
  } else if (next.month > clock.termLength) {
    next.over = true;
    next.ending = evaluateReelection(next);
  }

  return next;
}

function applyMidterms(next) {
  // President's party gains/loses seats based on approval vs. the 50 baseline.
  const sign = partySign(next.scenario.party);
  const swing = Math.round((next.approval - 50) / 4); // seats
  if (sign >= 0) {
    next.congress.houseR = clampSeats(next.congress.houseR + swing, 435);
    next.congress.houseD = 435 - next.congress.houseR;
    next.congress.senateR = clampSeats(next.congress.senateR + Math.round(swing / 6), 100);
    next.congress.senateD = 100 - next.congress.senateR;
  } else {
    next.congress.houseD = clampSeats(next.congress.houseD + swing, 435);
    next.congress.houseR = 435 - next.congress.houseD;
    next.congress.senateD = clampSeats(next.congress.senateD + Math.round(swing / 6), 100);
    next.congress.senateR = 100 - next.congress.senateD;
  }
}
const clampSeats = (v, total) => Math.max(0, Math.min(total, v));

function evaluateReelection(next) {
  const ec = electoralCount(next);
  if (ec.win >= 270) {
    return { type: "reelected", reason: `You won re-election with roughly ${ec.win} electoral votes. A second term begins.` };
  }
  if (next.approval >= 47) {
    return { type: "narrow", reason: "A brutally close election — the result hangs on a handful of states, and the recounts have only just begun." };
  }
  return { type: "defeated", reason: `You lost re-election. The nation voted for change after a first term that ended near ${Math.round(next.approval)}% approval.` };
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

const OPPONENTS = {
  Republican: [
    { name: "Gov. Caroline Hastings", party: "Republican", style: "a polished, disciplined governor", attack: "reckless spending and a weak hand abroad" },
    { name: "Sen. Roy Callahan", party: "Republican", style: "a folksy, combative senator", attack: "out-of-touch elitism and a bad economy" },
  ],
  Democrat: [
    { name: "Gov. Marisol Reyes", party: "Democrat", style: "an energetic, progressive governor", attack: "cruelty to working families and cuts to the safety net" },
    { name: "Sen. Daniel Okonkwo", party: "Democrat", style: "a cerebral, principled senator", attack: "corruption, division, and broken promises" },
  ],
  Independent: [
    { name: "Gov. Marisol Reyes", party: "Democrat", style: "an energetic Democratic governor", attack: "a chaotic, rudderless presidency" },
    { name: "Sen. Roy Callahan", party: "Republican", style: "a combative Republican senator", attack: "a chaotic, rudderless presidency" },
  ],
};

const DEBATE_TOPICS = [
  { topic: "The economy & cost of living", q: "Prices are still high and families are hurting. In one answer: why do you deserve four more years to run this economy?" },
  { topic: "Your record & broken promises", q: "You made big promises four years ago. Look into the camera and tell voters what you actually delivered — and where you fell short." },
  { topic: "The future & national security", q: "The world is more dangerous than when you took office. What is your closing argument for why you, not your opponent, should be trusted with it?" },
];

export function createCampaign(state) {
  const rng = mulberry32(hashString(state.scenario.presidentName + "campaign"));
  // The challenger comes from the opposing party.
  const oppKey = state.scenario.party === "Democrat" ? "Republican"
    : state.scenario.party === "Republican" ? "Democrat" : "Independent";
  const pool = OPPONENTS[oppKey] || OPPONENTS.Independent;
  const opponent = pool[Math.floor(rng() * pool.length)];
  return {
    opponent,
    topics: DEBATE_TOPICS,
    round: 1,
    scores: [],
    warChest: Math.round(180 + rng() * 220), // $M, flavor
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

export function finishCampaign(state, debateScore) {
  const next = structuredClone(state);
  const adj = Math.max(-8, Math.min(8, round1(debateScore * 0.28)));
  next.approval = clamp(round1(next.approval + adj));
  // The debate ripples out to the states.
  for (const code of STATE_CODES) {
    next.stateApproval[code] = clamp(Math.round(next.stateApproval[code] + adj * 0.5));
  }
  const ec = electoralCount(next);
  next.month = pacing(next).termLength + 1;
  next.phase = "concluded";
  next.over = true;

  const debateWord = debateScore > 8 ? "Your commanding debate performance" :
    debateScore > 0 ? "A solid debate showing" :
    debateScore < -8 ? "A disastrous debate" : "An uneven debate";

  const { winApproval } = difficultyOf(next.scenario.difficulty);

  // The alternative model skips the map: a national popular verdict, nothing
  // else. Some players simply want the number they have been watching to be
  // the number that decides it.
  if (next.scenario.elections === "alternative") {
    next.ending = next.approval >= 50
      ? { type: "reelected", reason: `${debateWord} carried it. You finished on ${Math.round(next.approval)}% and the country returned you for a second term.` }
      : next.approval >= winApproval
        ? { type: "narrow", reason: `${debateWord} left it inside the margin. At ${Math.round(next.approval)}% the result is contested and nobody will call it tonight.` }
        : { type: "defeated", reason: `${debateWord} could not close a ${Math.round(50 - next.approval)}-point gap. ${next.campaign.opponent.name} won, and the country turns the page.` };
    next.ending.electoral = ec.win;
    return next;
  }

  if (ec.win >= 270 && next.approval >= winApproval) {
    next.ending = { type: "reelected", reason: `${debateWord} sealed it. You won re-election with roughly ${ec.win} electoral votes — a second term begins.` };
  } else if (next.approval >= winApproval + 1) {
    next.ending = { type: "narrow", reason: `${debateWord} kept it agonizingly close. The networks won't call it — it comes down to recounts in three states.` };
  } else {
    next.ending = { type: "defeated", reason: `${debateWord} wasn't enough. ${next.campaign.opponent.name} defeated you, and the country turns the page after a single term.` };
  }
  next.ending.electoral = ec.win;
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
