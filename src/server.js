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
  finishMidterms,
  finishPrimary,
  maybeSucceed,
  openingEvent,
  STAKEHOLDERS,
} from "./gameEngine.js";
import { resolveTwentyFifth, twentyFifthStanding } from "./succession.js";
import { challengerFor, senateRaces, senateCycle, spendEffect } from "./elections.js";
import { PRIMARY_STRATEGIES, primaryThreat, primaryChallenger, delegateBoard } from "./primary.js";
import { governorRoster, courtGovernor, risingStars, COURTING_COST } from "./governors.js";
import { historicalVerdict } from "./verdict.js";
import {
  districtOptions, seatFor, floorBills, partyLine, districtView,
  castVote, sponsorBill, advanceHouseMonth, runReelection, HOUSE_TERM, canFileAgain,
} from "./house.js";
import {
  COMMITTEES, RANKS, committeeById, rankById, inYourDomain,
  chairAction, whipCount, spendCapital,
} from "./committees.js";
import { articlesReady, articlesStance, voteArticles } from "./articles.js";
import { nominationPending, nominationStance, confirmVote } from "./confirmations.js";
import {
  migrateSave, newCareer, nextChoices, syncCareerClock, foldOffice, earnRecognition,
  WILDERNESS_CHOICES, wildernessYear,
} from "./career.js";

/** Did the caller say this race cost them the seat they held? */
const choiceCollided = (body) => body?.collides === true;
import { runLadderRace } from "./ladderRace.js";
import {
  SENATE_TERM, CLOTURE, stateOptions, floorBills as senateFloor,
  castVote as senateVote, filibuster, advanceSenateMonth,
  runReelection as senateReelection, liveGrudges,
  partyLine as senatePartyLine, districtView as senateStateView,
} from "./senate.js";
import { historicalHouseVerdict } from "./houseVerdict.js";
import { STATES } from "./states.js";
import { attachQuotes } from "./personas.js";
import { applyDeployment, editFirstLady, FIRST_LADY_CAUSES } from "./firstLady.js";
import { INSTITUTIONS, candidatesFor, appoint, dismiss } from "./institutions.js";
import { SPECIAL_ACTIONS, availability, odds, propose } from "./specialActions.js";
import { REGIONS as FOREIGN_REGIONS } from "./foreign.js";
import { SOCIETY_METRICS } from "./society.js";
import { COVERT_ACTIONS } from "./covert.js";
import { drawEvent, shouldUsePool } from "./eventPool.js";
import { actOnBill } from "./bills.js";
import { claudeAvailable, claudeTurn, claudeVoices, claudeOpening, claudeAdvisor, claudeDebate } from "./claude.js";
import {
  providerInfo, providerId, providerHealth, probeProvider,
  recordModelFailure, resetProviderHealth,
} from "./ai/provider.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

const USING_AI = claudeAvailable();

// Say which brain is running the game, and how to change it. A player who
// cannot tell whether their local model is actually being used will assume it
// is not, and reach for an API key they did not want to need.
let AI_INFO = { id: providerId(), label: "…", detail: "", available: USING_AI };
providerInfo().then((info) => {
  AI_INFO = info;
  const line = info.id === "local"
    ? info.reachable
      ? `[Fantasy President] Local model — ${info.model} at ${info.url}. Nothing is sent anywhere.`
      // Say it at boot rather than letting the player find out from the prose.
      : `[Fantasy President] ⚠️  Local model NOT reachable. ${info.error}\n` +
        `                       Months will play on the built-in offline engine until it answers. ` +
        `Start your model server, then click the badge on the title screen to re-check.`
    : info.id === "anthropic"
      ? `[Fantasy President] Anthropic API — ${info.model}.`
      : "[Fantasy President] No model configured — running the built-in offline engine. " +
        "Set ANTHROPIC_API_KEY, or FP_PROVIDER=local to use a model on this machine.";
  console.log(line);
}).catch(() => {});

