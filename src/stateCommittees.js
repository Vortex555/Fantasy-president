import { seeded, clamp, round1 } from "./rng.js";
import { chamberFor } from "./statehouse.js";

/**
 * Where a state bill actually dies.
 *
 * In Congress a committee is a filter and a platform. In a state legislature it
 * is an execution chamber: most bills introduced in most states never get a
 * hearing at all, and never getting a hearing is not a defeat that appears
 * anywhere. There is no roll call, no recorded position, no press release. The
 * chair simply does not schedule it, the session ends, and the bill is dead
 * with nobody's name on the killing.
 *
 * That is the mechanic worth building and it is nothing like the congressional
 * one. The committee stage in this mode is not "can I amend this" — it is
 * "does this get heard at all", answered by one person, in private, for
 * reasons that never have to be given.
 *
 * The other difference is arithmetic. A state chamber of a hundred has perhaps
 * a dozen committees, so members sit on three or four of them and a
 * backbencher is genuinely in the room for a third of everything the
 * legislature does — far more of the institution than a congressman ever
 * touches.
 */

/**
 * The rooms a state legislature actually has.
 *
 * Fewer and broader than Congress's, which is how small chambers work: one
 * committee covers what four would in Washington. Appropriations is first
 * because in a state that must balance its budget, the committee that writes
 * the number is not one among equals.
 */
export const STATE_COMMITTEES = [
  { id: "st_approps", name: "Appropriations", prestige: 5, domains: ["economy", "health", "social", "security", "justice"],
    remit: "The budget, and therefore everything. In a state that cannot borrow, this room decides what the others may want." },
  { id: "st_ways", name: "Ways and Means", prestige: 5, domains: ["economy"],
    remit: "Taxes and revenue. Every proposal to cut one ends up here, and most of them end here." },
  { id: "st_judiciary", name: "Judiciary", prestige: 4, domains: ["justice"],
    remit: "Crime, sentencing, the courts, and every social question the state fights about." },
  { id: "st_education", name: "Education", prestige: 4, domains: ["social"],
    remit: "Schools, curricula, teacher pay and the university system. The largest line in most state budgets." },
  { id: "st_health", name: "Health and Human Services", prestige: 4, domains: ["health"],
    remit: "Medicaid, hospitals, licensing and the safety net. The second largest line, and growing." },
  { id: "st_commerce", name: "Commerce and Labor", prestige: 3, domains: ["economy"],
    remit: "Business regulation, occupational licensing, workers' compensation and the minimum wage." },
  { id: "st_transport", name: "Transportation", prestige: 3, domains: ["economy"],
    remit: "Roads, bridges and the formula that decides which county gets resurfaced." },
  { id: "st_natural", name: "Agriculture and Natural Resources", prestige: 2, domains: ["health", "economy"],
    remit: "Farms, water, extraction and land. Unglamorous, and in half the states the most powerful room in the building." },
  { id: "st_local", name: "Local Government", prestige: 2, domains: ["social", "justice"],
    remit: "Counties, municipalities and what they are allowed to decide for themselves." },
  { id: "st_rules", name: "Rules", prestige: 5, domains: ["economy", "health", "social", "security", "justice"],
    remit: "The Speaker's room. Nothing reaches the floor without a rule, and the rule is written here." },
];

export const stateCommitteeById = (id) => STATE_COMMITTEES.find((c) => c.id === id) || null;

/**
 * The committee a bill is referred to.
 *
 * By subject, and by money first: anything that costs a state more than a
 * token amount goes to Appropriations whatever else it is about, because a
 * chamber that must balance its budget refers on the number before the topic.
 */
export function referral(bill) {
  if (Math.abs(Number(bill?.cost) || 0) >= 25) return stateCommitteeById("st_approps");
  const domain = bill?.domain || "economy";
  return STATE_COMMITTEES.find((c) => c.id !== "st_rules" && c.id !== "st_approps"
    && c.domains.includes(domain))
    || stateCommitteeById("st_local");
}

// --- Where you sit -------------------------------------------------------------

/**
 * Three or four rooms, not one.
 *
 * A congressman sits on one committee that matters and lives in it. A state
 * legislator sits on three or four because the chamber is small and the work is
 * not, which means a backbencher is genuinely in the room for a large share of
 * everything the legislature does — and it is the reason state legislators know
 * so much more about so many more subjects than members of Congress do.
 */
export function assignSeats(state) {
  const chamber = chamberFor(state.seat?.state);
  const r = seeded(`${state.rosterSeed || "seat"}|statecommittees`);
  const standing = state.leadership ?? 50;
  const seniority = state.seat?.seniority || 1;

  // A big chamber spreads the work thinner; New Hampshire's four hundred
  // members are not each on four committees.
  const count = chamber.seats > 180 ? 2 : chamber.seats > 90 ? 3 : 4;
  const earned = 1 + Math.min(4, Math.floor((standing - 30) / 20) + Math.floor(seniority / 2));

  const pool = STATE_COMMITTEES.filter((c) => c.id !== "st_rules" && c.prestige <= earned);
  const table = pool.length >= count ? pool
    : STATE_COMMITTEES.filter((c) => c.id !== "st_rules" && c.prestige <= 3);

  const out = [];
  const left = [...table];
  for (let i = 0; i < count && left.length; i += 1) {
    out.push(left.splice(Math.floor(r.next() * left.length), 1)[0].id);
  }
  return out;
}

