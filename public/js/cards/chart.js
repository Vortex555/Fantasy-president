"use strict";

import { escapeHtml, shortMonthLabel, netApproval } from "../util.js";

/**
 * The approval line. Inline SVG, no library — a term is at most a couple of
 * hundred points and the shape is the whole message: where you peaked, where
 * you cracked, and whether you are above the line that wins an election.
 */

const W = 720;
const H = 190;
const PAD = { top: 14, right: 14, bottom: 22, left: 34 };

export function approvalChart(state) {
  const history = state.history || [];
  if (history.length < 2) {
    return `<div class="card" style="margin-top:14px">
      <span class="eyebrow">📉 Approval over the term</span>
      <p class="hint" style="margin:10px 0 0">The line starts after your second decision.</p>
    </div>`;
  }

  const startYear = state.scenario.startYear || 2025;
  // Plotted in net terms, the way the country talks about a presidency.
  const points = history.map((h) => ({ month: h.month, value: netApproval(h.approval ?? 50) }));
  const values = points.map((p) => p.value);
  const lo = Math.max(-100, Math.min(...values, -10) - 8);
  const hi = Math.min(100, Math.max(...values, 10) + 8);
  const span = Math.max(20, hi - lo);

  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i) => PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v) => PAD.top + innerH - ((v - lo) / span) * innerH;

  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${(PAD.top + innerH).toFixed(1)} L${PAD.left},${(PAD.top + innerH).toFixed(1)} Z`;

  // Gridlines at the numbers that actually mean something. Zero is the line
  // between a presidency the country is with and one it is not.
  const marks = [0, -25, 25, -50, 50].filter((v) => v > lo && v < hi);
  const peak = points.reduce((a, b) => (b.value > a.value ? b : a));
  const trough = points.reduce((a, b) => (b.value < a.value ? b : a));
  const last = points.at(-1);
  const first = points[0];
  const net = Math.round(last.value - first.value);

  return `<div class="card" style="margin-top:14px">
    <div class="card__head">
      <span class="eyebrow">📉 Approval over the term</span>
      <span class="hint">Moved <b style="color:${net >= 0 ? "var(--green)" : "var(--red)"}">${net >= 0 ? "+" : ""}${net}</b>
        since month ${first.month} · peak ${peak.value > 0 ? "+" : ""}${Math.round(peak.value)} ·
        low ${trough.value > 0 ? "+" : ""}${Math.round(trough.value)}</span>
    </div>
    <div class="chart">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
        aria-label="Approval from ${Math.round(first.value)} percent to ${Math.round(last.value)} percent">
        ${marks.map((v) => `
          <line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"
            class="chart__grid${v === 0 ? " chart__grid--major" : ""}" />
          <text x="2" y="${(y(v) + 4).toFixed(1)}" class="chart__label">${v > 0 ? "+" : ""}${v}</text>`).join("")}
        <path d="${area}" class="chart__area" />
        <path d="${line}" class="chart__line" />
        <circle cx="${x(points.length - 1).toFixed(1)}" cy="${y(last.value).toFixed(1)}" r="4" class="chart__dot" />
        <text x="${PAD.left}" y="${H - 6}" class="chart__label">${escapeHtml(shortMonthLabel(first.month, startYear))}</text>
        <text x="${W - PAD.right}" y="${H - 6}" class="chart__label" text-anchor="end">${escapeHtml(shortMonthLabel(last.month, startYear))}</text>
      </svg>
    </div>
  </div>`;
}
