import { seeded, hashString, clamp, round1 } from "./rng.js";
import { STATES, STATE_CODES } from "./states.js";
import { billById } from "./bills.js";
import { partyStanding } from "../public/js/data/party.js";
import { benchFor } from "./governors.js";

/**
 * The primary — the election a president can lose without ever facing the
 * other party.
 *
 * Everything else in this game measures how the *country* feels. This measures
 * how your own side feels, which is a different question and often the one that
 * ends a presidency first. Three things decide it: whether the coalition that
 * elected you is still warm, whether you look like a winner, and whether the
 * bills you actually signed match the politics you ran on.
 *
 * That last one is why `billLog` exists. Every signature is a record of who you
 * governed as, and at month 40 your own party reads it back to you.
 */

/** Eight months before the general — the nomination is settled first. */
export const PRIMARY_MONTH = 40;

// Where each party's base actually sits. Mirrors PARTY_ANCHOR in government.js.
const BASE_AXIS = { Democrat: -0.35, Republican: 0.45 };

const partySign = (party) => (party === "Republican" ? 1 : party === "Democrat" ? -1 : 0);

const presidentAxis = (state) => {
  const axis = Number(state?.scenario?.ideologyAxis);
  if (Number.isFinite(axis)) return Math.max(-1, Math.min(1, axis));
  return partySign(state?.scenario?.party) * 0.45;
};

/**
 * Re-exported so every caller reaches the same number. The implementation is
 * under public/ because the dashboard needs it too — see data/party.js.
 */
export { partyStanding };

/**
 * How far the record sits from the platform, roughly 0–2.
 *
 * Signing the other side's bills is drift. So is vetoing your own side's — a
 * base does not distinguish between a president who governed against them and
 * one who simply refused to govern for them.
 */
export function governingDrift(state) {
  const log = state.billLog || [];
  if (!log.length) return 0;
  const axis = presidentAxis(state);

  let total = 0, counted = 0;
  for (const entry of log) {
    const bill = billById(entry.id);
    if (!bill) continue;
    const distance = Math.abs(bill.axis - axis);
    if (entry.outcome === "signed" || entry.outcome === "overridden") {
      // An override is not the president's choice, so it reads as half a sin.
      total += distance * (entry.outcome === "overridden" ? 0.5 : 1);
      counted += 1;
    } else if (entry.outcome === "vetoed" && distance < 0.4) {
      total += 0.9;
      counted += 1;
    }
  }
  return counted ? round1(total / counted) : 0;
}

// --- Whether a challenge happens at all -------------------------------------

const DRIFT_BITE = 0.55;   // above this the base considers you a stranger

/**
 * How much grievance it takes before somebody actually files.
 *
 * Deliberately low enough that there is a band of *mild* challenges a president
 * can ride out on their record alone — a party that is grumbling is not a party
 * that has decided. Above it the record stops being enough.
 */
const CHALLENGE_THRESHOLD = 12;

/**
 * How exposed the president is to a challenge, and why.
 *
 * A president is renominated by default — parties do not turn on incumbents
 * lightly, and a challenge is an admission the party expects to lose. It takes
 * a genuine failure: an abandoned coalition, a collapsed presidency, or a
 * record the base does not recognise.
 */
export function primaryThreat(state) {
  const reasons = [];
  const party = state.scenario?.party;

  // No party, no primary. A president who cannot run again is not worth the
  // fight — the nomination is open anyway and the field will form without them.
  if (!partySign(party) || state.congressDissolved) {
    return { serious: false, score: 0, reasons: [], standing: partyStanding(state), drift: 0 };
  }
  if ((state.term || 1) >= 2 && !state.specialActions?.termLimitGone) {
    return { serious: false, score: 0, reasons: [], standing: partyStanding(state), drift: 0 };
  }

  const standing = partyStanding(state);
  const drift = governingDrift(state);
  let score = 0;

  if (standing < 50) {
    score += (50 - standing) * 0.9;
    reasons.push(`Your own coalition is at ${standing}. They are not sure you are one of them.`);
  }
  if ((state.approval ?? 50) < 42) {
    score += (42 - state.approval) * 0.8;
    reasons.push(`At ${Math.round(state.approval)}% approval the party thinks you cannot win.`);
  }
  if (drift > DRIFT_BITE) {
    // Weighted so that a genuinely betrayed base is on its own enough to
    // trigger a challenge, even for a president the country still tolerates.
    score += (drift - DRIFT_BITE) * 60;
    reasons.push("The bills you signed are not the ones you promised. The base has read the list.");
  }
  const lost = (state.midterms || []).find((m) => m.term === (state.term || 1));
  if (lost && lost.houseSwing + lost.senateSwing <= -25) {
    score += 12;
    reasons.push("The midterms were a rout, and somebody has to carry the blame for it.");
  }

  return { serious: score >= CHALLENGE_THRESHOLD, score: round1(score), reasons, standing, drift };
}

