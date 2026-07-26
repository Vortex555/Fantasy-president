import { round1 } from "./rng.js";
import { committeeById, rankById, rankIndex } from "./committees.js";
import { confirmationRecord } from "./confirmations.js";

/**
 * What the House remembers.
 *
 * A member is not judged the way a president is, and running one through the
 * presidential verdict produced exactly the nonsense you would expect: electoral
 * votes they never had, situations they were never asked to resolve, and a
 * closing line calling it a presidency.
 *
 * They are judged on four things instead — how long they lasted, what they
 * actually passed, how far up the ladder they got, and whose side they took
 * when it cost them. The last one is the interesting one, because there is no
 * right answer: a member who always voted their district and a member who
 * always voted their caucus have both had a career, just not the same one.
 */

/**
 * The bands are deliberately hard at the top. A four-term committee chair, an
 * eight-term whip and a ten-term Speaker are not the same career, and an
 * earlier cut of this scored all three as legends — which flattered everybody
 * and told nobody anything.
 */
const RANKS = [
  { at: 92, title: "A Legend of the CHAMBER", note: "The kind of career other members' staff are made to read about." },
  { at: 70, title: "A Power in the CHAMBER", note: "You ran something, and the room changed when you spoke in it." },
  { at: 38, title: "An Effective Member", note: "You passed things and held your seat. Most members manage neither." },
  { at: 25, title: "A Reliable Vote", note: "You were counted on, and counted. That is a career, if not a monument." },
  { at: 14, title: "A Backbencher", note: "You were there. The Congressional Record will confirm it." },
  { at: 0, title: "A Footnote", note: "Two years, a voting card, and a parking space." },
];

/** How a career in the House ended, in the language the House would use. */
const ENDINGS = {
  unseated: { seal: "📦", label: "Unseated", cls: "lose" },
  retired: { seal: "🎣", label: "Retired", cls: "" },
  serving: { seal: "🪑", label: "Still Serving", cls: "win" },
};

