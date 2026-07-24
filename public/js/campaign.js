"use strict";

import { $, show, escapeHtml, loader } from "./util.js";
import { G, saveCareer } from "./store.js";
import { debateRound, finishCampaign } from "./api.js";

let handlers = {};

/** Election season: three debate rounds, then the country votes. */
export function renderCampaign(hooks) {
  handlers = hooks;
  const state = G.state;
  const c = state.campaign;
  G.debate = { round: 1, scores: [], history: [] };

  // With debates switched off in setup, the record alone decides it.
  if (state.scenario.debates === false) return resolve(0);

  $("campaignBody").innerHTML = `
    <div class="dash-head">
      <div>
        <h1 class="display display--lg">The Campaign</h1>
        <div class="dash-head__sub">Four years of governing come down to three rounds, live, before the nation.</div>
      </div>
      <div class="dash-head__right">
        <h2 class="display display--md">Election season</h2>
        <div class="dash-head__sub">Month ${state.month} of 48</div>
      </div>
    </div>

    <div class="card">
      <div class="stage">
        <div class="podium">
          <div class="podium__emoji">🎙️</div>
          <div class="podium__name">${escapeHtml(state.scenario.presidentName)}</div>
          <div class="podium__meta">${escapeHtml(state.scenario.party)} · ${Math.round(state.approval)}% approval</div>
        </div>
        <div class="stage__vs">VS</div>
        <div class="podium">
          <div class="podium__emoji">🧑‍⚖️</div>
          <div class="podium__name">${escapeHtml(c.opponent.name)}</div>
          <div class="podium__meta">${escapeHtml(c.opponent.party)} challenger · ${escapeHtml(c.opponent.style)}</div>
        </div>
      </div>
      <div style="margin-top:20px">
        <div class="momentum">
          <div class="momentum__fill" id="momentumFill" style="left:50%;width:0"></div>
          <div class="momentum__tick"></div>
        </div>
        <p class="hint center" id="momentumText" style="margin:10px 0 0">Debate momentum: even</p>
      </div>
    </div>

    <div id="debateLog"></div>

    <div class="card" id="debateComposer">
      <span class="eyebrow" id="debateRoundLabel">Round 1 of 3</span>
      <p class="moderator" id="moderatorQ">—</p>
      <textarea id="debateInput" rows="4" maxlength="700"
        placeholder="Deliver your answer to the nation. Be specific, stay on message, and don't be afraid to go on offense."></textarea>
      <div class="composer__actions">
        <span class="composer__count" id="debateCount">0 / 700</span>
        <button class="btn btn--primary" id="debateSend">Respond →</button>
      </div>
    </div>

    <div class="next-step hidden" id="debateFinish">
      <button class="btn btn--primary btn--block" id="finishBtn" style="max-width:340px">
        See the Election Result →
      </button>
    </div>`;

  paintRound();
  const input = $("debateInput");
  input.oninput = () => { $("debateCount").textContent = `${input.value.length} / 700`; };
  $("debateSend").onclick = submitRound;
  $("finishBtn").onclick = () => resolve(G.debate.scores.reduce((a, b) => a + b, 0));
  show("campaign");
  input.focus();
}

function paintRound() {
  const t = G.state.campaign.topics[G.debate.round - 1];
  $("debateRoundLabel").textContent = `Round ${G.debate.round} of 3 · ${t.topic}`;
  $("moderatorQ").textContent = `Moderator: “${t.q}”`;
}

function paintMomentum(total) {
  const pct = Math.max(-100, Math.min(100, total * 3.3));
  const fill = $("momentumFill");
  fill.classList.toggle("is-neg", pct < 0);
  if (pct >= 0) { fill.style.left = "50%"; fill.style.width = `${pct / 2}%`; }
  else { fill.style.left = `${50 + pct / 2}%`; fill.style.width = `${-pct / 2}%`; }
  const label = total > 4 ? "You are winning the debate"
    : total < -4 ? "The challenger is winning"
    : "Debate momentum: even";
  $("momentumText").textContent = `${label} (${total > 0 ? "+" : ""}${total})`;
}

async function submitRound() {
  const input = $("debateInput");
  const line = input.value.trim();
  if (line.length < 3) { input.focus(); return; }

  const topic = G.state.campaign.topics[G.debate.round - 1].topic;
  $("debateSend").disabled = true;
  loader(true, G.meta.ai ? "The challenger is firing back…" : "The room reacts…");
  try {
    const res = await debateRound(G.state, G.debate.round, topic, line, G.debate.history);
    G.debate.scores.push(res.score || 0);
    G.debate.history.push({ role: "you", text: line });
    G.debate.history.push({ role: "opponent", text: res.opponentLine });

    appendExchange(G.debate.round, topic, line, res);
    paintMomentum(G.debate.scores.reduce((a, b) => a + b, 0));

    G.debate.round++;
    input.value = "";
    $("debateCount").textContent = "0 / 700";
    if (G.debate.round > 3) {
      $("debateComposer").classList.add("hidden");
      $("debateFinish").classList.remove("hidden");
      $("debateFinish").scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      paintRound();
    }
  } catch (err) {
    alert("The debate round failed: " + err.message);
  } finally {
    $("debateSend").disabled = false;
    loader(false);
  }
}

function appendExchange(round, topic, youLine, res) {
  const score = res.score || 0;
  const tone = score > 1 ? "delta--up" : score < -1 ? "delta--down" : "";
  const node = document.createElement("div");
  node.className = "card exchange";
  node.innerHTML = `
    <span class="eyebrow">Round ${round} · ${escapeHtml(topic)}</span>
    <p class="exchange__line"><b>${escapeHtml(G.state.scenario.presidentName)}:</b> ${escapeHtml(youLine)}</p>
    <p class="exchange__line exchange__line--opp"><b>${escapeHtml(G.state.campaign.opponent.name)}:</b> ${escapeHtml(res.opponentLine || "")}</p>
    <div class="exchange__pundit">
      <span>${escapeHtml(res.pundit || "")}</span>
      <span class="delta ${tone}">${score > 0 ? "+" : ""}${score}</span>
    </div>`;
  $("debateLog").appendChild(node);
}

async function resolve(total) {
  loader(true, "The polls are closing. The nation votes…");
  try {
    const res = await finishCampaign(G.state, total);
    G.state = res.state;
    saveCareer();
    handlers.onLegacy();
  } catch (err) {
    alert("The election could not be resolved: " + err.message);
  } finally {
    loader(false);
  }
}
