import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createGame,
  applyResult,
  mockTurn,
  mockAdvisor,
  mockDebate,
  fireAdvisor,
  finishCampaign,
  openingEvent,
  STAKEHOLDERS,
} from "./gameEngine.js";
import { STATES } from "./states.js";
import { claudeAvailable, claudeTurn, claudeOpening, claudeAdvisor, claudeDebate } from "./claude.js";

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
  });
});

// Start a new career.
app.post("/api/start", async (req, res) => {
  try {
    const scenario = sanitizeScenario(req.body?.scenario);
    const state = createGame(scenario);
    let event;
    if (USING_AI) {
      try {
        event = await claudeOpening(scenario);
      } catch (err) {
        console.error("Opening generation failed, using fallback:", err.message);
        event = openingEvent();
      }
    } else {
      event = openingEvent();
    }
    res.json({ state, event });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to start game." });
  }
});

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
        result = mockTurn(state, policy, publicMessage);
      }
    } else {
      result = mockTurn(state, policy, publicMessage);
    }

    const nextState = applyResult(state, policy, result);
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

function sanitizeScenario(s) {
  const parties = ["Democrat", "Republican", "Independent"];
  const name = String(s?.presidentName || "Alex Rivera").slice(0, 60);
  const party = parties.includes(s?.party) ? s.party : "Independent";
  const era = String(s?.era || "The present day, 2025").slice(0, 120);
  let startApproval = Number(s?.startApproval);
  if (!Number.isFinite(startApproval)) startApproval = 52;
  startApproval = Math.max(20, Math.min(70, Math.round(startApproval)));
  return { presidentName: name, party, era, startApproval };
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`[Fantasy President] Running at http://localhost:${PORT}`);
});
