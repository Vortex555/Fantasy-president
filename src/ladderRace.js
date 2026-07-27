import { clamp, round1 } from "./rng.js";
import { STATES } from "./states.js";
import { spendEffect, nationalEnvironment } from "./elections.js";
import { officeAt, recognitionFor, fullRecord } from "./career.js";

/**
 * One race for an office you do not hold.
 *
 * It returns the same shape `runReelection` does — a margin plus a named
 * contribution per factor — so the existing election screen draws it as factor
 * bars without learning anything new. What differs is which factors exist: a
 * re-election turns on the ground under you and how your own people rate you,
 * and a reach turns on whether anybody outside them has heard of you at all.
 *
 * Nothing here is random. A race is a sum of four things a career carries and
 * three things the country supplies, and every one of them is visible to the
 * player before they commit.
 */

const RECOGNITION_WEIGHT = 0.12;
const ESTABLISHMENT_WEIGHT = 0.08;
const RECORD_WEIGHT = 0.9;
const GROUND_WEIGHT = 0.42;      // matches runReelection, so the bars are comparable
const PRIMARY_THRESHOLD = 35;
const LEAN_SCALE = 90;           // the spectrum bills and districts already share

const partySign = (party) => (party === "Republican" ? 1 : party === "Democrat" ? -1 : 0);

const leanOf = (constituency, where) => {
  if (constituency === "nation") return 0;
  const code = constituency === "state" ? where : String(where || "").split("-")[0];
  return STATES[code]?.lean ?? 0;
};

/** The partisan ground under this constituency, from the candidate's side. */
function groundFor(constituency, where, party) {
  const sign = partySign(party);
  if (sign === 0) return round1(-Math.abs(leanOf(constituency, where)) * 0.15);
  return round1(sign * leanOf(constituency, where) * GROUND_WEIGHT);
}

/**
 * What a record is worth to an electorate that did not elect you.
 *
 * Every vote is scored against the new constituency's politics: the ones that
 * suit it help, the ones that do not are what the other side will be running in
 * October. A member who voted their district for six years finds those same
 * votes read back to them statewide, which is the whole reason the record
 * carries.
 */
function recordFactor(career, state, constituency, where, runOn) {
  const votes = fullRecord(career, state).votes;
  if (!votes.length) return 0;

  const electorate = clamp(leanOf(constituency, where) / LEAN_SCALE, -1, 1);
  let fit = 0;
  let counted = 0;
  for (const vote of votes) {
    if (vote.vote === "abstain") continue;
    const axis = Number(vote.axis) || 0;
    // Voting no on a right-wing bill is a left-wing act, and vice versa.
    const cast = vote.vote === "yes" ? axis : -axis;
    fit += 1 - Math.abs(cast - electorate) / 2;
    counted += 1;
  }
  if (!counted) return 0;

  // −0.5…+0.5, where zero is a record the new electorate is indifferent to.
  const average = fit / counted - 0.5;
  const emphasis = runOn === "record" ? 1.4 : runOn === "opponent" ? 0.5 : 0.8;
  return round1(average * 2 * RECORD_WEIGHT * emphasis);
}

export function runLadderRace(career, state, { target, where, opponent, runOn = "record", spend = {} }) {
  const office = officeAt(target);
  const constituency = office?.constituency || "state";
  const ev = constituency === "state" ? (STATES[where]?.ev ?? 3) : 538;

  const mine = recognitionFor(career, constituency, where);
  const theirs = Number(opponent?.recognition) || 50;
  const recognition = round1((mine - theirs) * RECOGNITION_WEIGHT);

  const ground = groundFor(constituency, where, career.party);
  const record = recordFactor(career, state, constituency, where, runOn);
  const money = round1(spendEffect(spend?.[where] ?? 0, ev));
  const establishment = round1((career.standing - 50) * ESTABLISHMENT_WEIGHT);

  // The national weather, which belongs to the President and lands on their own
  // party first — exactly as it does in every other election in the game.
  const sameParty = career.party === state.president?.party;
  const env = nationalEnvironment({
    approval: state.president?.approval ?? 50,
    economy: state.economy,
    arcs: state.arcs || [],
    scenario: { party: state.president?.party },
  }, { midterm: sameParty });
  const wave = round1(sameParty ? env : -env * 0.45);

  // Incumbency belongs to the seat you already hold. Reaching for a different
  // one, you are a challenger like any other.
  const incumbency = state.office === target
    ? round1(3 + Math.min(state.seat?.seniority || 1, 6) * 0.9)
    : 0;

  const margin = round1(ground + recognition + record + money + establishment + wave + incumbency);
  const contested = career.standing < PRIMARY_THRESHOLD;

  return {
    margin,
    won: margin > 0,
    ground, recognition, record, money, establishment, wave, incumbency,
    mine, theirs, opponent, target, where, runOn, constituency,
    primary: {
      contested,
      note: contested
        ? "The party has a candidate it prefers. You are in a primary before you ever meet the other side."
        : "The establishment is not going to fight you for this one.",
    },
  };
}
