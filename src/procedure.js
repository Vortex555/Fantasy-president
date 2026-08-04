import { clamp, round1, seeded } from "./rng.js";
import { STATES } from "./states.js";
import { buildCongress } from "../public/js/data/government.js";
import { BILL_POOL, rollCall, consensusOf, scheduledBill } from "./bills.js";
import { ownBloc, factionOf } from "./factions.js";
import { factionById } from "../public/js/data/factions.js";

/**
 * What a member does when they cannot get a vote.
 *
 * The mode gave a backbencher one verb. Burying a bill needs a chair, amending
 * one needs a subchair, the whip count needs a whip — and the calendar itself
 * belongs entirely to leadership, so a member who disagreed with what was being
 * scheduled could do precisely nothing about what was being scheduled.
 *
 * A discharge petition is the real answer and needs no rank at all: two hundred
 * and eighteen signatures drag a bill out of a committee that will not report it
 * and onto the floor, over the objection of the people who decide what the floor
 * is. It is rare because it is expensive — signing one is a public act of
 * defiance against your own leadership, which is why members who would happily
 * *vote* for a bill will not put their name on the paper that forces it — and it
 * is the only tool in the building a first-term member can use to set an agenda.
 *
 * The two numbers that make it a decision rather than a formality are the
 * ceiling and the drag. The ceiling is how many would ever sign, which is far
 * below how many would vote yes; if it sits under the line, no amount of
 * patience gets there and only favours will. The drag is what it costs you with
 * leadership every month it is live.
 */

/** A majority of the room you are actually standing in. */
export const DISCHARGE_THRESHOLD = (state) =>
  (state?.office === "senate" ? 51 : 218);

/** Filing one at all costs banked favours, and the whole term's goodwill. */
export const PETITION_COST = 6;
export const PETITION_LAUNCH_DRAG = 7;

/** And it keeps costing, every month your name is on it. */
export const PETITION_DRAG = 2;

/**
 * How much of the chamber's genuine support converts into a signature.
 *
 * The minority signs readily — forcing a vote the majority does not want is free
 * politics for them. The majority mostly does not, whatever it thinks of the
 * bill, because the paper is public and their leadership can read. That gap is
 * the entire reason discharge petitions almost never succeed in life, and it is
 * what stops this from being a button that reschedules the game.
 */
const MINORITY_WILLING = 0.82;
const MAJORITY_WILLING = 0.14;

/** What a favour buys in signatures, with the usual diminishing returns. */
const favourPush = (favours) =>
  (favours > 0 ? Math.floor(Math.sqrt(favours) * 9) : 0);

/** How fast the willing actually sign, per month. */
const SIGNING_RATE = 0.38;

const chamberOf = (state) => (state?.office === "senate" ? "senate" : "house");
const majorityParty = (state) => {
  const c = state?.congress || {};
  return chamberOf(state) === "senate"
    ? (c.senateR > c.senateD ? "Republican" : "Democrat")
    : (c.houseR > c.houseD ? "Republican" : "Democrat");
};

/**
 * Bills that exist, that the chamber would pass, and that leadership will not
 * bring to the floor.
 *
 * That combination is exactly what a discharge petition is for, and it falls out
 * of two calculations the engine already does rather than needing a new list: a
 * roll call says the votes are there, and the majority anchor says its
 * leadership does not want them cast. A bill leadership likes needs no petition,
 * and a bill the chamber would reject cannot be rescued by one.
 */
export function shelvedBills(state) {
  const roster = buildCongress(state, STATES)[chamberOf(state)] || [];
  if (!roster.length) return [];

  const seen = new Set([
    ...(state.voteLog || []).map((v) => v.id),
    ...(state.discharged || []),
    ...(state.committeeLog || []).filter((e) => e.action === "buried").map((e) => e.id),
  ]);

  const out = [];
  for (const source of BILL_POOL) {
    if (seen.has(source.id) || source.fringe) continue;
    const bill = scheduledBill(source);
    const call = rollCall(roster, bill, { consensus: consensusOf(bill) });
    if (!call.passed) continue;

    /**
     * The bill has to pass *without* the majority's own members carrying it.
     *
     * The first cut asked whether leadership liked the bill, measured against
     * its party anchor, and that is the wrong question twice over: consensus
     * inflates the anchor's fit so every bipartisan bill read as one leadership
     * wanted, and a chamber whose majority matches its leadership almost never
     * passes something that leadership dislikes. The shelf came back with one
     * bill on it.
     *
     * The real target is the bill that has the floor votes and cannot get the
     * room: a coalition of the whole minority plus a slice of the majority,
     * which the majority's leadership will not schedule precisely because most
     * of its own members are against it. That is what every discharge petition
     * in living memory has actually been about.
     */
    const own = majorityParty(state) === "Democrat" ? call.dYes : call.rYes;
    const ownSeats = roster.filter((m) => m.party === majorityParty(state)).length;
    const leadershipWants = own > ownSeats * 0.5;
    if (leadershipWants) continue;
    out.push({ ...bill, wouldPass: true, leadershipWants: false, yes: call.yes, ownYes: own });
  }

  // Stable within a term, because a shelf is not a docket: the same bills sit
  // there month after month until somebody moves one.
  const r = seeded(`${state.rosterSeed}|shelf|${state.term || 1}`);
  return out
    .map((b) => ({ b, k: r.next() }))
    .sort((x, y) => x.k - y.k)
    .slice(0, 4)
    .map((x) => x.b);
}

