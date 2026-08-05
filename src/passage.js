import { buildCongress } from "../public/js/data/government.js";
import { STATES } from "./states.js";
import { rollCall, consensusOf, chamberMedian, ISSUE_AXES } from "./bills.js";
import { applyConsequence, applyMigration } from "./consequence.js";
import { noteEvent, EVENT } from "./chronicle.js";
import { round1 } from "./rng.js";

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * What happens to a bill after it leaves your floor.
 *
 * The mode's oldest and largest lie: a bill that cleared the House became law
 * on the spot. The roll call was the end of the story — the economy moved, the
 * national problem eased, the record said "passed" — and the other five hundred
 * and thirty-four people in the building might as well not have existed. A
 * member could pass a sweeping statute on a party-line vote in a chamber whose
 * Senate was held by the other side, and the country would simply do as it was
 * told.
 *
 * So passage is a pipeline rather than a moment, and this module owns all of
 * it. A bill that clears your chamber is *sent*; it waits in the far chamber,
 * where most legislation quietly ends; what survives goes to a desk that may
 * refuse it; and a refusal comes back to your own floor as the two-thirds vote
 * that is the only answer to a veto.
 *
 * Nothing here decides how the player voted and nothing here is written by the
 * model. Every verdict is a roll call of a real roster, computed by the same
 * engine that runs the player's own chamber — see `rollCall` in bills.js — so
 * a Senate that changes hands at an election starts killing different bills
 * without a line of this changing.
 */

// --- The shape of the wait ---------------------------------------------------

/** Months a stalled bill waits before somebody offers to cut it down. */
const WATER_AFTER = 2;
/** And how long before the far chamber simply moves on. */
const GIVE_UP_AFTER = 4;
/** A veto override is taken up at once or not at all. */
const OVERRIDE_WINDOW = 2;

/** What a bill gutted in conference is worth once it is law. */
const GUTTED_STRENGTH = 0.5;

/**
 * How near a bill has to come to survive the month.
 *
 * A bill four votes short is being negotiated; a bill sixty short is dead and
 * everyone in the room knows it. The line is drawn as a share of the chamber so
 * that it means the same thing in a body of 100 and one of 435.
 */
const NEGOTIABLE = 0.06;

export const farChamberName = (state) => (state.office === "senate" ? "the House" : "the Senate");

/** The roster at the other end of the building. */
function farRoster(state) {
  const roster = buildCongress(state, STATES);
  return state.office === "senate" ? roster.house : roster.senate;
}

/**
 * The bar over there, which is not the same bar as here.
 *
 * The Senate's real threshold is sixty and has been for a generation, and that
 * single number is why most bills that pass the House are never heard of again.
 * It is the whole character of the far chamber for a House member, so it is
 * modelled rather than averaged away — except on the bills nobody filibusters,
 * where the support tier the docket already carries says so outright.
 */
function barFor(state, bill, total) {
  const cloture = state.office !== "senate"
    && bill.support !== "bipartisan" && bill.support !== "unanimous";
  return cloture ? Math.ceil(total * 0.6) : Math.floor(total / 2) + 1;
}

// --- Sending it ---------------------------------------------------------------

/**
 * A bill that carried, on its way out of the room.
 *
 * The record freezes the bill as it left, because that is the version the far
 * chamber is voting on: a bill amended in committee here goes over there
 * amended, and one gutted over there comes back to the record gutted. Whether
 * the player sponsored it is frozen with it, since it is the only thing that
 * decides whether they get to fight for it later.
 */
export function sendOnward(next, bill, { yours = false, vote = null } = {}) {
  const record = {
    key: `${bill.id}|${next.term || 1}|${next.month}`,
    bill: { ...bill },
    stage: "far",
    yours: Boolean(yours),
    vote,
    sentMonth: next.month,
    sentTerm: next.term || 1,
    waited: 0,
    favours: 0,
    bought: 0,
    gutted: false,
    strength: 1,
    note: `Passed the ${next.office === "senate" ? "Senate" : "House"}. It goes to ${farChamberName(next)}.`,
  };
  next.inFlight = [...(next.inFlight || []), record];
  return record;
}

