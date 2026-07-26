import { seeded, hashString, clamp, round1 } from "./rng.js";
import { STATES, STATE_CODES } from "./states.js";
import { apportion } from "../public/js/data/government.js";
import { benchFor } from "./governors.js";

/**
 * Elections.
 *
 * Both of them run through here, because they are the same arithmetic asked two
 * different questions. A midterm asks every district and a third of the Senate
 * "given how this presidency is going, who wins here?"; a general asks all fifty
 * states and the District the same thing about the president personally. The
 * inputs are the map the player has been watching all term, the economy, the
 * problems they never closed out, and whatever money they raised.
 *
 * The design rule throughout: the national environment is the only thing that
 * moves, and it moves every race at once. A seat is decided by where it sits
 * relative to the country, not by a die roll — so a player who can read the map
 * can read the night, and a bad month in October really does cost seats in
 * places they have never thought about.
 */

// --- Tuning ----------------------------------------------------------------

/** Approval points → points of national environment. */
const APPROVAL_WEIGHT = 0.55;

/** Where the misery index sits when nothing is wrong. See createGame. */
const MISERY_BASELINE = 7.1;
const MISERY_WEIGHT = 0.55;

/** Unfinished business is a drag on the party that owns the government. */
const ARC_DRAG_THRESHOLD = 3;
const ARC_DRAG = 0.4;
const SCAR_DRAG = 0.5;

/**
 * The thermostat. The president's party loses ground at a midterm more or less
 * regardless of merit, which is what makes month 24 a defence rather than an
 * opportunity: you are running to lose less, not to win.
 */
const MIDTERM_PENALTY = 4.5;

/**
 * How far a state's districts fan out around its statewide lean, and how they
 * are distributed across that range.
 *
 * The exponent is the load-bearing part. A linear fan puts far too many seats
 * near the middle, and a chamber of marginal seats swings by a hundred on a bad
 * night — twice the worst midterm in American history. Districts are drawn to
 * be safe, so the distribution is pushed toward its ends and only a thin band
 * is genuinely in play. Calibrated so a president at 50% loses about sixteen
 * seats, one at 40% loses about thirty, and a catastrophe bottoms out near
 * fifty — the real historical range.
 */
const DISTRICT_SPREAD = 46;
const DISTRICT_EXPONENT = 0.5;
const DISTRICT_JITTER = 3;

/**
 * How much a state can deviate from what its polling says, for reasons no
 * national model captures — a candidate, a scandal, a ballot measure that
 * brought the wrong people out. Seeded per career, so a replay sees the same
 * night, but enough to stop two states with identical approval always breaking
 * together.
 */
const STATE_IDIOSYNCRASY = 2.5;

/** Approval points → points of presidential margin in a state. */
const MARGIN_PER_POINT = 1.6;

/**
 * How much of the debate's aggregate score reaches the margin directly.
 *
 * Deliberately modest, because the debate is already paid once: `finishCampaign`
 * moves national and state approval before the count, and that flows into the
 * margin through the map. This is the second, election-day-only half. Together
 * a commanding debate is worth roughly four points of margin — decisive at the
 * tipping point, and still less than four years of governing.
 */
const DEBATE_WEIGHT = 0.25;

/** Inside this margin the networks will not call a state. */
const TOO_CLOSE = 4;

/**
 * An independent president has no caucus, so a referendum on them only
 * partially transfers to the party they are counted with downballot.
 */
const INDEPENDENT_TRANSFER = 0.5;

/** What a career starts with in the bank, in $M. */
export const WAR_CHEST_START = 40;

/** Dollars buy points of margin, and the curve flattens fast. */
const SPEND_K = 1.1;
const SPEND_CAP = 8;

const HOUSE_SEATS = 435;
const SENATE_SEATS = 100;

// --- Party bookkeeping -----------------------------------------------------

const partySign = (party) => (party === "Republican" ? 1 : party === "Democrat" ? -1 : 0);

/**
 * Which caucus the president's seats are counted in. An independent has no
 * party, but `congress` still only has two columns, so they are bookkept on the
 * Republican side exactly as `seatsFromComposition` does it.
 */
export function alignedParty(state) {
  return partySign(state.scenario?.party) >= 0 ? "Republican" : "Democrat";
}

const alignedSign = (state) => (alignedParty(state) === "Republican" ? 1 : -1);

