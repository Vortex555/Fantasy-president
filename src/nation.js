import { seeded, clamp, round1 } from "./rng.js";
import { drawEvent, rememberEvent, shouldUsePool } from "./eventPool.js";
import {
  createArc, activeArcs, nextArcId, normalizeDomain, MAX_SEVERITY, ARC_DOMAIN_IDS,
} from "./arcs.js";

/**
 * The country, from a seat inside it.
 *
 * A president's game supplies its own weather: they act, and the simulation
 * writes back an economy, a press reaction and a list of problems still
 * outstanding. A member had none of that. Their economy was four numbers
 * written once at swearing-in and never touched again, their `arcs` array was
 * initialised empty and stayed empty, and the floor drew from a fixed pool of
 * twenty-seven bills by dice roll. Nothing outside the chamber ever moved, so
 * nothing on the floor could be about anything.
 *
 * This is the missing half. The country now has a month-by-month state — a
 * situation dominating the news, a handful of unresolved problems with a
 * severity each, and an economy that drifts and responds to both. It runs
 * deterministically, so a career with no model configured still serves a
 * country that moves; the model's job is to write better situations into it and
 * better bills out of it, not to be the only thing keeping it alive.
 *
 * The loop that makes the mode work: a problem festers, leadership schedules a
 * bill about it, the chamber passes or kills the bill, and the problem eases or
 * escalates accordingly. A member votes on the country rather than on a list.
 */

/** How many problems the country carries at once. Fewer than a president's. */
export const MAX_NATIONAL_ARCS = 3;

/** Where the economy is pulled back toward when nothing is happening to it. */
const BASELINE = { gdpGrowth: 2.3, unemployment: 4.4, inflation: 2.4 };

/** How hard an unaddressed problem drags on the numbers, per point of severity. */
const DRAG = { gdpGrowth: -0.07, unemployment: 0.05, inflation: 0.06 };

/** A domain's problems only weigh on the economy if they are economic. */
const ECONOMIC_DOMAINS = new Set(["economy", "health"]);

/** Months of neglect before a problem gets worse. */
const ESCALATE_EVERY = 2;

/**
 * The month a career belongs to on a single continuous clock.
 *
 * Every term restarts `month` at 1, which is right for the chamber and wrong
 * for the country: the year a situation is drawn for, and the seed it is drawn
 * on, both have to keep counting or a member relives their first term forever.
 */
export function absoluteMonth(state) {
  const termLength = state?.office === "senate" ? 72 : 24;
  return ((state?.term || 1) - 1) * termLength + (state?.month || 1);
}

/** The pool draws against a continuous clock, so the era advances with the career. */
const poolView = (state) => ({ ...state, month: absoluteMonth(state) });

/**
 * Where this month's situation comes from — the same three-way choice the
 * presidency offers, so a member can play the mode with no key at all.
 */
export function situationFromPool(state) {
  return drawEvent(poolView(state));
}

export function wantsWrittenSituation(state, aiOn) {
  const mode = state?.scenario?.events || "hybrid";
  if (!aiOn || mode === "classic") return false;
  return !shouldUsePool(poolView(state), mode);
}

// --- Standing up the country -------------------------------------------------

/**
 * The country a new member is sworn into. One situation in the news and one
 * problem already outstanding, because nobody arrives to an empty in-tray.
 */
export function seedNation(state) {
  const situation = situationFromPool(state);
  const next = { ...state, situation, seenEvents: [] };
  rememberEvent(next, situation);
  next.arcs = [createArc({
    id: "arc_1",
    title: situation.title,
    brief: situation.brief,
    domain: situation.domain,
    severity: 2,
    month: absoluteMonth(state),
  })];
  return next;
}

// --- The month turning over --------------------------------------------------

/**
 * Which problems the chamber actually did something about this month.
 *
 * A bill that passed counts, whichever way the member voted — the country does
 * not care how one of 435 people voted, only what came out of the building.
 * This is deliberately the *chamber's* record and not the member's, because the
 * mode's whole premise is being one vote inside somebody else's outcome.
 */
export function domainsActedOn(state, month = state.month, term = state.term || 1) {
  return actedOn(state, month, term).domains;
}

