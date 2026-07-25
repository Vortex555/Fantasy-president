"use strict";

import { escapeHtml } from "../util.js";
import { G } from "../store.js";
import { buildCongress, caucusBreakdown } from "../data/government.js";

/**
 * Who is actually in the room. The chamber rows open onto a caucus breakdown
 * by ideology and a searchable directory of every member — 435 names is too
 * many to read, so the breakdown is the headline and the roster is the detail.
 */

// Derived, not stored. Cached per state so re-renders are free.
let cache = { key: null, congress: null };

export function congressRoster(state) {
  const key = `${state.rosterSeed}|${state.congress.houseD}|${state.congress.houseR}` +
    `|${state.congress.senateD}|${state.congress.senateR}|${state.scenario.radicals}`;
  if (cache.key !== key) cache = { key, congress: buildCongress(state, G.meta?.states || {}) };
  return cache.congress;
}

const partyDot = (party) => `<i class="dot dot--${party === "Republican" ? "rep" : "dem"}"></i>`;

function breakdownHtml(roster) {
  const rows = caucusBreakdown(roster);
  const total = roster.length;
  return `<div class="caucus">
    ${rows.map((r) => `
      <div class="caucus__row">
        <span class="caucus__name">${partyDot(r.party)}${escapeHtml(r.ideology)}${
          r.fringe ? ` <span class="caucus__flag">fringe</span>` : ""}</span>
        <span class="caucus__bar"><i style="width:${(r.count / total) * 100}%"
          class="${r.party === "Republican" ? "rep" : "dem"}"></i></span>
        <span class="caucus__count">${r.count}</span>
      </div>`).join("")}
  </div>`;
}

function directoryHtml(roster, chamber) {
  return `<details class="directory">
    <summary>Full roster — all ${roster.length} members</summary>
    <div class="directory__list" data-roster="${chamber}">
      ${roster.map((m) => `
        <div class="member">
          <span class="member__who">${partyDot(m.party)}<b>${escapeHtml(m.title)} ${escapeHtml(m.name)}</b>
            <span class="member__seat">${escapeHtml(m.seat)}</span></span>
          <span class="member__ideology${m.fringe ? " is-fringe" : ""}">${escapeHtml(m.ideology)}</span>
        </div>`).join("")}
    </div>
  </details>`;
}

/** The expandable row for one chamber: seat maths, caucuses, then the roster. */
export function chamberRow(state, chamber, title, split, mathRows) {
  if (state.congressDissolved) return "";
  const roster = congressRoster(state)[chamber];
  const fringe = roster.filter((m) => m.fringe).length;

  return `<details class="roster">
    <summary>
      <span class="eyebrow">🏛️ ${escapeHtml(title)} <b style="color:var(--ink)">${split}</b></span>
      <span class="row__chevron">▾</span>
    </summary>
    <div class="roster__body">
      ${mathRows.map(([k, v]) => `<div class="record__row"><span>${k}</span><b>${v}</b></div>`).join("")}

      <div class="eyebrow" style="margin:18px 0 10px">Caucuses by ideology${
        fringe ? ` · <span style="color:var(--red)">${fringe} radical</span>` : ""}</div>
      ${breakdownHtml(roster)}
      ${directoryHtml(roster, chamber)}
    </div>
  </details>`;
}

/** The nine, named, with the politics each of them brings to the bench. */
export function courtCard(state) {
  const justices = state.justices || [];
  const { conservative, liberal } = state.court;
  const label = conservative >= liberal
    ? `Conservative ${conservative}–${liberal} majority`
    : `Liberal ${liberal}–${conservative} majority`;

  if (!justices.length) {
    // A career saved before the bench was named.
    const seats = [];
    for (let i = 0; i < conservative; i++) seats.push(`<span class="justice justice--con">${68 + i * 3}</span>`);
    for (let i = 0; i < liberal; i++) seats.push(`<span class="justice justice--lib">${71 + i * 4}</span>`);
    return `<div class="card">
      <div class="card__head"><span class="eyebrow">⚖️ Supreme Court</span><span class="hint">${label}</span></div>
      <div class="bench">${seats.join("")}</div>
    </div>`;
  }

  return `<div class="card">
    <div class="card__head">
      <span class="eyebrow">⚖️ Supreme Court</span>
      <span class="hint">${label}</span>
    </div>
    <div class="bench">
      ${justices.map((j) => `
        <span class="justice justice--${j.wing === "conservative" ? "con" : "lib"}"
          title="${escapeHtml(j.name)} — ${escapeHtml(j.ideology)}, age ${j.age}">
          ${j.chief ? `<span class="justice__crown">👑</span>` : ""}${j.age}</span>`).join("")}
    </div>
    <details class="directory" style="margin-top:14px">
      <summary>The bench</summary>
      <div class="directory__list">
        ${justices.map((j) => `
          <div class="member">
            <span class="member__who"><i class="dot dot--${j.wing === "conservative" ? "rep" : "dem"}"></i>
              <b>${escapeHtml(j.name)}</b>${j.chief ? ` <span class="member__seat">Chief Justice</span>` : ""}
              <span class="member__seat">age ${j.age}</span></span>
            <span class="member__ideology${j.fringe ? " is-fringe" : ""}">${escapeHtml(j.ideology)}</span>
          </div>`).join("")}
      </div>
    </details>
  </div>`;
}
