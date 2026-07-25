"use strict";

import { $, show, escapeHtml, optionsHtml } from "./util.js";
import { listPresidents, savePresident, deletePresident } from "./store.js";
import { GENDERS, PARTIES, STYLES, MANDATES, COMPOSITIONS, VP_POOL } from "./data/catalog.js";
import {
  ideologiesFor, mainstreamIdeologies, fringeIdeologies, ideologyEffects, ideologyPosition,
} from "./data/ideologies.js";
import { PROFILE_DEFAULTS, PROFILE_FIELDS, profileEffects, homeStates } from "./data/profile.js";
import { settingDefaults, SETTINGS, NO_HINTS } from "./data/settings.js";
import { profileHtml, applyProfileClick, opensExtra, profileSummary } from "./profile.js";
import { settingsHtml, refreshNote, unavailable } from "./settings.js";

const DEFAULT_DRAFT = {
  presidentName: "",
  gender: "male",
  party: "Independent",
  ideology: "",
  style: "Polished / Presidential",
  mandate: "comfortable",
  composition: "balanced",
  ...PROFILE_DEFAULTS,
  ...settingDefaults(),
};

let draft = { ...DEFAULT_DRAFT };
let handlers = {};
let context = { scenario: null, era: null };

export const currentDraft = () => ({ ...draft });

/**
 * The ideology picker, split so the fringe is clearly the fringe. With fifty
 * positions on the bench a flat grid is unreadable, and the divider is honest
 * about which half of it will cost you the room.
 */
function ideologySection(party, selected) {
  const fringe = fringeIdeologies(party);
  return `<div class="opts opts--grid" data-pick="ideology">
      ${optionsHtml(mainstreamIdeologies(party), selected)}
    </div>
    ${fringe.length ? `
      <div class="opts-divider"><span>Fringe &amp; radical</span></div>
      <div class="opts opts--grid" data-pick="ideology">${optionsHtml(fringe, selected)}</div>` : ""}`;
}

function partyHtml(selected) {
  return PARTIES.map((p) => `
    <button type="button" class="opt opt--party ${p.cls}${p.value === selected ? " is-selected" : ""}"
      data-value="${p.value}">
      <span class="orb"></span>
      <span class="opt__label">${p.label}</span>
    </button>`).join("");
}

/** Congress composition is a party-strength control, so it needs a party. */
function compositionSection() {
  if (draft.party === "Independent") {
    return `<p class="hint">You have no bloc in Congress as an independent — both chambers start
      evenly divided and every vote has to be won on its own terms.</p>`;
  }
  return `<div class="opts opts--wide" data-pick="composition">${optionsHtml(COMPOSITIONS, draft.composition)}</div>`;
}

export function renderCharacter(scenario, era, onConfirm, onBack) {
  handlers = { onConfirm, onBack };
  context = { scenario, era };
  if (!draft.ideology) draft.ideology = ideologiesFor(draft.party)[0].value;

  const savedOptions = ['<option value="">— Saved presidents —</option>']
    .concat(listPresidents().map((p) =>
      `<option value="${escapeHtml(p.presidentName)}">${escapeHtml(p.presidentName)} · ${escapeHtml(p.party)}</option>`))
    .join("");

  $("characterForm").innerHTML = `
    <div class="load-saved">
      <span class="load-saved__label">📋 Load a saved president</span>
      <select id="savedSelect">${savedOptions}</select>
      <button type="button" class="btn btn--danger" id="deletePresident">Delete</button>
    </div>

    <div class="field-pair">
      <div class="field">
        <label class="field__label" for="nameInput">Your Name</label>
        <input id="nameInput" type="text" maxlength="60" placeholder="Enter your name"
          value="${escapeHtml(draft.presidentName)}" autocomplete="off" />
      </div>
      <div class="field">
        <span class="field__label">Gender</span>
        <div class="opts" data-pick="gender">${optionsHtml(GENDERS, draft.gender)}</div>
      </div>
    </div>

    <div class="field">
      <span class="field__label">Your Party</span>
      <div class="opts--party" data-pick="party">${partyHtml(draft.party)}</div>
    </div>

    <div class="divider"><span class="eyebrow">Character profile</span></div>
    ${profileHtml(draft)}

    <div class="divider"><span class="eyebrow">Political position</span></div>

    <div class="field">
      <span class="field__label">Communication Style</span>
      <div class="opts opts--grid" data-pick="style">${optionsHtml(STYLES, draft.style)}</div>
    </div>

    <div class="field">
      <span class="field__label">Ideology <span class="field__note">(updates when you pick a party)</span></span>
      <div id="ideologyWrap">${ideologySection(draft.party, draft.ideology)}</div>
    </div>

    <div class="field">
      <span class="field__label">Mandate Strength</span>
      <div class="opts opts--grid" data-pick="mandate">${optionsHtml(MANDATES, draft.mandate)}</div>
    </div>

    <div class="field">
      <span class="field__label">Congressional Composition
        <span class="field__note">(your party's strength in Congress at start)</span></span>
      <div id="compositionWrap">${compositionSection()}</div>
    </div>

    <div class="divider"><span class="eyebrow">Rules of play</span></div>
    ${settingsHtml(draft)}

    <button type="button" class="btn btn--primary btn--block" id="beginBtn" style="margin-top:26px">
      ${draft.bio ? "Next: Your Bio →" : "Begin Your Presidency →"}
    </button>`;

  flagUnavailableSettings();
  wire();
  show("character");
}

