import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createGame,
  applyResult,
  mockTurn,
  mockVoices,
  mockAdvisor,
  mockDebate,
  fireAdvisor,
  finishCampaign,
  openingEvent,
  STAKEHOLDERS,
} from "./gameEngine.js";
import { STATES } from "./states.js";
import { attachQuotes } from "./personas.js";
import { applyDeployment, editFirstLady, FIRST_LADY_CAUSES } from "./firstLady.js";
import { INSTITUTIONS, candidatesFor, appoint, dismiss } from "./institutions.js";
import { SPECIAL_ACTIONS, availability, odds, propose } from "./specialActions.js";
import { REGIONS as FOREIGN_REGIONS } from "./foreign.js";
import { SOCIETY_METRICS } from "./society.js";
import { COVERT_ACTIONS } from "./covert.js";
import { drawEvent, shouldUsePool } from "./eventPool.js";
import { claudeAvailable, claudeTurn, claudeVoices, claudeOpening, claudeAdvisor, claudeDebate } from "./claude.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

const USING_AI = claudeAvailable();
console.log(
  USING_AI
    ? "[Fantasy President] ANTHROPIC_API_KEY found — turns will be simulated by Claude."
    : "[Fantasy President] No ANTHROPIC_API_KEY — running the built-in local simulation. Set the key for full AI turns."
);

// Static reference data for the client (states + stakeholders + mode).
app.get("/api/meta", (_req, res) => {
  res.json({
    ai: USING_AI,
    states: STATES,
    stakeholders: STAKEHOLDERS.map((s) => ({ id: s.id, name: s.name })),
    institutions: INSTITUTIONS.map(({ id, title, term, remit, vacancyNote }) =>
      ({ id, title, term, remit, vacancyNote })),
    specialActions: SPECIAL_ACTIONS.map(({ id, group, title, desc, requirement }) =>
      ({ id, group, title, desc, requirement })),
    foreignRegions: FOREIGN_REGIONS.map(({ id, name, emoji }) => ({ id, name, emoji })),
    societyMetrics: SOCIETY_METRICS,
    covertActions: COVERT_ACTIONS,
    firstLadyCauses: FIRST_LADY_CAUSES.map(({ id, label }) => ({ id, label })),
  });
});

// Start a new career.
app.post("/api/start", async (req, res) => {
  try {
    const scenario = sanitizeScenario(req.body?.scenario);
    const state = createGame(scenario);
    const event = await nextSituation(state, scenario);
    res.json({ state, event });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to start game." });
  }
});

/**
 * Where a situation comes from. Classic always draws the hand-written pool,
 * Dynamic always asks the model, Hybrid mixes them — and any mode falls back
 * to the pool if the model is unavailable or errors.
 */
async function nextSituation(state, scenario) {
  const mode = scenario.events || "hybrid";
  if (!USING_AI || shouldUsePool(state, mode)) return drawEvent(state);
  try {
    return await claudeOpening(scenario);
  } catch (err) {
    console.error("Opening generation failed, drawing from the pool:", err.message);
    return drawEvent(state);
  }
}

// Resolve one month: apply the player's policy, return consequences + new state.
app.post("/api/turn", async (req, res) => {
  try {
    const { state, event, policy, publicMessage } = req.body || {};
    if (!state || !policy || !policy.trim()) {
      return res.status(400).json({ error: "A policy is required." });
    }
    if (state.over) return res.status(400).json({ error: "This career is over." });

    let result;
    if (USING_AI) {
      try {
        result = await claudeTurn(state, policy, publicMessage, event || openingEvent());
      } catch (err) {
        console.error("Claude turn failed, using fallback:", err.message);
        result = mockTurn(state, policy, publicMessage, event || openingEvent());
      }
    } else {
      result = mockTurn(state, policy, publicMessage, event || openingEvent());
    }

    // Remember which hand-written situation was used so it doesn't repeat.
    result.usedEvent = event;
    result.covertAction = typeof req.body?.covertAction === "string" ? req.body.covertAction : null;

    // applyResult scores all thirty voters from the deltas it just applied and
    // picks the rotating cast that speaks this month.
    const nextState = applyResult(state, policy, result);

    // Classic and Hybrid draw next month's situation from the written pool.
    // A detonating arc always wins — it seized the briefing for a reason.
    const mode = state.scenario?.events || "hybrid";
    if (!result.detonation && (mode === "classic" || shouldUsePool(nextState, mode))) {
      result.nextEvent = drawEvent(nextState);
    }

    // Only the speakers cost anything, and only on the cheap model.
    let quotes = [];
    if (USING_AI) {
      try {
        quotes = await claudeVoices(state, event || openingEvent(), policy, result.speakers);
      } catch (err) {
        console.error("Focus group failed, using fallback:", err.message);
        quotes = mockVoices(result.speakers, policy);
      }
    } else {
      quotes = mockVoices(result.speakers, policy);
    }
    result.personas = attachQuotes(result.personas, quotes);

    res.json({ result, state: nextState });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to resolve the turn." });
  }
});

