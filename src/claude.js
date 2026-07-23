import Anthropic from "@anthropic-ai/sdk";
import { STATES } from "./states.js";
import { STAKEHOLDERS, partyControl, electoralCount } from "./gameEngine.js";

const MODEL = process.env.FP_MODEL || "claude-opus-4-8";

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
  "nextEvent": { "title": "headline for next month's crisis", "brief": "2-4 sentence situation the player must respond to next" },
  "flags": { "removedFromOffice": false, "reason": "" } // set true only for catastrophic, plausible removal (impeachment+conviction, resignation, coup)
}

Rules:
- stakeholder "name" must be EXACTLY one of the provided official names; include every one that meaningfully reacts (changes may be positive, negative, or zero).
- Numbers are DELTAS to add to current values, not absolutes. Keep economic deltas realistic (e.g. gdpGrowth ±0.5, unemployment ±0.4, inflation ±0.6, debt ±1.5).
- Provide 4-6 personas spanning demographics and regions; some should disagree with each other.
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
    system: SYSTEM,
    messages: [{ role: "user", content: user }],
  });

  const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return extractJson(text);
}

const OPENING_SYSTEM = `You are the simulation engine for "Fantasy President." Generate the opening crisis a newly inaugurated president must face in their first weeks. It should be vivid, specific, and appropriate to the given era and president. Respond with ONLY JSON: {"title": "short headline", "brief": "3-5 sentence situation the player must respond to"}. No markdown, no prose outside the JSON.`;

export async function claudeOpening(scenario) {
  const resp = await getClient().messages.create({
    model: MODEL,
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
