"use strict";

import { escapeHtml, toggleHtml, segmentHtml } from "./util.js";
import { SETTINGS, DIFFICULTIES, NO_HINTS } from "./data/settings.js";

/**
 * The RULES OF PLAY rack. Each card is one rule; segmented controls show the
 * note for whichever mode is currently selected, so the card always explains
 * the state you are actually in.
 */

function settingCard(s, draft) {
  const tint = s.tone ? ` card--${s.tone}` : "";
  const body = s.kind === "toggle"
    ? toggleHtml(s.key, s.title, s.desc, Boolean(draft[s.key]))
    : segmentedCard(s, draft);

  return `<div class="card setting${tint}">
    ${body}
    ${s.warn ? `<p class="hint setting__foot"><b>⚠️ ${escapeHtml(s.warn)}</b></p>` : ""}
    ${s.sub ? `<div class="setting__sub">${
      toggleHtml(s.sub.key, s.sub.title, s.sub.desc, Boolean(draft[s.sub.key]))}</div>` : ""}
  </div>`;
}

function segmentedCard(s, draft) {
  const current = s.options.find((o) => o.value === draft[s.key]) || s.options[0];
  return `<span class="toggle__title">${s.title}${
    s.tag ? ` <span class="setting__tag">${escapeHtml(s.tag)}</span>` : ""}</span>
    <p class="toggle__desc">${escapeHtml(s.desc)}</p>
    <div class="setting__body">${segmentHtml(s.key, s.options, draft[s.key])}</div>
    <p class="hint setting__foot" data-note="${s.key}">${escapeHtml(current.note)}</p>`;
}

export function settingsHtml(draft) {
  return `
    ${SETTINGS.map((s) => settingCard(s, draft)).join("")}

    <div class="card setting">
      <span class="toggle__title">⚔️ Difficulty</span>
      <p class="toggle__desc">How far approval swings each month, and how much the country forgives at the ballot box.</p>
      <div class="setting__body">${segmentHtml("difficulty", DIFFICULTIES, draft.difficulty)}</div>
      <p class="hint setting__foot"><em>The game is built for Hard. Easy and Medium soften the consequences.</em></p>
    </div>

    <div class="card setting setting--stark">
      ${toggleHtml(NO_HINTS.key, NO_HINTS.title, NO_HINTS.desc, Boolean(draft[NO_HINTS.key]))}
    </div>`;
}

/** Update the note under a segmented control after the mode changes. */
export function refreshNote(key, value, root) {
  const setting = SETTINGS.find((s) => s.key === key);
  const note = root.querySelector(`[data-note="${key}"]`);
  if (!setting || !note) return;
  note.textContent = setting.options.find((o) => o.value === value)?.note || "";
}

/** Settings that only make sense in some eras, with the reason why. */
export function unavailable(settingKey, startYear) {
  if (settingKey === "covert" && startYear < 1990) {
    return "Covert operations cover the post-Cold-War intelligence war; this era starts too early.";
  }
  return null;
}