/** Grey out rules that this era cannot support, and say why. */
function flagUnavailableSettings() {
  const year = context.era?.startYear || 2025;
  for (const s of SETTINGS) {
    const reason = unavailable(s.key, year);
    if (!reason) continue;
    draft[s.key] = s.kind === "toggle" ? false : s.options[0].value;
    const control = $("characterForm").querySelector(`[data-toggle="${s.key}"], [data-seg="${s.key}"]`);
    const card = control?.closest(".setting");
    if (!card) continue;
    card.classList.add("is-disabled");
    card.insertAdjacentHTML("beforeend", `<p class="hint setting__foot">${escapeHtml(reason)}</p>`);
  }
}

const repaint = () => renderCharacter(context.scenario, context.era, handlers.onConfirm, handlers.onBack);

// #characterForm outlives every repaint, so its delegated listeners are bound
// exactly once. Binding per render stacks duplicates, and a toggle handled an
// even number of times flips back to where it started.
let wired = false;

function wire() {
  const form = $("characterForm");

  // Header buttons are plain assignments, so they are safe to rebind.
  $("charBack").onclick = handlers.onBack;
  $("charRandom").onclick = () => { draft = { ...draft, ...randomDraft() }; repaint(); };
  $("charSave").onclick = () => {
    if (!draft.presidentName.trim()) return $("nameInput").focus();
    if (savePresident(draft)) repaint();
  };

  if (wired) return;
  wired = true;

  form.addEventListener("input", (e) => {
    if (e.target.id === "nameInput") draft.presidentName = e.target.value;
    if (e.target.id === "customAge") draft.customAge = e.target.value.replace(/\D/g, "");
  });

  form.addEventListener("change", (e) => {
    if (e.target.id === "customState") draft.customState = e.target.value;
    if (e.target.id === "savedSelect" && e.target.value) {
      const found = listPresidents().find((p) => p.presidentName === e.target.value);
      if (found) {
        draft = { ...DEFAULT_DRAFT, ...found };
        repaint();
      }
    }
  });

  form.addEventListener("click", (e) => {
    if (e.target.closest(".is-disabled")) return;

    const opt = e.target.closest(".opt");
    if (opt) return handleOption(opt);

    const seg = e.target.closest(".seg__btn");
    if (seg) return handleSegment(seg, form);

    const toggle = e.target.closest(".toggle");
    if (toggle) return handleToggle(toggle);

    if (e.target.id === "deletePresident") {
      const name = $("savedSelect").value;
      if (name && confirm(`Delete the saved president "${name}"?`)) {
        deletePresident(name);
        repaint();
      }
      return;
    }
    if (e.target.id === "beginBtn") return submit();
  });
}

