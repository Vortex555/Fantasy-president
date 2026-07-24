"use strict";

import { $, el, show, escapeHtml, monthLabel, relativeDay } from "./util.js";
import { G, listCareers, deleteCareer, loadCareer } from "./store.js";

/** "Your Careers" — resume a run, retire one, or start fresh. */
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
          <div class="career__meta">${escapeHtml(c.scenarioName)} · ${status} · Last played ${relativeDay(c.lastPlayed)}</div>
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
export function renderModeBadge() {
  const badge = $("modeBadge");
  if (G.meta?.ai) {
    badge.textContent = "● Live AI simulation";
    badge.className = "badge badge--live";
  } else {
    badge.textContent = "● Local simulation";
    badge.className = "badge";
    badge.title = "Set ANTHROPIC_API_KEY to have Claude write each month.";
  }
}