const otherParty = (party) => (party === "Republican" ? "Democrat" : "Republican");

// --- The national environment ----------------------------------------------

/**
 * Everything about the country's mood that is *not* already in the state map:
 * the economy and the problems left open. Approval is deliberately excluded
 * because `stateApproval` already carries it, and counting it twice would make
 * a bad month land twice in the same election.
 */
export function fundamentals(state) {
  const eco = state.economy || {};
  const misery = (eco.unemployment ?? 4.1) + (eco.inflation ?? 3.0);
  let out = -(misery - MISERY_BASELINE) * MISERY_WEIGHT;

  for (const arc of state.arcs || []) {
    if (arc.status === "scarred") out -= SCAR_DRAG;
    else if (arc.status === "active" && arc.severity >= ARC_DRAG_THRESHOLD) out -= ARC_DRAG * arc.severity;
    else if (arc.status === "detonated") out -= ARC_DRAG * (arc.severity || 5);
  }
  return round1(out);
}

/**
 * The swing, in points, toward the president's party across every race in the
 * country. Positive is good for them.
 */
export function nationalEnvironment(state, { midterm = false } = {}) {
  const approval = ((state.approval ?? 50) - 50) * APPROVAL_WEIGHT;
  const penalty = midterm ? MIDTERM_PENALTY : 0;
  return round1(approval + fundamentals(state) - penalty);
}

// --- Money -----------------------------------------------------------------

/**
 * What a month of fundraising brings in, in $M. Popularity raises money and so
 * does a warm coalition — the eight blocs are donors before they are voters.
 */
export function fundraise(state) {
  const blocs = Object.values(state.stakeholders || {});
  const stakeAvg = blocs.length ? blocs.reduce((a, b) => a + b, 0) / blocs.length : 50;
  const raised = 6 + ((state.approval ?? 50) - 45) * 0.35 + (stakeAvg - 50) * 0.18;
  return round1(Math.max(0, raised));
}

/**
 * Points of margin bought by `dollars` ($M) in a state of `ev` electoral votes.
 *
 * Square-root returns, divided by the size of the state: the tenth million in
 * Nevada is worth far more than the tenth million in California, which is the
 * whole reason a campaign has to choose.
 */
export function spendEffect(dollars, ev) {
  const money = Number(dollars) || 0;
  if (money <= 0) return 0;
  const size = Math.max(3, Number(ev) || 3);
  return Math.min(SPEND_CAP, round1((SPEND_K * Math.sqrt(money)) / Math.sqrt(size)));
}

/** Total committed, so no campaign can spend money it does not have. */
export function totalSpend(spend) {
  return Object.values(spend || {}).reduce((sum, v) => sum + (Number(v) || 0), 0);
}

/**
 * Trim a spending plan to what is actually in the bank, largest commitments
 * first, so an over-ambitious map degrades instead of being rejected.
 */
export function affordableSpend(spend, warChest) {
  const budget = Math.max(0, Number(warChest) || 0);
  const entries = Object.entries(spend || {})
    .map(([code, v]) => [code, Math.max(0, Number(v) || 0)])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  const out = {};
  let left = budget;
  for (const [code, want] of entries) {
    if (left <= 0) break;
    const given = Math.min(want, left);
    out[code] = round1(given);
    left -= given;
  }
  return out;
}

const spendIn = (spend, code) => spendEffect(spend?.[code], STATES[code]?.ev ?? 3);

// --- The races -------------------------------------------------------------

/**
 * All 435 districts, each with a partisan lean of its own.
 *
 * Apportionment is real — a state's delegation is its electoral votes minus its
 * two senators — and districts inside a state are fanned out around the state's
 * lean so that a large delegation contains safe seats at both ends and a fight
 * in the middle.
 */
export function houseRaces(state) {
  const seats = apportion("house", STATES);
  const byState = new Map();
  for (const seat of seats) {
    if (!byState.has(seat.state)) byState.set(seat.state, []);
    byState.get(seat.state).push(seat);
  }

  const races = [];
  for (const [code, list] of byState) {
    const base = STATES[code]?.lean ?? 0;
    const n = list.length;
    list.forEach((seat, i) => {
      // A one-district state is its own lean; anything larger fans out toward
      // its ends, leaving only a thin band of seats actually in play.
      const t = n === 1 ? 0 : (2 * i) / (n - 1) - 1;
      const offset = DISTRICT_SPREAD * Math.sign(t) * Math.abs(t) ** DISTRICT_EXPONENT;
      const jitter = ((hashString(`${seat.seat}|district`) % 200) / 100 - 1) * DISTRICT_JITTER;
      races.push({
        chamber: "house",
        state: code,
        seat: seat.seat,
        lean: round1(base + offset + jitter),
      });
    });
  }
  return races;
}

