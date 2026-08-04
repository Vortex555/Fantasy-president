import { clamp, round1, seeded } from "./rng.js";
import { activeArcs } from "./arcs.js";
import { committeeById, chamberOf } from "./committees.js";

/**
 * A committee seat you use, rather than one that gates other things.
 *
 * The gavel was worth climbing for exactly two powers, and both of them were
 * about bills somebody else had written: bury one, or amend one. Which makes a
 * chairmanship a veto and nothing else — while the committee list has said from
 * the day it was written that Oversight is "a platform more than a legislature",
 * and the game gave it no way to be a platform at all.
 *
 * A hearing is the platform. It does not pass anything, change anything, or move
 * a single vote on the floor. What it does is make you a person the country has
 * heard of — which is the one currency the chamber modes never generated and the
 * ladder above them runs entirely on. A member who spends four terms televising
 * an administration's failures arrives at a statewide race already known, and
 * that is a career strategy the mode could not previously express.
 *
 * It is also the only way to build a national name that does not require the
 * Speakership, which matters because most careers never get one.
 */

/** Rungs that can call a witness, and rungs that can compel one. */
const HEARING_RANKS = new Set(["subchair", "chair", "speaker"]);
const SUBPOENA_RANKS = new Set(["chair", "speaker"]);

export const canHold = (state) => HEARING_RANKS.has(state?.rank || "member");
export const canCompel = (state) => SUBPOENA_RANKS.has(state?.rank || "member");

/** What a month of televised hearings costs in favours. */
export const HEARING_COST = 4;
export const SUBPOENA_COST = 9;

/**
 * How far a hearing carries.
 *
 * Deliberately small per hearing and worth a great deal compounded: a term of
 * them is a national profile, a single one is a news cycle. `earnRecognition`
 * reads the total at the end of an office, so this is the slow way to become
 * somebody — the fast way is a Speakership, and most careers do not get one.
 */
export const PROFILE_PER_HEARING = 6;
export const PROFILE_PER_SUBPOENA = 13;

/** Nobody becomes a household name from a committee room alone. */
export const PROFILE_CAP = 62;

/**
 * What a member may drag in front of their committee this month.
 *
 * Only problems the country is actually carrying, and only in the domains the
 * committee owns — a Judiciary chair cannot hold hearings on a grain shortage,
 * and the restriction is what makes which committee you sit on matter.
 */
export function hearingTargets(state) {
  const committee = committeeById(state.committee);
  if (!committee || !canHold(state)) return [];

  return activeArcs(state)
    .filter((arc) => committee.domains.includes(arc.domain))
    .map((arc) => ({
      id: arc.id,
      title: arc.title,
      severity: arc.severity,
      /**
       * Whose failure it is. A hearing into an administration of your own party
       * is a very different act from one into the other side's, and the game
       * should not pretend otherwise.
       */
      ownSide: state.president?.party === (state.caucus || state.scenario?.party),
    }));
}

/**
 * Hold one.
 *
 * The three effects are the three real ones. You get better known, which is the
 * point. Your own wing likes you for it, because a member on television is a
 * member fighting. And if the administration you are embarrassing is your own
 * party's, leadership is furious — which is the whole tension of oversight and
 * the reason most of it is done by the party out of power.
 */
export function holdHearing(state, arcId, { compel = false } = {}) {
  if (!canHold(state)) {
    return { rejected: true, note: "You need a gavel to call a hearing. A backbencher can attend one." };
  }
  if (compel && !canCompel(state)) {
    return { rejected: true, note: "Only a chair can compel a witness. A subcommittee can ask and be refused." };
  }
  if (state.heardThisMonth) {
    return { rejected: true, note: "Your committee has sat once this month. There is a calendar for these too." };
  }

  const target = hearingTargets(state).find((t) => t.id === arcId);
  if (!target) return { rejected: true, note: "That is not your committee's jurisdiction." };

  const cost = compel ? SUBPOENA_COST : HEARING_COST;
  if ((state.capital ?? 0) < cost) {
    return { rejected: true, note: `Staffing it costs ${cost} favours and you are owed fewer.` };
  }

  const r = seeded(`${state.rosterSeed}|hearing|${state.term || 1}|${state.month}|${arcId}`);
  /**
   * A hearing into a live crisis is news; one into a problem nobody is thinking
   * about is an empty room with cameras in it. Severity is how much the country
   * is already paying attention.
   */
  const bite = (compel ? PROFILE_PER_SUBPOENA : PROFILE_PER_HEARING)
    * (0.6 + target.severity * 0.12);
  const profile = Math.min(PROFILE_CAP, round1((state.profile ?? 0) + bite));

  /**
   * Compelling a witness who then defies you is worse than never asking. A
   * chair with no standing cannot make anybody appear, and the empty chair is
   * the story.
   */
  const stonewalled = compel && r.chance(clamp(0.42 - (state.leadership - 50) * 0.004, 0.1, 0.6));

  const embarrassesOwnSide = target.ownSide;
  const leadershipMove = embarrassesOwnSide ? -(compel ? 9 : 4) : (compel ? 2 : 1);
  const blocMove = compel ? 6 : 3;

  return {
    state: {
      ...state,
      capital: round1(Math.max(0, (state.capital ?? 0) - cost)),
      profile: stonewalled ? round1((state.profile ?? 0) + bite * 0.35) : profile,
      leadership: clamp(round1(state.leadership + leadershipMove)),
      bloc: clamp(round1((state.bloc ?? 62) + blocMove)),
      heardThisMonth: true,
      hearingLog: [...(state.hearingLog || []), {
        month: state.month, term: state.term || 1,
        arcId, title: target.title, compel, stonewalled,
      }],
    },
    stonewalled,
    note: stonewalled
      ? `You subpoenaed them and they did not come. The empty chair was the picture on every `
        + `bulletin, and the story was you rather than them.`
      : embarrassesOwnSide
        ? `${compel ? "You compelled testimony" : "You took evidence"} on the ${target.title.toLowerCase()}. `
          + `It made the news and it made your own leadership look like they were hiding something, `
          + `which they will remember.`
        : `${compel ? "You compelled testimony" : "You took evidence"} on the ${target.title.toLowerCase()}. `
          + `Two networks carried it live. People who could not name their own member know yours now.`,
  };
}

/** Clear the month's sitting, so a new month is a new hearing. */
export const resetHearings = (state) => ({ ...state, heardThisMonth: false });

/**
 * What the committee room was worth when the office closes.
 *
 * Folded into the same national recognition a Speakership confers, because they
 * are the same thing — being known by people who could not name their own
 * member. This is simply the slow road to it.
 */
export const profileEarned = (state) => Math.min(PROFILE_CAP, round1(state?.profile ?? 0));
