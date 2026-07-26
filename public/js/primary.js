"use strict";

import { $, show, escapeHtml, loader, monthLabel } from "./util.js";
import { G, saveCareer } from "./store.js";
import { primaryBoard, finishPrimary } from "./api.js";

/**
 * The primary.
 *
 * The one election where the electorate is your own side. It gets its own
 * screen rather than a card because the decision on it is unlike any other in
 * the game: not what to do about the country, but what to do about your party —
 * and every answer costs something you will still be paying for in November.
 */

let handlers = {};
let board = null;
let chosen = "record";

export async function renderPrimary(hooks) {
  handlers = hooks;
  chosen = "record";
  const state = G.state;

  loader(true, "The filing deadline has passed…");
  try {
    board = await primaryBoard(state);
  } catch (err) {
    alert("The primary board could not be loaded: " + err.message);
    return handlers.onDashboard();
  } finally {
    loader(false);
  }

  const c = board.challenger;
  const t = board.threat;

  $("primaryBody").innerHTML = `
    <div class="dash-head">
      <div>
        <h1 class="display display--lg">The Primary</h1>
        <div class="dash-head__sub">Before the country gets a say, your own party does.</div>
      </div>
      <div class="dash-head__right">
        <h2 class="display display--md">${escapeHtml(monthLabel(state.month, state.scenario.startYear))}</h2>
        <div class="dash-head__sub">${board.delegates.majority} of ${board.delegates.total} delegates to win</div>
      </div>
    </div>

    <div class="card card--alarm">
      <span class="eyebrow">🥊 ${escapeHtml(c.name)} is running against you</span>
      <p style="margin:10px 0 0">
        A ${escapeHtml(state.scenario.party)} challenger from
        ${c.wing === "base" ? "the wing of the party you left behind" : "the pragmatic centre of your own party"},
        who ${escapeHtml(c.pitch)}.
      </p>
      <div class="reasons">
        ${t.reasons.map((r) => `<div class="reason">${escapeHtml(r)}</div>`).join("")}
      </div>
      <div class="tiles tiles--four" style="margin-top:16px">
        ${cell("Coalition", t.standing)}
        ${cell("Approval", `${Math.round(state.approval)}%`)}
        ${cell("Record drift", t.drift.toFixed(2))}
        ${cell("Delegates needed", board.delegates.majority)}
      </div>
      <p class="hint" style="margin:14px 0 0">
        <b>Record drift</b> is the distance between the bills you actually signed and the politics
        you ran on. Your party has the list.
      </p>
    </div>

    <div class="card">
      <span class="eyebrow">🗳️ How do you fight it?</span>
      <div class="options" id="strategyList" style="margin-top:14px">
        ${board.strategies.map((s) => `
          <button class="option${s.id === "record" ? " is-on" : ""}" data-strategy="${s.id}">
            <span class="option__title">${escapeHtml(s.label)}</span>
            <span class="option__desc">${escapeHtml(s.detail)}</span>
            <span class="option__cost"><b>The price:</b> ${escapeHtml(s.cost)}</span>
          </button>`).join("")}
      </div>
    </div>

    <div class="next-step">
      <button class="btn btn--primary btn--block" id="primaryGo" style="max-width:340px">
        To the Convention →
      </button>
    </div>`;

  const list = $("strategyList");
  list.onclick = (e) => {
    const btn = e.target.closest("[data-strategy]");
    if (!btn) return;
    chosen = btn.dataset.strategy;
    for (const el of list.querySelectorAll("[data-strategy]")) {
      el.classList.toggle("is-on", el.dataset.strategy === chosen);
    }
  };
  $("primaryGo").onclick = () => contest();
  show("primary");
  window.scrollTo(0, 0);
}

async function contest() {
  loader(true, "The delegates are being counted…");
  try {
    const data = await finishPrimary(G.state, chosen);
    G.state = data.state;
    saveCareer();
    paintResult(data.result);
  } catch (err) {
    alert("The primary could not be resolved: " + err.message);
  } finally {
    loader(false);
  }
}