/** Which class of the Senate is on the ballot this term. */
export function senateCycle(state) {
  return (((state?.term || 1) - 1) % 3) + 1;
}

const senateStates = () => STATE_CODES.filter((code) => code !== "DC");

/**
 * The seats up this cycle. Every state has two senators in different classes,
 * so a state is never wholly on the ballot at once — which is exactly why the
 * Senate moves slower than the House and a wave takes two cycles to finish.
 */
export function senateRaces(state, cycle = senateCycle(state)) {
  const races = [];
  senateStates().forEach((code, index) => {
    const classes = [(index % 3) + 1, ((index + 1) % 3) + 1];
    classes.forEach((klass, seatIndex) => {
      if (klass !== cycle) return;
      races.push({
        chamber: "senate",
        state: code,
        seat: `${code}-${seatIndex === 0 ? "I" : "II"}`,
        lean: STATES[code]?.lean ?? 0,
        class: klass,
      });
    });
  });
  return races;
}

/**
 * Who wins a race, given the environment and whatever was spent there.
 * `lean` is positive-Republican; the margin returned is for `party`.
 */
function raceMargin(race, party, env, spend) {
  const sign = party === "Republican" ? 1 : -1;
  return round1(sign * race.lean + env + spendIn(spend, race.state));
}

// --- Midterms --------------------------------------------------------------

/**
 * The midterm night.
 *
 * Each race is run twice: once at a neutral environment and once at this
 * president's. The difference between the two is the seat swing, and the races
 * that come out differently are the seats the presidency itself moved. Working
 * from a delta rather than an absolute count means the chamber the player was
 * handed at the start of the game is respected — a president who inherited 240
 * seats and loses 30 has 210, not whatever the map says in the abstract.
 */
export function runMidterms(state, { spend } = {}) {
  const party = alignedParty(state);
  const opposition = otherParty(party);
  const before = { ...state.congress };

  if (state.congressDissolved) {
    return {
      held: false, env: 0, flips: [], congress: before, before,
      control: controlOf(before), house: null, senate: null,
      note: "There is no Congress to elect.",
    };
  }

  const raw = nationalEnvironment(state, { midterm: true });
  const env = round1(partySign(state.scenario?.party) === 0 ? raw * INDEPENDENT_TRANSFER : raw);
  const budget = affordableSpend(spend, state.warChest);

  const cycle = senateCycle(state);
  const houseResult = runChamber(houseRaces(state), party, opposition, env, budget);
  const senateResult = runChamber(senateRaces(state, cycle), party, opposition, env, budget);

  const congress = applySwing(before, party, houseResult.swing, senateResult.swing);

  return {
    held: true,
    env,
    cycle,
    spend: budget,
    before,
    congress,
    control: controlOf(congress),
    house: { ...houseResult, seats: seatsFor(congress, party, "house") },
    senate: { ...senateResult, seats: seatsFor(congress, party, "senate") },
    flips: [...houseResult.flips, ...senateResult.flips],
    note: describeMidterm(houseResult.swing, senateResult.swing, party),
  };
}

/** One chamber's races, as a swing against the neutral baseline. */
function runChamber(races, party, opposition, env, spend) {
  let won = 0, baseline = 0;
  const flips = [];

  for (const race of races) {
    const margin = raceMargin(race, party, env, spend);
    const neutral = raceMargin(race, party, 0, null);
    if (margin > 0) won += 1;
    if (neutral > 0) baseline += 1;
    if (margin > 0 !== neutral > 0) {
      flips.push({
        chamber: race.chamber,
        state: race.state,
        seat: race.seat,
        from: neutral > 0 ? party : opposition,
        to: margin > 0 ? party : opposition,
        margin: Math.abs(margin),
      });
    }
  }

  // The most brutal losses lead the coverage.
  flips.sort((a, b) => a.margin - b.margin);
  return { contested: races.length, won, baseline, swing: won - baseline, flips };
}

