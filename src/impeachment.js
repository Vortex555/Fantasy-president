import { seeded, hashString, clamp, round1 } from "./rng.js";
import { buildCongress } from "../public/js/data/government.js";
import { STATES } from "./states.js";

/**
 * Investigation, articles, and the only lawful way Congress can remove you.
 *
 * The pipeline is one thing, so it lives in one file: an FBI Director with
 * independence opens an investigation you cannot steer; a finished
 * investigation becomes an article; enough articles force a House vote; the
 * House impeaches on a simple majority and the Senate convicts on two thirds.
 *
 * The whole mechanic turns on a single number nobody looks at when they are
 * appointing: how independent the Director is. A loyalist slow-walks
 * everything and buys you years. Firing an independent one mid-investigation
 * is obstruction, and obstruction is itself an article — the cover-up really
 * is worse than the crime here.
 */

const HOUSE_TRIGGER = 5;   // total article weight before the House moves
const CONVICT_SHARE = 2 / 3;

export const ARTICLE_SOURCES = {
  investigation: { weight: 3, title: "Obstruction of a federal investigation" },
  scandal: { weight: 2, title: "Abuse of the office" },
  obstruction: { weight: 4, title: "Firing the investigator" },
  franchise: { weight: 3, title: "Subversion of the franchise" },
  court: { weight: 2, title: "Court-packing" },
  collapse: { weight: 1, title: "Incapacity" },
};

export function emptyJeopardy() {
  return {
    investigation: null,
    articles: [],
    status: "none",       // none | investigating | impeached | acquitted
    houseVote: null,
    senateVote: null,
    trialMonth: null,
    acquittals: 0,
    obstructed: false,
  };
}

const totalWeight = (articles) => articles.reduce((sum, a) => sum + a.weight, 0);

/** 0–1. How strong the case against the president has become. */
export const caseStrength = (jeopardy) =>
  Math.min(1, totalWeight(jeopardy?.articles || []) / 10);

// --- The Bureau ------------------------------------------------------------

const SUBJECTS = [
  "campaign finance and a foreign wire transfer",
  "contracts steered to a donor",
  "the use of federal agencies against a political opponent",
  "classified material held at a private residence",
  "pressure applied to a state election official",
  "a pardon exchanged for silence",
];

/**
 * How fast the Bureau moves. Independence is the engine; competence is the
 * quality of the work. A vacant seat means an acting director nobody is sure
 * answers to anyone, which is slow but not stopped.
 */
function investigationPace(state) {
  const seat = state.institutions?.fbi;
  if (!seat) return 5;
  if (seat.vacant) return 4;
  const { independence, competence } = seat.holder;
  return round1(independence * 0.12 + competence * 0.05);
}

/** Whether there is anything for the Bureau to open a file on. */
function investigationTrigger(state, policyText) {
  const pick = () => SUBJECTS[hashString(`${state.rosterSeed}|${state.month}`) % SUBJECTS.length];
  const scandalArc = (state.arcs || []).find(
    (a) => ["justice", "social"].includes(a.domain) && a.severity >= 3 &&
      (a.status === "active" || a.status === "detonated"));
  if (scandalArc) return `the ${scandalArc.title.toLowerCase()}`;

  if (/\b(cover up|shred|destroy the|off the books|quietly pay|hush|retaliat|purge)\b/i.test(policyText || "")) {
    return "the President's own conduct in office";
  }
  if (state.stability < 35) return pick();
  return null;
}

// --- The monthly tick ------------------------------------------------------

/**
 * One month of jeopardy. Mutates `next` and returns the events worth telling
 * the player about.
 */
