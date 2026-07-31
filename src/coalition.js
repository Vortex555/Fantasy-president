import { clamp, round1 } from "./rng.js";
import { STAKEHOLDERS } from "./stakeholders.js";
import { ideologyEffects } from "../public/js/data/ideologies.js";
import { billById } from "./bills.js";

/**
 * The people who put you here.
 *
 * Every one of the fifty-eight ideologies carries an `fx` block naming the blocs
 * it brings with it and the ones it drives away — a Progressive Firebrand
 * arrives with Labour and Civil Rights at their back and Wall Street against;
 * Third Way arrives with the exact opposite. In the presidency this seeds the
 * eight stakeholders on day one and they react to everything afterwards.
 *
 * In a congressional career none of it was ever read. A chamber state had no
 * stakeholders at all, so the richest half of what you chose at creation — not
 * a number on a spectrum but an actual coalition of named interests — did
 * nothing whatsoever from the moment you were sworn in.
 *
 * It matters more for a legislator than for a president, not less. A president
 * has a national mandate and can survive a bloc turning on them. A member of the
 * House has one district and a primary every two years, and the groups who
 * funded the last campaign are the ones who decide whether there is a next one.
 */

/** Only the blocs an ideology actually has a relationship with, in either direction. */
const RELEVANT = 12;

/**
 * The coalition a career is sworn in with.
 *
 * Everyone starts near indifferent and then the ideology moves the ones it
 * touches, so a Blue Dog genuinely does begin with gun owners warm and
 * environmentalists cold — and knows it, because the floor says so.
 */
export function buildCoalition(scenario) {
  const fx = ideologyEffects(scenario?.party, scenario?.ideology);
  const coalition = {};
  for (const s of STAKEHOLDERS) {
    const pull = Number(fx[s.id]) || 0;
    // Doubled, because for a legislator these are the groups who fund and staff
    // a campaign rather than eight national moods, and the difference between
    // an ally and a bystander should be visible on day one.
    coalition[s.id] = clamp(Math.round(50 + pull * 2));
  }
  return coalition;
}

/** Who this ideology is actually in a relationship with, warmest first. */
export function foundingBlocs(scenario) {
  const fx = ideologyEffects(scenario?.party, scenario?.ideology);
  return STAKEHOLDERS
    .filter((s) => Number(fx[s.id]))
    .map((s) => ({ id: s.id, name: s.name, pull: Number(fx[s.id]) }))
    .sort((a, b) => b.pull - a.pull)
    .slice(0, RELEVANT);
}

/**
 * What a bill does to them.
 *
 * A pool bill states it outright — the effects were written by hand and are
 * better than anything derivable. Anything else is inferred from where the bill
 * sits, using each bloc's own known lean: a hard-left bill pleases the blocs
 * that lean left by as much as it angers the ones that lean right.
 */
export function billReaction(bill) {
  const authored = billById(bill?.id);
  if (authored?.fx) {
    const out = {};
    for (const s of STAKEHOLDERS) {
      const v = Number(authored.fx[s.id]);
      if (v) out[s.id] = v;
    }
    if (Object.keys(out).length) return out;
  }

  const axis = Number(bill?.axis) || 0;
  if (Math.abs(axis) < 0.1) return {};      // a centrist bill nobody has feelings about
  const out = {};
  for (const s of STAKEHOLDERS) {
    // `lean` is the bloc's own politics on the same −1…+1 spectrum, so a bill
    // and a bloc pointing the same way is a bloc that is pleased.
    const alignment = s.lean * axis > 0 ? 1 : -1;
    const pull = round1(alignment * Math.abs(axis) * Math.abs(s.lean) * 14);
    if (Math.abs(pull) >= 0.5) out[s.id] = pull;
  }
  return out;
}

/**
 * Apply a passed bill to the coalition, and say who moved.
 *
 * Only bills that carried. A bloc does not reward you for a gesture that failed
 * — though the *vote* still costs you with them, which is handled separately and
 * is the crueller and truer half of the arrangement.
 */
export function applyBillToCoalition(state, bill) {
  if (!state.coalition) return {};
  const reaction = billReaction(bill);
  const moved = {};
  for (const [id, delta] of Object.entries(reaction)) {
    if (state.coalition[id] == null) continue;
    const before = state.coalition[id];
    state.coalition[id] = clamp(Math.round(before + delta * 0.5));
    const actual = state.coalition[id] - before;
    if (actual) moved[id] = actual;
  }
  return moved;
}

/**
 * How your own coalition reads a vote you personally cast.
 *
 * Smaller than the effect of a bill becoming law, and it lands whichever way the
 * roll call went — because a bloc that watched you vote against them does not
 * care that you lost. This is what makes a hopeless vote still cost something,
 * which is the whole reason a member ever ducks one.
 */
export function applyVoteToCoalition(state, bill, vote) {
  if (!state.coalition || vote === "abstain") return {};
  const reaction = billReaction(bill);
  const sign = vote === "yes" ? 1 : -1;
  const moved = {};
  for (const [id, delta] of Object.entries(reaction)) {
    if (state.coalition[id] == null) continue;
    const before = state.coalition[id];
    state.coalition[id] = clamp(Math.round(before + delta * sign * 0.28));
    const actual = state.coalition[id] - before;
    if (actual) moved[id] = actual;
  }
  return moved;
}

/**
 * Where you stand with the people who brought you, and what they are doing
 * about it.
 *
 * Judged against the coalition you *started* with rather than against fifty, so
 * the question is always "have you kept the people who chose you" and never
 * "are you popular with everyone". A Third Way Democrat is not supposed to have
 * organised labour, and should not be marked down for it.
 */
export function coalitionStanding(state) {
  const founding = foundingBlocs(state.scenario).filter((b) => b.pull > 0);
  if (!founding.length || !state.coalition) return null;

  const rows = founding.map((b) => ({
    id: b.id,
    name: b.name,
    now: state.coalition[b.id] ?? 50,
    started: clamp(Math.round(50 + b.pull * 2)),
  })).map((r) => ({ ...r, change: r.now - r.started }));

  const average = round1(rows.reduce((sum, r) => sum + r.now, 0) / rows.length);
  const lost = rows.filter((r) => r.now < 50);

  return {
    rows,
    average,
    // What they are prepared to do for you, or to you.
    mood: average >= 70 ? "committed" : average >= 50 ? "watchful" : average >= 35 ? "cooling" : "gone",
    note: average >= 70
      ? `The people who put you here are still with you, and they are paying for the field operation.`
      : average >= 50
        ? `Your coalition is intact but watching. They have noticed some of the votes.`
        : average >= 35
          ? `You are losing the people who made this career possible.${lost.length ? ` ${lost.map((r) => r.name).join(" and ")} no longer counts you as theirs.` : ""}`
          : `Your own coalition has written you off. Somebody is already raising money to replace you in a primary.`,
  };
}

/**
 * What the coalition is worth on election night.
 *
 * The same idea as integrity and deliberately a smaller number, because these
 * two things are correlated and stacking them at full strength would make a
 * career about one statistic. Integrity is whether voters believe you; this is
 * whether the organisations that turn voters out still bother.
 */
export function coalitionTurnout(state) {
  const standing = coalitionStanding(state);
  if (!standing) return 0;
  return round1(clamp((standing.average - 55) * 0.1, -5, 4));
}
