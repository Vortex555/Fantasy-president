import { seeded, clamp, round1 } from "./rng.js";
import { STATES } from "./states.js";
import { buildCongress } from "../public/js/data/government.js";
import { FACTIONS, factionOf } from "./factions.js";
import { rollCall, consensusOf } from "./bills.js";

/**
 * Electing a Speaker.
 *
 * The chair was handed out by arithmetic: clear a seniority bar, clear a
 * standing bar, hold the majority, and `rankOf` made you Speaker between one
 * Congress and the next without a vote being taken. Nobody has ever become
 * Speaker that way. It is the only officer of the House named in the
 * Constitution and it is filled by the whole chamber, on the record, by name,
 * on the first day — and when the chamber cannot agree, the House has no
 * Speaker, no rules, no committees and no sworn members until it does.
 *
 * So it is an election, in two rounds, exactly as it is in life. Your own
 * caucus picks a nominee behind closed doors, where a simple majority of the
 * people in the room is enough. Then the whole House votes in public, where a
 * nominee needs an absolute majority of everybody voting — 218 when all 435
 * turn up — and the other party is voting for somebody else. The gap between
 * those two numbers is the entire drama: a caucus of 220 can nominate you
 * unanimously and five of its members can still keep you out of the chair for a
 * fortnight, because five is all it takes.
 *
 * What you do about those five is the game. You concede. Every concession is
 * real, it is written into the rules package, and it is still there long after
 * the cameras have gone — which is why the shortest route to the chair is also
 * the shortest tenure in it.
 */

/** The number itself, when every seat is filled and everybody votes. */
export const HOUSE_SEATS = 435;

/** A ballot the chamber has already sat through this many times gets ugly. */
export const PATIENCE = 4;

/** Nobody holds out for ever, and nobody survives holding out for ever either. */
export const MAX_BALLOTS = 15;

// --- Am I even a candidate? ---------------------------------------------------

/** What a member needs before their own side would consider them for it. */
const CANDIDATE_SENIORITY = 3;
const CANDIDATE_STANDING = 58;

const majorityParty = (state) => {
  const c = state.congress || {};
  return c.houseR > c.houseD ? "Republican" : "Democrat";
};

const mySeats = (state) => {
  const c = state.congress || {};
  return (state.caucus || state.scenario?.party) === "Republican" ? c.houseR : c.houseD;
};

/**
 * Whether this member could put their name forward, and if not, why not.
 *
 * Deliberately answerable in a sentence on screen. A member who is told only
 * "not eligible" learns nothing about what to do differently for two years.
 */
export function candidacy(state) {
  if (state.office !== "house") {
    return { can: false, reason: "The Speaker is elected by the House." };
  }
  const caucus = state.caucus || state.scenario?.party;
  if (caucus !== majorityParty(state)) {
    return { can: false, reason: "Your caucus is in the minority. It can nominate you and it cannot elect you." };
  }
  const seniority = state.seat?.seniority || 1;
  if (seniority < CANDIDATE_SENIORITY) {
    return {
      can: false,
      reason: `A ${seniority === 1 ? "freshman" : `${seniority}-term member`} does not get a hearing. `
        + `Come back with ${CANDIDATE_SENIORITY} terms.`,
    };
  }
  if ((state.leadership ?? 50) < CANDIDATE_STANDING) {
    return {
      can: false,
      reason: `The caucus has you at ${Math.round(state.leadership ?? 50)}. `
        + `Nobody below ${CANDIDATE_STANDING} is nominated for anything.`,
    };
  }
  return { can: true, reason: null };
}

// --- The room behind the closed door ------------------------------------------

/**
 * The caucus nomination, which is not the election and decides it anyway.
 *
 * A majority of your own caucus, in a room, with no public record. Your standing
 * with leadership is most of it; your own wing turning out for you is the rest,
 * and a member with no bloc behind them is a member relying entirely on being
 * owed favours.
 */
