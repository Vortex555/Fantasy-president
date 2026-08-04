import { clamp, round1, seeded } from "./rng.js";
import { STATES } from "./states.js";
import { buildCongress } from "../public/js/data/government.js";
import { factionOf, ownBloc } from "./factions.js";
import { factionById } from "../public/js/data/factions.js";
import { findIdeology } from "../public/js/data/ideologies.js";

/**
 * The war inside your own party.
 *
 * Every lever the mode had pointed at the other side or at leadership. Nothing
 * pointed at the people sitting next to you — and a great deal of what a real
 * member does is aimed exactly there: whose primary you fund, whose challenger
 * you endorse, whose fundraiser you headline. Congressional careers are made and
 * ended by their own party far more often than by the other one.
 *
 * Two moves, and they are opposites. Endorsing a challenger against a colleague
 * is the insurgent's: it costs you everything with leadership, delights your own
 * wing, and if it lands it removes a member and replaces them with somebody like
 * you — which shifts the chamber itself, and therefore every roll call, faction
 * count and discharge ceiling in the game. Headlining fundraisers for colleagues
 * is the establishment's: it buys the favours and the standing that a member
 * climbing the committee ladder runs on, and it is paid for in days not spent at
 * home.
 *
 * The Groyper's trait string has promised since it was written that "you can end
 * a mainstream conservative's career from a phone". This is the first thing in
 * the codebase that lets anybody do it.
 */

/** Backing a challenger costs little money and every ounce of goodwill. */
export const ENDORSE_COST = 5;
export const ENDORSE_LEADERSHIP_DRAG = 16;
export const ENDORSE_BLOC_GAIN = 11;

/** A primary season, from endorsement to result. */
export const PRIMARY_MONTHS = 4;

/** How many of your own you can be at war with at once. */
export const MAX_CHALLENGES = 2;

const chamberOf = (state) => (state?.office === "senate" ? "senate" : "house");
const myParty = (state) => state.caucus || state.scenario?.party;

/**
 * Colleagues worth challenging.
 *
 * Your own party, in your own chamber, and not in your own bloc — you do not
 * primary the people you sit with. Sorted by how far from you they are, because
 * that is the order a movement actually works through a caucus.
 */
export function primaryTargets(state) {
  const mine = factionOf(state.scenario);
  const party = myParty(state);
  if (!mine) return [];

  const roster = buildCongress(state, STATES)[chamberOf(state)] || [];
  const pending = new Set((state.challenges || []).map((c) => c.seat));

  /**
   * Read from the ideology table when the scenario does not carry it.
   *
   * `scenario.ideologyAxis` is set at character creation and a save or an API
   * call that omits it falls to `Number(undefined) || 0` — dead centre — which
   * silently reorders the whole target list by distance from a politics nobody
   * holds. The same trap `convictionView` had.
   */
  const myAxis = Number(state.scenario?.ideologyAxis)
    || findIdeology(state.scenario?.party, state.scenario?.ideology)?.axis
    || 0;

  return roster
    .filter((m) => m.party === party && m.faction !== mine.id && !m.primaried && !pending.has(m.seat))
    .map((m) => ({
      seat: m.seat,
      name: m.name,
      state: m.state,
      ideology: m.ideology,
      faction: factionById(m.faction)?.name || "no bloc",
      /**
       * How exposed they are. A member whose politics is far from their own
       * party's activists is the one a challenger beats, and the distance from
       * *you* is the proxy for that — you are, after all, the activists.
       */
      distance: round1(Math.abs((m.axis ?? 0) - myAxis)),
    }))
    .sort((a, b) => b.distance - a.distance)
    .slice(0, 5);
}

/**
 * The odds a challenger actually wins.
 *
 * Almost never, without a movement behind it. Incumbents win their primaries
 * overwhelmingly, and what changes that is an organised faction with a reason —
 * so the number that matters is whether your bloc is big enough to be one, and
 * how far the target sits from the people who vote in primaries.
 */
export function challengeOdds(state, target) {
  const bloc = ownBloc(state);
  /**
   * What backs a challenger is a caucus that primaries people, not merely a big
   * one. `canDenyMajority` was the first cut and distinguishes nothing — it is
   * true of almost every bloc, so a Republican Study Committee member came out
   * as good at ending careers as the Freedom Caucus, which is the opposite of
   * how a party works. The governing wing does not run challengers against its
   * own colleagues; that is what makes it the governing wing.
   *
   * Size still matters on top of it. An organised faction with the numbers is a
   * movement; an organised faction without them is a mailing list.
   */
  const restive = Boolean(factionById(bloc?.id)?.restive);
  const organised = restive ? (bloc?.canDenyMajority ? 26 : 15) : 5;
  const exposure = Math.round((target?.distance ?? 0) * 22);
  const standing = Math.round(((state.bloc ?? 62) - 62) * 0.35);
  return clamp(6 + organised + exposure + standing, 4, 74);
}