function handleOption(btn) {
  const group = btn.parentElement;
  group.querySelectorAll(".opt").forEach((b) => b.classList.remove("is-selected"));
  btn.classList.add("is-selected");
  const value = btn.dataset.value;

  // Demographic fields live behind data-profile and may reveal a follow-up.
  if (group.dataset.profile) {
    const key = applyProfileClick(group, value, draft);
    if (opensExtra(key, draft) || key === "age" || key === "region") repaint();
    return;
  }

  const key = group.dataset.pick;
  if (!key) return;
  draft[key] = value;

  if (key === "ideology") {
    // The picker is two groups, so clear the selection in the other one.
    $("ideologyWrap").querySelectorAll(".opt").forEach((b) => {
      b.classList.toggle("is-selected", b.dataset.value === value);
    });
  }

  if (key === "party") {
    // Ideology is party-specific, and independents have no congressional bloc.
    draft.ideology = ideologiesFor(value)[0].value;
    $("ideologyWrap").innerHTML = ideologySection(value, draft.ideology);
    $("compositionWrap").innerHTML = compositionSection();
  }
}

function handleSegment(btn, form) {
  const group = btn.closest(".seg");
  const key = group.dataset.seg;
  group.querySelectorAll(".seg__btn").forEach((b) => b.classList.remove("is-on"));
  btn.classList.add("is-on");
  draft[key] = btn.dataset.value;
  refreshNote(key, draft[key], form);
}

function handleToggle(btn) {
  const key = btn.dataset.toggle;
  const on = !btn.classList.contains("is-on");
  btn.classList.toggle("is-on", on);
  btn.setAttribute("aria-pressed", String(on));
  draft[key] = on;
  // Switching the bio on changes what the primary button promises.
  if (key === "bio") {
    $("beginBtn").textContent = on ? "Next: Your Bio →" : "Begin Your Presidency →";
  }
}

/** Add two effect blocks together, key by key. */
function mergeEffects(...blocks) {
  const out = {};
  for (const block of blocks) {
    for (const [k, v] of Object.entries(block || {})) out[k] = (out[k] || 0) + v;
  }
  return out;
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

function randomDraft() {
  const gender = pick(["male", "female"]);
  const party = pick(PARTIES).value;
  const out = {
    presidentName: `${pick(VP_POOL.first[gender])} ${pick(VP_POOL.last)}`,
    gender,
    party,
    ideology: pick(ideologiesFor(party)).value,
    style: pick(STYLES).value,
    mandate: pick(MANDATES).value,
    composition: pick(COMPOSITIONS).value,
  };
  // Randomise the whole profile too, skipping the options that need typing.
  for (const field of PROFILE_FIELDS) {
    const choices = field.options.filter((o) => !o.custom);
    out[field.key] = pick(choices).value;
  }
  return out;
}

function submit() {
  const name = draft.presidentName.trim();
  if (!name) {
    const input = $("nameInput");
    input.focus();
    input.style.borderColor = "var(--red)";
    setTimeout(() => (input.style.borderColor = ""), 900);
    return;
  }

  const { scenario, era } = context;
  const mandate = MANDATES.find((m) => m.value === draft.mandate);
  const composition = COMPOSITIONS.find((c) => c.value === draft.composition);
  const settings = {};
  for (const s of SETTINGS) {
    settings[s.key] = draft[s.key];
    if (s.sub) settings[s.sub.key] = draft[s.sub.key];
  }

  handlers.onConfirm({
    ...draft,
    ...settings,
    [NO_HINTS.key]: draft[NO_HINTS.key],
    presidentName: name,
    profile: profileSummary(draft),
    // Who you are and what you believe both seed the board.
    profileEffects: mergeEffects(profileEffects(draft), ideologyEffects(draft.party, draft.ideology)),
    ...ideologyPosition(draft.party, draft.ideology),
    homeStates: homeStates(draft),
    scenarioKey: scenario.key,
    scenarioName: scenario.name,
    eraKey: era.key,
    eraTitle: era.title,
    startYear: era.startYear,
    era: era.prose,
    court: era.court,
    stability: era.stability,
    startApproval: era.approval ?? mandate.approval,
    congress: draft.party === "Independent" ? null : { house: composition.house, senate: composition.senate },
  });
}