export function nomination(state) {
  const seats = mySeats(state);
  const standing = state.leadership ?? 50;
  const bloc = state.bloc ?? 50;
  const seniority = Math.min(10, state.seat?.seniority || 1);

  const share = clamp(
    26 + (standing - 50) * 0.85 + (bloc - 50) * 0.25 + seniority * 2.2
    + Math.min(12, (state.capital ?? 0) / 6),
    5, 92,
  );
  const votes = Math.round(seats * share / 100);
  const needed = Math.floor(seats / 2) + 1;

  return {
    seats,
    votes,
    needed,
    won: votes >= needed,
    // Who else wanted it, so a loss has a name attached to it.
    rival: rivalFor(state),
  };
}

const RIVAL_FIRST = ["Marguerite", "Clay", "Rosalind", "Emeka", "Hollis", "Verna", "Sterling", "Otis"];
const RIVAL_LAST = ["Kirkland", "Thorne", "Mercer", "Prentice", "Winthrop", "Ashford", "Calloway"];

function rivalFor(state) {
  const r = seeded(`${state.rosterSeed || "house"}|speaker|${state.term || 1}`);
  return `${r.pick(RIVAL_FIRST)} ${r.pick(RIVAL_LAST)}`;
}

// --- The floor ----------------------------------------------------------------

/**
 * The blocs that will not vote for you on the first ballot.
 *
 * Real holdouts are organised, they are from your own side, and they want
 * things that are written down. The restive factions are the ones that do this
 * — the same ones that will later move to vacate — and your own bloc is the
 * exception, because a caucus does not hold its own candidate hostage.
 */
export function holdouts(state) {
  const roster = buildCongress(state, STATES).house || [];
  const caucus = state.caucus || state.scenario?.party;
  const mine = factionOf(state.scenario)?.id || null;
  const counts = new Map();

  for (const m of roster) {
    if (m.party !== caucus) continue;
    const faction = FACTIONS.find((f) => f.id === m.faction);
    if (!faction?.restive) continue;
    counts.set(faction.id, (counts.get(faction.id) || 0) + 1);
  }

  return [...counts.entries()]
    .map(([id, seats]) => {
      const faction = FACTIONS.find((f) => f.id === id);
      /**
       * How many of them actually withhold. A bloc does not vote as one on
       * this — some of it always folds on the first ballot — and the harder
       * the bloc, the more of it holds.
       *
       * Your own wing holds out too, and at first it did not: excluding it
       * gave a nominee whose caucus had exactly one restive bloc an election
       * with nobody in the way, which is not an election. It is also wrong
       * about how these go. The people who kept McCarthy from the chair
       * included members he had counted as his own, and being one of them
       * buys you a discount rather than an exemption — you know what they
       * want and they cannot pretend not to know you.
       */
      const own = faction.id === mine;
      const rate = (own ? 0.18 : 0.35) + (faction.discipline ?? 0.5) * (own ? 0.22 : 0.45);
      const holding = Math.max(1, Math.round(seats * rate));
      return {
        id, name: faction.name, seats, holding, own,
        wants: CONCESSIONS[id] || CONCESSIONS.default,
      };
    })
    .sort((a, b) => b.holding - a.holding);
}

/**
 * What they want, and what it costs you for the rest of the Congress.
 *
 * Every one of these is a thing an actual holdout bloc has demanded and got.
 * The motion-to-vacate threshold is the one that ended a speakership: a single
 * member being able to file it is the concession that made the chair
 * unholdable, and it is in here at exactly that price.
 */
