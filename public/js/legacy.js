"use strict";

import { $, show, escapeHtml, shortMonthLabel, ordinalTerm } from "./util.js";
import { G, saveCareer } from "./store.js";
import { liveArcs, scarArcs, favorableEV } from "./dashboard.js";
import { getVerdict } from "./api.js";

const DOMAIN_LABEL = {
  economy: "Economy", security: "National Security", justice: "Law & Justice",
  social: "Society", foreign: "Foreign Affairs", health: "Health & Environment",
};

const BILL_OUTCOME = {
  signed: "Signed", vetoed: "Vetoed", overridden: "Overridden",
};

const ENDINGS = {
  reelected: { seal: "🏆", title: "Re-elected", cls: "win" },
  narrow: { seal: "⚖️", title: "Too Close to Call", cls: "" },
  defeated: { seal: "🗳️", title: "Voted Out", cls: "lose" },
  removed: { seal: "⛓️", title: "Removed from Office", cls: "lose" },
  collapse: { seal: "💥", title: "The Government Falls", cls: "lose" },
  resigned: { seal: "📜", title: "Resigned", cls: "lose" },
  // Removed by the cabinet under the Twenty-Fifth rather than by the voters.
  incapacitated: { seal: "🩺", title: "Declared Unfit", cls: "lose" },
  // Your own party chose somebody else before the country ever voted.
  primaried: { seal: "🥊", title: "Denied the Nomination", cls: "lose" },
  // Two full terms, and the Constitution rather than the voters ended it.
  term_limited: { seal: "🎖️", title: "Term-Limited", cls: "win" },
  // No election was held, because there was nobody left to call one.
  autocrat: { seal: "🗝️", title: "Still in Office", cls: "lose" },
};

/**
 * Every election this career actually fought.
 *
 * Three systems produce this — the midterms, the primary and the general — and
 * until now the closing screen mentioned none of them.
 */
function electionsSection(state, startYear) {
  const rows = [];

  for (const m of state.midterms || []) {
    const net = (m.houseSwing || 0) + (m.senateSwing || 0);
    rows.push({
      when: shortMonthLabel(m.month || 24, startYear),
      what: `Midterms — ${m.houseSwing > 0 ? "+" : ""}${m.houseSwing} House, ` +
        `${m.senateSwing > 0 ? "+" : ""}${m.senateSwing} Senate`,
      good: net >= 0,
    });
  }
  if (state.primaryResult) {
    const p = state.primaryResult;
    rows.push({
      when: "Primary",
      what: p.won
        ? `Renominated over ${p.challenger} — ${p.delegates.you} delegates to ${p.delegates.them}`
        : `Denied the nomination by ${p.challenger} — ${p.delegates.you} to ${p.delegates.them}`,
      good: p.won,
    });
  }
  for (const e of state.elections || []) {
    rows.push({
      when: `Term ${e.term}`,
      what: `Re-elected with ${e.electoral} electoral votes`,
      good: true,
    });
  }
  if (state.election) {
    const r = state.election;
    rows.push({
      when: "Election night",
      what: `${r.ev.you}–${r.ev.them} in the college, ${r.popular.you.toFixed(1)}% of the vote` +
        (r.split ? " — a split decision" : ""),
      good: r.won,
    });
  }
  if (state.twentyFifthSurvived) {
    rows.push({
      when: "The 25th",
      what: `Survived ${state.twentyFifthSurvived} cabinet attempt${state.twentyFifthSurvived === 1 ? "" : "s"} to declare you unfit`,
      good: true,
    });
  }
  if (!rows.length) return "";

  return `<div class="card">
    <span class="eyebrow">🗳️ Every election you fought</span>
    <div style="margin-top:12px">
      ${rows.map((r) => `
        <div class="timeline__item">
          <span class="timeline__when">${escapeHtml(r.when)}</span>
          <span class="timeline__what">${escapeHtml(r.what)}
            <b style="color:${r.good ? "var(--green)" : "var(--red)"}">${r.good ? "✓" : "✕"}</b></span>
        </div>`).join("")}
    </div>
  </div>`;
}

/** What the histories say. Scored by the engine so it cannot drift from it. */
async function paintVerdict(state) {
  const box = $("verdictCard");
  if (!box) return;
  let v;
  try {
    v = await getVerdict(state);
  } catch {
    return;
  }
  box.innerHTML = `
    <div class="card verdict">
      <span class="eyebrow">⚖️ The verdict of history</span>
      <div class="verdict__head">
        <div>
          <div class="verdict__rank">${escapeHtml(v.title)}</div>
          <p class="verdict__summary">${escapeHtml(v.summary)}</p>
        </div>
        <div class="verdict__score">
          <b>${v.score}</b><span>/100</span>
        </div>
      </div>
      ${v.findings.length ? `<div class="verdict__findings">
        ${v.findings.map((f) => `<div class="finding finding--${f.good ? "good" : "bad"}">
          ${escapeHtml(f.text)}</div>`).join("")}
      </div>` : ""}
    </div>`;
}

