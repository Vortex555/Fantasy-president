import { findIdeology } from "./ideologies.js";

/**
 * Which bloc each politics sits in.
 *
 * Lifted out of src/factions.js into a leaf module of its own, for the reason
 * stakeholders.js was: the roll call has to know which faction each member
 * belongs to before it can honour a bloc breaking ranks, and factions.js
 * already imports government.js to count the chamber. Reaching the other way as
 * well would close an import cycle. Membership is data and a lookup with no
 * dependencies beyond the ideology table, so it cannot participate in one.
 *
 * Everything that needs the chamber — how big a bloc is, where it stands on a
 * bill, what defying it costs — stays in src/factions.js.
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
    band: [0.34, 0.58], discipline: 0.62,
    // Split down the middle on it, which is what being the party's centre of gravity means.
    liberty: 0.05,
    creed: "The party's centre of gravity. Large, orthodox, and rarely the problem.",
  },
  {
    id: "liberty", party: "Republican", name: "The Liberty Caucus",
    /**
     * Empty by design: this bloc is populated entirely through `OVERRIDES`.
     *
     * It is the one faction that cannot be described by a stretch of the
     * economic axis, because what its members share is the *other* dimension.
     * A Techno-Libertarian at 0.35 and a Constitutionalist at 0.7 sit a third of
     * the spectrum apart on money and next to each other on state power, and any
     * band wide enough to hold both swallows half the caucus with it. Naming
     * them is honest; the band was not.
     */
    band: [0.58, 0.58], discipline: 0.7,
    // The whole point of the bloc.
    liberty: 0.9,
    creed: "Doctrinaire on spending and on the Constitution. Will vote against its own leadership's budget on principle and enjoy it.",
  },
  {
    id: "freedom", party: "Republican", name: "The Freedom Caucus",
    /**
     * Was [0.72, 1], which no mainstream ideology could reach — the bench tops
     * out at 0.7 — so outside a radicalised chamber the bloc was populated by a
     * single override and stood at seven seats. The caucus that exists to deny
     * a Speaker his majority could not have denied him anything.
     */
    band: [0.58, 1], discipline: 0.85,
    /**
     * Organised against federal power as much as against the left, and the
     * other half of every warrant-requirement coalition.
     *
     * Deliberately above where its own roster averages. A caucus's whipped line
     * is not the mean of its members' dispositions — this one organises around
     * distrust of federal agencies specifically, which is why it turns out for a
     * warrant requirement that several of its members would not have written.
     */
    liberty: 0.55,
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
  /**
   * The definitional Liberty Caucus politics, and the axis sends it to the
   * hardliners instead. At 0.7 on money it is the furthest-right mainstream
   * ideology in the game; at +0.85 on state power it is the furthest thing from
   * what the Freedom Caucus's other members want.
   */
  "Constitutionalist": "liberty",
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