export function historicalHouseVerdict(state) {
  const findings = [];
  // Both chambers run through here; only the nouns differ.
  const senate = state.office === "senate";
  const chamberName = senate ? "Senate" : "House";
  const yearsPerTerm = senate ? 6 : 2;
  const seatWord = senate ? "state" : "district";
  let score = 12;   // showing up is worth something, but not much

  const seat = state.seat || {};
  const terms = seat.seniority || 1;
  const years = terms * yearsPerTerm;
  const record = state.voteLog || [];
  const sponsored = state.sponsored || [];
  const passed = sponsored.filter((s) => s.passed).length;
  const heard = sponsored.filter((s) => s.reachedFloor).length;

  // --- Longevity. The House rewards nothing so much as still being there.
  score += Math.min(34, terms * 3.6);
  if (terms >= 6) {
    findings.push({ good: true, text: `Held ${seat.district} for ${terms} terms — ${years} years in the ${chamberName}.` });
  } else if (terms === 1) {
    findings.push({ good: false, text: `One term. You were sworn in and then you were not.` });
  } else {
    findings.push({ good: true, text: `${terms} terms in ${seat.district}. ${years} years.` });
  }

  // --- The ground you held it on. A hostile seat is the harder trick.
  const sign = state.scenario?.party === "Republican" ? 1 : -1;
  const favour = sign * (seat.lean ?? 0);
  if (favour < -25 && terms >= 2) {
    score += 10;
    findings.push({ good: true, text:
      `${seat.district} votes the other way and you held it for ${terms} terms. Very few ${senate ? "senators" : "members"} can say that.` });
  } else if (favour > 45 && terms >= 4) {
    findings.push({ good: false, text:
      `You held one of the safest seats in the country. Nobody was ever going to take it off you.` });
  }

  // --- What you actually passed.
  score += passed * 9 + (heard - passed) * 2;
  if (passed) {
    findings.push({ good: true, text: `${passed} bill${passed === 1 ? "" : "s"} with your name on it became law.` });
  } else if (sponsored.length) {
    findings.push({ good: false, text: `You filed ${sponsored.length} bills and passed none of them.` });
  }

  // --- The ladder.
  const rank = state.rank || "member";
  const chamber = senate ? "senate" : "house";
  score += rankIndex(rank) * 7;
  if (rank === "speaker") {
    findings.push({ good: true, text: senate
      ? `You were Majority Leader of the Senate — you decided what a hundred people voted on.`
      : `You were Speaker of the House. Second in line to the presidency.` });
  } else if (rankIndex(rank) >= 2) {
    const committee = committeeById(state.committee);
    findings.push({ good: true, text:
      `You rose to ${rankById(rank, chamber).title}${committee && rank !== "whip" ? ` of ${committee.name}` : ""}.` });
  }

  // --- Whose side you took, and what it cost.
  if (record.length) {
    const withDistrict = record.filter((v) => v.withDistrict).length;
    const withParty = record.filter((v) => v.withParty).length;
    const districtRate = Math.round((withDistrict / record.length) * 100);
    const partyRate = Math.round((withParty / record.length) * 100);
    score += 6;

    findings.push({ good: true, text:
      `${record.length} votes cast — ${districtRate}% with your district, ${partyRate}% with your caucus.` });

    if (partyRate >= 85) {
      findings.push({ good: null, text:
        `You almost never broke ranks. Leadership could count on you, and everyone knew it.` });
    } else if (districtRate >= 85) {
      findings.push({ good: null, text:
        `You voted the district over the caucus again and again. It kept your seat and capped your career.` });
    }
  } else {
    findings.push({ good: false, text: `You cast no recorded votes of consequence.` });
  }

  // --- Committee work nobody sees.
  const buried = (state.committeeLog || []).filter((e) => e.action === "buried").length;
  if (buried) {
    score += buried * 2;
    findings.push({ good: null, text:
      `You killed ${buried} bill${buried === 1 ? "" : "s"} in committee. No roll call, no record, no defence needed.` });
  }

  // --- What six years of forgetting was actually spent on.
  if (senate) {
    const filibusters = (state.filibusters || []).length;
    if (filibusters) {
      score += filibusters * 3;
      findings.push({ good: null, text:
        `You held the floor ${filibusters} time${filibusters === 1 ? "" : "s"}, which any senator may do ` +
        `and few do twice.` });
    }

    /**
     * Advice and consent, which outlives everybody involved. This is the only
     * part of a legislative record that is still in force decades later, so it
     * is scored as the thing a senator is actually remembered for.
     */
    const consent = confirmationRecord(state);
    if (consent.total) {
      score += consent.lifetime * 7 + consent.total * 1.5 + consent.blocked * 3;
      if (consent.lifetime) {
        findings.push({ good: true, text:
          `You put ${consent.lifetime} ${consent.lifetime === 1 ? "judge" : "judges"} on the federal ` +
          `bench for life. They will still be handing down rulings long after anybody remembers ` +
          `who voted for them.` });
      }
      findings.push({ good: null, text:
        `${consent.total} nomination${consent.total === 1 ? "" : "s"} came before you and you were ` +
        `one of a hundred votes on each. ${consent.blocked
          ? `${consent.blocked} of them never took office.`
          : `Every one of them took office.`}` });
      if (consent.hacks) {
        findings.push({ good: false, text:
          `You voted to confirm ${consent.hacks} ${consent.hacks === 1 ? "nominee" : "nominees"} nobody ` +
          `could defend on the merits. That is the part of a confirmation record that gets quoted back.` });
      }
      if (consent.brokeRanks >= 2) {
        score += 4;
        findings.push({ good: true, text:
          `You broke with your caucus on ${consent.brokeRanks} nominations. In this chamber that is ` +
          `either independence or unreliability, and only the outcome decides which.` });
      }
    }
  }

  // --- The vote a career is remembered for.
  const impeachment = record.find((v) => v.impeachment);
  if (impeachment) {
    score += 4;
    findings.push({ good: null, text:
      `You voted ${impeachment.vote === "abstain" ? "on nothing" : `to ${impeachment.vote === "yes" ? "impeach" : "acquit"}`} ` +
      `a President of the United States${impeachment.withParty ? " with your caucus" : " against your caucus"}. ` +
      `It is the first line of every profile written about you since.` });
  }

  const final = Math.max(0, Math.min(100, Math.round(score)));
  const band = RANKS.find((r) => final >= r.at) || RANKS[RANKS.length - 1];
  const rankBand = { ...band, title: band.title.replace("CHAMBER", chamberName) };
  const endingType = state.ending?.type === "unseated" ? "unseated"
    : state.over ? "retired" : "serving";

  return {
    score: final,
    title: rankBand.title,
    summary: rankBand.note,
    ending: ENDINGS[endingType],
    terms, years, chamberName, seatWord, senate,
    district: seat.district,
    stateName: seat.stateName,
    rank: rankById(rank, chamber).title,
    committee: committeeById(state.committee)?.name || null,
    votes: record.length,
    passed,
    findings: [
      ...findings.filter((f) => f.good === true),
      ...findings.filter((f) => f.good === null),
      ...findings.filter((f) => f.good === false),
    ].slice(0, 8),
  };
}
