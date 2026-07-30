"use strict";

import { $, show, escapeHtml, loader } from "../util.js";
import { G } from "../store.js";
import { chamberCountry } from "../api.js";

/**
 * The country you found, and the country you leave.
 *
 * The screen this whole sub-system exists to make possible. A congressional
 * career is thirty years of one vote in four hundred and thirty-five, and until
 * now it left no trace anybody could look at: the statistics were the same on
 * the day you retired as the day you were sworn in, because nothing a chamber
 * did was ever applied to them.
 *
 * So this is deliberately a *record* rather than a dashboard. Every indicator
 * shows where it started, where it is, and the whole path between — and under
 * that, the four or five bills and disasters that actually bent the lines, with
 * whether this member voted for them. That last column is the point of the
 * screen. A chart of a country is interesting; a chart of a country with your
 * own name against the turns is a career.
 */

let handlers = {};
let record = null;

export async function renderCountry(hooks) {
  handlers = hooks;
  loader(true, "Reading the record…");
  try {
    record = await chamberCountry(G.state);
  } catch (err) {
    alert("The record could not be read: " + err.message);
    return handlers.onFloor();
  } finally {
    loader(false);
  }
  paint();
}

function paint() {
  const state = G.state;
  const c = record.compare;

  if (!c || record.months < 2) {
    $("countryBody").innerHTML = `
      ${head(state)}
      <div class="card">
        <span class="eyebrow">📜 Nothing to read yet</span>
        <p style="margin:10px 0 0">The record starts the month you were sworn in and one month is
          not a trend. Come back when you have a term behind you.</p>
      </div>
      ${backButton()}`;
    wire();
    return show("country");
  }

  const social = c.rows.filter((r) => !ECONOMIC.has(r.id));
  const economic = c.rows.filter((r) => ECONOMIC.has(r.id));

  $("countryBody").innerHTML = `
    ${head(state)}

    <div class="card">
      <div class="card__head">
        <span class="eyebrow">🇺🇸 The country you found · the country you have now</span>
        <span class="hint">${c.months} months on the record</span>
      </div>
      <p class="hint" style="margin:6px 0 16px">
        Sworn in term ${c.from.term}, month ${c.from.month}. Every line is the whole career.
      </p>
      ${indicatorTable(social)}
    </div>

    <div class="card">
      <span class="eyebrow">📈 The economy, across the same years</span>
      <div style="margin-top:14px">${indicatorTable(economic)}</div>
    </div>

    ${turningPointsCard()}
    ${yourselfCard()}
    ${standingCard()}
    ${backButton()}`;

  wire();
  show("country");
  window.scrollTo(0, 0);
}

const ECONOMIC = new Set(["gdpGrowth", "unemployment", "inflation", "debt"]);

const head = (state) => `
  <div class="dash-head">
    <div>
      <h1 class="display display--lg">The Record</h1>
      <div class="dash-head__sub">${escapeHtml(state.scenario.presidentName)} ·
        ${escapeHtml(record.seatWord || "")} · term ${state.term}, month ${state.month}</div>
    </div>
  </div>`;

/** Every indicator: where it started, the path, where it is, and which way that is. */
function indicatorTable(rows) {
  if (!rows.length) return `<p class="hint">Nothing recorded yet.</p>`;
  return `<div class="record">
    ${rows.map((r) => {
      const tone = r.direction === "better" ? "up" : r.direction === "worse" ? "down" : "";
      const arrow = r.direction === "better" ? "▲" : r.direction === "worse" ? "▼" : "–";
      return `<div class="record__row">
        <span class="record__name">${escapeHtml(r.name)}</span>
        <span class="record__from">${fmt(r.from, r.unit)}</span>
        ${sparkline(r.series, r.direction)}
        <span class="record__to">${fmt(r.to, r.unit)}</span>
        <span class="record__change ${tone}">${arrow} ${Math.abs(r.change)}</span>
      </div>`;
    }).join("")}
  </div>`;
}

const fmt = (v, unit) => `${v}${unit === "T" ? "T" : unit === "%" ? "%" : unit ? ` ${unit}` : ""}`;

/**
 * A sparkline in SVG, scaled to its own series.
 *
 * Its own range rather than a shared one, because these are eight quantities in
 * eight different units and the question a player is asking is "which way did
 * this go", not "is crime bigger than literacy".
 */
