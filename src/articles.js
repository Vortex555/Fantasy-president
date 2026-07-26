import { seeded, clamp, round1 } from "./rng.js";
import { STATES } from "./states.js";
import { rollCall } from "./bills.js";
import { buildCongress } from "../public/js/data/government.js";

/**
 * Impeachment, from the floor rather than the Oval Office.
 *
 * The presidential game models this from the wrong end: articles accumulate
 * against *you* and the House votes. Here you are one of the votes, and it is
 * the sharpest version of the bind the whole mode is built on.
 *
 * Every other vote splits your district from your caucus by a few points of
 * ideology. This one splits them on the only question American politics
 * actually organises around, and there is no abstention that reads as anything
 * other than an answer. A member of the President's own party in a district
 * that despises them, or the reverse, is being asked to choose their side in
 * public, on the record, forever.
 */

/** Weight of articles before the House is obliged to vote. */
const VOTE_TRIGGER = 5;

const ARTICLES = [
  { id: "finance", weight: 3, title: "Campaign finance and a foreign wire transfer" },
  { id: "contracts", weight: 2, title: "Federal contracts steered to a donor" },
  { id: "agencies", weight: 3, title: "Use of federal agencies against a political opponent" },
  { id: "classified", weight: 2, title: "Classified material held at a private residence" },
  { id: "pressure", weight: 3, title: "Pressure applied to a state election official" },
  { id: "obstruction", weight: 4, title: "Obstruction of a federal investigation" },
];

export function emptyArticles() {
  return { articles: [], status: "none", voted: false, houseVote: null, weight: 0 };
}

const partySign = (party) => (party === "Republican" ? 1 : party === "Democrat" ? -1 : 0);

/**
 * A month of the President's own trouble.
 *
 * Unpopular presidencies leak. This is deliberately slow and seeded so that a
 * given career either has an impeachment in it or does not — a coin flipped
 * every month would make the biggest vote in the mode feel arbitrary.
 */
export function tickArticles(state) {
  const next = structuredClone(state);
  next.jeopardy = next.jeopardy || emptyArticles();
  const j = next.jeopardy;
  if (j.status === "voted") return { state: next, event: null };

  const potus = next.president;
  const r = seeded(`${next.rosterSeed}|articles|${next.term || 1}|${next.month}`);

  // Trouble surfaces faster the weaker the President is.
  const exposure = clamp((55 - (potus?.approval ?? 50)) / 100, 0, 0.45);
  if (!r.chance(exposure * 0.35)) return { state: next, event: null };

  const held = new Set(j.articles.map((a) => a.id));
  const fresh = ARTICLES.filter((a) => !held.has(a.id));
  if (!fresh.length) return { state: next, event: null };

  const article = r.pick(fresh);
  j.articles.push({ ...article, month: next.month, term: next.term || 1 });
  j.weight = j.articles.reduce((sum, a) => sum + a.weight, 0);
  j.status = j.weight >= VOTE_TRIGGER ? "ready" : "investigating";

  return {
    state: next,
    event: {
      kind: j.status === "ready" ? "ready" : "opened",
      title: article.title,
      weight: j.weight,
      detail: j.status === "ready"
        ? `The Judiciary Committee has reported articles of impeachment against President ${potus.name}. ` +
          `The House will vote.`
        : `A new line of inquiry into President ${potus.name}: ${article.title.toLowerCase()}.`,
    },
  };
}

/** Is there an impeachment vote on the floor this month? */
export const articlesReady = (state) =>
  state?.jeopardy?.status === "ready" && !state.jeopardy.voted;

/**
 * Where your caucus and your district stand on removing the President.
 *
 * Neither is subtle. The caucus position is simply whether the President is
 * theirs. The district's is how far the President sits from the people who
 * elect you — which is the whole reason a member in the wrong seat dreads this
 * vote more than any other.
 */
export function articlesStance(state) {
  const potus = state.president;
  const caucus = state.caucus || state.scenario.party;
  const ownParty = potus?.party === caucus;

  const districtAxis = state.seat?.axis ?? 0;
  const distance = Math.abs(districtAxis - (potus?.axis ?? 0));
  // A district that disagrees with the President wants them gone.
  const districtWants = distance > 0.55;

  return {
    chamber: state.office === "senate" ? "senate" : "house",
    party: {
      position: ownParty ? "no" : "yes",
      intensity: 95,
      reason: ownParty
        ? `${potus.name} is your party's President. The caucus is holding the line.`
        : `The caucus has wanted this since the day ${potus.name} was sworn in.`,
    },
    district: {
      position: districtWants ? "yes" : "no",
      intensity: clamp(Math.round(Math.abs(distance - 0.55) * 160) + 25, 25, 100),
      reason: districtWants
        ? `${state.seat.district} did not vote for ${potus.name} and will not forgive a vote to protect them.`
        : `${state.seat.district} voted for ${potus.name}. A vote to impeach is a vote against your own district.`,
    },
    ownParty,
    president: potus,
  };
}