/**
 * What became law this month, by problem and by area.
 *
 * Matching on the *domain* alone turned out to be too loose a joint. A model
 * writing a bank-rescue bill tagged it `security` while the problem it was
 * plainly answering was tagged `economy`, so the bill passed, the country
 * noticed nothing, and the problem escalated as though Congress had ignored it.
 * Nothing in the game could show that had happened.
 *
 * So a written bill now names the problem it answers by id, and that is matched
 * first. The domain is kept as the fallback, because a bill drawn from the
 * hand-written pool has no such id and never will.
 *
 * This reads the enactment log rather than the vote log, and the difference is
 * the entire point of passage.js. A bill that cleared the member's own chamber
 * used to ease the country's problems on the strength of that alone — so a
 * party-line statute killed in the Senate three weeks later still repaired the
 * thing it was about, and nothing anywhere admitted it. The country responds to
 * law, not to one chamber's opinion; the vote log stays what it always was,
 * which is how this member voted.
 */
export function actedOn(state, month = state.month, term = state.term || 1) {
  const domains = new Set();
  const problems = new Set();
  for (const v of state.enacted || []) {
    if (v.month !== month || (v.term || 1) !== term) continue;
    if (v.addresses) problems.add(v.addresses);
    if (v.domain) domains.add(normalizeDomain(v.domain));
  }
  return { domains, problems };
}

/**
 * Roll the country forward one month.
 *
 * Called from both chambers' advance functions, on the state as it stands at
 * the end of the month — so the votes just cast are already in the log and the
 * problems they addressed ease before anything else is calculated.
 */
export function advanceNation(next) {
  const acted = actedOn(next);
  const arcs = [];
  const detonations = [];

  for (const arc of next.arcs || []) {
    if (arc.status && arc.status !== "active") continue;

    if (acted.problems.has(arc.id) || acted.domains.has(arc.domain)) {
      // Congress passed something in this area. Real progress, not a cure.
      const severity = arc.severity - 1;
      if (severity <= 0) {
        // Over. It leaves a line in the record and stops costing anything.
        next.resolved = [...(next.resolved || []), {
          title: arc.title, domain: arc.domain, month: next.month, term: next.term || 1,
        }].slice(-12);
        continue;
      }
      arcs.push({ ...arc, severity, ignoredStreak: 0, lastAddressedMonth: next.month });
      continue;
    }

    // Ignored. Problems that nobody legislates about get worse, slowly.
    const ignoredStreak = (arc.ignoredStreak || 0) + 1;
    const worse = ignoredStreak % ESCALATE_EVERY === 0;

    /**
     * At the top of the scale, ignored one more time, it stops being a problem
     * and becomes an event.
     *
     * Without this the country saturates and then stops. Severity caps at five,
     * three problems is the whole slate, and a chamber that legislates about
     * none of them arrives — in about eight months — at three permanent
     * five-out-of-five crises that can never resolve and can never make room
     * for anything else. The news kept moving in testing while the country
     * underneath it was frozen: a tariff war and a hospital emergency both
     * arrived and neither could become a problem, because there was nowhere to
     * put them.
     *
     * So it blows up. That clears the slot, forces itself into next month's
     * headlines, and leaves a scar on the record — which is the whole point of
     * having ignored it, and the only thing that makes ignoring it cost
     * anything in the end.
     */
    if (worse && arc.severity >= MAX_SEVERITY) {
      const monthsActive = Math.max(1, absoluteMonth(next) - (arc.bornMonth || 1));
      next.scars = [...(next.scars || []), {
        id: arc.id, title: arc.title, domain: arc.domain,
        month: next.month, term: next.term || 1, monthsActive,
      }].slice(-12);
      detonations.push({ arc: { ...arc, status: "detonated" }, monthsActive });
      continue;
    }

    arcs.push({
      ...arc,
      ignoredStreak,
      severity: worse ? Math.min(MAX_SEVERITY, arc.severity + 1) : arc.severity,
    });
  }

  next.arcs = arcs;
  // The one that blew up hardest is the one the country is talking about.
  next.detonation = detonations
    .sort((a, b) => b.monthsActive - a.monthsActive)[0] || null;
  if (next.detonation) detonationCost(next, detonations.length);

  driftEconomy(next);
  pressurePresident(next);
  return next;
}

/**
 * What a problem breaking open does to a country a member cannot steer.
 *
 * Deliberately not applied to the member's own two standings. Nothing here is
 * their fault or their doing — they hold one vote of four hundred and
 * thirty-five — and charging them for it would make the mode a game about
 * outcomes they cannot influence. It lands where they will feel it indirectly:
 * on the President whose approval becomes the wave they run in, and on an
 * economy that every voter reads as somebody's fault.
 */