export function tickJeopardy(next, policyText) {
  next.jeopardy = next.jeopardy || emptyJeopardy();
  const j = next.jeopardy;
  const events = [];
  const r = seeded(`${next.rosterSeed}|jeopardy|${next.month}|${next.term || 1}`);

  // A convicted president is already gone; an impeached one is on trial.
  if (j.status === "impeached") {
    if (next.month >= (j.trialMonth ?? next.month)) events.push(...senateTrial(next, j));
    return events;
  }

  // 1. Firing the investigator, converted into an article.
  if (j.obstructed) {
    j.obstructed = false;
    addArticle(j, next, "obstruction",
      "You dismissed the FBI Director while an investigation into this administration was open.");
    events.push({ kind: "article", detail: "Firing the Director became an article of impeachment in its own right." });
  }

  // 2. The Bureau's work.
  if (j.investigation) {
    j.investigation.progress = clamp(j.investigation.progress + investigationPace(next));
    if (j.investigation.progress >= 100) {
      addArticle(j, next, "investigation",
        `The Bureau referred its findings on ${j.investigation.subject} to the House.`);
      events.push({ kind: "referral",
        detail: `The FBI has completed its investigation into ${j.investigation.subject} and referred it to Congress.` });
      j.investigation = null;
      if (j.status === "investigating") j.status = "none";
    }
  } else {
    const subject = investigationTrigger(next, policyText);
    if (subject && r.chance(0.45)) {
      j.investigation = { subject, opened: next.month, progress: investigationPace(next) };
      j.status = "investigating";
      const seat = next.institutions?.fbi;
      events.push({ kind: "opened",
        detail: seat && !seat.vacant
          ? `${seat.holder.name} has opened an investigation into ${subject}.`
          : `An acting FBI Director has opened an investigation into ${subject}.` });
    }
  }

  // 3. Other things that become articles on their own.
  for (const arc of next.arcs || []) {
    if (arc.status !== "detonated" || arc.impeachmentLogged) continue;
    if (!["justice", "social"].includes(arc.domain)) continue;
    arc.impeachmentLogged = true;
    addArticle(j, next, "scandal", `${arc.title} blew up in public.`);
  }
  if (next.electorate?.excluded && !j.articles.some((a) => a.source === "franchise")) {
    addArticle(j, next, "franchise", "You took the vote from half the country.");
  }
  if ((next.specialActions?.passed || []).includes("expand_court")
      && !j.articles.some((a) => a.source === "court")) {
    addArticle(j, next, "court", "You added seats to the Supreme Court and filled them yourself.");
  }
  if (next.stability < 25 && !j.articles.some((a) => a.source === "collapse")) {
    addArticle(j, next, "collapse", "The government has stopped functioning around you.");
  }

  // 4. Does the House move?
  if (j.status !== "impeached" && totalWeight(j.articles) >= HOUSE_TRIGGER && !next.congressDissolved) {
    events.push(...houseVote(next, j));
  }
  return events;
}

function addArticle(j, next, source, detail) {
  const spec = ARTICLE_SOURCES[source];
  j.articles.push({
    source, title: spec.title, detail, weight: spec.weight,
    month: next.month, term: next.term || 1,
  });
}

// --- The votes -------------------------------------------------------------

/**
 * A member's personal willingness to break with their own president, apart
 * from ideology. Stable per member and deterministic — the same senator is
 * always the same senator. Without it a caucus flips as one block, because
 * ideologically they all sit at nearly the same distance from the president.
 */
const spine = (member) => (hashString(`${member.id}|spine`) % 1000) / 1000;

/**
 * How a chamber votes on removing the president.
 *
 * Not a policy vote. The opposition needs very little persuading; your own
 * party is held by loyalty, and loyalty is a function of how close they are to
 * you politically and how popular you still are. Popularity is armour — at 80%
 * approval a caucus holds the line, at 25% it starts looking for the exit.
 */
