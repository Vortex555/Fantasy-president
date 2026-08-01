import { clamp, round1 } from "./rng.js";
import { buildCongress } from "../public/js/data/government.js";
import { STATES } from "./states.js";
import { stanceFit, defectionOn } from "./bills.js";
import {
  FACTIONS, factionById, factionFor,
} from "../public/js/data/factions.js";

// Re-exported so every existing caller keeps its import. The membership data
// itself lives one level down; see the note at the top of that file.
export { FACTIONS, factionById, factionFor };

/**
 * The caucus inside the caucus.
 *
 * A chamber had two organised bodies in it: the majority and the minority. Every
 * one of the four hundred and thirty-five members carried an ideology drawn from
 * the same list the player picks from, and nothing whatsoever grouped them — so
 * the forty most left-wing Democrats in the room were forty individuals who
 * happened to hold similar opinions, rather than the thing they actually are,
 * which is a bloc with a chair, a whip, a number and a price.
 *
 * That is most of what makes a real legislature difficult to run. Leadership
 * does not negotiate with two hundred individuals; it negotiates with four or
 * five factions, any of which can withhold enough votes to kill a bill its own
 * party wants. And it is the piece that makes the ideology chosen at character
 * creation *prevalent* rather than merely present: it stops being a number and
 * becomes the group you sit with, whose demands you either meet or answer for.
 */

/** The player's own bloc. */
export const factionOf = (scenario) => factionFor(scenario?.party, scenario?.ideology);

/**
 * How many of the chamber sit in each bloc, and how many votes that is.
 *
 * Read from the actual roster rather than assumed, so a radicalised chamber
 * genuinely produces a Freedom Caucus of a hundred and forty and a Progressive
 * Caucus that can dictate terms — which is the moment a republic stops working
 * and the reason the setting exists.
 */
export function factionRoll(state) {
  const chamber = state.office === "senate" ? "senate" : "house";
  const bench = buildCongress(state, STATES)[chamber] || [];
  const counts = new Map();

  for (const member of bench) {
    const faction = factionFor(member.party, member.ideology);
    if (!faction) continue;
    counts.set(faction.id, (counts.get(faction.id) || 0) + 1);
  }

  return FACTIONS
    .map((f) => ({ ...f, members: counts.get(f.id) || 0 }))
    .filter((f) => f.members > 0)
    .sort((a, b) => b.members - a.members);
}

/** How big the player's own bloc is, and what share of the chamber. */
export function ownBloc(state) {
  const mine = factionOf(state.scenario);
  if (!mine) return null;
  const roll = factionRoll(state);
  const row = roll.find((f) => f.id === mine.id);
  if (!row) return null;

  const total = roll.reduce((sum, f) => sum + f.members, 0) || 1;
  const threshold = state.office === "senate" ? 51 : 218;
  return {
    ...row,
    share: round1((row.members / total) * 100),
    /**
     * Whether the bloc alone can deny a majority.
     *
     * The entire source of a faction's power, and the reason a caucus of forty
     * in a chamber of four hundred and thirty-five is worth more than four
     * hundred individuals: if leadership's margin is thinner than the bloc, the
     * bloc decides.
     */
    canDenyMajority: row.members >= Math.max(4, Math.round(total * 0.06)),
    threshold,
  };
}

// --- Where the bloc stands --------------------------------------------------

/**
 * The bloc's position on a bill, as a fourth voice beside the caucus, the seat
 * and the member's own convictions.
 *
 * A faction is more disciplined than a party — that is what makes it a faction —
 * so it takes a position sooner and holds it harder. Its centre is the middle of
 * its own band rather than the party's anchor, which is precisely why it can be
 * at odds with its own leadership.
 */
export function factionLine(state, bill) {
  const faction = factionOf(state.scenario);
  if (!faction) return null;

  /**
   * Its centre on money is the middle of its own band; its position on state
   * power is stated outright, because that is the axis a faction organises
   * around and no band can imply it.
   *
   * This is what stops the bloc card from being a second copy of the member's
   * own. Measured on the old single axis, a Groyper and the Freedom Caucus
   * differed on 6.5% of the range — nine hundredths apart, so the fourth voice
   * agreed with the player nineteen times in twenty. Two axes let a bloc be at
   * odds with its own most extreme members, which is the entire reason a whip
   * has a job.
   */
  const centre = { axis: (faction.band[0] + faction.band[1]) / 2, liberty: faction.liberty };
  const fit = stanceFit(centre, bill);

  /**
   * The bloc breaking from where its own position would put it.
   *
   * Stated by whoever wrote the bill and frozen on it, so this reads a value
   * rather than forming a judgement — which is what keeps the card and the roll
   * call in step, since `rollCall` reads the same field. The intensity is taken
   * from how far the bloc has had to travel: a caucus voting against its own
   * politics is not doing it quietly.
   */
  const broke = defectionOn(bill, faction.id);
  if (broke) {
    const distance = Math.abs(fit - 0.76);
    return {
      id: faction.id,
      name: faction.name,
      position: broke.position,
      fit: round1(fit),
      intensity: clamp(Math.round((0.14 + distance) * 240 * (0.6 + faction.discipline)), 25, 100),
      discipline: faction.discipline,
      defected: true,
      reason: broke.because
        || `${faction.name} has broken with its own position on this one.`,
    };
  }

  const position = fit >= 0.76 ? "yes" : "no";
  // Discipline sharpens the demand rather than moving it.
  const intensity = clamp(Math.round(Math.abs(fit - 0.76) * 240 * (0.6 + faction.discipline)), 5, 100);

  return {
    id: faction.id,
    name: faction.name,
    position,
    fit: round1(fit),
    intensity,
    discipline: faction.discipline,
    reason: position === "yes"
      ? `${faction.name} is whipping for it.`
      : `${faction.name} has decided this is the hill.`,
  };
}

/**
 * What defying your own bloc costs.
 *
 * Steeper than crossing party leadership, and deliberately so. A caucus of two
 * hundred forgives a defection because it has a hundred and ninety-nine other
 * members; a bloc of forty organised around a shared conviction does not, and
 * the whole reason it can hold a Speaker to ransom is that it does not.
 */
export const BLOC_SWING = 9;

export function blocDelta(faction, vote) {
  if (!faction) return 0;
  const heat = faction.intensity / 100;
  if (vote === "abstain") return -round1(heat * 3);
  return vote === faction.position
    ? round1(heat * BLOC_SWING * 0.45)
    : -round1(heat * BLOC_SWING);
}

/** A line worth reading when you have just crossed them. */
export function describeBloc(faction, vote, delta) {
  if (!faction || delta >= 0) return null;
  if (vote === "abstain") {
    return `You ducked a vote ${faction.name} was counting. They noticed which way you did not go.`;
  }
  return faction.intensity > 60
    ? `${faction.name} whipped this hard and you broke it. That is the kind of thing a bloc remembers at the next leadership election.`
    : `You went against ${faction.name}. Not a rupture, but it is on the board.`;
}

/** A career starts as a member in reasonable standing with its own wing. */
export const BLOC_START = 62;
