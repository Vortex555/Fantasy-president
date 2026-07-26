"use strict";

import { $, el, show, escapeHtml, monthLabel, relativeDay } from "./util.js";
import { G, listCareers, deleteCareer, loadCareer } from "./store.js";

/** "Your Careers" — resume a run, retire one, or start fresh. */
const RANK_LABEL = {
  member: "", subchair: "Subcommittee Chair", chair: "Committee Chair",
  whip: "Majority Whip", speaker: "Speaker",
};

/**
 * Which office a save is for. A member of the House and a president used to
 * render identically, which made a list of five careers unreadable.
 */
function officeLine(c) {
  if (c.office === "house") {
    const rank = RANK_LABEL[c.rank] || "Rep.";
    return `🪑 ${escapeHtml(rank)} ${escapeHtml(c.seat?.district || "")}`.trim();
  }
  if (c.office === "senate") {
    return `🏛️ Sen. ${escapeHtml(c.seat?.stateName || "")}`.trim();
  }
  return "🏛️ President";
}

export function renderCareers(onResume, onNew) {
  const list = $("careerList");
  list.innerHTML = "";
  const careers = listCareers();

  if (!careers.length) {
    list.appendChild(el("div", "empty",
      "No careers yet. Start one and it will be saved here after every month you play."));
  }

  for (const c of careers) {
    const row = el("div", "row");
    const status = c.over
      ? `<span class="career__status career__status--over">Concluded</span>`
      : `<span class="career__status">Active</span>`;
    row.innerHTML = `
      <div class="row__body career">
        <div>
          <div class="career__name">${escapeHtml(c.name)}</div>
          <div class="career__meta">${officeLine(c)} · ${escapeHtml(c.scenarioName)}${
            (c.term || 1) > 1 ? ` · ${c.term} terms` : ""} · ${status} · Last played ${relativeDay(c.lastPlayed)}</div>
        </div>
        <div class="career__right">
          <span class="career__date">${monthLabel(c.month, c.startYear)}</span>
          <button class="career__delete" title="Delete this career" aria-label="Delete ${escapeHtml(c.name)}">✕</button>
        </div>
      </div>`;

    row.querySelector(".career__delete").addEventListener("click", (e) => {
      e.stopPropagation();
      if (!confirm(`Delete ${c.name}'s career? This cannot be undone.`)) return;
      deleteCareer(c.id);
      renderCareers(onResume, onNew);
    });

    row.addEventListener("click", () => {
      if (loadCareer(c.id)) onResume();
    });
    list.appendChild(row);
  }

  const startNew = el("button", "row row--new", `
    <span class="row__icon">✨</span>
    <span class="row__body">
      <span class="row__title">Start a New Career</span>
      <span class="row__desc">Pick a scenario, build a president, and take the oath.</span>
    </span>
    <span class="row__chevron">▸</span>`);
  startNew.type = "button";
  startNew.addEventListener("click", onNew);
  list.appendChild(startNew);

  show("careers");
}

/** The mode chip in the corner — tells the player which simulation is running. */
/**
 * Which brain is running the game.
 *
 * There are three answers now and the difference matters to the player: an
 * API they are paying for, a model on their own machine that costs nothing and
 * sends nothing anywhere, or no model at all. Guessing which one is active is
 * not something anybody should have to do.
 */
export function renderModeBadge() {
  const badge = $("modeBadge");
  const p = G.meta?.provider;

  if (p?.id === "local" && p.available) {
    badge.textContent = `● Local model · ${p.model || "on this machine"}`;
    badge.className = "badge badge--blue";
    badge.title = p.detail || "Running on your own machine.";
    return;
  }
  if (G.meta?.ai) {
    badge.textContent = "● Live AI simulation";
    badge.className = "badge badge--live";
    badge.title = p?.detail || "";
    return;
  }
  badge.textContent = "● Local simulation";
  badge.className = "badge";
  badge.title = "No model configured. Set ANTHROPIC_API_KEY, or run a model on this machine " +
    "and start with FP_PROVIDER=local.";
}