/**
 * The most signatures this bill could ever collect, and the votes it would get
 * if it ever reached the floor.
 *
 * The gap between the two is the mechanic. A bill with 240 votes on the floor
 * might have 190 signatures available, and 190 is not 218 — so the last thirty
 * come out of your own standing or they do not come at all.
 */
export function petitionCeiling(state, bill) {
  const roster = buildCongress(state, STATES)[chamberOf(state)] || [];
  const call = rollCall(roster, bill, { consensus: consensusOf(bill) });
  const majority = majorityParty(state);

  const minorityYes = majority === "Democrat" ? call.rYes : call.dYes;
  const majorityYes = majority === "Democrat" ? call.dYes : call.rYes;
  const ceiling = Math.round(minorityYes * MINORITY_WILLING + majorityYes * MAJORITY_WILLING);

  return { ceiling, wouldVoteYes: call.yes, minorityYes, majorityYes };
}

/** Put your name on it first, which is the part that costs. */
export function launchPetition(state, billId, favours = 0) {
  if (state.petition) {
    return { rejected: true, note: "You are already carrying one. A member has the standing to force the floor once at a time." };
  }
  const bill = shelvedBills(state).find((b) => b.id === billId);
  if (!bill) return { rejected: true, note: "Nothing by that name is sitting in committee." };

  const spend = Math.max(0, Math.min(Number(favours) || 0, (state.capital ?? 0) - PETITION_COST));
  if ((state.capital ?? 0) < PETITION_COST) {
    return { rejected: true, note: `Filing costs ${PETITION_COST} favours and you do not have them. Nobody signs first for a member who is owed nothing.` };
  }

  const { ceiling } = petitionCeiling(state, bill);
  const opening = Math.round(ceiling * 0.35) + favourPush(spend);

  return {
    state: {
      ...state,
      capital: round1(Math.max(0, (state.capital ?? 0) - PETITION_COST - spend)),
      leadership: clamp(round1(state.leadership - PETITION_LAUNCH_DRAG)),
      petition: {
        billId: bill.id,
        title: bill.title,
        signatures: opening,
        needed: DISCHARGE_THRESHOLD(state),
        ceiling,
        spent: spend,
        launched: state.month,
      },
    },
    note: `You filed to discharge the ${bill.title}. ${opening} names by the end of the day, `
      + `and leadership had the list before you did.`,
  };
}

/** Call in favours to move names that leadership is sitting on. */
export function signPetition(state, favours) {
  if (!state.petition) return { rejected: true, note: "There is no petition running." };
  const spend = Math.max(0, Math.min(Number(favours) || 0, state.capital ?? 0));
  if (spend < 1) return { rejected: true, note: "That buys nobody." };

  /**
   * Diminishing returns across the whole petition, not per payment.
   *
   * Measured against the total spent so far, because `favourPush` is concave and
   * charging it per call made nibbling strictly better than committing: two
   * spends of twenty-five bought ninety names where one of fifty bought
   * sixty-three. The first cut capped the result to hide that, which stopped the
   * exploit and left the number arbitrary. This is the honest version — the
   * tenth favour called in is worth less than the first because it is the tenth,
   * whichever afternoon you make the call.
   */
  const before = state.petition.spent || 0;
  const gained = favourPush(before + spend) - favourPush(before);

  return {
    state: {
      ...state,
      capital: round1(Math.max(0, (state.capital ?? 0) - spend)),
      petition: {
        ...state.petition,
        spent: before + spend,
        signatures: state.petition.signatures + gained,
      },
    },
    note: gained > 0
      ? `${gained} more names. You are owed less than you were this morning.`
      : `Nothing moved. You have already called everyone who owes you on this one.`,
  };
}

