"use strict";

import { escapeHtml, track } from "../util.js";

/**
 * Jeopardy: the investigation, the articles, and the trial.
 *
 * The card only exists when there is something to be worried about — a
 * permanent "you are not being impeached" panel would teach the player to stop
 * reading it. When it does appear, the number that matters is the one the
 * Senate needs, so it is the loudest thing here.
 */

const STATUS = {
  investigating: { label: "Under investigation", tone: "badge--amber" },
  impeached: { label: "Impeached — awaiting trial", tone: "badge--red" },
  acquitted: { label: "Acquitted", tone: "badge--blue" },
};

function investigationBlock(j) {
  if (!j.investigation) return "";
  const pct = Math.round(j.investigation.progress);
  return `<div class="jeopardy__block">
    <div class="jeopardy__row">
      <span class="jeopardy__label">FBI investigation — ${escapeHtml(j.investigation.subject)}</span>
      <span class="jeopardy__value">${pct}%</span>
    </div>
    ${track(pct, pct > 70 ? "var(--red)" : "var(--amber)")}
    <p class="hint" style="margin:8px 0 0">At 100% the Bureau refers its findings to the House.
      How fast it gets there is set by how independent your Director is.</p>
  </div>`;
}

function articlesBlock(j) {
  if (!j.articles.length) return "";
  const weight = j.articles.reduce((sum, a) => sum + a.weight, 0);
  return `<div class="jeopardy__block">
    <div class="jeopardy__row">
      <span class="jeopardy__label">Articles on the table</span>
      <span class="jeopardy__value">${weight} / 5 to force a vote</span>
    </div>
    ${track(Math.min(100, (weight / 5) * 100), weight >= 5 ? "var(--red)" : "var(--amber)")}
    <div style="margin-top:12px">
      ${j.articles.map((a) => `
        <div class="timeline__item">
          <span class="timeline__when">Mo ${a.month}</span>
          <span class="timeline__what"><b>${escapeHtml(a.title)}</b> — ${escapeHtml(a.detail)}</span>
        </div>`).join("")}
    </div>
  </div>`;
}

function voteBlock(label, vote, needed, neededLabel, party) {
  if (!vote) return "";
  const short = needed - vote.yes;
  // How many of the votes against you came from your own side — the only part
  // of the tally a president actually studies.
  const ownDefectors = party === "Democrat" ? vote.dYes : party === "Republican" ? vote.rYes : 0;

  return `<div class="jeopardy__block">
    <div class="jeopardy__row">
      <span class="jeopardy__label">${label}</span>
      <span class="jeopardy__value">${vote.yes}–${vote.no}</span>
    </div>
    <p class="hint" style="margin:6px 0 0">${short > 0
      ? `${short} short of the ${needed} needed ${neededLabel}.`
      : `Past the ${needed} needed ${neededLabel}.`}
      ${ownDefectors > 0
        ? `<b style="color:var(--red)">${ownDefectors} of your own party voted against you.</b>`
        : "Your own party held the line."}</p>
  </div>`;
}

export function jeopardyCard(state) {
  const j = state.jeopardy;
  if (!j) return "";
  const live = j.investigation || j.articles.length || j.status === "impeached" || j.acquittals;
  if (!live) return "";

  const status = STATUS[j.status] || null;
  const impeached = j.status === "impeached";

  return `<div class="card${impeached ? " card--red card--alarm" : ""}" id="jeopardyCard">
    <div class="card__head">
      <span class="eyebrow">⚖️ Jeopardy</span>
      ${status ? `<span class="badge ${status.tone}">${status.label}</span>` : ""}
    </div>

    ${impeached ? `<p class="analysis" style="margin:0 0 14px">
      The House has impeached you. The Senate tries you next month, and it takes
      <b>67 of 100</b> to remove you from office.</p>` : ""}

    ${investigationBlock(j)}
    ${articlesBlock(j)}
    ${voteBlock("House vote", j.houseVote, j.houseVote?.majority, "to impeach", state.scenario.party)}
    ${voteBlock("Senate trial", j.senateVote, j.senateVote?.twoThirds, "to convict", state.scenario.party)}

    ${j.acquittals ? `<p class="hint" style="margin:12px 0 0">Survived
      ${j.acquittals} trial${j.acquittals > 1 ? "s" : ""}. The record does not go away.</p>` : ""}
  </div>`;
}