function paintResult(result) {
  const state = G.state;
  const d = result.delegates;
  const pct = (d.you / d.total) * 100;
  // The states where the challenger actually beat the president.
  const lost = result.states.filter((s) => s.share < 50)
    .sort((a, b) => a.share - b.share).slice(0, 10);

  $("primaryBody").innerHTML = `
    <div class="dash-head">
      <div>
        <h1 class="display display--lg">${result.won ? "Renominated" : "Denied"}</h1>
        <div class="dash-head__sub">${escapeHtml(
          result.won
            ? `You are your party's candidate. ${result.challenger.name} conceded.`
            : `${result.challenger.name} is your party's candidate. You are not on the ballot.`)}</div>
      </div>
    </div>

    <div class="card">
      <span class="eyebrow">🎟️ The delegates — ${d.majority} to win</span>
      <div class="evbar" style="margin-top:14px">
        <div class="evbar__you" style="width:${pct}%"></div>
        <div class="evbar__mark" style="left:50%"></div>
      </div>
      <div class="evbar__legend">
        <span><b>${d.you}</b> ${escapeHtml(state.scenario.presidentName)}</span>
        <span><b>${d.them}</b> ${escapeHtml(result.challenger.name)}</span>
      </div>
      <p class="hint" style="margin:16px 0 0">
        You took ${result.national}% of the party nationally, running
        <b>${escapeHtml(result.strategy.label.toLowerCase())}</b>.
      </p>
    </div>

    ${lost.length ? `<div class="card">
      <span class="eyebrow">📍 Where your own party voted against you</span>
      <div class="flips" style="margin-top:12px">
        ${lost.map((s) => `<span class="flip flip--loss">${s.code}<i>${s.share.toFixed(0)}%</i></span>`).join("")}
      </div>
    </div>` : ""}

    ${result.won ? strategyAftermath(result) : ""}

    <div class="next-step">
      <button class="btn btn--primary btn--block" id="primaryDone" style="max-width:340px">
        ${result.won ? "On to the General →" : "The Historical Record →"}
      </button>
    </div>`;

  $("primaryDone").onclick = () => {
    if (state.over) return handlers.onLegacy();
    G.event = null;
    handlers.onDashboard();
  };
  window.scrollTo(0, 0);
}

/** What the choice actually cost, spelled out while it is still fresh. */
function strategyAftermath(result) {
  const state = G.state;
  if (result.strategy.id === "base") {
    return `<div class="card">
      <span class="eyebrow">↩️ What it cost</span>
      <p style="margin:10px 0 0">
        You adopted the wing's platform and you are standing somewhere new — your position is now
        <b>${state.scenario.ideologyAxis}</b> on the spectrum. Your coalition warmed by seven points
        and everybody outside it cooled by five. You are a more polarising candidate than you were
        this morning: election night will be better where your side already lives and worse
        everywhere it does not.
      </p>
    </div>`;
  }
  if (result.strategy.id === "deal") {
    const vp = (state.cabinet || []).find((c) => c.id === "vp");
    return `<div class="card card--alarm">
      <span class="eyebrow">🤝 What it cost</span>
      <p style="margin:10px 0 0">
        ${escapeHtml(result.challenger.name)} is your Vice President. They withdrew, they endorsed
        you, and their loyalty to you is <b>${vp?.loyalty ?? "?"}</b>. They have their own base and
        they owe you nothing — which is the exact profile of somebody who can lead a Twenty-Fifth
        Amendment declaration against you.
      </p>
    </div>`;
  }
  return `<div class="card">
    <span class="eyebrow">🪨 What it cost</span>
    <p style="margin:10px 0 0">
      Nothing you did not already owe. You stood on the record, the party looked at it, and it was
      enough — this time.
    </p>
  </div>`;
}

const cell = (label, value) => `<div class="tile tile--compact">
  <div class="tile__label">${escapeHtml(label)}</div>
  <div class="tile__value">${escapeHtml(String(value))}</div>
</div>`;