function sparkline(series, direction) {
  if (!series || series.length < 2) return `<span class="record__spark"></span>`;
  const lo = Math.min(...series);
  const hi = Math.max(...series);
  const span = hi - lo || 1;
  const w = 150, h = 30;
  const points = series.map((v, i) => {
    const x = (i / (series.length - 1)) * w;
    const y = h - ((v - lo) / span) * (h - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const stroke = direction === "better" ? "var(--green)"
    : direction === "worse" ? "var(--red)" : "var(--faint)";

  return `<svg class="record__spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="${points}" fill="none" stroke="${stroke}" stroke-width="1.75"
      stroke-linejoin="round" stroke-linecap="round" />
  </svg>`;
}

/**
 * What moved them.
 *
 * The heart of the screen. Ranked by how far each event pushed a statistic
 * relative to how far that statistic travelled all career, so half a year of
 * life expectancy is weighed honestly against ninety points of crime.
 */
function turningPointsCard() {
  const points = record.turningPoints || [];
  if (!points.length) return "";

  return `<div class="card">
    <span class="eyebrow">🔀 What moved them</span>
    <p class="hint" style="margin:6px 0 14px">
      The moments that actually bent the lines above — and which way you went on each.
    </p>
    <div class="turns">
      ${points.map((t) => {
        const blew = t.kind === "detonated";
        return `<div class="turn ${blew ? "turn--bad" : ""}">
          <span class="turn__when">t${t.term} · m${t.month}</span>
          <span class="turn__mark">${blew ? "✷" : t.vote === "sponsor" ? "✍" : "▲"}</span>
          <span class="turn__what">
            <b>${escapeHtml(t.title)}</b>
            ${blew ? `<i class="turn__note">Left alone until it broke open.</i>`
              : t.vote === "sponsor" ? `<i class="turn__note">Your own bill.</i>`
              : t.vote ? `<i class="turn__note">You voted ${escapeHtml(t.vote.toUpperCase())}${
                  t.tally ? ` · carried ${escapeHtml(t.tally)}` : ""}.</i>` : ""}
          </span>
          <span class="turn__moved">${movedList(t.moved)}</span>
        </div>`;
      }).join("")}
    </div>
  </div>`;
}

const LABEL = {
  poverty: "poverty", crime: "crime", lifeExpectancy: "life exp.", literacy: "literacy",
  homeownership: "home own.", uninsured: "uninsured", unrest: "unrest", population: "population",
  gdpGrowth: "GDP", unemployment: "unemp.", inflation: "inflation", debt: "debt",
};

function movedList(moved) {
  const entries = Object.entries(moved || {});
  if (!entries.length) return `<i class="hint">—</i>`;
  return entries.slice(0, 3).map(([k, v]) =>
    `<span class="flip">${escapeHtml(LABEL[k] || k)}<i>${v > 0 ? "+" : ""}${v}</i></span>`).join("");
}

/** What is still outstanding, and what was left until it broke. */
function yourselfCard() {
  const live = record.problems || [];
  const scars = record.scars || [];
  const settled = record.resolved || [];
  if (!live.length && !scars.length && !settled.length) return "";

  return `<div class="card">
    <span class="eyebrow">🧾 The ledger</span>
    <div class="ledger">
      <div>
        <span class="hint">Settled by this Congress</span>
        ${settled.length
          ? `<div class="flips">${settled.slice(-6).map((r) =>
              `<span class="flip">${escapeHtml(r.title)}</span>`).join("")}</div>`
          : `<p class="hint" style="margin:6px 0 0"><i>Nothing yet.</i></p>`}
      </div>
      <div>
        <span class="hint">Left until it broke open</span>
        ${scars.length
          ? `<div class="flips">${scars.slice(-6).map((s) =>
              `<span class="flip flip--loss">${escapeHtml(s.title)}<i>${s.monthsActive}mo</i></span>`).join("")}</div>`
          : `<p class="hint" style="margin:6px 0 0"><i>Nothing, so far.</i></p>`}
      </div>
      <div>
        <span class="hint">Still on the table</span>
        ${live.length
          ? `<div class="flips">${live.map((p) =>
              `<span class="flip">${escapeHtml(p.title)}<i>${p.severity}/5</i></span>`).join("")}</div>`
          : `<p class="hint" style="margin:6px 0 0"><i>Nothing outstanding.</i></p>`}
      </div>
    </div>
  </div>`;
}

/** Your own two numbers, on the same timeline as the country's. */
function standingCard() {
  const you = record.you || {};
  if (!you.seat || you.seat.length < 2) return "";
  const line = (label, data, note) => `<div class="record__row">
    <span class="record__name">${escapeHtml(label)}</span>
    <span class="record__from">${data[0]}</span>
    ${sparkline(data, "")}
    <span class="record__to">${data[data.length - 1]}</span>
    <span class="record__change hint">${escapeHtml(note)}</span>
  </div>`;

  return `<div class="card">
    <span class="eyebrow">🪞 And what it cost you</span>
    <p class="hint" style="margin:6px 0 14px">
      The country above was moved by a chamber. These are the two numbers that decide
      whether you are still in it.
    </p>
    <div class="record">
      ${line(record.seatWord || "Your seat", you.seat, "your standing at home")}
      ${line("Your caucus", you.caucus, "what leadership makes of you")}
      ${line("The President", you.president, "the wave you run in")}
    </div>
  </div>`;
}

const backButton = () => `
  <div class="next-step">
    <button class="btn btn--primary btn--block" id="countryBack" style="max-width:340px">
      Back to the Floor →
    </button>
  </div>`;

function wire() {
  const back = $("countryBack");
  if (back) back.onclick = () => handlers.onFloor();
}