/** Fold a swing into the stored seat counts without breaking either chamber. */
export function applySwing(before, party, houseSwing, senateSwing) {
  const houseKey = party === "Republican" ? "houseR" : "houseD";
  const senateKey = party === "Republican" ? "senateR" : "senateD";
  const otherHouse = party === "Republican" ? "houseD" : "houseR";
  const otherSenate = party === "Republican" ? "senateD" : "senateR";

  const mine = clamp(before[houseKey] + houseSwing, 0, HOUSE_SEATS);
  const senateMine = clamp(before[senateKey] + senateSwing, 0, SENATE_SEATS);
  return {
    [houseKey]: mine,
    [otherHouse]: HOUSE_SEATS - mine,
    [senateKey]: senateMine,
    [otherSenate]: SENATE_SEATS - senateMine,
  };
}

const seatsFor = (congress, party, chamber) =>
  congress[`${chamber}${party === "Republican" ? "R" : "D"}`];

export function controlOf(congress) {
  return {
    house: congress.houseR > congress.houseD ? "Republican" : "Democrat",
    senate: congress.senateR > congress.senateD ? "Republican" : "Democrat",
  };
}

// --- Congress, from the cheap seats -----------------------------------------

/**
 * A congressional election held by somebody other than the player.
 *
 * The presidential game runs midterms because the president is the whole
 * weather system. A congressional career is the other way round: the member is
 * one race out of 435, the President is somebody else, and the country goes to
 * the polls every two years whether or not this particular seat is on the
 * ballot. A senator's six-year term contains three of these and they are only
 * running in one.
 *
 * Without this the chamber a career was handed in its first month was the
 * chamber it died in — which froze every gavel on day one and made the line
 * about losing the majority unreachable, in a mode whose ladder is half built
 * out of that risk.
 *
 * `index` is which election of the career this is, counting from one. That is
 * all the calendar it needs: elections are two years apart, odd ones are
 * midterms, and the Senate class rotates through three.
 */

/**
 * How much of the last wave is still in the chamber when the next one arrives.
 *
 * This constant is the whole difference between a chamber and a slide. Each
 * cycle's swing is measured against a *neutral* map, so folding it into last
 * cycle's result compounds it — a president fifteen points under water costs
 * their party the same twenty seats every two years until the chamber reads
 * 0–435 and the mode has no politics left in it.
 *
 * So the swing is applied to the chamber the career was handed, and the
 * deviation from it carries over at reduced strength. A sustained bad
 * presidency settles at about one and two-thirds of one cycle's damage instead
 * of sliding forever; a senate wave accumulates across two classes, which is
 * how long a real one takes to finish; and when the weather changes, seats come
 * back.
 */
const WAVE_MEMORY = 0.4;

/**
 * The floor under a beaten party.
 *
 * A wave takes the seats that were in play. It does not take the safest fifth
 * of the country, however long it goes on — there is no environment in which
 * Massachusetts elects a Republican and Wyoming elects a Democrat on the same
 * night. Without a floor, a decade of catastrophic presidencies grinds a
 * chamber down to a rump and the mode stops having two sides in it.
 */
const CHAMBER_FLOOR = { house: 120, senate: 28 };

const holdTheFloor = (congress, party) => {
  const key = (chamber) => `${chamber}${party === "Republican" ? "R" : "D"}`;
  const other = (chamber) => `${chamber}${party === "Republican" ? "D" : "R"}`;
  const out = { ...congress };
  for (const [chamber, seats] of [["house", HOUSE_SEATS], ["senate", SENATE_SEATS]]) {
    const floor = CHAMBER_FLOOR[chamber];
    const mine = clamp(out[key(chamber)], floor, seats - floor);
    out[key(chamber)] = mine;
    out[other(chamber)] = seats - mine;
  }
  return out;
};

