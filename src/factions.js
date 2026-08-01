import { clamp, round1 } from "./rng.js";
import { buildCongress } from "../public/js/data/government.js";
import { STATES } from "./states.js";
import { findIdeology } from "../public/js/data/ideologies.js";
import { stanceFit } from "./bills.js";

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

/**
 * The organised blocs, by party and by where on the spectrum they sit.
 *
 * Membership is drawn from an axis band rather than a hand-written roll, so an
 * ideology added later lands in the right caucus without anybody remembering to
 * file it. `overrides` catches the ones whose politics do not follow from their
 * position — a Religious Left member is economically left and culturally at home
 * with the faith bloc, which no axis band can express.
 */
export const FACTIONS = [
  // --- Democratic ----------------------------------------------------------
  {
    id: "progressive", party: "Democrat", name: "The Progressive Caucus",
    band: [-1, -0.52], discipline: 0.78,
    // Anti-war, anti-surveillance, and the reliable left half of every civil-liberties coalition.
    liberty: 0.55,
    creed: "Movement politics. Would rather lose a vote than water a bill down, and says so on television.",
  },
  {
    id: "labor_caucus", party: "Democrat", name: "The Labor Caucus",
    band: [-0.52, -0.38], discipline: 0.72,
    // Institutionalist. Wants the state strong enough to hold an employer to account.
    liberty: -0.1,
    creed: "Organised labour's own bloc. Economically hard, culturally cautious, and unmoved by anything that costs a union job.",
  },
  {
    id: "new_democrat", party: "Democrat", name: "The New Democrat Coalition",
    band: [-0.38, -0.2], discipline: 0.6,
    // The governing wing defends the security state, because governing it is the job.
    liberty: -0.35,
    creed: "The governing wing. Believes in markets, institutions and winning, roughly in that order.",
  },
  {
    id: "blue_dog", party: "Democrat", name: "The Blue Dog Coalition",
    band: [-0.2, 0], discipline: 0.55,
    // Law-and-order Democrats from seats that vote for sheriffs.
    liberty: -0.5,
    creed: "Members from seats their party should not hold. Vote with the other side often enough to keep them.",
  },

  // --- Republican ----------------------------------------------------------
  {
    id: "main_street", party: "Republican", name: "The Main Street Partnership",
    band: [0, 0.34], discipline: 0.55,
    // Governing conservatives. Votes to reauthorise whatever the agencies ask for.
    liberty: -0.3,
    creed: "Governing conservatives from suburbs that will not tolerate a shutdown. The bloc leadership counts on and the base distrusts.",
  },
  {
    id: "study_committee", party: "Republican", name: "The Republican Study Committee",
    band: [0.34, 0.55], discipline: 0.62,
    // Split down the middle on it, which is what being the party's centre of gravity means.
    liberty: 0.05,
    creed: "The party's centre of gravity. Large, orthodox, and rarely the problem.",
  },
  {
    id: "liberty", party: "Republican", name: "The Liberty Caucus",
    band: [0.55, 0.72], discipline: 0.7,
    // The whole point of the bloc.
    liberty: 0.9,
    creed: "Doctrinaire on spending and on the Constitution. Will vote against its own leadership's budget on principle and enjoy it.",
  },
  {
    id: "freedom", party: "Republican", name: "The Freedom Caucus",
    band: [0.72, 1], discipline: 0.85,
    // Organised against federal power as much as against the left. The other half of every warrant-requirement coalition.
    liberty: 0.75,
    creed: "Organised to say no. Small enough to fit in a room, disciplined enough to deny the Speaker a majority, and entirely willing to.",
  },
];

/**
 * Ideologies whose caucus does not follow from their position on the spectrum.
 *
 * These are the cross-pressured cases every real legislature has, and the axis
 * band cannot see them: a Religious Left member votes with the left on money and
 * sits with the faith bloc on everything else.
 */
const OVERRIDES = {
  "Religious Left": "labor_caucus",
  "Civil Libertarian": "new_democrat",
  "Anti-Monopoly Populist": "labor_caucus",
  "Abundance Democrat": "new_democrat",
  "Rockefeller Republican": "main_street",
  "Techno-Libertarian": "liberty",
  "Libertarian Conservative": "liberty",
  "Paleoconservative": "freedom",
  "Nativist": "freedom",
  "Neoconservative": "study_committee",
  /**
   * Found by the liberty axis rather than by hand.
   *
   * At 0.6 this sits inside the Liberty Caucus band, and on money that is right
   * — but the Liberty Caucus is organised around the Constitution and this is
   * the politics of mandatory minimums and federal police grants. Seating them
   * together made the bloc's own line meaningless on exactly the votes the bloc
   * exists for. The axis could not see it; the second one cannot miss it.
   */
  "Law & Order Conservative": "study_committee",
};

export const factionById = (id) => FACTIONS.find((f) => f.id === id) || null;

/**
 * Which bloc an ideology sits with.
 *
 * Independents have no caucus of their own — they are seated with whichever
 * party's bloc is nearest their politics, which is the same compromise the game
 * already makes for their committee assignments and for exactly the same
 * reason: a caucus is where the seats and the schedule come from, not a
 * statement of belief.
 */
export function factionFor(party, ideology) {
  if (OVERRIDES[ideology]) return factionById(OVERRIDES[ideology]);
  const found = findIdeology(party, ideology);
  const axis = found?.axis;
  if (axis == null) return null;

  const side = party === "Democrat" || party === "Republican" ? party : (axis < 0 ? "Democrat" : "Republican");
  const within = FACTIONS.filter((f) => f.party === side);
  return within.find((f) => axis >= f.band[0] && axis < f.band[1])
    || (axis < 0 ? within[0] : within[within.length - 1])
    || null;
}

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