/**
 * A month passes with your name on it.
 *
 * Signatures approach the ceiling and stop, which is the whole point: a petition
 * that stalls at a hundred and ninety has not failed slowly, it has failed, and
 * the only way past is favours. Meanwhile it costs you with leadership every
 * month it is live, so waiting is never free.
 */
export function advancePetition(state) {
  if (!state.petition) return { state, discharged: null, note: null };

  const p = state.petition;
  if (p.signatures >= p.needed) {
    return {
      state: {
        ...state,
        petition: null,
        discharged: [...(state.discharged || []), p.billId],
      },
      discharged: { id: p.billId, title: p.title },
      note: `The ${p.title} has the signatures. It goes to the floor whether leadership `
        + `schedules it or not, and everybody knows whose name is at the top of the paper.`,
    };
  }

  const room = Math.max(0, p.ceiling - p.signatures);
  const gained = Math.round(room * SIGNING_RATE);
  const signatures = p.signatures + gained;

  return {
    state: {
      ...state,
      leadership: clamp(round1(state.leadership - PETITION_DRAG)),
      petition: { ...p, signatures },
    },
    discharged: null,
    note: gained > 0
      ? `${gained} more signed the discharge petition. ${signatures} of ${p.needed}.`
      : `Nobody else signed. It is stuck at ${signatures} of ${p.needed}, and everyone `
        + `who was ever going to sign already has.`,
  };
}

// ---------------------------------------------------------------------------
// Removing the Speaker
// ---------------------------------------------------------------------------

/**
 * What denying a majority actually buys.
 *
 * A bloc's power in this mode was entirely negative and entirely invisible.
 * `canDenyMajority` said whether your caucus could withhold enough votes to sink
 * a bill leadership wanted, and there was nowhere to spend that — no lever
 * anywhere turned "we could stop you" into "so give us something". The motion to
 * vacate is that lever: the one move in the building where a faction of thirty
 * decides who runs a chamber of four hundred and thirty-five.
 *
 * It stopped being theoretical in October 2023, and the arithmetic of that day
 * is the arithmetic here. The minority votes for the chaos almost to a member —
 * removing the other party's Speaker is free politics — and the last twenty-odd
 * names come off your own side. You cannot do it alone, and you cannot do it
 * without the people who spend every other day opposing you.
 */

/** Filing it costs banked favours, and the motion is privileged whatever happens. */
export const VACATE_COST = 10;

/** What it does to your standing with the people you just tried to remove. */
export const VACATE_DRAG = 18;
export const VACATE_LOSS_DRAG = 34;

/** And what your own wing makes of a member willing to do it. */
export const VACATE_BLOC_GAIN = 16;

/** How long a chamber sits without a Speaker. Three weeks in 2023; three months here. */
export const VACANCY_MONTHS = 2;

/** How readily the other party votes to remove a Speaker who is not theirs. */
const MINORITY_APPETITE = 0.93;

/**
 * Which of your own side would vote to vacate.
 *
 * Distance from the party's own anchor, because the members who move against a
 * Speaker are the ones who were never at home under them. Favours move this and
 * nothing else — the minority needs no persuading and cannot be persuaded of
 * anything else.
 */
/**
 * Who moves against a Speaker: the organised flanks, marked on the caucuses
 * themselves.
 *
 * Two earlier cuts measured distance from the party anchor and both were wrong.
 * The mainstream Republican bench runs 0.1 to 0.7 around an anchor of 0.45, so a
 * wide threshold found five restive members in a chamber of 222 and a narrow one
 * found everybody. Worse, the members it found were *moderates* — the bench is
 * skewed, so distance-from-centre caught Rockefeller Republicans and missed the
 * Freedom Caucus entirely, and a Main Street member came out whipping a
 * rebellion better than the people who organise them.
 *
 * A caucus organised to defy its own leadership is a fact about the caucus, so
 * it is written on the caucus. See `restive` in factions.js.
 */

/**
 * How much of a restive caucus actually goes.
 *
 * Not most of it. In October 2023 eight Republicans voted to vacate out of a
 * Freedom Caucus several times that size — moving against your own Speaker is a
 * thing a handful of people do while the rest of their caucus watches. Counting
 * the restive blocs wholesale made the motion carry unaided from any starting
 * position, which is the opposite of what it should feel like.
 *
 * You get more of your own room than of somebody else's, because you are in it.
 */
const YOUR_BLOC_RATE = 0.22;
const OTHER_RESTIVE_RATE = 0.1;