/** What is waiting, for a screen that wants to show it. */
export const inFlight = (state) => (state.inFlight || []).map((r) => ({
  key: r.key,
  title: r.bill.title,
  domain: r.bill.domain || null,
  stage: r.stage,
  yours: r.yours,
  waited: r.waited,
  favours: r.favours,
  gutted: r.gutted,
  note: r.note,
  where: r.stage === "far" ? farChamberName(state)
    : r.stage === "desk" ? "the President's desk"
    : "your own floor",
}));

// --- Working your own bill ----------------------------------------------------

/**
 * Favours spent across the building, on your own legislation and nothing else.
 *
 * A member has no whip over the far chamber and never will. What they have is
 * the same currency they spend here — the debts of people who owe them — and
 * the willingness to spend it on a bill with their name on it. Leadership's
 * bills are leadership's problem; that boundary is what keeps this from
 * becoming a second whip screen in a mode about being acted upon.
 *
 * The price is deliberately steep. A favour buys about a third of a vote over
 * there against about one here, because these are not your colleagues.
 */
export const FAR_PRICE = 3;

export function pushFarChamber(state, key, favours) {
  const spend = Math.max(0, Math.round(Number(favours) || 0));
  const record = (state.inFlight || []).find((r) => r.key === key);

  if (!record) return { state, rejected: true, note: "That bill is not waiting on anybody." };
  if (record.stage !== "far") {
    return { state, rejected: true, note: `The ${farChamberName(state)} is finished with it.` };
  }
  if (!record.yours) {
    return {
      state, rejected: true,
      note: "You have no standing over there on somebody else's bill. Work your own.",
    };
  }
  if (!spend) return { state, rejected: true, note: "Spend something or do not." };
  if ((state.capital ?? 0) < spend) {
    return {
      state, rejected: true,
      note: `You have ${Math.round(state.capital ?? 0)} favours to call in, not ${spend}.`,
    };
  }
  if (spend < FAR_PRICE) {
    return {
      state, rejected: true,
      note: `Nobody in ${farChamberName(state)} owes you anything for ${spend}. `
        + `A vote over there starts at ${FAR_PRICE}.`,
    };
  }

  const next = structuredClone(state);
  const target = next.inFlight.find((r) => r.key === key);
  const bought = Math.floor(spend / FAR_PRICE);
  next.capital = round1(Math.max(0, (next.capital ?? 0) - spend));
  target.favours += spend;
  target.bought += bought;

  return {
    state: next,
    result: {
      bought, spent: spend,
      note: `You spent the week on the phone to ${farChamberName(state)}. `
        + `${bought} member${bought === 1 ? "" : "s"} over there will look at it now — `
        + "which is not the same as voting for it.",
    },
  };
}

// --- The far chamber ----------------------------------------------------------

/**
 * Cut down to something the other chamber would actually take.
 *
 * The same move a committee chair already makes here, pointed the other way:
 * drag the bill a third of the way toward the far chamber's own centre of
 * gravity and take half its force with it. A bill that survives this is law,
 * and it is not the law anybody voted for.
 */
function gut(bill, median) {
  const axis = round1(bill.axis + (median - bill.axis) * 0.34);
  const softened = Object.fromEntries(ISSUE_AXES
    .map((a) => [a.id, round2((Number(bill[a.id]) || 0) * 0.66)])
    .filter(([, v]) => v));

  return {
    ...bill,
    ...softened,
    axis,
    // A gutted bill is a bought bill: the votes it needed came from somewhere.
    support: bill.support === "partyline" ? "contested" : bill.support,
    gutted: true,
  };
}

/**
 * One month of the far chamber's attention, for one bill.
 *
 * Rolled fresh every month rather than decided on the way out, because the
 * things that change the answer all happen after the bill arrives: an election
 * hands the chamber to the other side, a crisis makes a partisan bill
 * bipartisan, the member spends a month on the telephone. A verdict computed
 * once at send would be a verdict that could not hear any of that.
 */
