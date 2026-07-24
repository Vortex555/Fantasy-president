"use strict";

import { $, el, show, escapeHtml } from "./util.js";
import { VP_POOL, PORTFOLIOS, IDEOLOGIES } from "./data.js";

let candidates = [];
let selected = null;
let portfolio = "";

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const between = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

/** Noun phrase per background, so the generated bio reads like a sentence. */
const BACKGROUND_LINE = {
  governor: "governor who ran a state and knows how a budget actually gets signed",
  senator: "senator who has spent a career counting votes on the floor",
  outsider: "newcomer who has never held office and says so in every interview",
  law: "prosecutor who tried the cases that made the evening news",
  business: "executive who built a company and talks about the country like a balance sheet",
  military: "commander who led troops and carries that authority into a room",
};

const BACKGROUND_LABEL = {
  governor: "governor", senator: "senator", outsider: "outsider",
  law: "prosecutor", business: "business", military: "military",
};

const AGES = ["40s", "50s", "60s"];

/** Five plausible running mates, drawn to complement the ticket. */
function generateCandidates(draft) {
  const ideologies = (IDEOLOGIES[draft.party] || IDEOLOGIES.Independent).map((i) => i.value);
  const usedNames = new Set();

  return Array.from({ length: 5 }, () => {
    const gender = Math.random() < 0.5 ? "male" : "female";
    let name;
    do {
      name = `${pick(VP_POOL.first[gender])} ${pick(VP_POOL.last)}`;
    } while (usedNames.has(name));
    usedNames.add(name);

    const background = pick(VP_POOL.background);
    const region = pick(VP_POOL.region);
    const ideology = pick(ideologies);
    const loyalty = between(62, 95);
    const competence = between(62, 92);

    return {
      name, gender, region, background, ideology, loyalty, competence,
      age: pick(AGES),
      bio: `A ${region} ${BACKGROUND_LINE[background]}. ` +
        `${name.split(" ")[0]} runs as a ${ideology.toLowerCase()} and ` +
        (loyalty >= 85 ? "would take a bullet for this administration."
          : loyalty >= 72 ? "will stay on message as long as the polls hold."
          : "is already, quietly, running for the job above them."),
    };
  });
}

export function renderRunningMate(draft, onConfirm) {
  candidates = generateCandidates(draft);
  selected = candidates[0];
  portfolio = "";
  paint(draft, onConfirm);
  show("vp");
}

function paint(draft, onConfirm) {
  const body = $("vpBody");
  body.innerHTML = `
    <p class="field__label">Choose your running mate:</p>
    <div class="rows" id="mateList"></div>

    <button type="button" class="btn" id="customMate" style="width:100%;margin-top:12px">
      + Build a Custom VP Instead
    </button>
    <div id="customMateForm" class="hidden"></div>

    <div class="card setting" style="margin-top:14px">
      <span class="field__label">Assign Portfolio</span>
      <p class="hint">A VP with a portfolio speaks for you on that brief — and takes the blame when it goes wrong.</p>
      <div class="setting__body">
        <select id="portfolioSelect">
          ${PORTFOLIOS.map((p) => `<option value="${p.value}">${escapeHtml(p.label)}</option>`).join("")}
        </select>
      </div>
    </div>

    <button type="button" class="btn btn--primary btn--block" id="confirmMate" style="margin-top:18px">
      Confirm Vice President →
    </button>`;

  const list = $("mateList");
  for (const c of candidates) {
    const row = el("button", `mate${c === selected ? " is-selected" : ""}`, `
      <span class="row__body">
        <span class="mate__name">${escapeHtml(c.name)}</span>
        <span class="mate__tags">${c.age} · ${c.gender} · ${escapeHtml(c.region)} · ${escapeHtml(BACKGROUND_LABEL[c.background] || c.background)}</span>
        <span class="mate__bio">${escapeHtml(c.bio)}</span>
      </span>
      <span class="mate__stats">Competence: <b>${c.competence}</b><br />Loyalty: <b>${c.loyalty}</b></span>`);
    row.type = "button";
    row.addEventListener("click", () => {
      selected = c;
      list.querySelectorAll(".mate").forEach((m) => m.classList.remove("is-selected"));
      row.classList.add("is-selected");
      $("customMateForm").classList.add("hidden");
    });
    list.appendChild(row);
  }

  $("customMate").onclick = () => toggleCustomForm(draft);
  $("portfolioSelect").onchange = (e) => { portfolio = e.target.value; };
  $("confirmMate").onclick = () => {
    const custom = readCustom();
    onConfirm({ ...(custom || selected), portfolio });
  };
}

function toggleCustomForm(draft) {
  const wrap = $("customMateForm");
  if (!wrap.classList.contains("hidden")) {
    wrap.classList.add("hidden");
    return;
  }
  wrap.innerHTML = `
    <div class="card setting" style="margin-top:12px">
      <div class="field-pair">
        <div class="field" style="margin-bottom:14px">
          <label class="field__label" for="customMateName">VP name</label>
          <input id="customMateName" type="text" maxlength="60" placeholder="Enter a name" autocomplete="off" />
        </div>
        <div class="field" style="margin-bottom:14px">
          <label class="field__label" for="customMateBg">Background</label>
          <select id="customMateBg">
            ${VP_POOL.background.map((b) => `<option value="${b}">${b[0].toUpperCase() + b.slice(1)}</option>`).join("")}
          </select>
        </div>
      </div>
      <p class="hint">A custom VP starts loyal (90) and capable (75). Selecting a card above cancels this.</p>
    </div>`;
  wrap.classList.remove("hidden");
  $("customMateName").focus();
  document.querySelectorAll(".mate").forEach((m) => m.classList.remove("is-selected"));
}

function readCustom() {
  const input = $("customMateName");
  const wrap = $("customMateForm");
  if (!input || wrap.classList.contains("hidden")) return null;
  const name = input.value.trim();
  if (!name) return null;
  const background = $("customMateBg").value;
  return {
    name,
    gender: "unspecified",
    age: "50s",
    region: "national",
    background,
    ideology: "hand-picked",
    loyalty: 90,
    competence: 75,
    bio: `Hand-picked by the President — a ${BACKGROUND_LINE[background]}.`,
  };
}
