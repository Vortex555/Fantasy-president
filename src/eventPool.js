import { seeded } from "./rng.js";

/**
 * Hand-written situations, used by Classic event generation and mixed into
 * Hybrid months.
 *
 * Every entry states an actor, a clock and a decision. A situation with no
 * deadline and nobody on the other side of it is not an event, it is weather.
 */

const POOL = [
  { id: "bank_run", domain: "economy", weight: 3,
    title: "A Regional Bank Fails on a Friday",
    brief: "Regulators seized the fourth-largest lender in the Midwest overnight. Two more banks with similar books open Monday morning, and depositors are already queuing. Treasury wants a blanket guarantee by Sunday night; the deficit hawks in your own party are calling it a bailout." },
  { id: "strike", domain: "economy", weight: 3,
    title: "The Ports Go Out",
    brief: "Ninety thousand dockworkers walked at midnight over automation clauses. Every container on both coasts stops moving in four days. You have the authority to force them back to work, and using it would end a fifty-year understanding between your office and organised labour." },
  { id: "inflation_spike", domain: "economy", weight: 2,
    title: "Groceries Jump Again",
    brief: "The monthly print came in at nearly double the forecast, led by food and rent. The Fed chair has signalled they will act alone if you do not. Voters do not distinguish between the Fed and you." },
  { id: "shutdown", domain: "economy", weight: 2,
    title: "Eleven Days to a Shutdown",
    brief: "The continuing resolution expires in eleven days and the votes are not there. The other side wants a policy rider you have publicly called a red line. Eight hundred thousand federal workers are drafting furlough notices." },

  { id: "ally_ultimatum", domain: "foreign", weight: 3,
    title: "An Ally Issues a Deadline",
    brief: "A treaty partner has given you six weeks to commit to their defence in writing or they will open direct talks with your principal adversary. Their government falls either way; the question is who it falls toward." },
  { id: "hostages", domain: "foreign", weight: 2,
    title: "Nine Citizens Taken",
    brief: "Nine of your citizens, including two children, were taken from a resort by a militia your intelligence services have described as 'negotiable'. The families are on television by lunchtime. Paying works and paying guarantees it happens again." },
  { id: "border_surge", domain: "security", weight: 2,
    title: "The Border Numbers Break the Record",
    brief: "Crossings hit an all-time monthly high and three border-state governors have started busing arrivals to cities that did not ask for them. Your own party is split down the middle on whether this is a humanitarian failure or an enforcement one." },

  { id: "court_strikes", domain: "justice", weight: 3,
    title: "The Court Takes Your Signature Policy",
    brief: "The Supreme Court granted certiorari on your flagship programme and scheduled argument for this term. Your Solicitor General privately puts the odds at a coin flip. There is a legislative fix available that requires the votes you do not have." },
  { id: "leak", domain: "justice", weight: 2,
    title: "A Deputy Secretary Is Leaking",
    brief: "Three stories in eight days have carried verbatim quotes from closed meetings. Counterintelligence has narrowed it to four people, one of whom you appointed personally. A leak investigation of your own staff will itself leak." },
  { id: "pardon", domain: "justice", weight: 2,
    title: "The Pardon Request You Cannot Ignore",
    brief: "A former ally, convicted on charges they insist were political, has filed for clemency and gone on television to ask you directly. Your base considers it a test of loyalty; the Justice Department considers it a line." },

  { id: "outbreak", domain: "health", weight: 3,
    title: "A Cluster in Three Cities",
    brief: "A respiratory illness with a fourteen-day incubation has appeared in three unconnected cities. CDC wants travel restrictions now on incomplete data. Acting early and being wrong is a career-ending humiliation; acting late and being right is worse." },
  { id: "disaster", domain: "health", weight: 3,
    title: "The Storm Sits Over the Coast",
    brief: "A category four stalled over a metropolitan area of four million and has not moved in eighteen hours. The governor is from the other party and has already blamed you on air. FEMA needs a disaster declaration and forty thousand personnel." },
  { id: "grid", domain: "health", weight: 2,
    title: "The Grid Fails in a Cold Snap",
    brief: "Eleven million people lost power in sub-zero temperatures after a regional operator's reserves failed. The deaths are being counted daily. The fix is federal reliability standards the affected states have spent a decade refusing." },

  { id: "protests", domain: "social", weight: 3,
    title: "The Protests Reach the Capital",
    brief: "Six days of demonstrations have grown from one city to forty, and tonight they are on the Mall. The mayor has asked for the Guard. Your own coalition is on both sides of the barricade and will read whatever you do as picking one." },
  { id: "scandal_aide", domain: "social", weight: 2,
    title: "Your Chief of Staff Is Named",
    brief: "A congressional committee named your Chief of Staff in a subpoena over contracts steered to a donor. They deny it convincingly and privately admit the emails are bad. Every hour they stay is a story about you." },
  { id: "ai_layoffs", domain: "social", weight: 2,
    title: "A Household Name Cuts Thirty Thousand",
    brief: "One of the largest private employers in the country announced thirty thousand redundancies and named automation as the reason, the same quarter it announced record profits. Its plants are in four states you cannot lose." },

  { id: "quiet", domain: "social", weight: 2, quiet: true,
    title: "A Quiet Month",
    brief: "No single crisis dominates the news. The wires are running process stories and the networks are down to weather. This is the rarest thing a president gets: room to choose the subject. What do you push while nobody is forcing your hand?" },
];

/** Situations that would be anachronistic before their time. */
const NOT_BEFORE = { ai_layoffs: 2015, grid: 1990 };

function eligible(state) {
  const year = (state.scenario.startYear || 2025) + Math.floor((state.month - 1) / 12);
  return POOL.filter((e) => year >= (NOT_BEFORE[e.id] ?? 0));
}

/**
 * Draw a situation the player has not already seen this term. Weighted, and
 * seeded on the month so a resumed career sees the same month it would have.
 */
export function drawEvent(state) {
  const seen = new Set(state.seenEvents || []);
  const pool = eligible(state);
  const fresh = pool.filter((e) => !seen.has(e.id));
  const candidates = fresh.length ? fresh : pool;

  const r = seeded(`${state.scenario.presidentName}|pool|${state.month}`);
  const total = candidates.reduce((sum, e) => sum + e.weight, 0);
  let roll = r.next() * total;
  const chosen = candidates.find((e) => (roll -= e.weight) <= 0) || candidates[0];

  return { id: chosen.id, title: chosen.title, brief: chosen.brief, domain: chosen.domain };
}

/** In Hybrid, roughly one month in three comes from the pool. */
export function shouldUsePool(state, mode) {
  if (mode === "classic") return true;
  if (mode !== "hybrid") return false;
  return seeded(`${state.scenario.presidentName}|mix|${state.month}`).chance(0.34);
}

export function rememberEvent(next, event) {
  if (!event?.id) return;
  next.seenEvents = [...(next.seenEvents || []), event.id].slice(-24);
}
