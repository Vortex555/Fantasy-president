import { hashString, clamp, round1 } from "./rng.js";

/**
 * The Supreme Court, as nine people rather than two numbers.
 *
 * Congress has always voted here member by member — a real roll call across 535
 * names, and an impeachment polled senator by senator. The third branch, the
 * one that can void a president's signature policy outright, was a weighted
 * coin: a 6–3 count and a hash. So the nine justices the game already names,
 * gives ideologies to and draws on the dashboard decided nothing.
 *
 * They decide it now, and they decide it on two axes rather than one. Politics
 * is the obvious axis. The other is deference — how far a justice will let *any*
 * president stretch executive power — and it is what produces the interesting
 * results: a conservative institutionalist upholding a liberal president's
 * order, a liberal textualist striking one down. A 6–3 bench is not a 6–3
 * outcome, which is the whole point of having nine people instead of a ratio.
 */

/** How far justices range in their tolerance for executive power. */
export const DEFERENCE_RANGE = [0.12, 0.88];

const partySign = (party) => (party === "Republican" ? 1 : party === "Democrat" ? -1 : 0);

const presidentAxis = (state) => {
  const axis = Number(state?.scenario?.ideologyAxis);
  if (Number.isFinite(axis)) return Math.max(-1, Math.min(1, axis));
  return partySign(state?.scenario?.party) * 0.45;
};

/**
 * How much a justice defers to executive power, regardless of who holds it.
 *
 * Stable per justice and independent of their politics, because that is exactly
 * what makes a bench unpredictable: the swing vote on executive overreach is
 * rarely the ideological centre.
 */
export function deferenceOf(justice) {
  const [lo, hi] = DEFERENCE_RANGE;
  const n = (hashString(`${justice?.name || "seat"}|deference`) % 1000) / 1000;
  return round1(lo + n * (hi - lo));
}

// What kind of legal question this is.
//
// Deliberately looser than it looks: a president writes "by emergency decree",
// "I hereby direct" and "acting under my authority as Commander in Chief", and
// a pattern that only matches the exact phrase "by decree" reads all three as
// ordinary legislation and never convenes the Court at all.
const EXECUTIVE = new RegExp([
  "executive (?:order|action|authority)", "by executive",
  "decree", "\\bfiat\\b", "emergency (?:power|authority|declaration)",
  "i (?:will |hereby |am )?(?:direct|order|instruct)", "i'll (?:direct|order|instruct)",
  "instruct(?:ing)? the", "order(?:ing)? the", "\\bdirective\\b",
  "unilateral", "commander in chief", "without (?:waiting for |the consent of )?congress",
].join("|"), "i");

const AGGRESSIVE = new RegExp([
  "\\b(?:ban|mandate|suspend|ignore|bypass|bypassing|override|shut down|impound|confiscate)\\b",
  "seiz", "nationalis", "nationaliz", "emergenc", "unilateral",
].join("|"), "i");

/**
 * Words that pull a policy left or right of wherever the president stands.
 *
 * Stems are unanchored on the right for the same reason as EXECUTIVE above: a
 * trailing \b makes "nationalis" fail to match "nationalising", which is the
 * form anybody actually writes.
 */
const LEFTWARD = new RegExp([
  "nationalis", "nationaliz", "redistribut", "decarbonis", "decarboniz",
  "\\b(?:union|unions|welfare|climate|emissions|abortion)\\b",
  "public ownership", "workers", "civil rights", "voting rights", "living wage",
].join("|"), "i");

const RIGHTWARD = new RegExp([
  "deregulat", "privatis", "privatiz", "deport",
  "\\b(?:police|gun|guns|drilling|tariffs?)\\b",
  "tax cut", "law and order", "second amendment", "religious", "school choice",
  "border (?:wall|security|enforcement)",
].join("|"), "i");

/**
 * What the Court is actually being asked about: where the policy sits on the
 * spectrum, and whether it is an exercise of executive power or an act of
 * Congress. Legislation is far harder to strike than an order.
 */
export function policyThrust(state, policyText) {
  const text = String(policyText || "");
  const executive = EXECUTIVE.test(text);
  const aggressive = executive && AGGRESSIVE.test(text);

  // A policy starts from the politics of the president who signed it, then
  // moves for what it actually does.
  let axis = presidentAxis(state);
  if (LEFTWARD.test(text)) axis -= 0.18;
  if (RIGHTWARD.test(text)) axis += 0.18;

  return {
    axis: round1(Math.max(-1, Math.min(1, axis))),
    executive,
    aggressive,
    // A stable per-case wobble: the same case argued twice comes out the same,
    // but two similar cases do not automatically produce the same bench split.
    caseSeed: hashString(text.slice(0, 240)),
  };
}

// --- One justice --------------------------------------------------------------

const UPHOLD_THRESHOLD = 0.5;

/**
 * How much each axis is worth.
 *
 * Politics dominates, as it should — but deference is heavy enough to move a
 * moderate across the line on its own, which is what produces the cases worth
 * reading: a conservative institutionalist upholding a liberal order, or a
 * liberal textualist refusing to.
 */
const POLITICS_WEIGHT = 0.85;
const DEFERENCE_WEIGHT = 0.45;

/**
 * How a single justice votes.
 *
 * Agreement with the policy's politics is most of it. Deference decides the
 * rest, and it is what an aggressive assertion of executive power actually
 * tests — a justice with no patience for it will strike down something they
 * politically agree with.
 */
