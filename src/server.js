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
  docketSize, fringeMonth, fringeSide, fringeBillFor, attributeSponsors,
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
  docketSize as senateDocketSize,
} from "./senate.js";
import { historicalHouseVerdict } from "./houseVerdict.js";
import { STATES } from "./states.js";
import {
  shelvedBills, petitionCeiling, launchPetition, signPetition, advancePetition,
  DISCHARGE_THRESHOLD, vacateCount, moveToVacate, resolveVacancy,
} from "./procedure.js";
import { ISSUE_KEYS, issueKey } from "../public/js/data/ideologies.js";
import { attachQuotes } from "./personas.js";
import { applyDeployment, editFirstLady, FIRST_LADY_CAUSES } from "./firstLady.js";
import { INSTITUTIONS, candidatesFor, appoint, dismiss } from "./institutions.js";
import { SPECIAL_ACTIONS, availability, odds, propose } from "./specialActions.js";
import { REGIONS as FOREIGN_REGIONS } from "./foreign.js";
import { SOCIETY_METRICS } from "./society.js";
import { COVERT_ACTIONS } from "./covert.js";
import { drawEvent, shouldUsePool } from "./eventPool.js";
import { actOnBill, billById, scheduledBill } from "./bills.js";
import { claudeAvailable, claudeTurn, claudeVoices, claudeOpening, claudeAdvisor, claudeDebate } from "./claude.js";
import {
  docketFromModel, voicesFromModel, situationFromModel, falloutFromModel, staffReply, staffOf,
} from "./chamberAi.js";
import {
  nationCard, setSituation, situationFromPool, wantsWrittenSituation,
} from "./nation.js";
import { detonationEvent, activeArcs } from "./arcs.js";
import { thenAndNow, turningPoints, series } from "./chronicle.js";
import { convictionView, traitFor } from "./conviction.js";
import { factionLine, ownBloc, factionRoll, defectionsOn } from "./factions.js";
import { coalitionStanding, foundingBlocs } from "./coalition.js";
import { billImpact, describeProfile, profileRows, nationalProfile } from "./demographics.js";
import {
  providerInfo, providerId, providerHealth, probeProvider,
  recordModelFailure, resetProviderHealth, providerMisconfigured,
} from "./ai/provider.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

const USING_AI = claudeAvailable();

/**
 * A provider setting nobody can act on is worth interrupting for.
 *
 * The rest of this block reports which brain is running. This one reports that
 * the answer is not the one that was asked for — which is a different and more
 * urgent thing to say, because the failure is silent and it can be expensive:
 * an unparsed `FP_PROVIDER` falls back to whatever key is in the shell, so a
 * player who configured a free model on their own machine can be billed for
 * months of API calls without one line anywhere admitting it.
 */
const MISCONFIGURED = providerMisconfigured();
if (MISCONFIGURED) {
  console.warn(
    `[Fantasy President] ⚠️  FP_PROVIDER is set to something unrecognised, so it was ignored.\n` +
    `                       Got: ${JSON.stringify(MISCONFIGURED.value)}\n` +
    `                       Expected exactly one of: anthropic, local, off\n` +
    (MISCONFIGURED.looksLikeShellLine
      ? `                       That looks like a whole shell command. An .env file is one\n` +
        `                       KEY=value per line, not a command you would type:\n` +
        `                           FP_PROVIDER=local\n` +
        `                           FP_LOCAL_URL=http://192.168.1.198:11434/v1\n`
      : "") +
    `                       Falling back to "${MISCONFIGURED.resolvedTo}"` +
    (MISCONFIGURED.resolvedTo === "anthropic"
      ? " — which is the PAID API, using the key in your environment."
      : ".")
  );
}

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
    const event = await openingSituation(state, scenario);
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
 * The situation a career opens on.
 *
 * A president opens on a crisis they must answer, so theirs is generated and
 * handed to the turn screen. A member opens on a country they were elected
 * into: `seedNation` has already put a story in the news and a problem on the
 * table, and what this does is give the model a chance to write a better one
 * over the top of it before the first calendar is drawn out of it.
 *
 * Both fall back to the hand-written pool — for a legislator that fallback is
 * already sitting on the state, which is why nothing here can leave them
 * without an opening at all.
 */
