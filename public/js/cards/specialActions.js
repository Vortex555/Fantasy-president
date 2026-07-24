"use strict";

import { el, escapeHtml, track, loader } from "../util.js";
import { G, saveCareer } from "../store.js";
import { availableActions, proposeAction } from "../api.js";

/**
 * Special actions — the docket of things that change the rules rather than the
 * country. Every row shows its real odds before you spend a month on it,
 * because a gamble you cannot price is not a decision.
 */

let cached = null;

export async function loadActions(state) {
  try {
    cached = await availableActions(state);
  } catch {
    cached = null;
  }
  return cached;
}

function oddsTone(pct) {
  if (pct >= 60) return "var(--green)";
  if (pct >= 30) return "var(--amber)";
  return "var(--red)";
}

function actionRow(a) {
  return `<div class="docket${a.available ? "" : " docket--blocked"}">
    <div class="docket__body">
      <div class="docket__title">${escapeHtml(a.title)}</div>
      <div class="docket__desc">${escapeHtml(a.desc)}</div>
      <div class="docket__req">${escapeHtml(a.requirement)}</div>
    </div>
    <div class="docket__action">
      ${a.available
        ? `<div class="docket__odds" style="color:${oddsTone(a.odds)}">${a.odds}%</div>
           <div class="hint" style="margin-bottom:6px">to pass</div>
           <button class="btn btn--sm btn--primary" data-propose="${a.id}">Propose</button>`
        : `<div class="hint">${escapeHtml(a.reason)}</div>`}
    </div>
  </div>`;
}

export function specialActionsCard(state) {
  if (!cached?.actions?.length) return "";
  const ledger = cached.ledger || state.specialActions;
  const groups = [...new Set(cached.actions.map((a) => a.group))];
  const openCount = cached.actions.filter((a) => a.available).length;

  const pending = ledger?.pending
    ? `<div class="card card--amber" style="margin:0 0 14px">
        <span class="eyebrow">Out with the states</span>
        <div class="docket__title" style="margin:6px 0 4px">${escapeHtml(ledger.pending.title)}</div>
        <p class="hint" style="margin:0 0 8px">${ledger.pending.ratified} of ${ledger.pending.needed} states ratified ·
          deadline month ${ledger.pending.deadline}</p>
        ${track((ledger.pending.ratified / ledger.pending.needed) * 100, "var(--amber)")}
      </div>`
    : "";

  return `<details class="roster" id="specialActionsCard">
    <summary>
      <span class="eyebrow">📜 Special actions <b style="color:var(--ink)">${openCount} available</b></span>
      <span class="row__chevron">▾</span>
    </summary>
    <div class="roster__body">
      ${pending}
      ${groups.map((group) => `
        <div class="eyebrow" style="margin:14px 0 8px">${escapeHtml(group)}</div>
        ${cached.actions.filter((a) => a.group === group).map(actionRow).join("")}`).join("")}
      ${ledger?.log?.length ? `
        <div class="eyebrow" style="margin:18px 0 8px">On the record</div>
        ${ledger.log.slice(0, 5).map((entry) => `
          <div class="timeline__item">
            <span class="timeline__when">Mo ${entry.month}</span>
            <span class="timeline__what">${escapeHtml(entry.title)} — ${escapeHtml(entry.note)}</span>
          </div>`).join("")}` : ""}
    </div>
  </details>`;
}

export function wireSpecialActions(root, refresh) {
  root.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-propose]");
    if (!btn) return;

    const action = cached.actions.find((a) => a.id === btn.dataset.propose);
    if (!confirm(`Propose "${action.title}"?\n\n${action.requirement}\nOdds of passing: ${action.odds}%.\n\nFailing costs approval and stability, and you only get two attempts.`)) return;

    loader(true, "The floor is voting…");
    try {
      const res = await proposeAction(G.state, action.id);
      if (res.rejected) return alert(res.note);
      G.state = res.state;
      saveCareer();
      alert(res.note);
      await loadActions(G.state);
      refresh();
    } catch (err) {
      alert("The proposal failed: " + err.message);
    } finally {
      loader(false);
    }
  });
}