// Talk to a cabinet member, the VP, or the First Spouse before you decide.
app.post("/api/advisor", async (req, res) => {
  try {
    const { state, event, advisorId, history, message } = req.body || {};
    if (!state || !advisorId || !message || !message.trim()) {
      return res.status(400).json({ error: "advisorId and message are required." });
    }
    const advisor = (state.cabinet || []).find((a) => a.id === advisorId);
    if (!advisor) return res.status(400).json({ error: "Unknown advisor." });

    let reply;
    if (USING_AI) {
      try {
        reply = await claudeAdvisor(state, event, advisor, history, message.trim());
      } catch (err) {
        console.error("Advisor chat failed, using fallback:", err.message);
        reply = mockAdvisor(state, event, advisor, message.trim());
      }
    } else {
      reply = mockAdvisor(state, event, advisor, message.trim());
    }
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The advisor could not respond." });
  }
});

// Cabinet direct order — dismiss and replace an advisor.
app.post("/api/cabinet/order", (req, res) => {
  try {
    const { state, advisorId, action } = req.body || {};
    if (!state || !advisorId) return res.status(400).json({ error: "state and advisorId are required." });
    if (action !== "fire") return res.status(400).json({ error: "Unsupported order." });
    const out = fireAdvisor(state, advisorId);
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The order could not be carried out." });
  }
});

// --- Institutional positions ----------------------------------------------