/** The historical record — what the country was handed back. */
export function renderLegacy(onCareers) {
  const state = G.state;
  const startYear = state.scenario.startYear || 2025;
  const end = state.ending || { type: "narrow", reason: "Your term has ended." };
  const look = ENDINGS[end.type] || { seal: "🏛️", title: "Your Presidency Ends", cls: "" };

  const peak = Math.max(state.approval, ...(state.history || []).map((h) => h.approval ?? 0));
  const open = liveArcs(state);
  const scars = scarArcs(state);
  const resolved = (state.arcs || []).filter((a) => a.status === "resolved").length;

  const rows = [
    ["President", escapeHtml(state.scenario.presidentName)],
    ["Party & ideology", escapeHtml([state.scenario.party, state.scenario.ideology].filter(Boolean).join(" · "))],
    ["Terms served", `${state.term || 1}${state.elections?.length ? ` · ${state.elections.length} election${state.elections.length > 1 ? "s" : ""} won` : ""}`],
    ["Months served", `${((state.term || 1) - 1) * 48 + Math.max(0, state.month - 1)} of ${(state.term || 1) * 48}`],
    ["Final approval", `${Math.round(state.approval)}%`],
    ["Peak approval", `${Math.round(peak)}%`],
    ["Final economy", `${state.economy.gdpGrowth.toFixed(1)}% GDP · ${state.economy.unemployment.toFixed(1)}% unemployment`],
    ["Favourable electoral votes", favorableEV(state)],
    ["Situations resolved", resolved],
    ["Left unresolved", open.length + scars.length],
  ];

  const unfinished = [
    ...scars.map((a) => ({ a, tag: "permanent scar" })),
    ...open.map((a) => ({ a, tag: `still open · severity ${a.severity}/5` })),
  ];

  $("legacyBody").innerHTML = `
    <div class="panel">
      <div class="legacy__seal">${look.seal}</div>
      <h1 class="display display--xl legacy__title ${look.cls}">${look.title}</h1>
      <p class="legacy__reason">${escapeHtml(end.reason)}</p>

      <div class="card" style="margin-top:26px">
        <span class="eyebrow">📜 The historical record</span>
        <div style="margin-top:12px">
          ${rows.map(([k, v]) => `<div class="record__row"><span>${k}</span><b>${v}</b></div>`).join("")}
        </div>
      </div>

      <div class="card">
        <span class="eyebrow">🗓️ Final chapters</span>
        <div style="margin-top:12px">
          ${(state.history || []).slice(-8).reverse().map((h) => `
            <div class="timeline__item">
              <span class="timeline__when">${escapeHtml(shortMonthLabel(((h.term || 1) - 1) * 48 + h.month, startYear))}</span>
              <span class="timeline__what">${escapeHtml(h.headline || "—")}
                <b style="color:${h.approvalChange >= 0 ? "var(--green)" : "var(--red)"}">
                  ${h.approvalChange >= 0 ? "+" : ""}${h.approvalChange}</b></span>
            </div>`).join("") || `<p class="hint" style="margin:0">No months were played.</p>`}
        </div>
      </div>

      ${(state.formerPresidents || []).length ? `
      <div class="card">
        <span class="eyebrow">🏛️ Everyone who held the office</span>
        <p class="hint" style="margin:6px 0 12px">
          This career outlived more than one presidency. The country carried on; the numbers below
          are what each of them left behind.
        </p>
        <div style="margin-top:12px">
          ${state.formerPresidents.map((p) => `
            <div class="timeline__item">
              <span class="timeline__when">${escapeHtml(shortMonthLabel(((p.term || 1) - 1) * 48 + p.leftMonth, startYear))}</span>
              <span class="timeline__what">${escapeHtml(p.name)} — ${escapeHtml(
                (ENDINGS[p.ending?.type] || {}).title || "left office")}
                <b>${Math.round(p.finalApproval)}%</b></span>
            </div>`).join("")}
          <div class="timeline__item">
            <span class="timeline__when">now</span>
            <span class="timeline__what">${escapeHtml(state.scenario.presidentName)} — ${escapeHtml(look.title)}
              <b>${Math.round(state.approval)}%</b></span>
          </div>
        </div>
      </div>` : ""}

      ${electionsSection(state, startYear)}

            ${(state.billLog || []).length ? `
      <div class="card">
        <span class="eyebrow">✒️ What you signed</span>
        <p class="hint" style="margin:6px 0 12px">
          The legislative record — every bill Congress put on the desk and what you did with it.
          This is the list your own party reads back to you at a primary.
        </p>
        <div style="margin-top:12px">
          ${state.billLog.slice(0, 14).map((b) => `
            <div class="timeline__item">
              <span class="timeline__when">${escapeHtml(BILL_OUTCOME[b.outcome] || b.outcome)}</span>
              <span class="timeline__what">${escapeHtml(b.title)}</span>
            </div>`).join("")}
        </div>
      </div>` : ""}

      ${unfinished.length ? `
      <div class="card">
        <span class="eyebrow">🗂️ Unfinished business</span>
        <div style="margin-top:12px">
          ${unfinished.map(({ a, tag }) => `
            <div class="timeline__item">
              <span class="timeline__when">${escapeHtml(DOMAIN_LABEL[a.domain] || "—")}</span>
              <span class="timeline__what">${escapeHtml(a.title)} <b>(${tag})</b></span>
            </div>`).join("")}
        </div>
      </div>` : ""}

      <div id="verdictCard"></div>

            <button class="btn btn--primary btn--block" id="backToCareers" style="margin-top:22px">
        ← Back to Your Careers
      </button>
    </div>`;

  saveCareer();
  $("backToCareers").onclick = onCareers;
  show("legacy");
  // The verdict is scored server-side; it arrives a beat after the record.
  paintVerdict(state);
}
