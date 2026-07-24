"use strict";

import { escapeHtml, optionsHtml } from "./util.js";
import { PROFILE_FIELDS, AGES, REGIONS } from "./data/profile.js";
import { G } from "./store.js";

/** State code → name, straight from the server's reference data. */
const stateName = (code) => G.meta?.states?.[code]?.name || code;
const stateCodes = () => Object.keys(G.meta?.states || {}).sort();

/**
 * The CHARACTER PROFILE block of the setup screen. Two fields per row, in the
 * order a biographer would ask them: who you are, then where you came from,
 * then what you did before this.
 */

const PAIRS = [
  ["age", "race"],
  ["religion", "marital"],
  ["education", "wealth"],
];

const FULL_WIDTH = ["background"];
const LAST_PAIRS = [["military", "scandal"]];

const fieldById = (key) => PROFILE_FIELDS.find((f) => f.key === key);

function fieldHtml(key, draft) {
  const field = fieldById(key);
  const cls = field.layout === "wrap" ? "opts" : "opts opts--grid";
  return `<div class="field">
    <span class="field__label">${escapeHtml(field.label)}</span>
    <div class="${cls}" data-profile="${key}">${optionsHtml(field.options, draft[key])}</div>
    ${extraHtml(key, draft)}
  </div>`;
}

/** The two options that open a free-text follow-up. */
function extraHtml(key, draft) {
  if (key === "age" && draft.age === "custom") {
    return `<input id="customAge" class="profile__extra" type="text" maxlength="3" inputmode="numeric"
      placeholder="Age in years" value="${escapeHtml(draft.customAge)}" />`;
  }
  if (key === "region" && draft.region === "custom") {
    return `<select id="customState" class="profile__extra">
      <option value="">— Pick your home state —</option>
      ${stateCodes().map((code) =>
        `<option value="${code}"${draft.customState === code ? " selected" : ""}>${escapeHtml(stateName(code))}</option>`).join("")}
    </select>`;
  }
  return "";
}

export function profileHtml(draft) {
  const pair = ([a, b]) => `<div class="field-pair">${fieldHtml(a, draft)}${fieldHtml(b, draft)}</div>`;
  return [
    ...PAIRS.map(pair),
    ...FULL_WIDTH.map((k) => fieldHtml(k, draft)),
    ...LAST_PAIRS.map(pair),
    fieldHtml("region", draft),
  ].join("");
}

/**
 * Apply a click on a profile option. Returns the key that changed so the
 * caller knows whether a follow-up input needs re-rendering.
 */
export function applyProfileClick(group, value, draft) {
  const key = group.dataset.profile;
  if (!key) return null;
  draft[key] = value;
  if (key === "age" && value !== "custom") draft.customAge = "";
  if (key === "region" && value !== "custom") draft.customState = "";
  return key;
}

/** Whether picking this option reveals a follow-up field. */
export const opensExtra = (key, draft) =>
  (key === "age" && draft.age === "custom") || (key === "region" && draft.region === "custom");

/** A one-line summary for the saved-president list and the AI prompt. */
export function profileSummary(draft) {
  const age = draft.age === "custom" && draft.customAge ? `${draft.customAge} years old` : draft.age;
  const home = draft.region === "custom" && draft.customState
    ? stateName(draft.customState)
    : draft.region;
  return [
    age, draft.race, draft.religion, draft.marital,
    draft.education, draft.wealth, draft.background,
    draft.military !== "No Service" ? draft.military : null,
    draft.scandal !== "Clean Record" ? `scandal history: ${draft.scandal}` : "no scandal history",
    `from the ${home}`,
  ].filter(Boolean).join(", ");
}

export { AGES, REGIONS };