export function runCongressionalCycle(state, { index = 1 } = {}) {
  const president = state.president || {};
  const party = president.party === "Republican" ? "Republican" : "Democrat";
  const opposition = otherParty(party);
  const caucus = state.caucus || state.scenario?.party;
  const before = { ...state.congress };
  // The chamber this career started with is the thing waves are measured from.
  const start = { ...(state.congressStart || state.congress) };
  const drift = state.congressDrift || { house: 0, senate: 0 };
  const startYear = state.scenario?.startYear ?? 2025;

  // Odd elections are midterms: the first one is two years into a presidency,
  // and the President's party is punished for being in office.
  const midterm = index % 2 === 1;
  const cycle = ((index - 1) % 3) + 1;
  const year = startYear + 2 * index - 1;

  /**
   * The weather, which belongs to the President and not to the member. Passing
   * the career itself here would read the member's own standing with their
   * district as if it were national approval.
   */
  const env = nationalEnvironment({
    approval: president.approval ?? 50,
    economy: state.economy,
    arcs: state.arcs || [],
    scenario: { party },
  }, { midterm });

  const houseResult = runChamber(houseRaces(state), party, opposition, env, null);
  const senateResult = runChamber(senateRaces(state, cycle), party, opposition, env, null);

  const congressDrift = {
    house: round1(drift.house * WAVE_MEMORY + houseResult.swing),
    senate: round1(drift.senate * WAVE_MEMORY + senateResult.swing),
  };
  const congress = holdTheFloor(applySwing(start, party,
    Math.round(congressDrift.house), Math.round(congressDrift.senate)), party);

  const controlBefore = controlOf(before);
  const control = controlOf(congress);

  return {
    index, year, midterm, cycle, env,
    before, congress, control, controlBefore,
    congressStart: start, congressDrift,
    houseSwing: houseResult.swing,
    senateSwing: senateResult.swing,
    house: { ...houseResult, seats: seatsFor(congress, party, "house") },
    senate: { ...senateResult, seats: seatsFor(congress, party, "senate") },
    flipped: {
      house: control.house !== controlBefore.house,
      senate: control.senate !== controlBefore.senate,
    },
    note: describeCycle(controlBefore, control, caucus, president, houseResult.swing + senateResult.swing),
  };
}

/**
 * What the night meant to the member, which is not what it meant to the
 * President. A wave against their own party is a wave against the seat they are
 * sitting in; a wave against the other one is the best news they will get all
 * term — unless it takes their gavel, which it can.
 */
function describeCycle(before, after, caucus, president, net) {
  const gained = [];
  const lost = [];
  for (const chamber of ["house", "senate"]) {
    if (after[chamber] === before[chamber]) continue;
    (after[chamber] === caucus ? gained : lost).push(chamber === "house" ? "the House" : "the Senate");
  }

  const list = (xs) => (xs.length === 2 ? `${xs[0]} and ${xs[1]}` : xs[0]);
  if (gained.length && lost.length) {
    return `Your caucus took ${list(gained)} and lost ${list(lost)} on the same night.`;
  }
  if (gained.length) {
    return `Your caucus won ${list(gained)}. Everything that was impossible last month is now a question of ` +
      `who you know.`;
  }
  if (lost.length) {
    return `Your caucus lost ${list(lost)}. The gavels go with it, and so does the floor schedule.`;
  }
  const side = caucus === president.party ? "your own" : "the President's";
  if (net <= -12) return `A bad night nationally for ${side} party, but control did not change hands.`;
  if (net >= 12) return `A good night nationally for ${side} party, though nobody's majority changed.`;
  return `Control did not change: the same two people run the same two chambers.`;
}

function describeMidterm(houseSwing, senateSwing, party) {
  const side = `the ${party}s`;
  const net = houseSwing + senateSwing;
  if (net <= -40) return `A wipeout. ${side} were routed, and the second half of this presidency will be spent negotiating.`;
  if (net <= -15) return `A bad night for ${side}. The map got smaller and the agenda got harder.`;
  if (net < 0) return `${side} held most of what they had and lost the rest. A survivable night.`;
  if (net === 0) return `A wash. Nobody moved, which after a midterm counts as a win for ${side}.`;
  if (net < 15) return `${side} gained ground — rare at a midterm, and the party noticed.`;
  return `A landslide against the thermostat. ${side} gained seats at a midterm, which almost never happens.`;
}

// --- The presidential election ---------------------------------------------

/**
 * Election night.
 *
 * Every state is called from the approval the player has been watching there
 * all term, adjusted for the fundamentals that never showed up in the polling,
 * whatever the debate did, and where the money went. Electoral votes are
 * winner-take-all; the popular vote is computed separately from the two-party
 * shares, weighted by size — so the two can disagree, and when they do the
 * result says so.
 */
