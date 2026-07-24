"use strict";

import { $, el, show, escapeHtml } from "./util.js";
import { listPresidents, savePresident, deletePresident } from "./store.js";
import {
  GENDERS, PARTIES, IDEOLOGIES, STYLES, MANDATES, COMPOSITIONS, DIFFICULTIES, VP_POOL,
} from "./data.js";

const DEFAULT_DRAFT = {
  presidentName: "",
  gender: "male",
  party: "Independent",
  ideology: "",
  style: "Polished / Presidential",
  mandate: "comfortable",
  composition: "balanced",
  checks: true,
  debates: true,
  difficulty: "hard",
};

let draft = { ...DEFAULT_DRAFT };
let handlers = {};

export const currentDraft = () => ({ ...draft });

/** Options markup shared by every picker on this screen. */
function optsHtml(items, selected, extraCls = "") {
  return items.map((it) => {
    const value = it.value;
    const label = it.label || value;
    const on = value === selected ? " is-selected" : "";
    const sub = it.sub ? `<span class="opt__sub">${escapeHtml(it.sub)}</span>` : "";
    return `<button type="button" class="opt${extraCls}${on}" data-value="${escapeHtml(value)}">
      <span class="opt__label">${escapeHtml(label)}</span>${sub}</button>`;
  }).join("");
}

function partyHtml(selected) {
  return PARTIES.map((p) => `
    <button type="button" class="opt opt--party ${p.cls}${p.value === selected ? " is-selected" : ""}"
      data-value="${p.value}">
      <span class="orb"></span>
      <span class="opt__label">${p.label}</span>
    </button>`).join("");
}

function toggleHtml(id, title, desc, on) {
  return `<button type="button" class="toggle${on ? " is-on" : ""}" id="${id}" aria-pressed="${on}">
    <span><span class="toggle__title">${title}</span><span class="toggle__desc">${desc}</span></span>
    <span class="switch"></span>
  </button>`;
}

function ideologiesFor(party) {
  return IDEOLOGIES[party] || IDEOLOGIES.Independent;
}

/** Congress composition is a party-strength control, so it needs a party. */
function compositionSection() {
  if (draft.party === "Independent") {
    return `<p class="hint">You have no bloc in Congress as an independent — both chambers start
      evenly divided and every vote has to be won on its own terms.</p>`;
  }
  return `<div class="opts opts--wide" id="compositionOpts">${optsHtml(COMPOSITIONS, draft.composition)}</div>`;
}

