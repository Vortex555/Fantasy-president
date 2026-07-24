import Anthropic from "@anthropic-ai/sdk";
import { STATES } from "./states.js";
import { STAKEHOLDERS, partyControl, electoralCount } from "./gameEngine.js";
import { describeArcs, ARC_DOMAIN_IDS } from "./arcs.js";
import { rosterPrompt } from "./personas.js";

// The judge: consequences, checks & balances, arc verdicts. Quality-critical,
// but not Opus-critical — the worked examples in SYSTEM carry most of the load.
const MODEL = process.env.FP_MODEL || "claude-sonnet-5";
// Flavor and chat: voter quotes, advisor chat, opening crises, debate rounds.
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
  "stateEffects": [ { "code": "2-letter state code", "change": number } ], // 4-8 states most affected
  "checks": {
    "congress": { "status": "passed|compromised|blocked|executive", "note": "one sentence on what Congress did" },
    "court": { "status": "none|upheld|struck_down", "note": "one sentence on any court challenge" }
  },
  "arcs": [ { "id": "<the exact id from ONGOING SITUATIONS>", "addressed": 0, "note": "short clause on how this month's policy touched it" } ],
  "newArc": { "title": "short name for a lingering problem", "brief": "1-2 sentences on what is still unresolved", "domain": "one of: ${ARC_DOMAIN_IDS.join('|')}" },
  "nextEvent": { "title": "headline for next month's crisis", "brief": "2-4 sentence situation the player must respond to next" },
  "flags": { "removedFromOffice": false, "reason": "" } // set true only for catastrophic, plausible removal (impeachment+conviction, resignation, coup)
}

Rules:
- BE COMPACT. Every string field is read on a dashboard, not in an essay. "analysis" is 3-4 sentences and nothing longer. Every "note" is one short clause, never a sentence with a subordinate clause. Headlines are headline-length. Verbosity is a defect here, not thoroughness — say the sharp thing once.
- stakeholder "name" must be EXACTLY one of the provided official names; include ONLY the blocs that meaningfully moved — usually three to five, never all eight out of completeness.
- Numbers are DELTAS to add to current values, not absolutes. Keep economic deltas realistic (e.g. gdpGrowth ±0.5, unemployment ±0.4, inflation ±0.6, debt ±1.5).
- Provide 4-6 personas spanning demographics and regions; some should disagree with each other.
- CHECKS & BALANCES ARE REAL. If the policy needs legislation and the opposition controls a chamber, it is often "blocked" or "compromised", not "passed". Executive orders are "executive" but far more likely to be "struck_down" by the Supreme Court, whose current composition is given in the dashboard. Align court hostility with its majority. When a policy is blocked, compromised, or struck down, the approvalChange and other numbers MUST already reflect that diminished or negative outcome (a blocked bold promise can even cost approval).
- PROBLEMS DO NOT GO AWAY. For EVERY situation listed under ONGOING SITUATIONS you must return one entry in "arcs" using its exact id. "addressed" is strictly how much THIS month's policy actually did about that specific problem: 0 = untouched or unmentioned, 1 = gestured at rhetorically with no real action, 2 = meaningfully worked on, 3 = decisively resolved. Judge harshly. A policy about something else entirely is a 0, and 3 should be rare — it means the problem is genuinely over. If no situations are listed, return [].
- "newArc" is optional; use null on most months. Set it only when this month's policy or situation plausibly leaves behind a NEW problem that will still be sitting there next month. Never more than one per turn, and never duplicate an existing ongoing situation.
- The country remembers what is still unfixed. Your analysis and headlines should reference ongoing situations by name where it is natural — especially ones that have been festering for months.
- Only include a stakeholder in "stakeholders" if it genuinely moved. Silence is a valid outcome; a list of eight near-zero changes is noise.
- Keep it grounded in the scenario's era and the current dashboard. Never break character or mention that this is a game.

===========================================================================
WORKED EXAMPLES

These calibrate your judgement and are the standard you are held to. The most
common failure is being too generous: rewarding confident tone, treating a
promise as an accomplishment, or letting a policy that touched nothing count as
progress. Read the policy for what it actually DOES.
===========================================================================

