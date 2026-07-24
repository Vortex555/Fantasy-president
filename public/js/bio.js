"use strict";

import { $, show, escapeHtml } from "./util.js";
import { BIO_FIELDS } from "./data/settings.js";

/**
 * The guided bio, shown between character setup and the running mate when the
 * Custom Bio rule is on. Everything written here is handed to the simulation,
 * so the answers come back as events about this president specifically.
 */

let answers = {};
// #bioBody persists across visits, so its input listener binds only once.
let wired = false;

export function renderBio(draft, onDone, onBack) {
  answers = { ...(draft.bioAnswers || {}) };

  $("bioBody").innerHTML = `
    <p class="lede" style="margin-bottom:26px">Every answer becomes material. Promises get called in,
      rivals resurface, and the thing you would rather not discuss has a way of coming out in month
      thirty. Leave anything blank and the simulation simply won't use it.</p>

    ${BIO_FIELDS.map((f) => `
      <div class="field">
        <label class="field__label" for="bio-${f.key}">${escapeHtml(f.label)}</label>
        <textarea id="bio-${f.key}" data-bio="${f.key}" rows="2" maxlength="${f.max}"
          placeholder="${escapeHtml(f.placeholder)}">${escapeHtml(answers[f.key] || "")}</textarea>
      </div>`).join("")}

    <div class="btn-row" style="margin-top:8px">
      <button type="button" class="btn" id="bioBack">← Back</button>
      <button type="button" class="btn" id="bioSkip">Skip this</button>
      <button type="button" class="btn btn--primary" id="bioDone" style="flex:1">Continue →</button>
    </div>`;

  const body = $("bioBody");
  if (!wired) {
    wired = true;
    body.addEventListener("input", (e) => {
      const key = e.target.dataset.bio;
      if (key) answers[key] = e.target.value;
    });
  }

  $("bioBack").onclick = onBack;
  $("bioSkip").onclick = () => onDone({});
  $("bioDone").onclick = () => {
    // Drop blanks so the prompt never carries empty headings.
    const filled = Object.fromEntries(
      Object.entries(answers).map(([k, v]) => [k, String(v).trim()]).filter(([, v]) => v));
    onDone(filled);
  };

  show("bio");
}

/** Fold the answers into the prose the simulation reads. */
export function bioSummary(bioAnswers) {
  if (!bioAnswers || !Object.keys(bioAnswers).length) return "";
  const labels = Object.fromEntries(BIO_FIELDS.map((f) => [f.key, f.label]));
  return Object.entries(bioAnswers)
    .map(([k, v]) => `${labels[k] || k}: ${v}`)
    .join("\n");
}
