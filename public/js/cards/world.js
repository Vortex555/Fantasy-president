"use strict";

import { escapeHtml, track, toneFor } from "../util.js";
import { G } from "../store.js";

/**
 * The cards for the optional subsystems: foreign standing, the national
 * statistics, the wars, and the shadow war. Each renders to nothing when its
 * rule is off, so the dashboard only ever shows what is actually running.
 */

// --- Foreign relations -----------------------------------------------------

export function foreignCard(state) {
  if (!state.foreign || !G.meta.foreignRegions?.length) return "";
  const values = G.meta.foreignRegions.map((r) => state.foreign[r.id] ?? 50);
  const avg = Math.round(values.reduce((a, b) => a + b, 0) / values.length);

  return `<div class="card" style="margin:0">
    <div class="card__head">
      <span class="eyebrow">🌐 Foreign relations</span>
      <span class="hint">Standing in the world: <b style="color:${toneFor(avg)}">${avg}</b></span>
    </div>
    <div style="margin-top:12px">
      ${G.meta.foreignRegions.map((r) => {
        const v = state.foreign[r.id] ?? 50;
        return `<div class="stake">
          <span class="stake__name">${r.emoji} ${escapeHtml(r.name)}</span>
          <span class="stake__track">${track(v, toneFor(v))}</span>
          <span class="stake__val" style="color:${toneFor(v)}">${v}</span>
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

// --- Social engineering ----------------------------------------------------

const fmt = (metric, value) =>
  `${metric.decimals === 0 ? Math.round(value) : Number(value).toFixed(metric.decimals)}${metric.unit}`;

export function societyCard(state) {
  if (!state.society || !G.meta.societyMetrics?.length) return "";

  return `<div class="card" style="margin-top:14px">
    <span class="eyebrow">📊 The country itself</span>
    <p class="hint" style="margin:6px 0 0">What your policies did to the place, as opposed to the polling.</p>
    <div class="tiles tiles--four" style="margin-top:12px">
      ${G.meta.societyMetrics.map((m) => `
        <div class="tile tile--compact">
          <span class="eyebrow">${escapeHtml(m.name)}</span>
          <div class="tile__value">${fmt(m, state.society[m.id])}</div>
        </div>`).join("")}
    </div>
  </div>`;
}

// --- Deployments & war -----------------------------------------------------

const WAR_STATUS = {
  active: { label: "Active", cls: "badge--red" },
  withdrawn: { label: "Withdrawn", cls: "" },
  settled: { label: "Settled", cls: "badge--blue" },
  won: { label: "Objective met", cls: "badge--live" },
};

export function warCard(state) {
  const dep = state.deployments;
  if (!dep || !dep.wars?.length) return "";
  const active = dep.wars.filter((w) => w.status === "active");
  const weariness = Math.round(dep.weariness);

  return `<div class="card" style="margin-top:14px">
    <div class="card__head">
      <span class="eyebrow">⚔️ Deployments</span>
      <span class="hint">War-weariness: <b style="color:${weariness > 55 ? "var(--red)" : weariness > 35 ? "var(--amber)" : "var(--green)"}">${weariness}</b>/100</span>
    </div>
    <div style="margin-top:4px">${track(weariness, weariness > 55 ? "var(--red)" : "var(--amber)")}</div>

    <div class="posts" style="margin-top:14px">
      ${dep.wars.map((w) => {
        const status = WAR_STATUS[w.status] || WAR_STATUS.active;
        return `<div class="post${w.status === "active" ? " post--expiring" : ""}">
          <div class="post__head">
            <span class="post__title">${escapeHtml(w.name)}</span>
            <span class="badge ${status.cls}">${status.label}</span>
          </div>
          <div class="post__name">${w.troops.toLocaleString()} deployed</div>
          <div class="post__stats">
            <span>${w.casualties.toLocaleString()} casualties</span>
            <span>${w.monthsActive} mo</span>
          </div>
          <div class="post__term">${escapeHtml(w.objective)}</div>
          ${dep.mode === "strategic" ? track(w.progress, "var(--blue)") : ""}
        </div>`;
      }).join("")}
    </div>

    ${active.length ? `<p class="hint" style="margin:12px 0 0">Your orders come from what you write in the month's
      policy — escalate, hold, draw down, withdraw${dep.mode === "strategic" ? ", or open talks" : ""}.</p>` : ""}
  </div>`;
}

// --- Covert operations -----------------------------------------------------

const COVERT_DIALS = [
  { id: "penetration", name: "Penetration", better: "up" },
  { id: "pressure", name: "Pressure on havens", better: "up" },
  { id: "homeland", name: "Homeland hardening", better: "up" },
  { id: "exposure", name: "Exposure", better: "down" },
  { id: "threat", name: "Active threat", better: "down" },
];

export function covertCard(state) {
  const c = state.covert;
  if (!c) return "";
  const tone = (dial) => {
    const v = c[dial.id];
    return dial.better === "up" ? toneFor(v) : toneFor(100 - v);
  };

  return `<div class="card" style="margin-top:14px">
    <div class="card__head">
      <span class="eyebrow">🎯 Covert operations</span>
      <span class="hint">${c.lastAction ? `Last posture: ${escapeHtml(c.lastAction.replace("_", " "))}` : "No posture set"}</span>
    </div>
    <div style="margin-top:12px">
      ${COVERT_DIALS.map((d) => `
        <div class="stake">
          <span class="stake__name">${escapeHtml(d.name)}</span>
          <span class="stake__track">${track(c[d.id], tone(d))}</span>
          <span class="stake__val" style="color:${tone(d)}">${Math.round(c[d.id])}</span>
        </div>`).join("")}
    </div>
    <p class="hint" style="margin:12px 0 0">Set the posture in your monthly policy — run agents, strike the havens,
      harden the homeland, work through partners, or go quiet.</p>
    ${c.log?.length ? `
      <div class="eyebrow" style="margin:16px 0 8px">Programme log</div>
      ${c.log.slice(0, 4).map((entry) => `
        <div class="timeline__item">
          <span class="timeline__when">Mo ${entry.month}</span>
          <span class="timeline__what">${escapeHtml(entry.detail)}</span>
        </div>`).join("")}` : ""}
  </div>`;
}