// --- The challenger ---------------------------------------------------------

const CHALLENGERS = {
  Democrat: {
    base: [
      { name: "Sen. Adaeze Okonjo", pitch: "says you promised a movement and delivered a management consultancy" },
      { name: "Rep. Coretta Boone", pitch: "has the unions, the students and every activist you disappointed" },
    ],
    electability: [
      { name: "Gov. Hollis Prentice", pitch: "argues, gently and constantly, that the party cannot win with you" },
      { name: "Sen. Delia Marchetti", pitch: "is running purely on the polling, and the polling is on their side" },
    ],
  },
  Republican: {
    base: [
      { name: "Sen. Sterling Crenshaw", pitch: "says you went to Washington and Washington won" },
      { name: "Gov. Wanda Fairbanks", pitch: "has the grassroots, the donors you ignored, and a longer memory than you" },
    ],
    electability: [
      { name: "Gov. Bertrand Ashford", pitch: "is telling every donor in the country that you are unelectable" },
      { name: "Sen. Perla Vasquez", pitch: "is running on competence, which is a polite way of describing you" },
    ],
  },
};

/**
 * Who comes for you, and from where.
 *
 * A president who abandoned the base gets somebody from the wing. A president
 * who is simply failing gets a pragmatist arguing the party cannot win with
 * them — a very different opponent, and a harder one to answer, because they
 * are not wrong.
 */
export function primaryChallenger(state) {
  const party = partySign(state.scenario?.party) > 0 ? "Republican" : "Democrat";
  const drift = governingDrift(state);
  const wing = drift > DRIFT_BITE ? "base" : "electability";
  const pool = CHALLENGERS[party][wing];
  const r = seeded(`${state.scenario?.presidentName}|primary|${wing}`);
  const pick = r.pick(pool);
  const anchor = BASE_AXIS[party];

  // Your own party's strongest governor — and which one depends on the
  // grievance. A betrayed base sends whoever stands furthest out on their side;
  // a party that thinks you cannot win sends whoever sits nearest its centre.
  const bench = state.governors ? benchFor(state, party) : [];
  if (bench.length) {
    const ranked = [...bench].sort((a, b) => wing === "base"
      ? Math.abs(b.axis - anchor) - Math.abs(a.axis - anchor)
      : Math.abs(a.axis - anchor) - Math.abs(b.axis - anchor));
    // Only the genuinely ambitious ones actually file against a sitting president.
    const rival = ranked.find((g) => g.ambition >= 55) || ranked[0];
    return {
      name: `Gov. ${rival.name}`,
      party, wing,
      axis: round1(rival.axis),
      state: rival.state,
      stateName: rival.stateName,
      pitch: `${pick.pitch}, and runs the ${rival.stateName} statehouse while doing it`,
      fromStatehouse: true,
    };
  }

  // No statehouse map — fall back to the written pool. The wing candidate
  // stands past the base; the pragmatist stands inside it.
  const axis = wing === "base" ? clamp(anchor * 1.6, -1, 1) : round1(anchor * 0.55);
  return { ...pick, party, wing, axis: round1(axis) };
}

// --- The delegates ----------------------------------------------------------

/**
 * A party's nominating contest is not the country. Delegates concentrate where
 * the party is actually strong, which is why a Democratic primary runs through
 * California and a Republican one runs through Texas.
 */