/** Put your name behind somebody else's opponent. */
export function endorseChallenger(state, seat) {
  const live = state.challenges || [];
  if (live.length >= MAX_CHALLENGES) {
    return { rejected: true, note: `You are already at war with ${live.length} of your own. Any more and it stops being a campaign and starts being your entire reputation.` };
  }
  const target = primaryTargets(state).find((t) => t.seat === seat);
  if (!target) return { rejected: true, note: "Nobody by that name is up, or they are one of yours." };
  if ((state.capital ?? 0) < ENDORSE_COST) {
    return { rejected: true, note: `Even a phone call costs ${ENDORSE_COST} favours. Somebody has to introduce the challenger to the money.` };
  }

  return {
    state: {
      ...state,
      capital: round1(Math.max(0, (state.capital ?? 0) - ENDORSE_COST)),
      leadership: clamp(round1(state.leadership - ENDORSE_LEADERSHIP_DRAG)),
      bloc: clamp(round1((state.bloc ?? 62) + ENDORSE_BLOC_GAIN)),
      challenges: [...live, {
        seat: target.seat, name: target.name, ideology: target.ideology,
        odds: challengeOdds(state, target),
        due: (state.month || 1) + PRIMARY_MONTHS,
      }],
    },
    note: `You endorsed a primary challenger against ${target.name}. It took an afternoon, `
      + `it cost you every friend you had in leadership, and it will be the first line of `
      + `your obituary if it works.`,
  };
}

/**
 * A month of primary season.
 *
 * Losing is the common case and it is not free: a colleague you tried to remove
 * and failed to is a colleague for the rest of your career. Winning replaces
 * them with somebody from your own bloc, which moves the chamber — and every
 * roll call, faction count, discharge ceiling and motion to vacate reads that
 * chamber.
 */
export function resolvePrimaries(state) {
  const live = state.challenges || [];
  if (!live.length) return { state, results: [] };

  const month = state.month || 1;
  const due = live.filter((c) => month >= c.due);
  if (!due.length) return { state, results: [] };

  const results = [];
  let primaried = [...(state.primaried || [])];
  let leadership = state.leadership;
  let bloc = state.bloc ?? 62;

  for (const c of due) {
    const r = seeded(`${state.rosterSeed}|primary|${c.seat}|${c.due}`);
    const won = r.chance(c.odds / 100);
    if (won) {
      primaried.push({ seat: c.seat, ideology: state.scenario?.ideology, name: null });
      bloc = clamp(round1(bloc + 8));
      leadership = clamp(round1(leadership - 6));
    } else {
      leadership = clamp(round1(leadership - 3));
    }
    results.push({ ...c, won });
  }

  return {
    state: {
      ...state,
      leadership, bloc, primaried,
      challenges: live.filter((c) => month < c.due),
    },
    results,
    note: results.map((x) => (x.won
      ? `${x.name} lost their primary. The seat comes back with somebody who thinks like you, `
        + `and every member who watched it happen now knows what you are.`
      : `${x.name} survived their primary comfortably. You will be sitting near them for years.`))
      .join(" "),
  };
}

// ---------------------------------------------------------------------------
// The other direction
// ---------------------------------------------------------------------------

/**
 * Headlining fundraisers for colleagues.
 *
 * The establishment's move, and the exact inverse of casework: that spends
 * standing with your caucus to buy standing at home, and this spends days at
 * home to buy standing — and favours — with your caucus. A member who raises
 * for thirty colleagues is a member thirty people owe, which is how committee
 * assignments and leadership races have always actually been decided.
 */
export const FUNDRAISE_APPROVAL_COST = 2.4;
export const FUNDRAISE_LEADERSHIP_GAIN = 3.2;
export const FUNDRAISE_CAPITAL_GAIN = 4;

export function fundraiseForColleagues(state) {
  if (state.fundraisedThisMonth) {
    return { rejected: true, note: "You have done the circuit this month. There are only so many rubber-chicken dinners in a calendar." };
  }
  return {
    state: {
      ...state,
      approval: clamp(round1((state.approval ?? 50) - FUNDRAISE_APPROVAL_COST)),
      leadership: clamp(round1(state.leadership + FUNDRAISE_LEADERSHIP_GAIN)),
      capital: round1((state.capital ?? 0) + FUNDRAISE_CAPITAL_GAIN),
      fundraisedThisMonth: true,
    },
    note: "Four fundraisers in three states for members who needed the money more than you did. "
      + "None of it was for your seat, and every one of them knows it.",
  };
}

export const resetFundraising = (state) => ({ ...state, fundraisedThisMonth: false });