// The slate of nominees available for a vacant office.
app.post("/api/institutions/candidates", (req, res) => {
  try {
    const { state, institutionId } = req.body || {};
    if (!state || !institutionId) return res.status(400).json({ error: "state and institutionId are required." });
    res.json({ candidates: candidatesFor(state, String(institutionId)) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not assemble a shortlist." });
  }
});

app.post("/api/institutions/appoint", (req, res) => {
  try {
    const { state, institutionId, candidateKey } = req.body || {};
    if (!state || !institutionId || !candidateKey) {
      return res.status(400).json({ error: "state, institutionId and candidateKey are required." });
    }
    res.json(appoint(state, String(institutionId), String(candidateKey)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The nomination could not be sent." });
  }
});

app.post("/api/institutions/dismiss", (req, res) => {
  try {
    const { state, institutionId } = req.body || {};
    if (!state || !institutionId) return res.status(400).json({ error: "state and institutionId are required." });
    res.json(dismiss(state, String(institutionId)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The dismissal could not be carried out." });
  }
});

// --- Special actions -------------------------------------------------------

// What can be attempted right now, and at what odds.
app.post("/api/actions/available", (req, res) => {
  try {
    const { state } = req.body || {};
    if (!state) return res.status(400).json({ error: "state is required." });
    res.json({
      actions: SPECIAL_ACTIONS.map((a) => ({
        id: a.id, group: a.group, title: a.title, desc: a.desc, requirement: a.requirement,
        ...availability(state, a),
        odds: odds(state, a),
      })),
      ledger: state.specialActions || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Could not read the docket." });
  }
});

app.post("/api/actions/propose", (req, res) => {
  try {
    const { state, actionId } = req.body || {};
    if (!state || !actionId) return res.status(400).json({ error: "state and actionId are required." });
    res.json(propose(state, String(actionId)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The proposal could not be filed." });
  }
});

// --- The East Wing ---------------------------------------------------------

app.post("/api/firstlady/deploy", (req, res) => {
  try {
    const { state, instruction } = req.body || {};
    if (!state) return res.status(400).json({ error: "state is required." });
    const out = applyDeployment(state, String(instruction || ""));
    if (out.outcome?.rejected) return res.json({ rejected: true, note: out.outcome.note });
    res.json({ state: out.state, outcome: out.outcome });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The East Wing could not be deployed." });
  }
});

app.post("/api/firstlady/edit", (req, res) => {
  try {
    const { state, name, causeId } = req.body || {};
    if (!state) return res.status(400).json({ error: "state is required." });
    res.json({ state: editFirstLady(state, { name, causeId }) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The change could not be made." });
  }
});

// One round of the presidential debate.
app.post("/api/debate", async (req, res) => {
  try {
    const { state, round, topic, playerLine, history } = req.body || {};
    if (!state || !playerLine || !playerLine.trim()) {
      return res.status(400).json({ error: "A debate answer is required." });
    }
    let out;
    if (USING_AI) {
      try {
        out = await claudeDebate(state, round, topic, playerLine, history);
      } catch (err) {
        console.error("Debate round failed, using fallback:", err.message);
        out = mockDebate(state, round, topic, playerLine);
      }
    } else {
      out = mockDebate(state, round, topic, playerLine);
    }
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The debate round could not be scored." });
  }
});

// Resolve the campaign into an election result.
app.post("/api/campaign/finish", (req, res) => {
  try {
    const { state, debateScore } = req.body || {};
    if (!state) return res.status(400).json({ error: "state is required." });
    const finalState = finishCampaign(state, Number(debateScore) || 0);
    res.json({ state: finalState });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The election could not be resolved." });
  }
});

const PARTIES = ["Democrat", "Republican", "Independent"];
const DIFFICULTIES = ["easy", "medium", "hard"];

/** Rules of play: the allowed values for every non-boolean setting. */
const MODES = {
  persona: ["off", "whacko", "tweeter"],
  elections: ["classic", "alternative"],
  events: ["classic", "hybrid", "dynamic"],
  war: ["off", "classic", "strategic"],
};

const BOOLEAN_SETTINGS = ["economy", "checks", "bio", "society", "covert", "weekly", "debates", "podium", "noHints"];

const oneOf = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);

const str = (v, fallback, max) => String(v ?? fallback ?? "").slice(0, max);

const num = (v, fallback, lo, hi) => {
  const n = Number(v);
  return Math.max(lo, Math.min(hi, Number.isFinite(n) ? Math.round(n) : fallback));
};

/** Everything the setup screens can send, validated at the boundary. */
function sanitizeScenario(s) {
  const scenario = {
    presidentName: str(s?.presidentName, "Alex Rivera", 60),
    party: PARTIES.includes(s?.party) ? s.party : "Independent",
    gender: ["male", "female"].includes(s?.gender) ? s.gender : "unspecified",
    ideology: str(s?.ideology, "", 60),
    style: str(s?.style, "", 60),
    era: str(s?.era, "The present day, 2025.", 400),
    startApproval: num(s?.startApproval, 52, 20, 70),
    difficulty: DIFFICULTIES.includes(s?.difficulty) ? s.difficulty : "hard",
    profile: str(s?.profile, "", 400),
    scenarioKey: str(s?.scenarioKey, "custom", 40),
    scenarioName: str(s?.scenarioName, "Custom", 60),
    eraKey: str(s?.eraKey, "custom", 40),
    eraTitle: str(s?.eraTitle, "Present day", 60),
    startYear: num(s?.startYear, 2025, 1900, 2200),
  };

  if (Number.isFinite(Number(s?.stability))) {
    scenario.stability = num(s.stability, 72, 10, 100);
  }

  // Rules of play. Booleans default on where the reference defaults them on.
  const onByDefault = new Set(["economy", "checks", "debates"]);
  for (const key of BOOLEAN_SETTINGS) {
    scenario[key] = onByDefault.has(key) ? s?.[key] !== false : s?.[key] === true;
  }
  for (const [key, allowed] of Object.entries(MODES)) {
    scenario[key] = oneOf(s?.[key], allowed, allowed[key === "events" ? 1 : 0]);
  }
  // Covert operations are a post-Cold-War frame; earlier eras cannot run them.
  if (scenario.startYear < 1990) scenario.covert = false;

  // Who the president is: bloc affinities and a home-state bonus.
  if (s?.profileEffects && typeof s.profileEffects === "object") {
    scenario.profileEffects = {};
    for (const [k, v] of Object.entries(s.profileEffects)) {
      const n = Number(v);
      if (Number.isFinite(n)) scenario.profileEffects[str(k, "", 24)] = Math.max(-30, Math.min(30, Math.round(n)));
    }
  }
  if (Array.isArray(s?.homeStates)) {
    scenario.homeStates = s.homeStates.slice(0, 12).map((c) => str(c, "", 2).toUpperCase());
  }
  if (s?.bioAnswers && typeof s.bioAnswers === "object") {
    scenario.bioAnswers = {};
    for (const [k, v] of Object.entries(s.bioAnswers).slice(0, 12)) {
      const text = str(v, "", 240).trim();
      if (text) scenario.bioAnswers[str(k, "", 24)] = text;
    }
  }

  // A court is nine seats however the scenario splits them.
  const conservative = num(s?.court?.conservative, 6, 0, 9);
  scenario.court = { conservative, liberal: 9 - conservative };

  // Seats the president's own party holds. Independents get no bloc.
  if (s?.congress && scenario.party !== "Independent") {
    scenario.congress = {
      house: num(s.congress.house, 218, 0, 435),
      senate: num(s.congress.senate, 50, 0, 100),
    };
  }

  if (s?.vp && typeof s.vp === "object") {
    scenario.vp = {
      name: str(s.vp.name, "Morgan Hale", 60),
      age: str(s.vp.age, "50s", 20),
      gender: str(s.vp.gender, "unspecified", 20),
      region: str(s.vp.region, "national", 40),
      background: str(s.vp.background, "senator", 40),
      ideology: str(s.vp.ideology, "", 60),
      bio: str(s.vp.bio, "", 400),
      portfolio: str(s.vp.portfolio, "", 40),
      loyalty: num(s.vp.loyalty, 80, 0, 100),
      competence: num(s.vp.competence, 75, 0, 100),
    };
  }

  return scenario;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[Fantasy President] Running at http://localhost:${PORT}`);
});
