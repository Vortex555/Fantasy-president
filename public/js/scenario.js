"use strict";

import { $, el, show, escapeHtml } from "./util.js";
import { SCENARIOS } from "./data.js";

let chosenScenario = null;

export const currentScenario = () => chosenScenario;

/** "Choose your scenario." Scenarios with eras route through the era picker. */
export function renderScenarios(onPicked) {
  const list = $("scenarioList");
  list.innerHTML = "";

  for (const s of SCENARIOS) {
    const row = el("button", `row${s.variant ? ` row--${s.variant}` : ""}`, `
      <span class="row__icon">${s.icon}</span>
      <span class="row__body">
        <span class="row__title">${escapeHtml(s.name)}</span>
        <span class="row__desc">${escapeHtml(s.desc)}</span>
      </span>
      <span class="row__chevron">▸</span>`);
    row.type = "button";
    row.addEventListener("click", () => {
      chosenScenario = s;
      if (s.eras?.length) renderEras(onPicked);
      else onPicked(s, s.era);
    });
    list.appendChild(row);
  }

  show("scenarios");
}

/** "Pick Your Era" — the world you inherit on day one. */
export function renderEras(onPicked) {
  const s = chosenScenario;
  const list = $("eraList");
  list.innerHTML = "";

  for (const era of s.eras) {
    const row = el("button", "row", `
      <span class="row__icon">${era.icon}</span>
      <span class="row__body">
        <span class="row__title">${escapeHtml(era.title)}</span>
        <span class="row__desc">${escapeHtml(era.desc)}</span>
      </span>
      <span class="row__chevron">▸</span>`);
    row.type = "button";
    row.addEventListener("click", () => onPicked(s, era));
    list.appendChild(row);
  }

  show("eras");
}
