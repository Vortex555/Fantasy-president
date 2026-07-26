"use strict";

import { $, escapeHtml, loader } from "../util.js";
import { G, saveCareer } from "../store.js";
import { getGovernors, courtGovernor } from "../api.js";

/**
 * The statehouses.
 *
 * Fifty people the president did not appoint and cannot remove, each running a
 * piece of the country the president needs in order to actually do anything.
 * The card leads with the ones refusing to co-operate, because those are the
 * states where a policy quietly fails to arrive — and with the bench, because
 * the person who ends this presidency is usually already on it.
 */

let board = null;

export function governorsCard(state) {
  if (!state.governors) return "";
  return `<div class="card" id="governorsCard">
    <div class="card__head">
      <span class="eyebrow">🏛️ The statehouses</span>
      <span class="hint" id="govSummary">Loading the fifty…</span>
    </div>
    <div id="govBody"><p class="hint" style="margin:0">Reading the statehouses…</p></div>
  </div>`;
}

const tone = (d) => (d >= 70 ? "bad" : d >= 45 ? "warn" : "good");
const label = (d) => (d >= 70 ? "Open resistance" : d >= 45 ? "Obstructive" : d >= 25 ? "Correct" : "Co-operative");

export async function wireGovernors(onChange) {
  const body = $("govBody");
  if (!body) return;

  try {
    board = await getGovernors(G.state);
  } catch {
    body.innerHTML = `<p class="hint" style="margin:0">The statehouses could not be reached.</p>`;
    return;
  }
  paint(onChange);
}

function paint(onChange) {
  const body = $("govBody");
  if (!body || !board) return;

  const sorted = [...board.governors].sort((a, b) => b.defiance - a.defiance);
  const hostile = sorted.filter((g) => g.defiance >= 45);
  const avg = Math.round(board.governors.reduce((s, g) => s + g.defiance, 0) / board.governors.length);

  const summary = $("govSummary");
  if (summary) {
    summary.textContent = hostile.length
      ? `${hostile.length} of 50 obstructing · average resistance ${avg}`
      : `The states are co-operating · average resistance ${avg}`;
  }

  // Only the ones that are actually a problem, plus the bench.
  const shown = sorted.slice(0, 6);

  body.innerHTML = `
    <p class="hint" style="margin:0 0 12px">
      A policy is only worth what the states carry out. Where resistance is high, federal
      programmes arrive late, thin, or not at all.
    </p>
    <div class="govs">
      ${shown.map((g) => `
        <div class="gov">
          <div class="gov__who">
            <span class="gov__state">${g.state}</span>
            <div>
              <div class="gov__name">Gov. ${escapeHtml(g.name)}</div>
              <div class="gov__meta">${escapeHtml(g.party)} · ${escapeHtml(g.ideology)} · ${escapeHtml(g.stateName)}</div>
            </div>
          </div>
          <div class="gov__right">
            <span class="badge badge--${tone(g.defiance) === "bad" ? "red" : tone(g.defiance) === "warn" ? "amber" : "live"}">
              ${label(g.defiance)} ${g.defiance}</span>
            <button class="btn btn--sm" data-court="${g.state}"
              ${board.warChest < board.cost ? "disabled" : ""}>Deal · $${board.cost}M</button>
          </div>
        </div>`).join("")}
    </div>

    ${board.bench.length ? `
      <div class="gov-bench">
        <span class="eyebrow">🎯 Running for your job</span>
        <p class="hint" style="margin:6px 0 10px">
          The governors positioning for a national run. One of these is your challenger.
        </p>
        <div class="flips">
          ${board.bench.map((b) => `<span class="flip flip--${b.party === G.state.scenario.party ? "loss" : "gain"}">
            ${escapeHtml(b.name)} <i>${b.state} · ${escapeHtml(b.party[0])}</i></span>`).join("")}
        </div>
      </div>` : ""}`;

  body.onclick = async (e) => {
    const btn = e.target.closest("[data-court]");
    if (!btn) return;
    loader(true, "A quiet conversation is being had…");
    try {
      const data = await courtGovernor(G.state, btn.dataset.court);
      G.state = data.state;
      saveCareer();
      board = await getGovernors(G.state);
      paint(onChange);
      if (onChange) onChange(data.note);
    } catch (err) {
      alert("The deal could not be made: " + err.message);
    } finally {
      loader(false);
    }
  };
}