function farVerdict(state, record) {
  const roster = farRoster(state);
  const bill = record.bill;
  const tally = rollCall(roster, bill, { consensus: consensusOf(bill) });
  const need = barFor(state, bill, tally.total);
  const have = tally.yes + record.bought;

  if (have >= need) return { fate: "desk", tally, need, have };

  const shortfall = need - have;
  const negotiable = shortfall <= Math.ceil(tally.total * NEGOTIABLE);

  if (!negotiable) return { fate: "killed", tally, need, have };
  if (record.waited < WATER_AFTER) return { fate: "stalled", tally, need, have };
  if (record.gutted || record.waited >= GIVE_UP_AFTER) return { fate: "killed", tally, need, have };

  // Close enough to be worth cutting down, and it has waited long enough that
  // somebody has offered to.
  const cut = gut(bill, chamberMedian(roster));
  const after = rollCall(roster, cut, { consensus: consensusOf(cut) });
  return after.yes + record.bought >= barFor(state, cut, after.total)
    ? { fate: "gutted", bill: cut, tally: after, need, have: after.yes + record.bought }
    : { fate: "killed", tally, need, have };
}

// --- The desk -----------------------------------------------------------------

/**
 * Whether the President signs it.
 *
 * Not a coin and not a personality: a president signs what is near enough to
 * their own politics and refuses what is not, which is both how it works and
 * the only version of it a player can reason about before they vote. The one
 * exception is the one that matters — a bill that cleared the far chamber with
 * two thirds is going to become law whatever the desk does, and no president
 * spends a veto on a lost argument.
 */
function deskVerdict(state, record, tally) {
  const potus = state.president;
  if (!potus) return { signed: true, reason: "There is nobody at the desk to refuse it." };
  if (tally?.overrode) {
    return {
      signed: true,
      reason: `It cleared ${farChamberName(state)} by two thirds. `
        + `President ${potus.name} signed it rather than lose the veto.`,
    };
  }

  const side = Math.sign(Number(potus.axis) || 0) || 1;
  const near = side * (Number(record.bill.axis) || 0) >= -0.1;
  return near
    ? { signed: true, reason: `President ${potus.name} signed it.` }
    : { signed: false, reason: `President ${potus.name} vetoed it.` };
}

// --- Becoming law -------------------------------------------------------------

/**
 * The only place in the mode where a bill changes the country.
 *
 * It used to be `castVote`, which is what made all of this necessary. The
 * enactment is recorded separately from the vote log because they answer
 * different questions — the log is how the member voted, this is what the
 * building actually produced — and because the country has to ease in the month
 * the thing became law rather than the month somebody voted on it. See
 * `actedOn` in nation.js.
 */
export function enact(next, record) {
  const bill = record.bill;
  const moved = applyConsequence(next, bill, record.strength);
  const migration = applyMigration(next, bill);

  next.enacted = [...(next.enacted || []), {
    id: bill.id,
    title: bill.title,
    domain: bill.domain || null,
    addresses: bill.addresses || null,
    axis: bill.axis,
    gutted: Boolean(record.gutted),
    strength: record.strength,
    month: next.month,
    term: next.term || 1,
    yours: Boolean(record.yours),
  }];

  return { moved, migration };
}

// --- The month ----------------------------------------------------------------

const drop = (next, key) => {
  next.inFlight = (next.inFlight || []).filter((r) => r.key !== key);
};

/**
 * Walk the ledger one month forward.
 *
 * Called from both chambers' advance functions *before* the country is rolled,
 * so a bill signed this month is a bill the country has already noticed by the
 * time the problems are re-scored.
 *
 * Every exit from the ledger leaves an event behind. A bill that vanished
 * quietly would be indistinguishable from one nobody had ever sent, and the
 * whole point of the pipeline is that the player can see where their work went.
 */