export function renderCharacter(scenario, era, onConfirm, onBack) {
  handlers = { onConfirm, onBack };
  if (!draft.ideology) draft.ideology = ideologiesFor(draft.party)[0].value;

  const saved = listPresidents();
  const savedOptions = ['<option value="">— Saved presidents —</option>']
    .concat(saved.map((p) => `<option value="${escapeHtml(p.presidentName)}">${escapeHtml(p.presidentName)} · ${escapeHtml(p.party)}</option>`))
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
        <div class="opts" id="genderOpts">${optsHtml(GENDERS, draft.gender)}</div>
      </div>
    </div>

    <div class="field">
      <span class="field__label">Your Party</span>
      <div class="opts--party" id="partyOpts">${partyHtml(draft.party)}</div>
    </div>

    <div class="divider"><span class="eyebrow">Character profile</span></div>

    <div class="field">
      <span class="field__label">Ideology <span class="field__note">(updates when you pick a party)</span></span>
      <div class="opts opts--grid" id="ideologyOpts">${optsHtml(ideologiesFor(draft.party), draft.ideology)}</div>
    </div>

    <div class="field">
      <span class="field__label">Communication Style</span>
      <div class="opts opts--grid" id="styleOpts">${optsHtml(STYLES, draft.style)}</div>
    </div>

    <div class="divider"><span class="eyebrow">Political position</span></div>

    <div class="field">
      <span class="field__label">Mandate Strength</span>
      <div class="opts opts--grid" id="mandateOpts">${optsHtml(MANDATES, draft.mandate)}</div>
    </div>

    <div class="field">
      <span class="field__label">Congressional Composition
        <span class="field__note">(your party's strength in Congress at start)</span></span>
      <div id="compositionWrap">${compositionSection()}</div>
    </div>

    <div class="divider"><span class="eyebrow">Rules of play</span></div>

    <div class="card card--blue setting">
      ${toggleHtml("checksToggle", "⚖️ Checks &amp; Balances",
        "Congress, the courts and federal agencies can block or water down what you sign. Forces realism.", draft.checks)}
    </div>

    <div class="card card--purple setting">
      ${toggleHtml("debatesToggle", "🎤 Presidential Debates",
        "Run the debate rounds when election season arrives. Switch off and the campaign is decided on your record alone.", draft.debates)}
    </div>

    <div class="card setting">
      <span class="field__label">⚔️ Difficulty</span>
      <p class="hint">Affects how far approval swings each month and how much the country forgives at the ballot box.</p>
      <div class="setting__body">
        <div class="seg" id="difficultySeg">
          ${DIFFICULTIES.map((d) => `<button type="button" class="seg__btn${d.value === draft.difficulty ? " is-on" : ""}"
            data-value="${d.value}">${d.label}${d.tag ? `<span class="seg__tag">${d.tag}</span>` : ""}</button>`).join("")}
        </div>
      </div>
      <p class="hint setting__foot"><em>The game is built for Hard. Easy and Medium soften the consequences.</em></p>
    </div>

    <button type="button" class="btn btn--primary btn--block" id="beginBtn" style="margin-top:26px">
      Begin Your Presidency →
    </button>`;

  wire(scenario, era);
  show("character");
}

function wire(scenario, era) {
  const form = $("characterForm");

  form.addEventListener("input", (e) => {
    if (e.target.id === "nameInput") draft.presidentName = e.target.value;
  });

  form.addEventListener("click", (e) => {
    const opt = e.target.closest(".opt");
    const seg = e.target.closest(".seg__btn");
    const toggle = e.target.closest(".toggle");

    if (opt) return handleOption(opt);
    if (seg) {
      $("difficultySeg").querySelectorAll(".seg__btn").forEach((b) => b.classList.remove("is-on"));
      seg.classList.add("is-on");
      draft.difficulty = seg.dataset.value;
      return;
    }
    if (toggle) {
      const on = !toggle.classList.contains("is-on");
      toggle.classList.toggle("is-on", on);
      toggle.setAttribute("aria-pressed", String(on));
      if (toggle.id === "checksToggle") draft.checks = on;
      if (toggle.id === "debatesToggle") draft.debates = on;
      return;
    }
    if (e.target.id === "deletePresident") {
      const name = $("savedSelect").value;
      if (!name) return;
      if (!confirm(`Delete the saved president "${name}"?`)) return;
      deletePresident(name);
      renderCharacter(scenario, era, handlers.onConfirm, handlers.onBack);
      return;
    }
    if (e.target.id === "beginBtn") return submit(scenario, era);
  });

  form.addEventListener("change", (e) => {
    if (e.target.id !== "savedSelect" || !e.target.value) return;
    const found = listPresidents().find((p) => p.presidentName === e.target.value);
    if (found) {
      draft = { ...DEFAULT_DRAFT, ...found };
      renderCharacter(scenario, era, handlers.onConfirm, handlers.onBack);
    }
  });

  $("charBack").onclick = handlers.onBack;
  $("charRandom").onclick = () => {
    draft = { ...draft, ...randomDraft() };
    renderCharacter(scenario, era, handlers.onConfirm, handlers.onBack);
  };
  $("charSave").onclick = () => {
    if (!draft.presidentName.trim()) {
      $("nameInput").focus();
      return;
    }
    if (savePresident(draft)) renderCharacter(scenario, era, handlers.onConfirm, handlers.onBack);
  };
}

/** Every option group is a single-choice picker over the same markup. */
function handleOption(btn) {
  const group = btn.parentElement;
  group.querySelectorAll(".opt").forEach((b) => b.classList.remove("is-selected"));
  btn.classList.add("is-selected");
  const value = btn.dataset.value;

  switch (group.id) {
    case "genderOpts": draft.gender = value; break;
    case "styleOpts": draft.style = value; break;
    case "mandateOpts": draft.mandate = value; break;
    case "compositionOpts": draft.composition = value; break;
    case "ideologyOpts": draft.ideology = value; break;
    case "partyOpts": {
      draft.party = value;
      // Ideology is party-specific, and Independents have no congressional bloc.
      draft.ideology = ideologiesFor(value)[0].value;
      $("ideologyOpts").innerHTML = optsHtml(ideologiesFor(value), draft.ideology);
      $("compositionWrap").innerHTML = compositionSection();
      break;
    }
  }
}

function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

function randomDraft() {
  const gender = pick(["male", "female"]);
  const party = pick(PARTIES).value;
  return {
    presidentName: `${pick(VP_POOL.first[gender])} ${pick(VP_POOL.last)}`,
    gender,
    party,
    ideology: pick(ideologiesFor(party)).value,
    style: pick(STYLES).value,
    mandate: pick(MANDATES).value,
    composition: pick(COMPOSITIONS).value,
  };
}

function submit(scenario, era) {
  const name = draft.presidentName.trim();
  if (!name) {
    const input = $("nameInput");
    input.focus();
    input.style.borderColor = "var(--red)";
    setTimeout(() => (input.style.borderColor = ""), 900);
    return;
  }
  const mandate = MANDATES.find((m) => m.value === draft.mandate);
  const composition = COMPOSITIONS.find((c) => c.value === draft.composition);

  handlers.onConfirm({
    ...draft,
    presidentName: name,
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