// Static reference data for the client (states + stakeholders + mode).
app.get("/api/meta", async (_req, res) => {
  /**
   * If we last saw the local machine as unreachable, ask again before answering.
   *
   * This is the intuitive fix a player will try — start the model server,
   * reload the page — and it costs a probe only in the case where we already
   * believe something is wrong. A healthy provider is never re-probed here.
   */
  if (AI_INFO.id === "local" && AI_INFO.reachable === false) {
    try {
      AI_INFO = await providerInfo();
    } catch { /* keep what we had */ }
  }

  res.json({
    ai: USING_AI,
    provider: AI_INFO,
    aiHealth: providerHealth(),
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

// --- The ladder ------------------------------------------------------------

/**
 * Every ladder endpoint takes `{ career, state }` and every one of them accepts
 * a save that predates the ladder — the envelope is inferred here rather than
 * in the browser, which cannot import this module.
 */
function withCareer(body) {
  const migrated = migrateSave({ career: body?.career, state: body?.state });
  const state = migrated?.state || body?.state || null;
  return { career: syncCareerClock(migrated?.career || null, state), state };
}

/** What a member may do at the end of a term. */
app.post("/api/ladder/choices", (req, res) => {
  try {
    const { career, state } = withCareer(req.body);
    if (!career || !state?.office) {
      return res.status(400).json({ error: "A career in an office is required." });
    }
    res.json({ career, choices: nextChoices(career, state), wilderness: WILDERNESS_CHOICES });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The ballot could not be read." });
  }
});

/** Run for something you do not hold. */
app.post("/api/ladder/race", (req, res) => {
  try {
    const { career, state } = withCareer(req.body);
    const { target, where, opponent, runOn, spend } = req.body || {};
    if (!career || !state || !target) {
      return res.status(400).json({ error: "career, state and target are required." });
    }
    const result = runLadderRace(career, state, { target, where, opponent, runOn, spend });

    /**
     * Winning ends the office you were holding, so this is where it enters the
     * archive — with its record tagged, its terms counted, and the caucus's
     * final opinion folded into the party's. Losing a race you gave your seat
     * up for ends it too; the client marks that one as the wilderness.
     */
    const carried = result.won || choiceCollided(req.body)
      ? earnRecognition(foldOffice(career, state, result.won ? "sought-higher" : "unseated"), state)
      : career;

    res.json({ career: carried, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The race could not be run." });
  }
});

/** A year out of office. */
app.post("/api/ladder/wilderness", (req, res) => {
  try {
    const { career } = withCareer(req.body);
    if (!career) return res.status(400).json({ error: "career is required." });
    res.json(wildernessYear(career, String(req.body?.choice || "nothing")));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The year could not pass." });
  }
});

/**
 * Is the brain answering?
 *
 * The title screen asks this once at boot, and the badge asks again whenever the
 * player clicks it — because the interesting answer usually arrives *after* boot
 * (a machine that was asleep, a model that was swapped). `recheck` throws away
 * everything the server thinks it knows and asks the machine directly.
 */
app.post("/api/ai/status", async (req, res) => {
  try {
    if (req.body?.recheck === true) resetProviderHealth();
    const probe = await probeProvider();
    if (req.body?.recheck === true) {
      // A fresh probe is also fresh information for the title-screen copy.
      AI_INFO = await providerInfo();
    }
    res.json({ ...providerHealth(), probe, provider: AI_INFO });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The model could not be checked." });
  }
});

// Start a new career.
app.post("/api/start", async (req, res) => {
  try {
    const scenario = sanitizeScenario(req.body?.scenario);
    // A career reaching a new office arrives warmer than a stranger. Anything
    // sent here already carries an envelope this server produced.
    const state = createGame(scenario, req.body?.career || null);
    const event = await nextSituation(state, scenario);
    /**
     * Every career carries an envelope from its first month, so the ladder is
     * available at the first term boundary rather than only to careers that
     * happen to have been saved and reloaded.
     */
    const career = req.body?.career || newCareer(scenario);
    res.json({ state, event, career });
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

    /**
     * Falling back to the offline engine when the model cannot be reached is
     * the right behaviour — a sleeping GPU should not end somebody's term. What
     * was wrong was doing it *silently*: the month played out on the built-in
     * engine, the badge went on naming a local model, and the only evidence was
     * a line in a terminal nobody was reading.
     */
    let result;
    let fellBack = null;
    if (USING_AI) {
      try {
        result = await claudeTurn(state, policy, publicMessage, event || openingEvent());
      } catch (err) {
        console.error("Model turn failed, using the offline engine:", err.message);
        recordModelFailure(err.message);
        fellBack = err.message;
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

    // Which brain actually answered this month, and why if it was not the one
    // the player configured. The client refreshes its badge from this.
    res.json({ result, state: nextState, ai: { ...providerHealth(), fellBack } });
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
    const outcome = propose(state, String(actionId));
    // A refused order ends the presidency, not necessarily the republic.
    if (outcome.state) outcome.state = maybeSucceed(outcome.state);
    res.json(outcome);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The proposal could not be filed." });
  }
});

// What the histories say about a finished presidency.
app.post("/api/verdict", (req, res) => {
  try {
    const { state } = req.body || {};
    if (!state) return res.status(400).json({ error: "state is required." });
    res.json(historicalVerdict(state));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The verdict could not be written." });
  }
});

// --- The House -------------------------------------------------------------

/** Seats worth choosing between, before a career starts. */
app.post("/api/house/districts", (req, res) => {
  try {
    const { party, presidentName, startYear } = req.body || {};
    const scenario = {
      presidentName: str(presidentName, "Alex Rivera", 60),
      party: PARTIES.includes(party) ? party : "Democrat",
      startYear: num(startYear, 2025, 1900, 2200),
    };
    const seed = { rosterSeed: `${scenario.presidentName}|${scenario.startYear}|${scenario.party}`, scenario };
    res.json({ districts: districtOptions(seed, scenario.party) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The map could not be drawn." });
  }
});

/** What leadership has scheduled, and where everyone stands on it. */
app.post("/api/house/floor", (req, res) => {
  try {
    const { state } = req.body || {};
    if (!state || state.office !== "house") return res.status(400).json({ error: "A House career is required." });
    const buried = new Set((state.committeeLog || [])
      .filter((e) => e.action === "buried").map((e) => e.id));
    const bills = floorBills(state)
      .filter((bill) => !buried.has(bill.id))
      .map((bill) => ({
        ...bill,
        party: partyLine(state, bill),
        district: districtView(state, bill),
        // What this member's rank lets them do to it before anybody votes.
        yours: inYourDomain(state, bill),
        whip: whipCount(state, bill),
      }));
    const committee = committeeById(state.committee);
    res.json({
      bills,
      // The one vote that is not a bill.
      articles: articlesReady(state)
        ? { ...state.jeopardy, stance: articlesStance(state), president: state.president }
        : null,
      committee: committee && { ...committee },
      rank: rankById(state.rank, "house"),
      capital: state.capital ?? 0,
      term: state.term || 1,
      monthsLeft: HOUSE_TERM - state.month + 1,
      canSponsor: canFileAgain(state),
      forecast: runReelection(state),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The floor schedule could not be read." });
  }
});

app.post("/api/house/vote", (req, res) => {
  try {
    const { state, bill, vote } = req.body || {};
    if (!state || !bill) return res.status(400).json({ error: "state and bill are required." });
    const out = castVote(state, bill, String(vote));
    if (out.rejected) return res.status(400).json({ error: out.note });
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The vote could not be recorded." });
  }
});

/**
 * Filing a bill, working a gavel and counting the floor are the same acts in
 * both chambers — the machinery in committees.js and house.js is chamber-aware —
 * so each handler is registered on both paths instead of being written twice
 * with one of the two versions quietly answering House questions.
 *
 * The guard is the part that is not shared: a presidential state has no seat,
 * no caucus and no committee, and must never reach any of them.
 */
const memberOnly = (handler) => (req, res) => {
  const state = req.body?.state;
  if (!state || !["house", "senate"].includes(state.office)) {
    return res.status(400).json({ error: "A congressional career is required." });
  }
  return handler(req, res, state);
};

const sponsorRoute = memberOnly((req, res, state) => {
  try {
    const { title, axis, domain } = req.body || {};
    const out = sponsorBill(state, {
      title: str(title, "An Act", 90),
      axis: Math.max(-1, Math.min(1, Number(axis) || 0)),
      domain: str(domain, "economy", 20),
    });
    if (out.rejected) return res.status(400).json({ error: out.note });
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The bill could not be filed." });
  }
});

app.post("/api/house/sponsor", sponsorRoute);
app.post("/api/senate/sponsor", sponsorRoute);

/** End the month. At the end of a term, the district answers. */
app.post("/api/house/advance", (req, res) => {
  try {
    const { state } = req.body || {};
    if (!state || state.office !== "house") return res.status(400).json({ error: "A House career is required." });
    res.json(advanceHouseMonth(state));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The month could not be closed out." });
  }
});

/**
 * Impeachment. The House accuses on a simple majority and the Senate convicts
 * on two thirds, and `voteArticles` knows which room it is in — so both paths
 * run the same handler and get different arithmetic.
 */
const articlesRoute = memberOnly((req, res, state) => {
  try {
    const out = voteArticles(state, String(req.body?.vote));
    if (out.rejected) return res.status(400).json({ error: out.note });
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The vote could not be recorded." });
  }
});

app.post("/api/house/articles", articlesRoute);
app.post("/api/senate/articles", articlesRoute);

/** What the House remembers about a member. */
app.post("/api/house/verdict", (req, res) => {
  try {
    const { state } = req.body || {};
    // Both chambers close on this record; only the nouns differ.
    if (!state || !["house", "senate"].includes(state.office)) {
      return res.status(400).json({ error: "A congressional career is required." });
    }
    res.json(historicalHouseVerdict(state));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The record could not be written." });
  }
});

/** Bury a bill in committee, or report it out amended. */
const committeeRoute = memberOnly((req, res, state) => {
  try {
    const { bill, action } = req.body || {};
    if (!bill) return res.status(400).json({ error: "bill is required." });
    if (action !== "bury" && action !== "amend") {
      return res.status(400).json({ error: "Bury it or amend it." });
    }
    const out = chairAction(state, bill, action);
    if (out.rejected) return res.status(400).json({ error: out.note });
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The committee could not act." });
  }
});

app.post("/api/house/committee", committeeRoute);
app.post("/api/senate/committee", committeeRoute);

/** Call in favours to move a whip count. */
const whipRoute = memberOnly((req, res, state) => {
  try {
    const { bill, amount } = req.body || {};
    if (!bill) return res.status(400).json({ error: "bill is required." });
    const out = spendCapital(state, bill, Number(amount));
    if (out.rejected) return res.status(400).json({ error: out.note });
    res.json({ ...out, whip: whipCount(out.state, bill) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The floor could not be worked." });
  }
});

app.post("/api/house/whip", whipRoute);
app.post("/api/senate/whip", whipRoute);

// --- The Senate ------------------------------------------------------------

app.post("/api/senate/states", (req, res) => {
  try {
    const { party, presidentName, startYear } = req.body || {};
    const scenario = {
      presidentName: str(presidentName, "Alex Rivera", 60),
      party: PARTIES.includes(party) ? party : "Democrat",
      startYear: num(startYear, 2025, 1900, 2200),
    };
    res.json({ states: stateOptions({ scenario }, scenario.party) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The map could not be drawn." });
  }
});

app.post("/api/senate/floor", (req, res) => {
  try {
    const { state } = req.body || {};
    if (!state || state.office !== "senate") return res.status(400).json({ error: "A Senate career is required." });
    const buried = new Set((state.committeeLog || [])
      .filter((e) => e.action === "buried").map((e) => e.id));
    const held = new Set((state.filibusters || []).map((f) => f.id));
    const bills = senateFloor(state)
      .filter((b) => !buried.has(b.id))
      .map((bill) => ({
        ...bill,
        party: senatePartyLine(state, bill),
        district: senateStateView(state, bill),
        yours: inYourDomain(state, bill),
        whip: whipCount(state, bill),
        filibustered: held.has(bill.id),
      }));
    res.json({
      bills,
      committee: committeeById(state.committee),
      rank: rankById(state.rank, "senate"),
      capital: state.capital ?? 0,
      cloture: CLOTURE,
      grudges: liveGrudges(state).slice(0, 5),
      term: state.term || 1,
      monthsLeft: SENATE_TERM - state.month + 1,
      // Asked properly. Hardcoding this to true offered the filing card every
      // month and then refused the filing on the cooldown.
      canSponsor: canFileAgain(state),
      forecast: senateReelection(state),
      articles: articlesReady(state)
        ? { ...state.jeopardy, stance: articlesStance(state), president: state.president }
        : null,
      // Somebody is waiting on the chamber, and the seat stays empty until it answers.
      nomination: nominationPending(state)
        ? { ...state.nomination, stance: nominationStance(state), president: state.president }
        : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The floor schedule could not be read." });
  }
});

app.post("/api/senate/vote", (req, res) => {
  try {
    const { state, bill, vote } = req.body || {};
    if (!state || !bill) return res.status(400).json({ error: "state and bill are required." });
    const out = senateVote(state, bill, String(vote));
    if (out.rejected) return res.status(400).json({ error: out.note });
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The vote could not be recorded." });
  }
});

/** Hold the floor. Any senator may. */
app.post("/api/senate/filibuster", (req, res) => {
  try {
    const { state, bill } = req.body || {};
    if (!state || !bill) return res.status(400).json({ error: "state and bill are required." });
    const out = filibuster(state, bill);
    if (out.rejected) return res.status(400).json({ error: out.note });
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The floor could not be held." });
  }
});

/**
 * Advice and consent — the vote only the Senate gets to cast, and the only one
 * whose consequences outlive everybody casting it.
 */
app.post("/api/senate/confirm", (req, res) => {
  try {
    const { state, vote } = req.body || {};
    if (!state || state.office !== "senate") {
      return res.status(400).json({ error: "A Senate career is required." });
    }
    const out = confirmVote(state, String(vote));
    if (out.rejected) return res.status(400).json({ error: out.note });
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The vote could not be recorded." });
  }
});

app.post("/api/senate/advance", (req, res) => {
  try {
    const { state } = req.body || {};
    if (!state || state.office !== "senate") return res.status(400).json({ error: "A Senate career is required." });
    res.json(advanceSenateMonth(state));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The month could not be closed out." });
  }
});

// --- The statehouses -------------------------------------------------------

// The fifty governors, how hard each is resisting, and who is running for your job.
app.post("/api/governors", (req, res) => {
  try {
    const { state } = req.body || {};
    if (!state) return res.status(400).json({ error: "state is required." });
    const defiance = state.governors || {};
    res.json({
      cost: COURTING_COST,
      warChest: state.warChest ?? 0,
      governors: governorRoster(state).map((g) => ({ ...g, defiance: defiance[g.state] ?? 0 })),
      bench: risingStars(state).slice(0, 5).map(({ name, party, state: code, stateName, ambition, standing, score }) =>
        ({ name, party, state: code, stateName, ambition, standing, score })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The statehouses could not be read." });
  }
});

// Come to an understanding with one of them.
app.post("/api/governors/court", (req, res) => {
  try {
    const { state, code } = req.body || {};
    if (!state || !code) return res.status(400).json({ error: "state and code are required." });
    const out = courtGovernor(state, String(code).toUpperCase());
    if (out.rejected) return res.status(400).json({ error: out.note });
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The deal could not be made." });
  }
});

// --- The primary -----------------------------------------------------------

// Who is challenging, why, and what the options cost.
app.post("/api/primary/board", (req, res) => {
  try {
    const { state } = req.body || {};
    if (!state) return res.status(400).json({ error: "state is required." });
    const board = delegateBoard(state);
    res.json({
      challenger: primaryChallenger(state),
      threat: primaryThreat(state),
      strategies: PRIMARY_STRATEGIES,
      delegates: { total: board.total, majority: board.majority },
      states: board.states,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The primary board could not be built." });
  }
});

// Fight it, however you have chosen to.
app.post("/api/primary/finish", (req, res) => {
  try {
    const { state, strategy } = req.body || {};
    if (!state) return res.status(400).json({ error: "state is required." });
    if (!PRIMARY_STRATEGIES.some((s) => s.id === strategy)) {
      return res.status(400).json({ error: "Unknown strategy." });
    }
    const { state: next, result } = finishPrimary(state, strategy);
    res.json({ state: next, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The primary could not be resolved." });
  }
});

// --- Leaving office --------------------------------------------------------

// Resignation. The oath passes to the Vice President, so this has to run
// through the engine rather than being set on the client.
app.post("/api/resign", (req, res) => {
  try {
    const { state } = req.body || {};
    if (!state) return res.status(400).json({ error: "state is required." });
    const resigned = {
      ...state,
      over: true,
      phase: "concluded",
      ending: {
        type: "resigned",
        reason: "You resigned the presidency. The country is left to argue about why.",
      },
    };
    const next = maybeSucceed(resigned);
    res.json({ state: next, succeeded: Boolean(next.succession) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The resignation could not be filed." });
  }
});

// Where the cabinet stands on a Twenty-Fifth Amendment declaration.
app.post("/api/twentyfifth/standing", (req, res) => {
  try {
    const { state } = req.body || {};
    if (!state) return res.status(400).json({ error: "state is required." });
    const standing = twentyFifthStanding(state);
    res.json({
      vpName: standing.vp?.name || null,
      cabinetFor: standing.cabinetFor,
      cabinetAgainst: standing.cabinetAgainst,
      declaration: state.twentyFifth || null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The cabinet's position could not be read." });
  }
});

// Contest it, or stand down.
app.post("/api/twentyfifth/resolve", (req, res) => {
  try {
    const { state, action } = req.body || {};
    if (!state) return res.status(400).json({ error: "state is required." });
    if (action !== "contest" && action !== "step_aside") {
      return res.status(400).json({ error: "Contest it or stand down." });
    }
    const out = resolveTwentyFifth(state, action);
    if (out.rejected) return res.status(400).json({ error: out.note });
    res.json({ state: out.state, result: out.result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The declaration could not be answered." });
  }
});

// --- Bills on your desk ----------------------------------------------------

app.post("/api/bills/act", (req, res) => {
  try {
    const { state, billId, action } = req.body || {};
    if (!state || !billId) return res.status(400).json({ error: "state and billId are required." });
    const out = actOnBill(state, String(billId), String(action));
    if (out.rejected) return res.json({ rejected: true, note: out.note });
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The bill could not be acted on." });
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
    const { state, debateScore, spend } = req.body || {};
    if (!state) return res.status(400).json({ error: "state is required." });
    const finalState = finishCampaign(state, Number(debateScore) || 0, sanitizeSpend(spend));
    res.json({ state: finalState, election: finalState.election || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The election could not be resolved." });
  }
});

// The seats actually on the ballot this cycle, so the midterm map can show the
// player what they are defending before they decide where the money goes.
app.post("/api/midterms/board", (req, res) => {
  try {
    const { state } = req.body || {};
    if (!state) return res.status(400).json({ error: "state is required." });
    const cycle = senateCycle(state);
    res.json({
      cycle,
      challenger: challengerFor(state),
      warChest: state.warChest ?? 0,
      senateStates: senateRaces(state, cycle).map((r) => r.state),
      // What a representative commitment buys, so the UI can be honest.
      sample: Object.fromEntries(
        Object.entries(STATES).map(([code, info]) => [code, spendEffect(20, info.ev)])),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The midterm board could not be built." });
  }
});

// Hold the midterms.
app.post("/api/midterms/finish", (req, res) => {
  try {
    const { state, spend } = req.body || {};
    if (!state) return res.status(400).json({ error: "state is required." });
    const { state: next, result } = finishMidterms(state, sanitizeSpend(spend));
    res.json({ state: next, result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The midterms could not be held." });
  }
});

/**
 * A spending plan arrives from the browser, so nothing in it is trusted: only
 * real state codes, only finite non-negative numbers. The engine trims the
 * total to the war chest separately.
 */
function sanitizeSpend(spend) {
  if (!spend || typeof spend !== "object") return {};
  const out = {};
  for (const [code, value] of Object.entries(spend)) {
    if (!Object.hasOwn(STATES, code)) continue;
    const dollars = Number(value);
    if (!Number.isFinite(dollars) || dollars <= 0) continue;
    out[code] = Math.min(dollars, 5000);
  }
  return out;
}

const PARTIES = ["Democrat", "Republican", "Independent"];
const DIFFICULTIES = ["easy", "medium", "hard"];

/** Rules of play: the allowed values for every non-boolean setting. */
const MODES = {
  persona: ["off", "whacko", "tweeter"],
  elections: ["classic", "alternative"],
  events: ["classic", "hybrid", "dynamic"],
  war: ["off", "classic", "strategic"],
};

const BOOLEAN_SETTINGS = ["economy", "checks", "bio", "society", "covert", "weekly", "debates", "podium", "noHints", "radicals"];

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
    // Where that ideology sits on the spectrum, and how hard it splits a room.
    ideologyAxis: Math.max(-1, Math.min(1, Number(s?.ideologyAxis) || 0)),
    ideologyIntensity: Math.max(0.5, Math.min(2.5, Number(s?.ideologyIntensity) || 1)),
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
    // Which office this career is for. Anything unrecognised is a presidency,
    // so every save written before this existed still loads as one.
    office: ["house", "senate"].includes(s?.office) ? s.office : "president",
  };
  if (scenario.office === "house") {
    scenario.district = str(s?.district, "OH-6", 8).toUpperCase();
  }
  if (scenario.office === "senate") {
    scenario.seatState = str(s?.seatState, "OH", 4).toUpperCase();
  }

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