const DISTRICT_SWING = 16;   // far heavier than an ordinary bill
const PARTY_SWING = 14;

/**
 * Cast the vote.
 *
 * The swings are roughly double an ordinary bill's, in both directions, because
 * this is the vote a district remembers and the vote a caucus never forgets.
 */
export function voteArticles(state, vote) {
  if (!["yes", "no", "abstain"].includes(vote)) {
    return { state, rejected: true, note: "Vote to impeach, vote to acquit, or abstain." };
  }
  if (!articlesReady(state)) {
    return { state, rejected: true, note: "There are no articles on the floor." };
  }

  const next = structuredClone(state);
  const stance = articlesStance(next);
  const withDistrict = vote === stance.district.position;
  const withParty = vote === stance.party.position;

  const districtDelta = vote === "abstain"
    ? -round1(stance.district.intensity / 100 * 6)
    : round1((withDistrict ? 1 : -1) * (stance.district.intensity / 100) * DISTRICT_SWING);
  const partyDelta = vote === "abstain"
    ? -round1(PARTY_SWING * 0.45)
    : round1((withParty ? 1 : -1) * PARTY_SWING);

  next.approval = clamp(round1(next.approval + districtDelta));
  next.leadership = clamp(round1(next.leadership + partyDelta));

  /**
   * The chamber. Impeachment is close to a party-line vote, so the roll call is
   * driven by the caucuses rather than by any bill's position.
   *
   * Which chamber you sit in changes the question entirely. The House impeaches
   * on a simple majority — an accusation. The Senate convicts on two thirds,
   * which no party has ever had on its own, so a conviction requires the
   * President's own side to break. That is why the House vote is a foregone
   * conclusion and the Senate vote is not.
   */
  const roster = buildCongress(next, STATES);
  const senate = next.office === "senate";
  const chamber = senate ? roster.senate : roster.house;
  const potusSign = partySign(next.president.party);
  const against = chamber.filter((m) => partySign(m.party) !== potusSign).length;
  const defectors = Math.round(against * 0.03);
  // A handful of the President's own side cross on a strong enough case.
  const crossers = senate ? Math.round((chamber.length - against) * 0.08) : 0;
  const yes = against - defectors + crossers + (vote === "yes" ? 1 : 0);
  const threshold = senate
    ? Math.ceil(chamber.length * 2 / 3)
    : Math.floor(chamber.length / 2) + 1;
  const impeached = yes >= threshold;

  next.jeopardy = {
    ...next.jeopardy,
    voted: true,
    status: "voted",
    yourVote: vote,
    houseVote: { yes, no: chamber.length - yes, total: chamber.length, threshold, impeached },
  };
  next.voteLog = [...(next.voteLog || []), {
    id: "impeachment",
    title: `${next.office === "senate" ? "Trial" : "Impeachment"} of President ${next.president.name}`,
    axis: 0, vote, month: next.month, term: next.term || 1,
    withDistrict, withParty, passed: impeached, impeachment: true,
  }];

  return {
    state: next,
    result: {
      yourVote: vote, impeached, stance,
      tally: next.jeopardy.houseVote,
      district: { ...stance.district, delta: districtDelta },
      party: { ...stance.party, delta: partyDelta },
      note: describe({ vote, withParty, withDistrict, impeached, stance }),
    },
  };
}

function describe({ vote, withParty, withDistrict, impeached, stance }) {
  const name = stance.president.name;
  if (vote === "abstain") {
    return `You did not vote on the impeachment of a President of the United States. ` +
      `Nobody will read that as anything but an answer.`;
  }
  const senate = stance.chamber === "senate";
  const outcome = impeached
    ? senate
      ? `The Senate convicted ${name}. They are removed from office.`
      : `The House impeached ${name}. It goes to the Senate.`
    : senate
      ? `The Senate acquitted ${name}. They keep the office and the asterisk.`
      : `The House declined to impeach ${name}.`;

  if (withParty && withDistrict) return `${outcome} You were never going to vote any other way.`;
  if (!withParty && !withDistrict) {
    return `${outcome} You voted against your caucus and your district at once, which almost nobody does.`;
  }
  if (withParty) {
    return `${outcome} You held with the caucus against your own district. They will run that vote ` +
      `in every advertisement between now and November.`;
  }
  return `${outcome} You broke with your caucus to vote your district. Leadership will remember it ` +
    `longer than the voters will.`;
}