function detonationCost(next, count) {
  const potus = next.president;
  if (potus) {
    next.president = { ...potus, approval: clamp(round1(potus.approval - 4 * count)) };
  }
  const e = next.economy;
  if (!e) return;
  e.gdpGrowth = clamp(round1(e.gdpGrowth - 0.3 * count), -7, 7);
  e.unemployment = clamp(round1(e.unemployment + 0.2 * count), 1.5, 25);
}

/**
 * Next month's news, and the problem it may leave behind.
 *
 * Split out from `advanceNation` because the situation is the one part of the
 * month a model may write, and the server needs to be able to await it after
 * the deterministic half has already run.
 */
export function setSituation(next, situation) {
  if (!situation?.title) return next;
  next.situation = situation;
  // A problem that blew up is already on the record as a scar; it must not come
  // straight back as a fresh problem to be solved.
  if (situation.detonated) {
    next.newsLog = [...(next.newsLog || []), {
      title: situation.title, domain: normalizeDomain(situation.domain),
    }].slice(-6);
    rememberEvent(next, situation);
    return next;
  }
  rememberEvent(next, situation);
  // What the country has recently been about, which is how the next story is
  // steered off it. Kept short: six months is as far back as a news cycle goes.
  next.newsLog = [...(next.newsLog || []), {
    title: situation.title, domain: normalizeDomain(situation.domain),
  }].slice(-6);

  // A new situation becomes a standing problem only if there is room for one
  // and it is not the same trouble under a new headline.
  const live = activeArcs(next);
  if (live.length >= MAX_NATIONAL_ARCS) return next;
  const domain = normalizeDomain(situation.domain);
  if (live.some((a) => a.domain === domain && a.title === situation.title)) return next;

  next.arcs = [...(next.arcs || []), createArc({
    id: nextArcId(next.arcs),
    title: situation.title,
    brief: situation.brief,
    domain,
    /**
     * Two, not one.
     *
     * At one, a problem was born already a single vote from being over — so the
     * country churned through crises instead of accumulating them, severity
     * never once passed 2 in six months of play, and the escalation mechanic
     * that is supposed to punish an idle chamber never engaged. At two, one
     * bill eases a problem and a second finishes it, which is the difference
     * between a country with a memory and a news ticker.
     */
    severity: 2,
    month: absoluteMonth(next),
  })];
  return next;
}

/**
 * Which corner of the country next month's story should come from.
 *
 * A small model asked to "grow the next story out of this one" writes the same
 * story again. Six straight months of one subject — protests, then emergency
 * funding for protests, then emergency funding stalling — is what that looks
 * like from inside, and no amount of asking for variety in prose fixes it,
 * because the instruction competes with the continuity instruction and loses.
 *
 * So the choice is taken away from it. The engine names one domain and the
 * model writes in that domain, which is a single concrete instruction a weak
 * model follows reliably. Domains the news has not touched lately are favoured,
 * and roughly one month in four is deliberately left on the current subject —
 * because a festering problem finally detonating is the most interesting story
 * the country has, and a country that changed the subject every single month
 * would have no memory at all.
 */
export function steerDomain(state) {
  const r = seeded(`${state.rosterSeed}|news|${state.term || 1}|${state.month}`);
  const recent = (state.newsLog || []).map((n) => n.domain);
  const current = normalizeDomain(state.situation?.domain);

  // Let the running story continue sometimes — but never twice running, or the
  // lock-in this exists to break simply comes back more slowly.
  const stuck = recent.slice(-2).every((d) => d === current) && recent.length >= 2;
  if (!stuck && r.chance(0.25)) return current;

  const weigh = (domain) => {
    const lastSeen = recent.lastIndexOf(domain);
    // Never in the recent log is best; seen last month is worst.
    const staleness = lastSeen === -1 ? recent.length + 2 : recent.length - lastSeen;
    return domain === current ? 0.15 : staleness * staleness;
  };
  const candidates = ARC_DOMAIN_IDS;
  return r.weighted(candidates, candidates.map(weigh));
}

/** The subjects the country has just been through, so the next one is not one of them. */
export const recentNewsSubjects = (state) => (state.newsLog || []).map((n) => n.title);

/**
 * The economy, drifting.
 *
 * Mean reversion plus a small seeded shock, dragged by whichever problems are
 * economic and unresolved. A member cannot steer any of it — that is the point,
 * and it is what makes the national environment they run in feel like weather
 * rather than a number somebody typed.
 */