export function delegateBoard(state) {
  const sign = partySign(state.scenario?.party) || 1;
  const states = STATE_CODES.map((code) => {
    const info = STATES[code];
    // Party strength here, 0–1: high where the state leans the president's way.
    const strength = clamp(50 + sign * (info.lean ?? 0), 5, 95) / 100;
    return {
      code,
      name: info.name,
      strength: round1(strength * 100),
      delegates: Math.max(1, Math.round(info.ev * (0.35 + strength))),
    };
  });
  const total = states.reduce((sum, s) => sum + s.delegates, 0);
  return { states, total, majority: Math.floor(total / 2) + 1 };
}

export const PRIMARY_STRATEGIES = [
  {
    id: "record",
    label: "Run on the record",
    detail: "Stand on what you actually did and dare them to say it was wrong. No concessions, no new promises.",
    cost: "Nothing up front — and nothing to fall back on if the base has already decided.",
  },
  {
    id: "base",
    label: "Run to the base",
    detail: "Give the wing what it wants. Adopt the challenger's platform, publicly, and take the coalition back.",
    cost: "It moves where you stand for good. You become a more polarising candidate — stronger where your side already lives, weaker everywhere else — and every bloc outside your coalition cools on you.",
  },
  {
    id: "deal",
    label: "Cut a deal",
    detail: "Offer the challenger the ticket. They withdraw, endorse you, and the party closes ranks by the weekend.",
    cost: "They become your Vice President — a rival with their own base, who owes you nothing.",
  },
];

const strategyById = (id) => PRIMARY_STRATEGIES.find((s) => s.id === id) || PRIMARY_STRATEGIES[0];

/** The share an unchallenged-on-the-merits incumbent starts from. */
const INCUMBENCY = 58;

/**
 * What each choice is worth in delegates.
 *
 * The two that cost something are deliberately situational rather than flat,
 * so neither is simply the better button. Tacking to the base is the *answer
 * to having drifted* — it mostly forgives the record, and does very little for
 * a president whose record was fine and whose problem is that they are losing.
 * Cutting a deal brings the challenger's voters across whatever the grievance
 * was, so it is the one that saves a president nobody believes in any more.
 * Running on the record buys nothing at all, which is the point of it.
 */
const STRATEGY_EDGE = { record: 0, base: 8, deal: 12 };

/** How much of the drift penalty each strategy forgives. */
const DRIFT_RELIEF = { record: 1, base: 0.35, deal: 1 };

/**
 * The contest itself.
 *
 * A national share built from the three things the party is actually weighing,
 * then applied state by state — because a primary electorate in a state where
 * the party is strong behaves differently from one where it is an afterthought.
 */
export function runPrimary(state, strategyId = "record") {
  const strategy = strategyById(strategyId);
  const challenger = primaryChallenger(state);
  const board = delegateBoard(state);
  const standing = partyStanding(state);
  const drift = governingDrift(state);

  const party = partySign(state.scenario?.party) > 0 ? "Republican" : "Democrat";
  const anchor = BASE_AXIS[party];
  // Who is standing closer to where the party actually lives.
  const presDistance = Math.abs(presidentAxis(state) - anchor);
  const challDistance = Math.abs(challenger.axis - anchor);
  const ideologyEdge = (challDistance - presDistance) * 22;

  // Publicly adopting the wing's platform is an apology for the record, so it
  // buys back most of what the record cost — and nothing else.
  const driftPenalty = drift * 14 * (DRIFT_RELIEF[strategy.id] ?? 1);

  // An incumbent starts ahead. They have the machinery, the endorsements and
  // the name, and a party has to genuinely want rid of them to overcome it.
  const national = INCUMBENCY
    + (standing - 55) * 0.45
    + ((state.approval ?? 50) - 45) * 0.35
    + ideologyEdge
    - driftPenalty
    + (STRATEGY_EDGE[strategy.id] || 0);

  let you = 0;
  const results = board.states.map((s) => {
    const local = state.stateApproval?.[s.code] ?? 50;
    // Party voters are warmer than the general public, and the state's own
    // reading of the president still colours it.
    const share = clamp(national + (local - (state.approval ?? 50)) * 0.5, 3, 97);
    const won = Math.round((s.delegates * share) / 100);
    you += won;
    return { ...s, share: round1(share), delegates: s.delegates, yours: won };
  });

  const them = board.total - you;
  return {
    strategy,
    challenger,
    national: round1(national),
    standing,
    drift,
    states: results,
    delegates: { you, them, total: board.total, majority: board.majority },
    won: you >= board.majority,
  };
}
