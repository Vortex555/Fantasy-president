"use strict";

import { $, show, escapeHtml, shortMonthLabel, ordinalTerm } from "./util.js";
import { G, saveCareer } from "./store.js";
import { liveArcs, scarArcs, favorableEV } from "./dashboard.js";

const DOMAIN_LABEL = {
  economy: "Economy", security: "National Security", justice: "Law & Justice",
  social: "Society", foreign: "Foreign Affairs", health: "Health & Environment",
};

const ENDINGS = {
  reelected: { seal: "🏆", title: "Re-elected", cls: "win" },
  narrow: { seal: "⚖️", title: "Too Close to Call", cls: "" },
  defeated: { seal: "🗳️", title: "Voted Out", cls: "lose" },
  removed: { seal: "⛓️", title: "Removed from Office", cls: "lose" },
  collapse: { seal: "💥", title: "The Government Falls", cls: "lose" },
  resigned: { seal: "📜", title: "Resigned", cls: "lose" },
  // Two full terms, and the Constitution rather than the voters ended it.
  term_limited: { seal: "🎖️", title: "Term-Limited", cls: "win" },
  // No election was held, because there was nobody left to call one.
  autocrat: { seal: "🗝️", title: "Still in Office", cls: "lose" },
};

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

      <button class="btn btn--primary btn--block" id="backToCareers" style="margin-top:22px">
        ← Back to Your Careers
      </button>
    </div>`;

  saveCareer();
  $("backToCareers").onclick = onCareers;
  show("legacy");
}