export function advancePassage(next) {
  const events = [];
  const term = next.term || 1;

  for (const record of [...(next.inFlight || [])]) {
    /**
     * A Congress ends and takes everything unfinished with it.
     *
     * Real, and brutal, and the reason a bill filed in the second year of a
     * Congress is a different animal from one filed in the first. Nothing
     * carries over; it all has to start again.
     */
    if (record.sentTerm !== term) {
      drop(next, record.key);
      events.push(noteEvent(EVENT.BLOCKED, {
        title: record.bill.title, domain: record.bill.domain,
      }));
      continue;
    }

    if (record.stage === "override") {
      record.waited += 1;
      if (record.waited > OVERRIDE_WINDOW) {
        drop(next, record.key);
        events.push(noteEvent(EVENT.BLOCKED, {
          title: record.bill.title, domain: record.bill.domain,
        }));
      }
      continue;
    }

    if (record.stage === "desk") {
      const desk = deskVerdict(next, record, record.lastTally);
      drop(next, record.key);
      if (desk.signed) {
        const { moved } = enact(next, record);
        /**
         * The member's own vote travels with the bill all the way to the
         * signing, because the record's whole promise is "what moved the
         * country, and which way you went on each" — and by the time a bill
         * becomes law the roll call it came from can be months behind. Without
         * this the turning-points screen knows a statute bent the line and has
         * forgotten who voted for it.
         */
        events.push(noteEvent(EVENT.ENACTED, {
          title: record.bill.title, domain: record.bill.domain, moved, vote: record.vote,
        }));
      } else {
        // Back to the floor it came from, as the only vote that can answer a veto.
        next.inFlight = [...(next.inFlight || []), {
          ...record, stage: "override", waited: 0, note: desk.reason,
        }];
        events.push(noteEvent(EVENT.VETOED, {
          title: record.bill.title, domain: record.bill.domain,
        }));
      }
      continue;
    }

    // Still over there.
    record.waited += 1;
    const verdict = farVerdict(next, record);

    if (verdict.fate === "stalled") {
      record.note = `${farChamberName(next)} has not taken it up. `
        + `${verdict.need - verdict.have} vote${verdict.need - verdict.have === 1 ? "" : "s"} short.`;
      continue;
    }
    if (verdict.fate === "killed") {
      drop(next, record.key);
      events.push(noteEvent(EVENT.BLOCKED, {
        title: record.bill.title, domain: record.bill.domain,
      }));
      continue;
    }

    if (verdict.fate === "gutted") {
      record.bill = verdict.bill;
      record.gutted = true;
      record.strength = GUTTED_STRENGTH;
      events.push(noteEvent(EVENT.GUTTED, {
        title: record.bill.title, domain: record.bill.domain,
      }));
    }
    record.stage = "desk";
    record.waited = 0;
    record.lastTally = verdict.tally;
    record.note = record.gutted
      ? `${farChamberName(next)} passed it cut in half. It goes to the desk.`
      : `${farChamberName(next)} passed it. It goes to the desk.`;
  }

  return events;
}

// --- The override vote --------------------------------------------------------

/**
 * What a veto puts back on your own calendar.
 *
 * Prepended to the month's floor exactly like a discharged bill, because it is
 * the same kind of thing: a vote leadership did not schedule and cannot avoid.
 */
export function overrideBills(state) {
  return (state.inFlight || [])
    .filter((r) => r.stage === "override")
    .map((r) => ({ ...r.bill, override: true, overrideKey: r.key }));
}

/** The bill a member is actually voting on when they vote on an override. */
export const overrideRecord = (state, bill) =>
  (state.inFlight || []).find((r) => r.key === bill?.overrideKey) || null;

/**
 * The override, resolved.
 *
 * Two thirds or nothing — and unlike every other vote in the mode, the player's
 * own vote is very often the whole story, because the margin between a caucus
 * and two thirds of a chamber is exactly the handful of people willing to defy
 * a president of their own party.
 */
export function resolveOverride(next, bill, carried) {
  const record = overrideRecord(next, bill);
  if (!record) return null;
  drop(next, record.key);

  if (!carried) {
    return {
      enacted: false, moved: {},
      note: `The veto stands. ${record.bill.title} is finished, and everybody who voted for it is on the record.`,
    };
  }
  const { moved } = enact(next, record);
  return {
    enacted: true, moved,
    note: `Two thirds. ${record.bill.title} becomes law over the President's veto — `
      + "which happens to about one veto in twenty.",
  };
}
