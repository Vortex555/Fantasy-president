"use strict";

import { $, show, escapeHtml, optionsHtml } from "./util.js";
import { listPresidents, savePresident, deletePresident } from "./store.js";
import { GENDERS, PARTIES, STYLES, MANDATES, COMPOSITIONS, VP_POOL } from "./data/catalog.js";
import {
  ideologiesFor, mainstreamIdeologies, fringeIdeologies, ideologyEffects, ideologyPosition,
} from "./data/ideologies.js";
import { PROFILE_DEFAULTS, PROFILE_FIELDS, profileEffects, homeStates } from "./data/profile.js";
import { settingDefaults, SETTINGS, NO_HINTS, appliesTo } from "./data/settings.js";
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

/**
 * What this screen is for depends entirely on which office was just chosen.
 *
 * It used to say "Create your own president" and offer a Mandate Strength
 * control to somebody running for a House seat in Ohio — a starting approval
 * rating their district never reads, chosen on a screen naming a job they are
 * not applying for. Everything here that differs between the three careers is
 * named once, in this table, rather than guessed at further down.
 */
const OFFICE = {
  president: {
    lede: "Create your own president.",
    next: "Begin Your Presidency →",
    // The same word in all three offices: it is a character draft, and the
    // screen is called Character Setup.
    savedNoun: "character",
    mandate: true,
    compositionLabel: "Congressional Composition",
    compositionNote: "(your party's strength in Congress at start)",
  },
  house: {
    lede: "Create the member of Congress you are about to become.",
    next: "Choose Your District →",
    savedNoun: "character",
    // A district decides how it rates you; nobody hands a freshman a mandate.
    mandate: false,
    compositionLabel: "The Chamber You Arrive In",
    compositionNote: "(your caucus's strength in the House — it decides who holds the gavels)",
  },
  senate: {
    lede: "Create the senator you are about to become.",
    next: "Choose Your State →",
    savedNoun: "character",
    mandate: false,
    compositionLabel: "The Chamber You Arrive In",
    compositionNote: "(your caucus's strength in the Senate — it decides who holds the gavels)",
  },
  /**
   * The bottom rung.
   *
   * Missing from this table, a state representative fell through
   * `OFFICE[office] || OFFICE.president` and was shown presidential copy and
   * presidential rules on the way into a chamber that has neither a cabinet nor
   * a foreign policy. The fallback is the right behaviour for an unknown office
   * and the wrong behaviour for one the game actually has.
   */
  statehouse: {
    lede: "Create the state legislator you are about to become.",
    next: "Choose Your State →",
    savedNoun: "character",
    mandate: false,
    compositionLabel: "The Chamber You Arrive In",
    // The composition of a state legislature is drawn from the state itself, so
    // there is nothing here for a player to set.
    compositionNote: "(drawn from the state you pick — most state chambers are far more lopsided than Congress)",
  },
};

const officeOf = () => OFFICE[context.office] || OFFICE.president;
const isPresident = () => (context.office || "president") === "president";

export function renderCharacter(scenario, era, office, onConfirm, onBack) {
  handlers = { onConfirm, onBack };
  context = { scenario, era, office: OFFICE[office] ? office : "president" };
  if (!draft.ideology) draft.ideology = ideologiesFor(draft.party)[0].value;

  const o = officeOf();
  const lede = $("characterLede");
  if (lede) lede.textContent = o.lede;

  const savedOptions = [`<option value="">— Saved ${o.savedNoun}s —</option>`]
    .concat(listPresidents().map((p) =>
      `<option value="${escapeHtml(p.presidentName)}">${escapeHtml(p.presidentName)} · ${escapeHtml(p.party)}</option>`))
    .join("");

  $("characterForm").innerHTML = `
    <div class="load-saved">
      <span class="load-saved__label">📋 Load a saved ${o.savedNoun}</span>
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

    ${o.mandate ? `<div class="field">
      <span class="field__label">Mandate Strength</span>
      <div class="opts opts--grid" data-pick="mandate">${optionsHtml(MANDATES, draft.mandate)}</div>
    </div>` : `<p class="hint">Your standing at home is not something you choose — it comes from
      how well the seat you pick next actually fits the politics you just described.</p>`}

    <div class="field">
      <span class="field__label">${escapeHtml(o.compositionLabel)}
        <span class="field__note">${escapeHtml(o.compositionNote)}</span></span>
      <div id="compositionWrap">${compositionSection()}</div>
    </div>

    <div class="divider"><span class="eyebrow">Rules of play</span></div>
    ${settingsHtml(draft, context.office)}

    <button type="button" class="btn btn--primary btn--block" id="beginBtn" style="margin-top:26px">
      ${draft.bio && isPresident() ? "Next: Your Bio →" : o.next}
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

// The office has to be carried through a repaint. Dropping it sent every
// re-render — a profile click, the Random button — back to the presidency.
const repaint = () =>
  renderCharacter(context.scenario, context.era, context.office, handlers.onConfirm, handlers.onBack);

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
    $("beginBtn").textContent = on ? "Next: Your Bio →" : officeOf().next;
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

  const { scenario, era, office } = context;
  const mandate = MANDATES.find((m) => m.value === draft.mandate);
  const composition = COMPOSITIONS.find((c) => c.value === draft.composition);

  /**
   * Only send the rules this office actually plays by.
   *
   * The rack is filtered on screen, but a saved character carries every switch
   * it was created with — so loading a president into a House career would
   * otherwise smuggle `bio: true` through and route a freshman member into the
   * presidential bio form for questions about their campaign promises.
   */
  const settings = {};
  for (const s of SETTINGS) {
    const on = appliesTo(s, office);
    settings[s.key] = on ? draft[s.key] : s.default;
    if (s.sub) settings[s.sub.key] = on ? draft[s.sub.key] : s.sub.default;
  }

  handlers.onConfirm({
    ...draft,
    ...settings,
    [NO_HINTS.key]: isPresident() ? draft[NO_HINTS.key] : NO_HINTS.default,
    difficulty: isPresident() ? draft.difficulty : "hard",
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