function driftEconomy(next) {
  const e = next.economy;
  if (!e) return;
  const r = seeded(`${next.rosterSeed}|econ|${next.term || 1}|${next.month}`);

  const weight = activeArcs(next)
    .filter((a) => ECONOMIC_DOMAINS.has(a.domain))
    .reduce((sum, a) => sum + a.severity, 0);

  const move = (value, base, drag, shock) =>
    round1(value + (base - value) * 0.12 + weight * drag + (r.next() - 0.5) * shock);

  e.gdpGrowth = clamp(move(e.gdpGrowth, BASELINE.gdpGrowth, DRAG.gdpGrowth, 0.5), -7, 7);
  e.unemployment = clamp(move(e.unemployment, BASELINE.unemployment, DRAG.unemployment, 0.3), 1.5, 25);
  e.inflation = clamp(move(e.inflation, BASELINE.inflation, DRAG.inflation, 0.4), -3, 40);
  // Debt only goes one way at this resolution, a little faster in a bad economy.
  e.debt = round1(e.debt + 0.08 + Math.max(0, e.unemployment - BASELINE.unemployment) * 0.05);
}

/**
 * The President wears the country's problems.
 *
 * `driftPresident` already walks their approval randomly; this leans that walk
 * against them when things are going badly, which is what turns a national
 * situation into a wave the member's own re-election is measured against.
 */
function pressurePresident(next) {
  const potus = next.president;
  if (!potus) return;
  const weight = activeArcs(next).reduce((sum, a) => sum + Math.max(0, a.severity - 2), 0);
  if (!weight) return;
  next.president = { ...potus, approval: clamp(round1(potus.approval - weight * 0.35)) };
}

// --- Saying it out loud ------------------------------------------------------

const SEVERITY_WORD = ["", "simmering", "serious", "bad", "acute", "out of control"];

export const severityWord = (n) => SEVERITY_WORD[clamp(Math.round(n), 0, 5)] || "serious";

/**
 * The country in a block of text, for a model that is about to write a floor
 * schedule out of it. Deliberately dense: this is context, not prose.
 */
export function nationSummary(state) {
  const e = state.economy || {};
  const potus = state.president || {};
  const c = state.congress || {};
  const senate = state.office === "senate";
  const majority = senate
    ? (c.senateR > c.senateD ? "Republican" : "Democrat")
    : (c.houseR > c.houseD ? "Republican" : "Democrat");

  const lines = [
    `Year: ${(state.scenario?.startYear || 2025) + Math.floor((absoluteMonth(state) - 1) / 12)}.`,
    `President ${potus.name} (${potus.party}), approval ${potus.approval}%.`,
    `House ${c.houseD}D-${c.houseR}R, Senate ${c.senateD}D-${c.senateR}R. ` +
      `The ${majority}s hold this chamber and set the calendar.`,
    `Economy: GDP growth ${e.gdpGrowth}%, unemployment ${e.unemployment}%, ` +
      `inflation ${e.inflation}%, debt $${e.debt}T.`,
  ];

  if (state.situation?.title) {
    lines.push(`DOMINATING THE NEWS THIS MONTH: ${state.situation.title} — ${state.situation.brief}`);
  }

  const live = activeArcs(state);
  lines.push(live.length
    ? `UNRESOLVED NATIONAL PROBLEMS (the ones Congress keeps being asked about).\n` +
      `Each has an id. When a bill answers one, quote its id exactly:\n${live
        .map((a) => `- id=${a.id} [${a.domain}] ${a.title} — ${severityWord(a.severity)} (severity ${a.severity}/5, ` +
          `${a.ignoredStreak || 0} months since Congress last acted on it). ${a.brief}`)
        .join("\n")}`
    : "No national problem is currently outstanding.");

  if (state.resolved?.length) {
    lines.push(`Recently settled by this Congress: ${state.resolved.slice(-3).map((x) => x.title).join("; ")}.`);
  }
  return lines.join("\n");
}

/** The same thing, shaped for the floor screen rather than for a prompt. */
export function nationCard(state) {
  return {
    situation: state.situation || null,
    problems: activeArcs(state).map((a) => ({
      id: a.id,
      title: a.title,
      brief: a.brief,
      domain: a.domain,
      severity: a.severity,
      word: severityWord(a.severity),
      ignoredStreak: a.ignoredStreak || 0,
    })),
    economy: state.economy || null,
    president: state.president || null,
    resolved: (state.resolved || []).slice(-3),
    // What the chamber left alone until it broke open. A different kind of
    // record from the one above, and the one a career is actually judged on.
    scars: (state.scars || []).slice(-3),
  };
}
