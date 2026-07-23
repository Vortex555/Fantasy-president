import Anthropic from "@anthropic-ai/sdk";
import { STATES } from "./states.js";
import { STAKEHOLDERS, partyControl, electoralCount } from "./gameEngine.js";

const MODEL = process.env.FP_MODEL || "claude-opus-4-8";
// A cheaper model for the many low-stakes calls (advisor chat, opening crises).
const CHAT_MODEL = process.env.FP_CHAT_MODEL || "claude-haiku-4-5";

let client = null;
export function claudeAvailable() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
function getClient() {
  if (!client) client = new Anthropic(); // reads ANTHROPIC_API_KEY from env
  return client;
}

const SYSTEM = `You are the simulation engine behind "Fantasy President," a serious, non-partisan political strategy game. The player is the President of the United States. Each month they respond to an unfolding situation by writing a free-form policy in their own words, optionally with a public message that spins it.

Your job: simulate the realistic downstream consequences of that policy across voters, organized stakeholders, the economy, the press, and the political system. Reward specificity and coherent strategy; punish vagueness, recklessness, and decisions that ignore political constraints. Be even-handed — do not favor any real-world party or ideology. Consequences should be plausible and sometimes create future problems.

You MUST respond with ONLY a single JSON object (no prose, no markdown fences) with exactly this shape:
{
  "analysis": "3-5 sentence federal briefing describing how the policy is being implemented and received. Concrete and grounded.",
  "approvalChange": number,        // net national approval change, -14..14
  "economy": { "gdpGrowth": number, "unemployment": number, "inflation": number, "debt": number }, // small deltas; debt in $trillions
  "stakeholders": [ { "name": "<one of the official stakeholder names>", "change": number, "note": "3-6 word reaction" } ],
  "press": [
    { "outlet": "invented outlet name", "lean": "left",   "headline": "period-appropriate headline" },
    { "outlet": "invented outlet name", "lean": "center", "headline": "period-appropriate headline" },
    { "outlet": "invented outlet name", "lean": "right",  "headline": "period-appropriate headline" }
  ],
  "personas": [ { "name": "First L.", "group": "occupation, state", "mood": "approve|disapprove|mixed", "quote": "1-2 sentence reaction in their voice" } ],
  "stateEffects": [ { "code": "2-letter state code", "change": number } ], // 4-8 states most affected
  "checks": {
    "congress": { "status": "passed|compromised|blocked|executive", "note": "one sentence on what Congress did" },
    "court": { "status": "none|upheld|struck_down", "note": "one sentence on any court challenge" }
  },
  "nextEvent": { "title": "headline for next month's crisis", "brief": "2-4 sentence situation the player must respond to next" },
  "flags": { "removedFromOffice": false, "reason": "" } // set true only for catastrophic, plausible removal (impeachment+conviction, resignation, coup)
}

Rules:
- stakeholder "name" must be EXACTLY one of the provided official names; include every one that meaningfully reacts (changes may be positive, negative, or zero).
- Numbers are DELTAS to add to current values, not absolutes. Keep economic deltas realistic (e.g. gdpGrowth ±0.5, unemployment ±0.4, inflation ±0.6, debt ±1.5).
- Provide 4-6 personas spanning demographics and regions; some should disagree with each other.
- CHECKS & BALANCES ARE REAL. If the policy needs legislation and the opposition controls a chamber, it is often "blocked" or "compromised", not "passed". Executive orders are "executive" but far more likely to be "struck_down" by the Supreme Court, whose current composition is given in the dashboard. Align court hostility with its majority. When a policy is blocked, compromised, or struck down, the approvalChange and other numbers MUST already reflect that diminished or negative outcome (a blocked bold promise can even cost approval).
- Keep it grounded in the scenario's era and the current dashboard. Never break character or mention that this is a game.`;

function stateSummary(state) {
  const stakes = STAKEHOLDERS.map((s) => `${s.name} ${state.stakeholders[s.id]}`).join(", ");
  const control = partyControl(state);
  const ev = electoralCount(state);
  const notableStates = Object.entries(state.stateApproval)
    .sort((a, b) => a[1] - b[1])
    .filter((_, i, arr) => i < 3 || i >= arr.length - 3)
    .map(([code, v]) => `${code} ${v}%`)
    .join(", ");
  return `President: ${state.scenario.presidentName} (${state.scenario.party}), ${state.scenario.era}.
Month ${state.month} of 48.
National approval: ${state.approval}%   Government stability: ${state.stability}%
Economy: GDP growth ${state.economy.gdpGrowth}%, unemployment ${state.economy.unemployment}%, inflation ${state.economy.inflation}%, national debt $${state.economy.debt}T.
Congress: House ${state.congress.houseD}D-${state.congress.houseR}R (${control.house}), Senate ${state.congress.senateD}D-${state.congress.senateR}R (${control.senate}).
Supreme Court: ${state.court.conservative}–${state.court.liberal} ${state.court.conservative >= state.court.liberal ? "conservative" : "liberal"} majority.
Electoral map: ~${ev.win} EV favorable, ~${ev.lose} unfavorable, ~${ev.tossup} tossup.
Stakeholder support (0-100): ${stakes}.
Notable states (approval): ${notableStates}.
Official stakeholder names you must use: ${STAKEHOLDERS.map((s) => s.name).join(", ")}.`;
}