export function justiceVote(justice, thrust, state) {
  const deference = deferenceOf(justice);
  // 0..1: how close this justice is to the policy's politics. In practice this
  // lands between about 0.5 (opposed) and 0.95 (aligned), so it is centred on
  // 0.7 rather than 0.5 — otherwise the whole bench sits on one side of the
  // line and no case ever turns on anybody.
  const agreement = 1 - Math.abs((justice.axis ?? 0) - thrust.axis) / 2;

  // An act of Congress carries a presumption of constitutionality; an executive
  // order carries none, and an aggressive one is actively suspect. This is a
  // flat cost rather than a multiple of deference, because otherwise it
  // swamps the politics entirely and every bench strikes everything.
  const scruple = thrust.aggressive ? 0.14 : thrust.executive ? 0.05 : 0;

  // Every justice is their own person beyond their politics.
  const idiosyncrasy = ((hashString(`${justice.name}|${thrust.caseSeed}`) % 1000) / 1000 - 0.5) * 0.16;
  const chiefWeight = justice.chief ? 0.04 : 0; // the chief leans institutional

  // Full precision here on purpose. Rounding before the comparison quantises
  // every justice to the nearest tenth, which collapses exactly the near-misses
  // that make a 5–4 a 5–4 — and can flip a vote outright.
  const score = 0.5
    + (agreement - 0.7) * POLITICS_WEIGHT
    + (deference - 0.5) * DEFERENCE_WEIGHT
    - scruple + idiosyncrasy + chiefWeight;
  const uphold = score > UPHOLD_THRESHOLD;

  return {
    name: justice.name,
    wing: justice.wing,
    ideology: justice.ideology,
    axis: justice.axis,
    chief: Boolean(justice.chief),
    deference,
    score: Math.round(score * 1000) / 1000,
    uphold,
    // How close this justice was to voting the other way.
    margin: Math.round(Math.abs(score - UPHOLD_THRESHOLD) * 1000) / 1000,
    reason: reasonFor({ uphold, agreement, deference, thrust }),
  };
}

function reasonFor({ uphold, agreement, deference, thrust }) {
  if (uphold) {
    if (deference >= 0.6 && agreement < 0.5) return "defers to the executive despite disagreeing with it";
    if (agreement >= 0.7) return "finds the policy plainly within the President's authority";
    return "sees no constitutional defect worth striking";
  }
  if (thrust.aggressive && deference < 0.45) return "will not let this office stretch that far";
  if (agreement < 0.4) return "finds the reasoning as unpersuasive as the politics";
  return "holds that this needed an act of Congress";
}

// --- The bench ----------------------------------------------------------------

/**
 * The whole Court on one policy.
 *
 * Only a genuine challenge is heard: an act of Congress passed the ordinary way
 * does not reach the bench, and neither does a policy nobody has standing to
 * sue over.
 */
export function courtRuling(state, policyText) {
  const thrust = policyThrust(state, policyText);
  const justices = state.justices || [];

  // Aggressive executive action always draws a challenge; an ordinary order
  // draws one often enough to matter.
  const challenged = thrust.aggressive
    || (thrust.executive && hashString(`${policyText}|cert`) % 100 < 45);
  if (!challenged || justices.length < 5) {
    return {
      heard: false, thrust, votes: [], upholds: 0, strikes: 0, struck: false,
      majority: [], dissent: [], opinion: "",
    };
  }

  const votes = justices.map((j) => justiceVote(j, thrust, state));
  const upholds = votes.filter((v) => v.uphold).length;
  const strikes = votes.length - upholds;
  const struck = strikes > upholds;

  const majority = votes.filter((v) => v.uphold !== struck);
  const dissent = votes.filter((v) => v.uphold === struck);
  // Whoever came closest to crossing is the justice who actually decided it.
  const swing = [...majority].sort((a, b) => a.margin - b.margin)[0] || null;

  return {
    heard: true,
    thrust,
    votes,
    upholds,
    strikes,
    struck,
    majority,
    dissent,
    swing,
    tally: `${Math.max(upholds, strikes)}–${Math.min(upholds, strikes)}`,
    opinion: opinionFor({ struck, upholds, strikes, swing, dissent, thrust }),
  };
}

function opinionFor({ struck, upholds, strikes, swing, dissent, thrust }) {
  const tally = `${Math.max(upholds, strikes)}–${Math.min(upholds, strikes)}`;
  const close = Math.abs(upholds - strikes) <= 1;
  const kind = thrust.aggressive ? "the order" : thrust.executive ? "the directive" : "the policy";

  if (struck) {
    return close
      ? `The Court struck ${kind} down ${tally}. ${swing ? `${swing.name} ${swing.reason}, and that was the case.` : ""} ` +
        `${dissent.length ? `${dissent[0].name} wrote for the dissent.` : ""}`.trim()
      : `The Court struck ${kind} down ${tally} — not close, and not appealable. ` +
        `${swing ? `Even ${swing.name}, who ${swing.reason}, went with the majority.` : ""}`.trim();
  }
  return close
    ? `Upheld ${tally}. ${swing ? `${swing.name} ${swing.reason} — one vote the other way and it falls.` : ""}`.trim()
    : `Upheld ${tally}. ${dissent.length ? `${dissent[0].name} dissented, and ${dissent[0].reason}.` : "The bench was not seriously divided."}`.trim();
}

/** A line for the model's context block, when the bench is a live constraint. */
export function courtSummary(state) {
  const justices = state.justices || [];
  if (!justices.length) return "";
  const deferential = justices.filter((j) => deferenceOf(j) >= 0.6).length;
  return `The bench: ${justices.map((j) =>
    `${j.name} (${j.wing}, ${j.ideology})`).join(", ")}. ` +
    `${deferential} of ${justices.length} are broadly deferential to executive power.`;
}