const CONCESSIONS = {
  freedom: {
    id: "vacate_one",
    label: "One member may move to vacate the chair",
    cost: "Anybody in the chamber can put your speakership to a vote, on any day, for any reason.",
  },
  progressive: {
    id: "floor_votes",
    label: "Guaranteed floor votes on their bills",
    cost: "Their legislation reaches the floor whether or not you want the caucus recorded on it.",
  },
  blue_dog: {
    id: "spending_caps",
    label: "Statutory caps on every spending bill",
    cost: "Every appropriation you bring up has to clear a number you do not control.",
  },
  study_committee: {
    id: "rules_seats",
    label: "Three of their members on Rules",
    cost: "You no longer control what reaches the floor from your own committee.",
  },
  default: {
    id: "committee_gavels",
    label: "Committee gavels for their people",
    cost: "Chairs who owe their room to somebody other than you.",
  },
};

/**
 * One ballot.
 *
 * The arithmetic is the real arithmetic: an absolute majority of the members
 * voting, which is 218 of 435 and drops as members vote present rather than for
 * anybody. Your side's seats minus whoever is still holding out; the other
 * side's entire caucus votes for its own leader and is never available to you.
 */
export function ballot(state, race) {
  const seats = mySeats(state);
  const held = race.holdouts.reduce((sum, h) => sum + (h.conceded ? 0 : h.holding), 0);
  const voting = HOUSE_SEATS - race.present;
  const needed = Math.floor(voting / 2) + 1;
  const votes = seats - held;

  return { votes, needed, held, voting, won: votes >= needed };
}

/**
 * Open the chair.
 *
 * Called at the start of a Congress and on a vacancy. Everything the race needs
 * is settled here so the ballots themselves are arithmetic on a frozen board —
 * a race whose holdouts changed between ballots would be a race the player
 * could not read.
 */
export function openRace(state) {
  const nominated = nomination(state);
  return {
    open: true,
    ballots: 0,
    // Members who vote "present" lower the number needed to win, which is how
    // the 2023 election was eventually resolved and is worth having in here.
    present: 0,
    conceded: [],
    nominee: nominated.won,
    rival: nominated.rival,
    nomination: nominated,
    holdouts: holdouts(state).map((h) => ({ ...h, conceded: false })),
    log: [],
    done: false,
    won: false,
  };
}

/**
 * Give one bloc what it is asking for.
 *
 * There is no partial concession and no taking one back. What it buys is that
 * bloc's votes on every subsequent ballot; what it costs is on the state for
 * the rest of the Congress, and in one case for as long as you hold the chair.
 */
export function concede(state, race, blocId) {
  const holdout = race.holdouts.find((h) => h.id === blocId && !h.conceded);
  if (!holdout) return { race, rejected: true, note: "They are not holding anything back." };

  const next = {
    ...race,
    holdouts: race.holdouts.map((h) => (h.id === blocId ? { ...h, conceded: true } : h)),
    conceded: [...race.conceded, holdout.wants],
    log: [...race.log, `Conceded to the ${holdout.name}: ${holdout.wants.label.toLowerCase()}.`],
  };
  return { race: next, note: `${holdout.holding} votes come back. ${holdout.wants.cost}` };
}

/**
 * Another ballot, with whatever you have bought since the last one.
 *
 * The chamber's patience is finite and visible. Every ballot after the fourth
 * costs you standing with your own caucus whether you win it or not, because a
 * House that cannot elect a Speaker is a House in which nothing else can happen
 * — no members sworn, no committees, no legislation — and everybody in it knows
 * whose fault that is.
 */
export function takeBallot(state, race) {
  const result = ballot(state, race);
  const ballots = race.ballots + 1;
  const next = {
    ...race,
    ballots,
    log: [...race.log, `Ballot ${ballots}: ${result.votes} of ${result.needed}.`],
  };

  if (result.won) {
    return { race: { ...next, done: true, won: true }, result };
  }
  if (ballots >= MAX_BALLOTS) {
    return {
      race: { ...next, done: true, won: false },
      result,
      note: `Fifteen ballots. The caucus has gone to ${race.rival} and you are not going to be Speaker.`,
    };
  }
  return { race: next, result };
}