function extractJson(text) {
  let t = text.trim();
  // strip code fences if present
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1) t = t.slice(start, end + 1);
  return JSON.parse(t);
}

export async function claudeTurn(state, policy, publicMessage, event) {
  const user = `${stateSummary(state)}

THIS MONTH'S SITUATION:
${event.title} — ${event.brief}

THE PRESIDENT'S POLICY:
"""${policy}"""

${publicMessage ? `PUBLIC MESSAGE / SPIN:\n"""${publicMessage}"""` : "The president chose not to issue a public message."}

Simulate the consequences and return the JSON object.`;

  const resp = await getClient().messages.create({
    model: MODEL,
    max_tokens: 4000,
    // The rules prompt is identical every turn — cache it so repeat turns bill
    // the prefix at ~10%. Only the per-turn user message varies.
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: user }],
  });

  const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return extractJson(text);
}

// Advisor / cabinet chat — runs on the cheap model. The persona system prompt is
// stable for a given advisor, so it caches across a multi-message conversation.
export async function claudeAdvisor(state, event, advisor, history, userMessage) {
  const control = partyControl(state);
  const sys = `You are ${advisor.name}, the ${advisor.role} to President ${state.scenario.presidentName} (${state.scenario.party}). You are ${advisor.persona}. Your loyalty to the President is ${advisor.loyalty}/100 and your competence is ${advisor.competence}/100 — let these color your tone (a low-loyalty advisor is blunter and more self-interested; a low-competence one gives shakier advice). Stay in character at all times. Speak in the first person, directly to the President, in 2-4 sentences. Be specific to the situation and your area of focus (${advisor.focus}). Never mention that this is a game. Do not use JSON — just speak.

CURRENT SITUATION: ${event?.title || "General strategy"} — ${event?.brief || ""}
DASHBOARD: approval ${state.approval}%, stability ${state.stability}%. Congress: ${control.house} House, ${control.senate} Senate. Supreme Court ${state.court.conservative}-${state.court.liberal} ${state.court.conservative >= state.court.liberal ? "conservative" : "liberal"}. Economy: ${state.economy.gdpGrowth}% GDP, ${state.economy.unemployment}% unemployment, ${state.economy.inflation}% inflation.`;

  const messages = [];
  for (const m of (history || []).slice(-8)) {
    messages.push({ role: m.role === "advisor" ? "assistant" : "user", content: m.text });
  }
  messages.push({ role: "user", content: userMessage });

  const resp = await getClient().messages.create({
    model: CHAT_MODEL,
    max_tokens: 400,
    system: [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }],
    messages,
  });
  return resp.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}

// One debate round: role-play the challenger's rebuttal and score the President.
export async function claudeDebate(state, round, topic, playerLine, history) {
  const opp = state.campaign.opponent;
  const sys = `You are running one round of a televised U.S. presidential debate for a strategy game, playing two roles at once and staying strictly non-partisan.

ROLE 1 — the challenger, ${opp.name}, ${opp.style} (${opp.party}). Deliver a punchy 2-3 sentence rebuttal to the President's answer, in character, hammering the theme of "${opp.attack}". Sharp but not cartoonish.
ROLE 2 — a neutral debate analyst. Score the PRESIDENT's answer for this round from -10 (a gaffe/non-answer) to +10 (a commanding, specific, on-message answer). Reward substance, specificity, confidence and staying on topic; penalize vagueness, rambling, and unforced errors. Then write a one-sentence pundit reaction.

Debate topic this round: ${topic}.
President: ${state.scenario.presidentName} (${state.scenario.party}), current approval ${state.approval}%.

Respond with ONLY JSON: {"opponentLine": "...", "score": number, "pundit": "..."}. No markdown.`;

  const messages = [];
  for (const h of (history || []).slice(-6)) {
    messages.push({ role: h.role === "opponent" ? "assistant" : "user", content: h.text });
  }
  messages.push({ role: "user", content: `The President's answer this round:\n"""${playerLine}"""` });

  const resp = await getClient().messages.create({
    model: CHAT_MODEL,
    max_tokens: 500,
    system: [{ type: "text", text: sys, cache_control: { type: "ephemeral" } }],
    messages,
  });
  const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const out = extractJson(text);
  out.score = Math.max(-10, Math.min(10, Math.round(Number(out.score) || 0)));
  return out;
}

const OPENING_SYSTEM = `You are the simulation engine for "Fantasy President." Generate the opening crisis a newly inaugurated president must face in their first weeks. It should be vivid, specific, and appropriate to the given era and president. Respond with ONLY JSON: {"title": "short headline", "brief": "3-5 sentence situation the player must respond to"}. No markdown, no prose outside the JSON.`;

export async function claudeOpening(scenario) {
  const resp = await getClient().messages.create({
    model: CHAT_MODEL,
    max_tokens: 700,
    system: OPENING_SYSTEM,
    messages: [
      {
        role: "user",
        content: `President ${scenario.presidentName}, a ${scenario.party}, has just taken office. Era/setting: ${scenario.era}. Starting approval: ${scenario.startApproval}%. Generate their opening crisis.`,
      },
    ],
  });
  const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return extractJson(text);
}