export function runPresidential(state, { swing = 0, bonus = 0, spend } = {}) {
  const env = fundamentals(state);
  const budget = affordableSpend(spend, state.warChest);
  // The debate is damped; the difficulty cushion is not, because it is already
  // expressed in the points it is meant to be worth.
  const debate = round1(swing * DEBATE_WEIGHT + bonus);

  let evYou = 0, evThem = 0, weighted = 0, weight = 0;
  const results = [];

  const seed = state.rosterSeed || state.scenario?.presidentName || "election";

  for (const code of STATE_CODES) {
    const info = STATES[code];
    const approval = state.stateApproval?.[code] ?? 50;
    // Every state has a reason of its own that no national number explains.
    const local = ((hashString(`${seed}|${code}|local`) % 200) / 100 - 1) * STATE_IDIOSYNCRASY;
    const margin = round1(
      (approval - 50) * MARGIN_PER_POINT + env + debate + local + spendIn(budget, code));
    // A margin is the gap between two shares, so half of it sits on each side.
    const share = clamp(50 + margin / 2, 2, 98);
    const won = margin > 0;

    if (won) evYou += info.ev; else evThem += info.ev;
    weighted += share * info.ev;
    weight += info.ev;

    results.push({
      code, name: info.name, ev: info.ev, margin, share: round1(share),
      won, tooClose: Math.abs(margin) < TOO_CLOSE,
    });
  }

  const you = round1(weighted / weight);
  const popular = { you, them: round1(100 - you) };
  const won = evYou >= 270;
  const popularWin = popular.you > 50;

  // Sorted by how close they were: the states that decided it, first.
  const decisive = [...results].sort((a, b) => Math.abs(a.margin) - Math.abs(b.margin)).slice(0, 8);

  return {
    env, debate, spend: budget,
    states: results,
    ev: { you: evYou, them: evThem, needed: 270 },
    popular,
    won,
    popularWin,
    split: won !== popularWin,
    tooClose: results.filter((s) => s.tooClose).map((s) => s.code),
    decisive,
  };
}

// --- The challenger --------------------------------------------------------

const CHALLENGERS = {
  Republican: [
    { name: "Gov. Caroline Hastings", style: "a polished, disciplined governor", attack: "reckless spending and a weak hand abroad" },
    { name: "Sen. Roy Callahan", style: "a folksy, combative senator", attack: "out-of-touch elitism and a bad economy" },
    { name: "Gov. Wade Pruitt", style: "a blunt, business-first governor", attack: "a government that has grown while paychecks have not" },
    { name: "Sen. Adele Marchetti", style: "a disciplined national-security hawk", attack: "an America that adversaries no longer take seriously" },
  ],
  Democrat: [
    { name: "Gov. Marisol Reyes", style: "an energetic, progressive governor", attack: "cruelty to working families and cuts to the safety net" },
    { name: "Sen. Daniel Okonkwo", style: "a cerebral, principled senator", attack: "corruption, division, and broken promises" },
    { name: "Gov. Ruth Ellery", style: "a plain-spoken heartland governor", attack: "a presidency that forgot the people who pay for it" },
    { name: "Sen. Amara Sundqvist", style: "a coalition-building former mayor", attack: "chaos where there should have been competence" },
  ],
};

/**
 * The opponent, fixed for the whole presidency.
 *
 * They are drawn on day one rather than at month 46, so the party out of power
 * has a face the player can be told about long before they have to debate it.
 */
export function challengerFor(state) {
  const scenario = state.scenario || state;
  const party = otherParty(alignedParty({ scenario }));
  const r = seeded(`${scenario.presidentName}|${scenario.party}|challenger`);
  const flavour = r.pick(CHALLENGERS[party]);

  // The opposition's strongest governor, if this career has a statehouse map to
  // draw from. Somebody the player has been watching resist them for four
  // years is a better opponent than a stranger who appears in month 46.
  const bench = state.governors ? benchFor(state, party) : [];
  const rival = bench[0];
  if (!rival) return { ...flavour, party };

  return {
    name: `Gov. ${rival.name}`,
    party,
    state: rival.state,
    stateName: rival.stateName,
    style: `the ${rival.ideology.toLowerCase()} governor of ${rival.stateName}`,
    attack: flavour.attack,
    fromStatehouse: true,
  };
}