/**
 * Whether you run one of them, which in a state legislature is not a matter of
 * seniority.
 *
 * Congressional chairs were handed out by years served for most of a century.
 * State house chairs are appointed by the Speaker, personally, and are removed
 * the same way — which makes a chairmanship a statement about your standing
 * with leadership and nothing else at all.
 */
export function chairOf(state) {
  const seats = state.committees || [];
  if (!seats.length) return null;
  const standing = state.leadership ?? 50;
  const seniority = state.seat?.seniority || 1;
  if (standing < 62 || seniority < 2) return null;

  const r = seeded(`${state.rosterSeed || "seat"}|statechair|${state.term || 1}`);
  // The better your standing, the better the room you are given.
  const ranked = seats
    .map((id) => stateCommitteeById(id))
    .filter(Boolean)
    .sort((a, b) => b.prestige - a.prestige);
  const reach = standing >= 82 ? 0 : standing >= 72 ? Math.min(1, ranked.length - 1) : ranked.length - 1;
  return ranked[Math.min(reach, ranked.length - 1)]?.id || null;
}

// --- The drawer ----------------------------------------------------------------

/**
 * Whether a bill is heard at all.
 *
 * The most consequential and least visible thing that happens to state
 * legislation. Most bills introduced in most states die here, and dying here
 * means no hearing, no vote, no record and no explanation — the chair does not
 * schedule it, the session ends, and that is the whole of it.
 *
 * The odds are deliberately bleak, because they are bleak. What moves them is
 * whether the bill has real backing, whether it costs money the state does not
 * have, and whether the member sits in the room at all.
 */
export function hearingOdds(state, bill) {
  const committee = referral(bill);
  const seats = state.committees || [];
  const mine = seats.includes(committee.id);
  const chair = chairOf(state) === committee.id;

  let odds = 0.34;
  if (mine) odds += 0.16;                                  // you are in the room
  if (chair) odds += 0.3;                                   // you decide
  if (bill.support === "bipartisan" || bill.support === "unanimous") odds += 0.2;
  // A chamber that must balance is hardest on the bills that cost it money.
  const cost = Number(bill.cost) || 0;
  if (cost > 40) odds -= 0.15;
  if (cost > 0 && (state.budget ?? 0) < 0) odds -= 0.12;
  if (cost < 0) odds += 0.06;

  return {
    committee,
    mine,
    chair,
    odds: clamp(round1(odds * 100) / 100, 0.05, 0.95),
  };
}

/**
 * The committee stage, resolved.
 *
 * A bill either gets a hearing and reaches the floor, or it does not and is
 * never heard of again. The player's own committee is where they have a say;
 * everywhere else this happens to them, which is the honest proportion.
 */
export function throughCommittee(state, bills) {
  const r = seeded(`${state.rosterSeed || "seat"}|hearings|${state.term || 1}|${state.month}`);
  const heard = [];
  const buried = [];

  for (const bill of bills) {
    const read = hearingOdds(state, bill);
    /**
     * A chair does not roll dice on their own committee's bills — they decide.
     * So anything in the player's own room is held for them rather than
     * resolved, and everything else is settled without them, as it is.
     */
    if (read.chair) {
      heard.push({ ...bill, yours: true, committee: read.committee.id, awaiting: true });
      continue;
    }
    if (r.next() < read.odds) heard.push({ ...bill, committee: read.committee.id, inRoom: read.mine });
    else buried.push({ ...bill, committee: read.committee.id, inRoom: read.mine });
  }
  return { heard, buried };
}

/**
 * The chair's own decision, which is the whole of the power.
 *
 * There is no roll call and no record. Giving a bill a hearing spends nothing
 * and puts it on the floor; putting it in the drawer costs you with whoever
 * wanted it and costs you nothing anywhere else, which is exactly why the
 * drawer is used as much as it is.
 */
export function chairDecision(next, bill, hear) {
  const committee = stateCommitteeById(bill.committee);
  if (chairOf(next) !== bill.committee) {
    return { rejected: true, note: "It is not your committee." };
  }

  next.committeeLog = [...(next.committeeLog || []), {
    month: next.month, term: next.term || 1,
    id: bill.id, title: bill.title, action: hear ? "heard" : "drawer",
  }].slice(-20);

  if (hear) {
    return {
      heard: true,
      note: `You gave it a hearing. ${committee?.name || "The committee"} reports it to the floor.`,
    };
  }

  /**
   * Whoever wanted it knows exactly who did this. It costs standing with the
   * caucus when the caucus wanted it — and nothing at all when they did not,
   * which is the reason a Speaker hands out chairmanships.
   */
  const wanted = Math.sign(Number(bill.axis) || 0)
    === (next.caucus === "Republican" ? 1 : -1);
  if (wanted) next.leadership = clamp(round1((next.leadership ?? 50) - 3));

  return {
    heard: false,
    note: "You did not schedule it. There is no vote, no record and no explanation, "
      + "and by the end of the session it will be as though it was never filed"
      + (wanted ? " — though the people who wanted it know precisely whose drawer it is in." : "."),
  };
}
