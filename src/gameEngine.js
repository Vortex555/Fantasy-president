import { STATES, STATE_CODES, TOTAL_EV } from "./states.js";

export const TERM_LENGTH = 48; // months
export const MIDTERM_MONTH = 24;

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

const clamp = (v, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const round1 = (v) => Math.round(v * 10) / 10;

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

  // Seed stakeholder support from ideological alignment with the president.
  const stakeholders = {};
  for (const s of STAKEHOLDERS) {
    const alignment = sign * s.lean; // positive when stakeholder agrees with president
    stakeholders[s.id] = clamp(Math.round(50 + alignment * 18));
  }

  // Congress: opposition tends to hold at least one chamber. Seed by party.
  const congress = seedCongress(sign);

  return {
    scenario,
    month: 1,
    approval: scenario.startApproval,
    stability: 72,
    economy: {
      gdpGrowth: 2.4,
      unemployment: 4.1,
      inflation: 3.0,
      debt: 34.2, // trillions
    },
    stakeholders,
    stateApproval,
    congress,
    history: [],
    over: false,
    ending: null,
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

// Fold a TurnResult (from Claude or the mock engine) into a new game state.
export function applyResult(state, policy, result) {
  const next = structuredClone(state);

  next.approval = clamp(round1(next.approval + (result.approvalChange || 0)));

  const eco = result.economy || {};
  next.economy.gdpGrowth = clamp(round1(next.economy.gdpGrowth + (eco.gdpGrowth || 0)), -7, 7);
  next.economy.unemployment = clamp(round1(next.economy.unemployment + (eco.unemployment || 0)), 1.5, 25);
  next.economy.inflation = clamp(round1(next.economy.inflation + (eco.inflation || 0)), -3, 40);
  next.economy.debt = round1(next.economy.debt + (eco.debt || 0));

  for (const s of result.stakeholders || []) {
    const id = resolveStakeholder(s.name);
    if (id && next.stakeholders[id] != null) {
      next.stakeholders[id] = clamp(Math.round(next.stakeholders[id] + (s.change || 0)));
    }
  }

  for (const se of result.stateEffects || []) {
    const code = (se.code || "").toUpperCase();
    if (next.stateApproval[code] != null) {
      next.stateApproval[code] = clamp(Math.round(next.stateApproval[code] + (se.change || 0)));
    }
  }
  // General drift of every state toward the new national number (small).
  const drift = (next.approval - state.approval) * 0.35;
  for (const code of STATE_CODES) {
    next.stateApproval[code] = clamp(Math.round(next.stateApproval[code] + drift));
  }

  // Stability reflects approval, stakeholder average and economic pain.
  const stakeAvg = Object.values(next.stakeholders).reduce((a, b) => a + b, 0) / STAKEHOLDERS.length;
  const miseryIndex = next.economy.unemployment + next.economy.inflation;
  next.stability = clamp(Math.round(0.5 * next.approval + 0.35 * stakeAvg + 0.15 * (100 - miseryIndex * 2)));

  next.history.push({
    month: state.month,
    policy,
    headline: result.press?.[0]?.headline || result.analysis?.slice(0, 90),
    approval: next.approval,
    approvalChange: round1(next.approval - state.approval),
  });

  // Midterm elections reshuffle Congress.
  if (state.month === MIDTERM_MONTH) {
    applyMidterms(next);
  }

  next.month = state.month + 1;

  // Endings.
  if (result.flags?.removedFromOffice) {
    next.over = true;
    next.ending = { type: "removed", reason: result.flags.reason || "You were forced from office." };
  } else if (next.stability <= 8) {
    next.over = true;
    next.ending = { type: "collapse", reason: "Government stability collapsed. You were removed from power." };
  } else if (next.month > TERM_LENGTH) {
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

const PERSONA_POOL = [
  { name: "Dolores M.", group: "Retired teacher, Ohio" },
  { name: "Marcus T.", group: "Rideshare driver, Georgia" },
  { name: "Priya K.", group: "Software engineer, Washington" },
  { name: "Wade H.", group: "Cattle rancher, Texas" },
  { name: "Angela R.", group: "ER nurse, Pennsylvania" },
  { name: "Diego S.", group: "Small-business owner, Arizona" },
];

const EVENTS = [
  { title: "Refinery Explosion Spikes Gas Prices", brief: "A fire at a major Gulf Coast refinery has knocked out 8% of national fuel capacity. Prices at the pump are climbing by the hour and truckers are threatening a slowdown." },
  { title: "Supreme Court Vacancy", brief: "A sitting justice has announced sudden retirement, handing you a generational chance to reshape the Court — and a confirmation fight that will consume the capital." },
  { title: "Ally Requests Emergency Arms", brief: "A treaty ally on the far side of the world is under pressure from a hostile neighbor and is asking for weapons, intelligence, and a public show of support." },
  { title: "Data Breach Hits 90 Million Americans", brief: "A foreign-linked hack has exposed the financial records of nearly a third of the country. Congress and the public want to know what you'll do about it." },
  { title: "Historic Drought Threatens Harvest", brief: "The worst drought in fifty years is scorching the farm belt. Crop forecasts are collapsing and rural communities are demanding federal relief." },
  { title: "Wave of Factory Closures", brief: "Three major manufacturers announced plant closures this week, citing costs. Twenty thousand jobs are on the line in swing-state towns." },
];

function hashString(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function mockTurn(state, policy, publicMessage) {
  const text = `${policy} ${publicMessage || ""}`;
  const seed = hashString(text + state.month);
  const rng = mulberry32(seed);

  let approvalChange = (rng() - 0.45) * 6;
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

  const personaCount = 4;
  const shuffled = [...PERSONA_POOL].sort(() => rng() - 0.5).slice(0, personaCount);
  const personas = shuffled.map((p) => {
    const mood = approvalChange + (rng() - 0.5) * 8;
    return {
      name: p.name,
      group: p.group,
      mood: mood > 2 ? "approve" : mood < -2 ? "disapprove" : "mixed",
      quote: personaQuote(mood, rng()),
    };
  });

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
    personas,
    stateEffects,
    nextEvent: { title: ev.title, brief: ev.brief },
    flags,
  };
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
function personaQuote(mood, r) {
  const bucket = mood > 2 ? "approve" : mood < -2 ? "disapprove" : "mixed";
  const list = QUOTES[bucket];
  return list[Math.floor(r * list.length) % list.length];
}

function buildMockAnalysis(policy, matched, approvalChange, economy) {
  const topics = matched.length ? matched.map((m) => m.re.source.split("|")[0].replace(/\\b|\(.*/g, "")).slice(0, 3).join(", ") : "the broad thrust of your directive";
  const dir = approvalChange > 1 ? "landed well with the public" : approvalChange < -1 ? "provoked a sharp backlash" : "met a muted, wait-and-see response";
  const ecoNote = economy.debt > 0.5 ? " The Treasury flags a meaningful hit to the deficit." :
    economy.gdpGrowth > 0.2 ? " Early economic indicators tick upward." : "";
  return `Federal agencies have begun implementing your directive. Initial reaction touched on ${topics} and, on balance, ${dir}.${ecoNote} Field offices report the policy is workable, though full rollout will take months and the courts may yet weigh in.`;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The opening event of a fresh game (mock; Claude generates a richer one live).
export function openingEvent() {
  return {
    title: "The First Crisis Lands",
    brief:
      "You are ten days into the job. Overnight, a mid-size regional bank failed, and this morning two more are teetering as depositors line up at the doors. Markets are jittery, cable news is in a frenzy, and your first real test as president has arrived before you've even finished hiring your staff. The country is watching to see what kind of leader you are.",
  };
}