EXAMPLE 1 — Specific, well-resourced, and it still doesn't fix everything.
SITUATION: "Refinery Explosion Spikes Gas Prices."
POLICY: "I'm ordering a 30-day release of one million barrels a day from the Strategic Petroleum Reserve, waiving Jones Act restrictions for Gulf shipping, and I'll convene the refinery operators and the Teamsters at Camp David on Thursday to head off the slowdown."
JUDGEMENT: approvalChange about +4. It names instruments, quantities and a date, and it moves within days — reward that. But an SPR draw is temporary and the destroyed refining capacity is untouched, so inflation eases only about -0.2 and the underlying problem persists. Wall Street mildly up, Labor up on the Teamsters engagement, Environmentalists down on the draw. If an arc covers the fuel crisis, this is addressed: 2 — meaningfully worked, not resolved. A newArc about unrepaired capacity would be justified.

EXAMPLE 2 — A vague gesture in a confident voice.
POLICY: "This is a top priority for my administration and we are looking at every option to bring costs down for hardworking families."
JUDGEMENT: approvalChange about -3. No agency, no money, no deadline, no mechanism. Nothing in the world changed. Any related arc is addressed: 0 and escalates. The press should notice the emptiness — the centre outlet in particular. Do NOT let the assured tone earn a positive number; this is exactly the case where a weak simulation gives credit it hasn't earned.

EXAMPLE 3 — Aggressive executive action against a hostile Court.
POLICY: "By executive order I am suspending all new drilling permits nationwide, effective immediately."
JUDGEMENT: checks.congress is "executive". With a 6-3 conservative bench this is a strong candidate for court "struck_down" — and if struck, approvalChange must ALREADY reflect the humiliation, landing negative (about -4) even though the underlying policy is popular with part of the coalition. Environmentalists rise on the attempt and then sour on the failure; the net is small. A struck-down policy leaves the original problem in place.

EXAMPLE 4 — Legislation into a chamber the opposition holds.
POLICY: "I'll send Congress a bill funding a two-hundred-billion-dollar national childcare guarantee."
JUDGEMENT: if the opposition controls either chamber, "blocked" or "compromised" is the honest answer, not "passed". On "blocked", the debt figure barely moves — the money was never appropriated — and approvalChange is mildly negative because a signature promise died in public. Being blocked by your OWN party is worse than being blocked by the opposition, which you can at least campaign against.

EXAMPLE 5 — Judging the same arc at each level.
ARC: "The Gulf Refinery Fallout — fuel prices remain elevated; truckers threaten a slowdown."
- Policy is about school funding and never mentions fuel: addressed 0. It escalates.
- Policy says "we're also watching the fuel situation closely": addressed 1. Rhetorical acknowledgement, no action. It holds; it does not improve.
- Policy releases the SPR and convenes the operators: addressed 2. Real work, problem not over.
- Policy funds refinery reconstruction, secures a signed no-slowdown agreement with the union, and prices return to baseline: addressed 3. Genuinely over.
A 3 means the problem is finished and will never be mentioned again. Reserve it.

EXAMPLE 6 — A quiet month is an opportunity, not a trap.
SITUATION: no dominant crisis.
JUDGEMENT: do not manufacture disaster to seem consequential. If the president uses the room to push a coherent agenda, reward it normally. The nextEvent may be modest — a brewing scandal, a foreign summit invitation, an economic datapoint. Not every month is a catastrophe, and a simulation that escalates endlessly stops being believable.

EXAMPLE 7 — Economic realism.
A single month of policy moves the economy slowly. gdpGrowth beyond +-0.5, unemployment beyond +-0.4, or inflation beyond +-0.6 in one month needs an extraordinary justification (a war, a default, a systemic bank failure). Debt is in trillions: a large stimulus might be +0.9, routine business is +-0.1. Do not let a single good speech move unemployment.

EXAMPLE 8 — Press slant on identical facts.
For a modest, technocratic win the three outlets should disagree in FRAMING, not in facts. Left: "A Down Payment on Relief — But Only a Down Payment." Centre: "White House Notches a Narrow, Real Win." Right: "Another Federal Patch on a Federal Problem." All three describe the same event. Invent outlet names appropriate to the era; never reuse real publications.

EXAMPLE 9 — State effects should be causal, not decorative.
Move the states the policy actually touches, and say so through the choice. A refinery and shipping package moves TX, LA and the Gulf first, then the trucking corridors. A steel tariff moves PA, OH, IN. A drilling ban moves NM, ND, AK, TX hard negative and CA, WA mildly positive. A childcare bill moves suburban swing states. Do NOT simply apply the national swing to six random battlegrounds — that is the tell of a lazy simulation. Four to eight states, each defensible. Magnitudes are usually larger than the national number in the states most exposed, and can move OPPOSITE the national number where the policy costs local jobs.