/**
 * What winning and losing actually do to the career.
 *
 * A Speaker who conceded the one-member motion to vacate holds the chair on
 * somebody else's terms from the first day, and the game says so by writing it
 * on the state where `vacateCount` will find it. See procedure.js.
 */
export function settle(next, race) {
  next.speakerRace = null;

  if (!race.won) {
    next.rank = next.rank === "speaker" ? "chair" : next.rank;
    next.leadership = clamp(round1((next.leadership ?? 50) - 6 - race.ballots));
    next.speakerLost = { term: next.term || 1, ballots: race.ballots, to: race.rival };
    return {
      won: false,
      note: `${race.rival} was elected Speaker on the ${ordinal(race.ballots)} ballot. `
        + "You are not, and everybody watched you fail to be.",
    };
  }

  next.rank = "speaker";
  next.committee = "rules";
  next.concessions = race.conceded.map((c) => c.id);
  // Every ballot after the fourth was a day the House did nothing, on camera.
  const bruise = Math.max(0, race.ballots - PATIENCE) * 1.5;
  next.leadership = clamp(round1((next.leadership ?? 50) + 8 - bruise));

  return {
    won: true,
    note: race.ballots <= 1
      ? "Elected Speaker on the first ballot, which almost nobody is."
      : `Elected Speaker on the ${ordinal(race.ballots)} ballot`
        + (race.conceded.length
          ? `. The ${race.conceded.length} concession${race.conceded.length === 1 ? "" : "s"} `
            + `you made to get there ${race.conceded.length === 1 ? "is" : "are"} now the rules of the House.`
          : ", having conceded nothing, which is rarer than winning it."),
    concessions: race.conceded,
  };
}

const ordinal = (n) => {
  const suffix = ["th", "st", "nd", "rd"][(n % 100 - 20) % 10] || ["th", "st", "nd", "rd"][n % 100] || "th";
  return `${n}${suffix}`;
};

/** Whether a concession is in force, for the systems that have to honour it. */
export const conceded = (state, id) => (state?.concessions || []).includes(id);

// --- The job ------------------------------------------------------------------

/**
 * What the Speaker actually does, which is decide what never gets a vote.
 *
 * Every other member of this chamber is handed a calendar. The Speaker is
 * handed a queue of people who want something on it, and the power is almost
 * entirely negative: a bill that does not get a rule does not get a vote, does
 * not get debated, and cannot be amended on the floor by anybody. Nothing in
 * the House happens because the Speaker wants it. A great deal fails to happen
 * because the Speaker did not.
 *
 * So a Speaker's month is a shortlist and a number of slots smaller than the
 * shortlist, and every name left off it is somebody who now wants something
 * from you and did not get it.
 */
export function demands(state, bills) {
  const caucus = state.caucus || state.scenario?.party;
  const mine = FACTIONS.filter((f) => f.party === caucus);
  const r = seeded(`${state.rosterSeed || "house"}|demands|${state.term || 1}|${state.month}`);

  return bills.map((bill, i) => {
    /**
     * Who is asking. A bill on a Speaker's desk always has somebody behind it,
     * and which of your own wings it is decides what refusing costs.
     */
    const wing = mine.length ? mine[(i + Math.floor(r.next() * mine.length)) % mine.length] : null;
    const mustPass = /appropriat|budget|continuing resolution|funding|debt limit/i.test(bill.title || "");

    return {
      id: bill.id,
      bill,
      /** Whose bill it is, and how much of the caucus is behind them. */
      wanted: mustPass ? "The whole building" : (wing?.name || "Your leadership"),
      wing: mustPass ? null : wing?.id || null,
      restive: Boolean(wing?.restive),
      mustPass,
      /**
       * Whether your own caucus is with it. A Speaker who brings up a bill that
       * most of their own side opposes can pass it with the other party's votes
       * — and that is the single most reliable way to lose the chair. See
       * `hastert`.
       */
      ownSide: ownSideBacks(state, bill),
      note: mustPass
        ? "It has to be on the floor. The government stops if it is not."
        : wing?.restive
          ? `${wing.name} have asked three times and are counting how often you say no.`
          : `${wing?.name || "Leadership"} would like it scheduled.`,
    };
  });
}