export function vacateCount(state, favours = 0) {
  const roster = buildCongress(state, STATES)[chamberOf(state)] || [];
  const mine = state.caucus || state.scenario?.party;

  /**
   * Your own bloc moves for one of its own.
   *
   * Without this the count came out identical whoever filed it, which makes the
   * ideology chosen at creation irrelevant on the one motion it should matter
   * most for. A member of the caucus that organised the rebellion can whip it;
   * somebody from the party's centre of gravity is asking strangers.
   */
  const myBloc = factionOf(state.scenario)?.id || null;

  let minorityYes = 0;
  let rebels = 0;
  for (const m of roster) {
    if (m.party !== mine) {
      minorityYes += 1;
      continue;
    }
    if (!factionById(m.faction)?.restive) continue;
    rebels += (myBloc && m.faction === myBloc) ? YOUR_BLOC_RATE : OTHER_RESTIVE_RATE;
  }
  minorityYes = Math.round(minorityYes * MINORITY_APPETITE);
  rebels += favourPush(Math.max(0, Number(favours) || 0)) / 4;

  const yes = Math.round(minorityYes + rebels);
  const threshold = Math.floor(roster.length / 2) + 1;
  return {
    yes, no: roster.length - yes, threshold, passes: yes >= threshold,
    minorityYes, rebels: Math.round(rebels), total: roster.length,
  };
}

/** Move it, and live with the count. */
export function moveToVacate(state, favours = 0) {
  const c = state.congress || {};
  const mine = state.caucus || state.scenario?.party;
  const holdsChair = chamberOf(state) === "senate"
    ? (mine === "Republican" ? c.senateR > c.senateD : c.senateD > c.senateR)
    : (mine === "Republican" ? c.houseR > c.houseD : c.houseD > c.houseR);

  if (!holdsChair) {
    return { rejected: true, note: "The chair belongs to the other party. Moving to vacate it is their fight, not yours." };
  }
  if (state.vacancy) return { rejected: true, note: "There is no Speaker to remove." };
  if ((state.capital ?? 0) < VACATE_COST) {
    return { rejected: true, note: `A privileged motion costs ${VACATE_COST} favours to get anybody to second. You are owed too little.` };
  }

  const spend = Math.max(0, Math.min(Number(favours) || 0, (state.capital ?? 0) - VACATE_COST));
  const count = vacateCount(state, spend);
  const bloc = clamp(round1((state.bloc ?? 62) + VACATE_BLOC_GAIN));

  if (!count.passes) {
    return {
      state: {
        ...state,
        capital: round1(Math.max(0, (state.capital ?? 0) - VACATE_COST - spend)),
        leadership: clamp(round1(state.leadership - VACATE_LOSS_DRAG)),
        bloc: clamp(round1((state.bloc ?? 62) + VACATE_BLOC_GAIN * 0.4)),
      },
      passed: false, count,
      note: `The motion failed, ${count.yes} to ${count.no}. The Speaker survives, knows exactly `
        + `who moved it, and has four hundred and thirty-four other people to be generous to.`,
    };
  }

  return {
    state: {
      ...state,
      capital: round1(Math.max(0, (state.capital ?? 0) - VACATE_COST - spend)),
      leadership: clamp(round1(state.leadership - VACATE_DRAG)),
      bloc,
      vacancy: VACANCY_MONTHS,
    },
    passed: true, count,
    note: `The chair is vacant, ${count.yes} to ${count.no}. Nothing is scheduled and nothing `
      + `can be until somebody can hold a majority, which is now a question rather than a fact.`,
  };
}

/**
 * A month of no Speaker, and what the chamber looks like when it finds one.
 *
 * The paralysis is the cost — no calendar, no votes, no favours earned — and the
 * payoff is who ends up holding the gavel. Whoever it is got there by being
 * acceptable to the people who removed the last one, so a member from a bloc
 * large enough to do it again starts the new regime on far better terms than
 * they ended the old one.
 */
export function resolveVacancy(state) {
  if (!state.vacancy) return { state, note: null };

  const left = state.vacancy - 1;
  if (left > 0) {
    return {
      state: { ...state, vacancy: left },
      note: `Another month with no Speaker. Nothing is scheduled, nothing is voted on, `
        + `and every member is being asked daily who they could live with.`,
    };
  }

  const bloc = ownBloc(state);
  const leverage = bloc?.canDenyMajority ? 22 : 8;
  return {
    state: {
      ...state,
      vacancy: 0,
      leadership: clamp(round1(state.leadership + leverage)),
    },
    note: `The chamber has a Speaker again. They got there by being somebody your wing `
      + `could live with, and they know it — which is worth more to you than the last one `
      + `ever was.`,
  };
}