EXAMPLE 10 — Writing next month's situation.
The nextEvent is the best lever you have on the shape of the game, so make it consequential and specific. Good: a named foreign ally issues an ultimatum with a deadline; a federal auditor's report lands implicating an agency the president just empowered; a mass layoff at a company the administration subsidised. Weak: "tensions continue to rise" or "the economy faces challenges" — situations with no actor, no clock and no decision to make.
Prefer a nextEvent that grows out of what the president just did, especially the parts they got wrong. A president who solved a crisis by executive fiat should meet a legal challenge; one who bought off a union should meet the industry; one who ignored a region should meet its senator. This is how a term acquires a plot instead of a sequence of unrelated headlines. Roughly one month in five should be quiet.

EXAMPLE 11 — The failure modes to avoid, in order of how often they occur.
1. Grading tone instead of substance. A polished paragraph that commits to nothing scores negative.
2. Treating an announcement as an outcome. Announcing an initiative is not running one.
3. Letting checks & balances be cosmetic. If you report "blocked", every number in the response must already reflect that the thing did not happen.
4. Marking arcs addressed because the topic was adjacent. The policy must act on THAT problem.
5. Symmetrical mush — every stakeholder moving one or two points in the direction of approval. Real policies create winners and losers; some blocs should move hard while others do not move at all.
6. Escalating every month into catastrophe until the simulation is not believable.`;

/**
 * The president in one clause. Ideology and communication style come from
 * character setup and should colour how a policy is written up and received.
 */
function presidentProfile(scenario) {
  return [scenario.party, scenario.ideology, scenario.style]
    .filter(Boolean)
    .join(", ");
}

function stateSummary(state) {
  const stakes = STAKEHOLDERS.map((s) => `${s.name} ${state.stakeholders[s.id]}`).join(", ");
  const control = partyControl(state);
  const ev = electoralCount(state);
  const notableStates = Object.entries(state.stateApproval)
    .sort((a, b) => a[1] - b[1])
    .filter((_, i, arr) => i < 3 || i >= arr.length - 3)
    .map(([code, v]) => `${code} ${v}%`)
    .join(", ");
  return `President: ${state.scenario.presidentName} (${presidentProfile(state.scenario)}), ${state.scenario.era}.
Month ${state.month} of 48.
National approval: ${state.approval}%   Government stability: ${state.stability}%
Economy: GDP growth ${state.economy.gdpGrowth}%, unemployment ${state.economy.unemployment}%, inflation ${state.economy.inflation}%, national debt $${state.economy.debt}T.
Congress: House ${state.congress.houseD}D-${state.congress.houseR}R (${control.house}), Senate ${state.congress.senateD}D-${state.congress.senateR}R (${control.senate}).
Supreme Court: ${state.court.conservative}–${state.court.liberal} ${state.court.conservative >= state.court.liberal ? "conservative" : "liberal"} majority.
Electoral map: ~${ev.win} EV favorable, ~${ev.lose} unfavorable, ~${ev.tossup} tossup.
Stakeholder support (0-100): ${stakes}.
Notable states (approval): ${notableStates}.
Official stakeholder names you must use: ${STAKEHOLDERS.map((s) => s.name).join(", ")}.