/**
 * Whether a majority of the Speaker's own caucus supports a bill.
 *
 * The informal rule that has ended more speakerships than any formal one. A
 * Speaker who puts a bill on the floor that most of their own members oppose,
 * and passes it with the minority's votes, has done the one thing the caucus
 * genuinely will not forgive — Boehner did it repeatedly and it cost him the
 * chair, and it is the substance of nearly every motion to vacate ever filed.
 */
export function ownSideBacks(state, bill) {
  const roster = buildCongress(state, STATES).house || [];
  const caucus = state.caucus || state.scenario?.party;
  const ours = roster.filter((m) => m.party === caucus);
  if (!ours.length) return true;

  const tally = rollCall(ours, bill, { consensus: consensusOf(bill) });
  return tally.yes * 2 > ours.length;
}

/** The most a Speaker can put on the floor in a month. */
export const SLOTS = 2;

/**
 * Settle a month's calendar.
 *
 * What is scheduled reaches the floor. What is not leaves a grievance with
 * whoever asked, and grievances are what a motion to vacate is made of — a
 * Speaker is not removed for a bad decision, they are removed by four wings who
 * have each been told no three times.
 */
export function schedule(next, requests, chosenIds) {
  const chosen = new Set((Array.isArray(chosenIds) ? chosenIds : []).slice(0, SLOTS));
  const scheduled = [];
  const refused = [];

  for (const request of requests) {
    if (chosen.has(request.id)) {
      scheduled.push(request);
      // Bringing something up settles the debt with whoever wanted it.
      if (request.wing) next.grievance = { ...(next.grievance || {}), [request.wing]: 0 };
      continue;
    }
    refused.push(request);
    if (request.wing) {
      const held = (next.grievance || {})[request.wing] || 0;
      next.grievance = { ...(next.grievance || {}), [request.wing]: held + (request.restive ? 2 : 1) };
    }
    /**
     * The one refusal a Speaker cannot absorb. A funding bill that is not
     * brought up is a government that stops, and everybody in the country knows
     * exactly one person decided that.
     */
    if (request.mustPass) {
      next.shutdown = (next.shutdown || 0) + 1;
      next.leadership = clamp(round1((next.leadership ?? 50) - 9));
      next.approval = clamp(round1((next.approval ?? 50) - 5));
    }
  }

  return { scheduled, refused, bills: scheduled.map((r) => r.bill) };
}

/**
 * What it costs to pass something your own side did not want.
 *
 * Applied when a bill the caucus opposed carries anyway, which in practice
 * means it carried on the minority's votes. The chair does not fall over one of
 * these; it falls over the third one.
 */
export function hastert(next, request, passed) {
  if (!passed || request?.ownSide !== false) return null;
  next.leadership = clamp(round1((next.leadership ?? 50) - 7));
  next.bloc = clamp(round1((next.bloc ?? 50) - 10));
  next.betrayals = (next.betrayals || 0) + 1;

  return {
    note: `It passed with the other party's votes, over the objection of most of your own. `
      + `That is the ${ordinal(next.betrayals)} time, and it is the thing this caucus removes `
      + "Speakers for.",
    betrayals: next.betrayals,
  };
}

// --- Holding it ---------------------------------------------------------------

/**
 * The bill for the concessions, arriving monthly.
 *
 * This is what a speakership actually is once you have one: not a power but a
 * standing threat, priced by what you agreed to on the way in. A Speaker who
 * never conceded the motion to vacate is difficult to remove and knows it. A
 * Speaker who conceded it to five holdouts on the eleventh ballot governs at
 * the pleasure of any one member of the chamber, on any day, for any reason —
 * which is the whole story of the 118th Congress and is worth being in here at
 * full strength rather than as a modifier.
 *
 * The odds are deliberately readable. A player who cannot see the number cannot
 * decide whether to spend standing keeping the restive wing quiet, and that
 * decision is the job.
 */