export function removalVote(roster, state, strength) {
  const presidentParty = state.scenario.party;
  const presidentAxis = Number(state.scenario.ideologyAxis) || 0;
  const armour = 0.5 + clamp(state.approval, 0, 100) / 200;

  let yes = 0, dYes = 0, rYes = 0;
  for (const m of roster) {
    const opposition = m.party !== presidentParty;
    const loyalty = opposition ? 0 : (1 - Math.abs(m.axis - presidentAxis)) * armour;
    const score = strength - loyalty + (opposition ? 0.55 : 0) + (spine(m) - 0.5) * 0.5;
    if (score <= 0.35) continue;
    yes += 1;
    if (m.party === "Democrat") dYes += 1; else rYes += 1;
  }
  const total = roster.length;
  return {
    yes, no: total - yes, dYes, rYes, total,
    majority: Math.floor(total / 2) + 1,
    twoThirds: Math.ceil(total * CONVICT_SHARE),
    passed: yes >= Math.floor(total / 2) + 1,
    convicts: yes >= Math.ceil(total * CONVICT_SHARE),
  };
}

const rosterFor = (state) => buildCongress(state, STATES);

function houseVote(next, j) {
  const strength = caseStrength(j);
  const vote = removalVote(rosterFor(next).house, next, strength);
  j.houseVote = vote;

  if (!vote.passed) {
    // The articles stay on the table; the House can come back to them.
    return [{ kind: "house_failed",
      detail: `The House voted ${vote.yes}–${vote.no} against impeachment. ${vote.majority - vote.yes} votes short.` }];
  }

  j.status = "impeached";
  j.trialMonth = next.month + 1;
  next.approval = clamp(round1(next.approval - 4));
  next.stability = clamp(next.stability - 8);
  return [{ kind: "impeached",
    detail: `The House impeached you ${vote.yes}–${vote.no}. The Senate will try you next month, ` +
      `and it takes ${Math.ceil(vote.total * CONVICT_SHARE)} of 100 to convict.` }];
}

function senateTrial(next, j) {
  const strength = caseStrength(j);
  const vote = removalVote(rosterFor(next).senate, next, strength);
  j.senateVote = vote;

  if (vote.convicts) {
    next.over = true;
    next.ending = {
      type: "removed",
      reason: `The Senate convicted you ${vote.yes}–${vote.no} on ${j.articles.length} ` +
        `article${j.articles.length > 1 ? "s" : ""} of impeachment. You are the first president ` +
        `removed by the process the Constitution actually provides for.`,
    };
    return [{ kind: "convicted",
      detail: `Convicted ${vote.yes}–${vote.no}. You are removed from office.` }];
  }

  // Acquitted — and not unharmed.
  j.status = "acquitted";
  j.acquittals += 1;
  j.articles = [];
  j.houseVote = null;
  j.trialMonth = null;
  next.approval = clamp(round1(next.approval - 2.5));
  next.stability = clamp(next.stability - 4);
  next.stakeholders.civil_rights = clamp(next.stakeholders.civil_rights - 5);

  return [{ kind: "acquitted",
    detail: `The Senate acquitted you ${vote.yes}–${vote.no}, ${vote.twoThirds - vote.yes} short of the ` +
      `${vote.twoThirds} needed. You keep the office and the asterisk.` }];
}

// --- Readouts --------------------------------------------------------------

/** A line for the model's context block, only when there is jeopardy. */
export function jeopardySummary(state) {
  const j = state.jeopardy;
  if (!j) return "";
  const parts = [];
  if (j.investigation) {
    parts.push(`An FBI investigation into ${j.investigation.subject} is ${Math.round(j.investigation.progress)}% complete.`);
  }
  if (j.articles.length) {
    parts.push(`${j.articles.length} article(s) of impeachment are on the table: ` +
      `${j.articles.map((a) => a.title).join(", ")}.`);
  }
  if (j.status === "impeached") parts.push("The President has been IMPEACHED and awaits trial in the Senate.");
  if (j.acquittals) parts.push(`The President has survived ${j.acquittals} impeachment trial(s).`);
  return parts.join(" ");
}