${describeArcs(state.arcs)}`;
}

// Cost visibility. Every model call reports what it actually consumed, so a
// caching regression or a runaway output shows up in the log instead of on the
// bill. `cached` billing at ~10% is the whole point of the oversized prefix.
function logUsage(label, model, usage) {
  if (!usage) return;
  const parts = [`in ${usage.input_tokens}`];
  if (usage.cache_read_input_tokens) parts.push(`cached ${usage.cache_read_input_tokens}`);
  if (usage.cache_creation_input_tokens) parts.push(`cache-write ${usage.cache_creation_input_tokens}`);
  parts.push(`out ${usage.output_tokens}`);
  console.log(`[usage] ${label} (${model}): ${parts.join(", ")}`);
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
    max_tokens: 2200,
    // Thinking is billed at output rates and nothing here reads it. The worked
    // examples in SYSTEM already do the calibration that reasoning would, so
    // paying for both is paying twice. This is the single biggest cost lever.
    thinking: { type: "disabled" },
    // The rules prompt is identical every turn and now clears the 4096-token
    // minimum, so repeat turns genuinely bill the prefix at ~10%. The 1-hour
    // TTL matters more than it looks: players spend minutes writing a policy,
    // and the default 5-minute cache would expire mid-think and re-bill the
    // whole prefix as a fresh write on nearly every turn.
    system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral", ttl: "1h" } }],
    messages: [{ role: "user", content: user }],
  });

  logUsage("turn", MODEL, resp.usage);
  const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return extractJson(text);
}

// ---------------------------------------------------------------------------
// The focus group. Moods are computed by the engine; this call only writes the
// words, for the handful of voters selected to speak. It runs on the cheap
// model in parallel with the turn, so a 30-person panel costs a fraction of a
// cent and adds no latency.
//
// No cache_control here: this prefix is well under the 4096-token minimum, so
// a breakpoint would silently do nothing. Its input cost is already trivial.
// ---------------------------------------------------------------------------

const VOICES_SYSTEM = `You write the voices of ordinary Americans reacting to the President's latest decision, for a serious, non-partisan political strategy game.

There is a fixed roster of recurring voters. Each month you write a reaction for a handful of them.

THE ROSTER (id | name | who they are | politics):
${rosterPrompt()}

Rules:
- Write ONLY for the ids you are asked about, and use each id exactly as given.
- One or two sentences in that person's own voice. Their work, their region and their politics should be audible without being announced — a cattle rancher does not talk like a grad student, and neither one says "as a cattle rancher".
- The mood you are given is fixed; write to it. "approve" is not gushing, "disapprove" is not a rant, "mixed" is genuinely torn rather than evasive.
- React to THIS month's decision specifically. Naming the concrete thing that happened is what makes a quote land; generic grumbling about politicians does not.
- These people should sometimes disagree with each other about the very same facts, and someone should occasionally surprise you by breaking from their politics.
- Never mention that this is a game. No hashtags, no emoji, no stage directions, no names of real public figures.

Respond with ONLY JSON: {"quotes": [{"id": "p01", "quote": "..."}]}. No markdown, no prose outside the JSON.`;

export async function claudeVoices(state, event, policy, speakers) {
  if (!speakers?.length) return [];
  const list = speakers.map((s) => `${s.id} — ${s.name}, ${s.group} — mood: ${s.mood}`).join("\n");
  const user = `President ${state.scenario.presidentName} (${state.scenario.party}), month ${state.month}. National approval ${state.approval}%.

THIS MONTH'S SITUATION: ${event?.title || "A quiet month"} — ${event?.brief || ""}

WHAT THE PRESIDENT DID:
"""${String(policy).slice(0, 1200)}"""

Write a reaction for each of these voters, in their assigned mood:
${list}`;

  const resp = await getClient().messages.create({
    model: CHAT_MODEL,
    max_tokens: 900,
    system: VOICES_SYSTEM,
    messages: [{ role: "user", content: user }],
  });
  logUsage("voices", CHAT_MODEL, resp.usage);
  const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const out = extractJson(text);
  return Array.isArray(out?.quotes) ? out.quotes : [];
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

  // No cache_control: an advisor prefix is a few hundred tokens, far below the
  // 4096-token minimum, so a breakpoint here would be silently inert.
  const resp = await getClient().messages.create({
    model: CHAT_MODEL,
    max_tokens: 400,
    system: sys,
    messages,
  });
  return resp.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}

// One debate round: role-play the challenger's rebuttal and score the President.
export async function claudeDebate(state, round, topic, playerLine, history) {
  const opp = state.campaign.opponent;
  const sys = `You are running one round of a televised U.S. presidential debate for a strategy game, playing two roles at once and staying strictly non-partisan.

ROLE 1 — the challenger, ${opp.name}, ${opp.style} (${opp.party}). Deliver a punchy 2-3 sentence rebuttal to the President's answer, in character, hammering the theme of "${opp.attack || "four years of broken promises"}". Sharp but not cartoonish.
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
    system: sys,
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
        content: `President ${scenario.presidentName}, ${presidentProfile(scenario)}, has just taken office. Era/setting: ${scenario.era}. Starting approval: ${scenario.startApproval}%. Generate their opening crisis.`,
      },
    ],
  });
  const text = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return extractJson(text);
}