export function chairThreat(state) {
  if (state.rank !== "speaker" || state.office !== "house") return { at: 0, reasons: [] };

  const reasons = [];
  let risk = 0.02;

  if (conceded(state, "vacate_one")) {
    risk += 0.09;
    reasons.push("Any single member can file it — you agreed to that to get the chair.");
  }
  if (conceded(state, "rules_seats")) {
    risk += 0.03;
    reasons.push("They hold three seats on Rules and can see everything coming.");
  }
  const standing = state.leadership ?? 50;
  if (standing < 55) {
    risk += (55 - standing) * 0.004;
    reasons.push(`The caucus has you at ${Math.round(standing)}, and a Speaker below sixty is a Speaker being counted.`);
  }
  const bloc = state.bloc ?? 50;
  if (bloc < 45) {
    risk += 0.03;
    reasons.push("Your own wing is not with you, which is where these always start.");
  }

  /**
   * And the two things the job itself accumulates.
   *
   * A Speaker is not removed for one bad decision. They are removed by four
   * wings who have each been told no three times, and by the third bill passed
   * over the objection of their own caucus. Both of those are the ordinary
   * conduct of the office, which is why nobody holds it for long.
   */
  const held = Object.entries(state.grievance || {})
    .filter(([, n]) => n >= 3)
    .map(([id]) => FACTIONS.find((f) => f.id === id)?.name || id);
  if (held.length) {
    risk += held.length * 0.04;
    reasons.push(`${held.join(" and ")} ${held.length === 1 ? "has" : "have"} been told no `
      + "often enough to start counting.");
  }

  const betrayals = state.betrayals || 0;
  if (betrayals) {
    risk += betrayals * 0.05;
    reasons.push(`${betrayals} bill${betrayals === 1 ? "" : "s"} passed on the other party's votes `
      + "over the objection of your own caucus.");
  }

  if (state.shutdown) {
    risk += 0.06;
    reasons.push("You let the funding lapse, and everybody knows exactly who decided that.");
  }

  if (!reasons.length) {
    reasons.push("Nobody has the votes and everybody knows it.");
  }

  return { at: Math.min(0.4, round1(risk * 100) / 100), reasons };
}

/**
 * One month of holding the chair.
 *
 * Rolled seeded on the month, so the same month is the same month. A motion
 * that is filed is resolved by the same count that has always resolved them —
 * see `vacateCount` in procedure.js — because the arithmetic of removing a
 * Speaker does not change depending on who is asking.
 */
export function tickChair(next, count) {
  const threat = chairThreat(next);
  if (!threat.at) return null;

  const r = seeded(`${next.rosterSeed || "house"}|chair|${next.term || 1}|${next.month}`);
  if (r.next() >= threat.at) return null;

  const filed = {
    month: next.month,
    term: next.term || 1,
    yes: count.yes,
    threshold: count.threshold,
    carried: count.passes,
  };

  if (count.passes) {
    next.rank = "chair";
    next.vacancy = 2;
    next.concessions = [];
    next.leadership = clamp(round1((next.leadership ?? 50) - 10));
    return {
      ...filed,
      note: `The motion carried ${count.yes}–${count.threshold - 1 > 0 ? count.total - count.yes : 0}. `
        + "You are no longer Speaker, and the chair is empty until the House can agree on somebody.",
    };
  }

  next.leadership = clamp(round1((next.leadership ?? 50) - 2));
  return {
    ...filed,
    note: `A motion to vacate was filed and failed ${count.yes}–${count.total - count.yes}. `
      + "You keep the chair, and everybody now knows the exact number of people who wanted you gone.",
  };
}