async function openingSituation(state, scenario) {
  if (["house", "senate"].includes(state.office)) return openingForMember(state);

  const mode = scenario.events || "hybrid";
  if (!USING_AI || shouldUsePool(state, mode)) return drawEvent(state);
  try {
    return await claudeOpening(scenario);
  } catch (err) {
    console.error("Opening generation failed, drawing from the pool:", err.message);
    return drawEvent(state);
  }
}

/**
 * A member's opening story, written in place.
 *
 * This used to be the one model call a congressional career made, and it was
 * spent on a presidential crisis brief that the floor screen never rendered —
 * generated, paid for, and dropped. Now it writes the country the chamber is
 * about to legislate in, which is the thing a member's first month is actually
 * made of.
 */
async function openingForMember(state) {
  if (!wantsWrittenSituation(state, USING_AI)) return state.situation;
  try {
    const written = await situationFromModel(state);
    // The drawn story and the problem it seeded are both replaced rather than
    // added to, or a career would open owing two crises when only one is news.
    state.arcs = [];
    setSituation(state, written);
    return written;
  } catch (err) {
    console.error("The opening story failed, keeping the drawn one:", err.message);
    recordModelFailure(err.message);
    return state.situation;
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

/**
 * The month's calendar, written once and then remembered.
 *
 * The floor screen re-reads itself after every whip call and every committee
 * action, so generating the schedule on each request would rewrite the bills
 * underneath a member who was halfway through working them — and, with a model
 * configured, bill for it every time. So the calendar is settled once per month
 * and stored on the career, and every later read this month gets that same
 * calendar back.
 *
 * Which is why this returns the state as well: the client is the only thing
 * holding the save, and it has to keep the docket that was just written.
 */

/**
 * One line per voice per bill, written once and frozen.
 *
 * Last thing before the calendar is final, and after `crisisConsensus`, because
 * consensus moves the stances and an explanation written against the wrong ones
 * would be retired on arrival.
 *
 * Every position handed over is the engine's own. The model is told where the
 * four voices landed and asked only to say why, so nothing here can move a
 * number — and because the whole call is cosmetic, every failure is swallowed
 * and the hand-written lines take over. See `voicesFromModel`.
 */
async function describeVoices(state, bills) {
  if (!bills.length || !USING_AI || !wantsWrittenSituation(state, USING_AI)) return bills;

  const positions = {};
  for (const bill of bills) {
    const bloc = factionLine(state, bill);
    positions[bill.id] = {
      party: partyLine(state, bill).position,
      district: districtView(state, bill).position,
      conviction: convictionView(state, bill).position,
      bloc: bloc?.position || "no",
      blocName: bloc?.name || null,
    };
  }

  try {
    const voices = await voicesFromModel(state, bills, positions);
    return bills.map((b) => (voices[b.id] ? { ...b, voices: voices[b.id] } : b));
  } catch (err) {
    console.error("The floor's explanations failed; the written lines stand in:", err.message);
    recordModelFailure(err.message);
    return bills;
  }
}

async function ensureDocket(state, { size, offline }) {
  const term = state.term || 1;
  const kept = state.docket;
  if (kept && kept.term === term && kept.month === state.month) {
    return { state, bills: kept.bills || [], written: Boolean(kept.written) };
  }

  const count = size(state);
  let bills = [];
  let written = false;

  if (count) {
    // Whether the fringe gets a slot is the engine's roll, not the model's, so
    // the rate is the same whoever writes the bills. See fringeMonth().
    const fringe = fringeMonth(state) ? fringeSide(state) : null;

    // Classic careers, an absent key and a sleeping local model all land on the
    // hand-written pool, which is what the mode ran on before any of this.
    if (wantsWrittenSituation(state, USING_AI)) {
      try {
        bills = await docketFromModel(state, count, { fringe });
        written = bills.length > 0;
      } catch (err) {
        console.error("The written calendar failed, drawing from the pool:", err.message);
        recordModelFailure(err.message);
      }
    }
    if (!bills.length) bills = offline(state);
    /**
     * A model that was asked for an extremist bill and did not produce one does
     * not get to quietly skip the month. The written six are there precisely so
     * the promised rate holds whatever the model does with the instruction.
     */
    else if (fringe && !bills.some((b) => b.fringe)) {
      const written6 = fringeBillFor(state);
      if (written6) bills = [...bills.slice(0, -1), written6];
    }

    /**
     * Whose name is on each bill, decided here for both routes at once.
     *
     * The single point where the month's calendar is final, which is what this
     * needs: the sponsor is drawn from the real chamber roster and must not
     * change when the floor screen repaints. See `attributeSponsors`.
     */
    /**
     * Anything dragged out by petition goes on the calendar first.
     *
     * The whole point of winning one is that leadership does not get to decide
     * whether the vote happens, so this is not weighted or sampled — it is
     * prepended, and cleared once it has been scheduled.
     */
    for (const id of state.discharged || []) {
      const source = billById(id);
      if (source) bills = [scheduledBill(source, { discharged: true }), ...bills];
    }
    bills = attributeSponsors(state, bills);
    bills = crisisConsensus(state, bills);
    bills = await describeVoices(state, bills);
  }

  const next = {
    ...state,
    // Cleared here rather than on the win, so a bill forced onto the floor is
    // scheduled exactly once however often this screen is repainted.
    ...(state.discharged?.length ? { discharged: [] } : {}),
    docket: { term, month: state.month, bills, written },
  };
  return { state: next, bills, written };
}

/**
 * A real emergency suspends normal politics, whatever anyone marked the bill.
 *
 * This is the specific thing that was wrong. A five-billion-dollar cyber-defence
 * appropriation, in the month after an actual attack on critical infrastructure,
 * came back marked as a party-line Republican project and passed 55-45 with not
 * one Democrat voting for it. Both halves of that were wrong: the bill was given
 * the politics of a tax cut, and the roll call had no way to express a chamber
 * closing ranks even if it had been marked correctly.
 *
 * So the engine has the last word on it. If a bill answers a problem the country
 * is carrying at severity four or five, it is at least bipartisan no matter what
 * the model said — because that is what an acute crisis does to a legislature,
 * and it is not a judgement a model should be trusted to make when the engine
 * already knows how bad things are.
 *
 * It only ever raises. A bill the model called unanimous is left alone.
 */
function crisisConsensus(state, bills) {
  const acute = new Map();
  for (const arc of activeArcs(state)) {
    if (arc.severity >= 4) acute.set(arc.id, arc);
  }

  return bills.map((raw) => {
    /**
     * Every bill leaves here with a stated tier, never an absent one.
     *
     * Bills drawn from the pool and the six fringe bills do not pass through
     * `validateDocket`, so they arrived with `support` undefined — harmless,
     * since `consensusOf` reads the pool's own value and defaults to zero, but
     * it left the field meaning two different things depending on which route
     * the bill took. A party-line vote is the honest default and says so.
     */
    const bill = raw.support ? raw : { ...raw, support: "partyline" };

    // The fringe is never a consensus, however bad things get. That is the
    // entire point of the fringe.
    if (bill.fringe) return bill;
    if (!acute.size) return bill;
    if (!bill.addresses || !acute.has(bill.addresses)) return bill;
    if (bill.support === "unanimous" || bill.support === "bipartisan") return bill;
    return {
      ...bill,
      support: "bipartisan",
      crisis: acute.get(bill.addresses).title,
    };
  });
}

/** Which calendar year a career is standing in, for the era-aware demographics. */
const yearOf = (state) =>
  (state?.scenario?.startYear || 2025)
  + Math.floor((((state?.term || 1) - 1) * (state?.office === "senate" ? 72 : 24) + (state?.month || 1) - 1) / 12);

/** What leadership has scheduled, and where everyone stands on it. */
app.post("/api/house/floor", async (req, res) => {
  try {
    const { state: body } = req.body || {};
    if (!body || body.office !== "house") return res.status(400).json({ error: "A House career is required." });
    const { state, bills: docket, written } = await ensureDocket(body, {
      size: docketSize, offline: floorBills,
    });
    const buried = new Set((state.committeeLog || [])
      .filter((e) => e.action === "buried").map((e) => e.id));
    const bills = docket
      .filter((bill) => !buried.has(bill.id))
      .map((bill) => ({
        ...bill,
        party: partyLine(state, bill),
        district: districtView(state, bill),
        // The third party to the vote, and the only one that is actually them.
        conviction: convictionView(state, bill),
        // And the bloc you sit with, which whips harder than the caucus does.
        bloc: factionLine(state, bill),
        // Whose votes have come loose, including blocs that are not the
        // player's — which is most of them. See defectionsOn.
        defections: defectionsOn(state, bill),
        // And who in the seat actually wins or loses by it.
        impact: billImpact(state.people, bill, yearOf(state)),
        // What this member's rank lets them do to it before anybody votes.
        yours: inYourDomain(state, bill),
        whip: whipCount(state, bill),
      }));
    const committee = committeeById(state.committee);
    res.json({
      bills,
      /**
       * What leadership will not schedule, and whether you are forcing one of
       * them. The only lever on the calendar a member without a gavel has.
       */
      shelf: shelvedBills(state).map((b) => ({
        id: b.id, title: b.title, brief: b.brief, domain: b.domain,
        floorVotes: b.yes, ownYes: b.ownYes, ...petitionCeiling(state, b),
      })),
      petition: state.petition || null,
      dischargeNeeded: DISCHARGE_THRESHOLD(state),
      // What denying a majority is worth, and whether the chair is empty.
      vacate: vacateCount(state, 0),
      vacancy: state.vacancy || 0,
      // The country the calendar was written out of, so the floor can show it.
      nation: nationCard(state),
      written,
      staff: staffOf(state),
      // The docket was just settled; the client holds the only copy of the save.
      state,
      // The one vote that is not a bill.
      articles: articlesReady(state)
        ? { ...state.jeopardy, stance: articlesStance(state), president: state.president }
        : null,
      // How often they have voted like the person they said they were, and where
      // they stand with the blocs their ideology brought. See conviction.js.
      integrity: state.integrity ?? null,
      coalition: coalitionStanding(state),
      founding: foundingBlocs(state.scenario),
      ideology: state.scenario?.ideology || null,
      // The wing of the party you actually sit in, and what it is worth.
      faction: ownBloc(state),
      blocStanding: state.bloc ?? null,
      chamberFactions: factionRoll(state),
      trait: traitFor(state.scenario?.party, state.scenario?.ideology),
      // Who this member represents, and how far that has moved since the oath.
      people: state.people ? {
        rows: profileRows(state.people, yearOf(state)),
        describes: describeProfile(state.people, yearOf(state)),
        wasDescribed: describeProfile(state.peopleAtOath, state.scenario?.startYear || 2025),
        leanNow: state.seat?.lean,
        leanAtOath: state.leanAtOath ?? state.seat?.lean,
      } : null,
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

/**
 * What a roll call is worth is arithmetic, and what it meant is prose.
 *
 * The engine has already decided everything that counts — whether the bill
 * carried, what it cost this member at home and with their caucus — before this
 * runs. All the model is asked for is the aftermath: how it played in the local
 * paper, what the people who elected them make of it. If it cannot answer, the
 * vote still stands with the note the engine wrote, which is what every vote in
 * this mode had before there was a model in it at all.
 */
async function attachFallout(state, result) {
  if (!USING_AI) return result;
  try {
    return { ...result, fallout: await falloutFromModel(state, result) };
  } catch (err) {
    console.error("The fallout could not be written:", err.message);
    recordModelFailure(err.message);
    return result;
  }
}

app.post("/api/house/vote", async (req, res) => {
  try {
    const { state, bill, vote } = req.body || {};
    if (!state || !bill) return res.status(400).json({ error: "state and bill are required." });
    const out = castVote(state, bill, String(vote));
    if (out.rejected) return res.status(400).json({ error: out.note });
    res.json({ ...out, result: await attachFallout(out.state, out.result) });
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
    const { title, axis, domain, favours } = req.body || {};
    const out = sponsorBill(state, {
      title: str(title, "An Act", 90),
      axis: Math.max(-1, Math.min(1, Number(axis) || 0)),
      domain: str(domain, "economy", 20),
      // Favours called in to get it heard. Bounded by what they actually hold,
      // which sponsorBill checks for itself.
      favours: num(favours, 0, 0, 100000),
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

/**
 * Next month's news.
 *
 * Run after the chamber's own advance, on the state as it will be, so the story
 * grows out of the month that just happened — including the problems this
 * chamber declined to legislate about, which is where the interesting ones come
 * from. Classic careers and an unreachable model both fall through to the
 * hand-written pool, so the country still moves either way.
 */
async function nextNationalStory(out) {
  const state = out?.state;
  // A career that has just ended is not owed a headline.
  if (!state || state.over) return out;

  /**
   * A problem that finally broke open writes its own headline and nothing gets
   * to write over it. It is the only thing anyone is talking about, it took
   * months of the chamber doing nothing to produce, and asking a model for
   * something more interesting would be throwing away the one story the game
   * actually earned.
   */
  if (state.detonation) {
    const blown = detonationEvent(state.detonation);
    return {
      ...out,
      state: setSituation({ ...state, detonation: null }, { ...blown, domain: state.detonation.arc.domain }),
      detonation: blown,
    };
  }

  let situation = null;
  if (wantsWrittenSituation(state, USING_AI)) {
    try {
      situation = await situationFromModel(state);
    } catch (err) {
      console.error("Next month's story failed, drawing from the pool:", err.message);
      recordModelFailure(err.message);
    }
  }
  return { ...out, state: setSituation(state, situation || situationFromPool(state)) };
}

/** End the month. At the end of a term, the district answers. */
/**
 * Forcing the floor.
 *
 * The one agenda-setting power that needs no rank, which is why it is on
 * `/api/chamber/` rather than behind a committee gate.
 */
app.post("/api/chamber/petition", memberOnly((req, res, state) => {
  try {
    const action = String(req.body?.action || "launch");
    const out = action === "sign"
      ? signPetition(state, Number(req.body?.favours) || 0)
      : launchPetition(state, String(req.body?.billId || ""), Number(req.body?.favours) || 0);
    if (out.rejected) return res.status(400).json({ error: out.note });
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The petition could not be filed." });
  }
}));

/** Moving against your own Speaker. */
app.post("/api/chamber/vacate", memberOnly((req, res, state) => {
  try {
    const out = moveToVacate(state, Number(req.body?.favours) || 0);
    if (out.rejected) return res.status(400).json({ error: out.note });
    res.json(out);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The motion could not be offered." });
  }
}));

app.post("/api/house/advance", async (req, res) => {
  try {
    const { state } = req.body || {};
    if (!state || state.office !== "house") return res.status(400).json({ error: "A House career is required." });
    const moved = advancePetition(state);
    const chair = resolveVacancy(moved.state);
    const out = advanceHouseMonth(chair.state);
    if (chair.note) out.vacancyNote = chair.note;
    // A signature drive is a month-by-month thing, so its news rides along with
    // the month rather than needing a screen of its own.
    if (moved.note) out.petitionNote = moved.note;
    if (moved.discharged) out.discharged = moved.discharged;
    res.json(await nextNationalStory(out));
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
    // An amendment has to survive the repaint that follows it. The calendar is
    // stored on the career now, so the amended text can be written back into it
    // — before, the marked-up bill lived only in the reply and the floor screen
    // reloaded the original underneath it a moment later.
    res.json({ ...out, state: reviseDocket(out.state, out.result.bill) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The committee could not act." });
  }
});

/** Replace one bill on this month's calendar, leaving the rest of it alone. */
function reviseDocket(state, bill) {
  const docket = state?.docket;
  if (!docket?.bills || !bill?.id) return state;
  return {
    ...state,
    docket: {
      ...docket,
      bills: docket.bills.map((b) => (b.id === bill.id ? { ...b, ...bill } : b)),
    },
  };
}

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

/**
 * The country you found, and the country you leave.
 *
 * Everything a career has done to the nation, read back out of the monthly
 * record: every indicator from the day of the oath to today, and the handful of
 * bills and disasters that actually bent the lines — with whether this member
 * voted for them.
 */
app.post("/api/chamber/country", memberOnly((req, res, state) => {
  try {
    res.json({
      compare: thenAndNow(state),
      turningPoints: turningPoints(state, 10),
      months: (state.chronicle || []).length,
      // The two numbers that are the member's own, drawn on the same timeline
      // as the country's, so a career can be read against what it cost.
      you: {
        seat: series(state, "approval"),
        caucus: series(state, "leadership"),
        president: series(state, "president"),
      },
      problems: (state.arcs || []).map((a) => ({
        id: a.id, title: a.title, domain: a.domain, severity: a.severity,
      })),
      scars: state.scars || [],
      resolved: state.resolved || [],
      seatWord: state.office === "senate" ? state.seat?.stateName : state.seat?.district,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "The record could not be read." });
  }
}));

/**
 * The chief of staff.
 *
 * A president has a cabinet to argue with before they decide. A member has one
 * room with four people in it, and the one who matters is whoever runs the
 * office — so this is the same conversation asked the only question a member
 * actually has, which is what a vote is going to cost them.
 */
app.post("/api/chamber/staff", memberOnly(async (req, res, state) => {
  try {
    const { history, message } = req.body || {};
    const text = str(message, "", 600).trim();
    if (!text) return res.status(400).json({ error: "A message is required." });

    const chief = staffOf(state);
    if (!USING_AI) return res.json({ reply: offlineStaffReply(state, text), staff: chief });
    try {
      return res.json({ reply: await staffReply(state, history, text), staff: chief });
    } catch (err) {
      console.error("The chief of staff could not answer:", err.message);
      recordModelFailure(err.message);
      return res.json({ reply: offlineStaffReply(state, text), staff: chief });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Your office could not be reached." });
  }
}));

/**
 * What the office says with no model behind it. Not an imitation of the model —
 * it reads the same two numbers the player can already see and says the one
 * true thing about them, which is better than a generated-sounding sentence.
 */
function offlineStaffReply(state, message) {
  const home = state.office === "senate" ? state.seat?.stateName : state.seat?.district;
  const weak = state.approval < 45;
  const cold = state.leadership < 45;
  const asked = message.length > 90 ? "There is a lot in that" : "Short answer";

  if (weak && cold) {
    return `${asked}: you are at ${state.approval} in ${home} and ${state.leadership} with the caucus, ` +
      `which means you have no cover in either direction. Whatever you do next, do it for one of them ` +
      `and not for both, because trying to please everybody is how you got to two numbers this bad.`;
  }
  if (weak) {
    return `${asked}: ${home} has you at ${state.approval}. Leadership will forgive a defection long ` +
      `before your voters forgive a vote they can put on a mailer. Go home on this one.`;
  }
  if (cold) {
    return `${asked}: you are at ${state.leadership} with the caucus, and that is what gets bills heard ` +
      `and gavels handed out. You can afford to take one for the team here — ${home} is at ${state.approval} ` +
      `and not paying close attention.`;
  }
  return `${asked}: you are in decent shape both ways — ${state.approval} at home, ${state.leadership} ` +
    `with the caucus. That is exactly the position to spend, not to sit on. Pick the vote you actually ` +
    `believe in and take it while you can still absorb the cost.`;
}

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

app.post("/api/senate/floor", async (req, res) => {
  try {
    const { state: body } = req.body || {};
    if (!body || body.office !== "senate") return res.status(400).json({ error: "A Senate career is required." });
    const { state, bills: docket, written } = await ensureDocket(body, {
      size: senateDocketSize, offline: senateFloor,
    });
    const buried = new Set((state.committeeLog || [])
      .filter((e) => e.action === "buried").map((e) => e.id));
    const held = new Set((state.filibusters || []).map((f) => f.id));
    const bills = docket
      .filter((b) => !buried.has(b.id))
      .map((bill) => ({
        ...bill,
        party: senatePartyLine(state, bill),
        district: senateStateView(state, bill),
        conviction: convictionView(state, bill),
        bloc: factionLine(state, bill),
        // Whose votes have come loose, including blocs that are not the
        // player's — which is most of them. See defectionsOn.
        defections: defectionsOn(state, bill),
        impact: billImpact(state.people, bill, yearOf(state)),
        yours: inYourDomain(state, bill),
        whip: whipCount(state, bill),
        filibustered: held.has(bill.id),
      }));
    res.json({
      bills,
      nation: nationCard(state),
      written,
      staff: staffOf(state),
      state,
      // How often they have voted like the person they said they were, and where
      // they stand with the blocs their ideology brought. See conviction.js.
      integrity: state.integrity ?? null,
      coalition: coalitionStanding(state),
      founding: foundingBlocs(state.scenario),
      ideology: state.scenario?.ideology || null,
      // The wing of the party you actually sit in, and what it is worth.
      faction: ownBloc(state),
      blocStanding: state.bloc ?? null,
      chamberFactions: factionRoll(state),
      trait: traitFor(state.scenario?.party, state.scenario?.ideology),
      // Who this member represents, and how far that has moved since the oath.
      people: state.people ? {
        rows: profileRows(state.people, yearOf(state)),
        describes: describeProfile(state.people, yearOf(state)),
        wasDescribed: describeProfile(state.peopleAtOath, state.scenario?.startYear || 2025),
        leanNow: state.seat?.lean,
        leanAtOath: state.leanAtOath ?? state.seat?.lean,
      } : null,
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

app.post("/api/senate/vote", async (req, res) => {
  try {
    const { state, bill, vote } = req.body || {};
    if (!state || !bill) return res.status(400).json({ error: "state and bill are required." });
    const out = senateVote(state, bill, String(vote));
    if (out.rejected) return res.status(400).json({ error: out.note });
    res.json({ ...out, result: await attachFallout(out.state, out.result) });
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

app.post("/api/senate/advance", async (req, res) => {
  try {
    const { state } = req.body || {};
    if (!state || state.office !== "senate") return res.status(400).json({ error: "A Senate career is required." });
    const moved = advancePetition(state);
    const chair = resolveVacancy(moved.state);
    const out = advanceSenateMonth(chair.state);
    if (chair.note) out.vacancyNote = chair.note;
    // A signature drive is a month-by-month thing, so its news rides along with
    // the month rather than needing a screen of its own.
    if (moved.note) out.petitionNote = moved.note;
    if (moved.discharged) out.discharged = moved.discharged;
    res.json(await nextNationalStory(out));
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
    /**
     * And the four issue axes, which are what make the ideology chosen at
     * creation mean something at every roll call rather than only placing the
     * character on a line. See ISSUE_AXES in bills.js.
     */
    ...Object.fromEntries(ISSUE_KEYS.map((id) => [
      issueKey(id), Math.max(-1, Math.min(1, Number(s?.[issueKey(id)]) || 0)),
    ])),
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
