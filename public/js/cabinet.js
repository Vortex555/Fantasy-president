import { $, el, show, escapeHtml } from "./util.js";
import { cabinetSlate } from "./api.js";

/**
 * The transition.
 *
 * A president used to arrive with eleven strangers already at the table,
 * generated from the hash of their own name, and the only post they had ever
 * chosen was the Vice President. That was survivable while the cabinet was
 * something you consulted; it stopped being survivable when the rooms started
 * asking those people for plans, because the plan you are offered is only as
 * good as the person you appointed.
 *
 * Two decisions of deliberately different sizes. The doctrine staffs the whole
 * government in one click and is the only compulsory part. The individual posts
 * are there for the player who cares which of them runs Defense, and invisible
 * to the one who does not.
 */

let draft = null;
let onDone = null;
let doctrine = "balanced";
let picks = {};
let roles = [];
let open = null;      // the post whose slate is showing
let slate = [];

export function renderCabinet(scenarioDraft, confirm, doctrines, appointable) {
  draft = scenarioDraft;
  onDone = confirm;
  doctrine = doctrines[2]?.id || doctrines[0]?.id;
  picks = {};
  roles = appointable;
  open = null;
  paint(doctrines);
  show("cabinet");
}

function paint(doctrines) {
  $("cabinetBody").innerHTML = `
    <p class="field__label">How are you staffing the government?</p>
    <p class="hint" style="margin:0 0 12px">
      Every one of these people will be asked for a plan, in a room, in front of you.
      Loyalty buys a cabinet that will not brief against you. Competence buys one that
      is right. Nobody has ever been offered both.
    </p>
    <div class="rows" id="doctrineList">
      ${doctrines.map((d) => `
        <button type="button" class="mate${d.id === doctrine ? " is-selected" : ""}" data-doctrine="${escapeHtml(d.id)}">
          <span class="row__body">
            <span class="mate__name">${escapeHtml(d.name)}</span>
            <span class="mate__bio">${escapeHtml(d.blurb)}</span>
          </span>
          <span class="mate__stats">Loyalty <b>${d.loyalty[0]}–${d.loyalty[1]}</b><br />Competence <b>${d.competence[0]}–${d.competence[1]}</b></span>
        </button>`).join("")}
    </div>

    <div class="card setting" style="margin-top:16px">
      <span class="field__label">Pick anybody you actually care about</span>
      <p class="hint">Optional. Everything you leave alone is filled in around whatever you chose above.</p>
      <div class="rows" id="postList" style="margin-top:10px">
        ${roles.map((r) => `
          <button type="button" class="career office" data-post="${escapeHtml(r.id)}">
            <span class="office__text">
              <span class="office__title">${r.emoji} ${escapeHtml(r.role)}</span>
              <span class="office__lede">${picks[r.id]
                ? `You picked the ${escapeHtml(picks[r.id])}.`
                : escapeHtml(r.focus)}</span>
            </span>
            <span class="career__go">${picks[r.id] ? "✓" : "▸"}</span>
          </button>`).join("")}
      </div>
      <div id="slateBox"></div>
    </div>

    <button type="button" class="btn btn--primary btn--block" id="confirmCabinet" style="margin-top:18px">
      Take the oath →
    </button>`;

  $("doctrineList").onclick = (e) => {
    const pick = e.target.closest("[data-doctrine]");
    if (!pick) return;
    doctrine = pick.dataset.doctrine;
    // Changing the house style abandons the individual arguments you had won,
    // which is the honest behaviour: those people were candidates under a
    // different transition.
    picks = {};
    open = null;
    paint(doctrines);
  };

  $("postList").onclick = async (e) => {
    const pick = e.target.closest("[data-post]");
    if (!pick) return;
    open = open === pick.dataset.post ? null : pick.dataset.post;
    if (!open) return paintSlate();
    slate = [];
    paintSlate("Finding three people who would take it…");
    try {
      const data = await cabinetSlate(draft, open);
      slate = data.candidates || [];
    } catch {
      slate = [];
    }
    paintSlate();
  };

  $("confirmCabinet").onclick = () => onDone({ cabinetDoctrine: doctrine, cabinetPicks: picks });
}

function paintSlate(loading) {
  const box = $("slateBox");
  if (!box) return;
  if (!open) return (box.innerHTML = "");
  if (loading) return (box.innerHTML = `<p class="hint" style="margin:12px 0 0">${escapeHtml(loading)}</p>`);

  box.innerHTML = `<div class="rows" style="margin-top:12px">
    ${slate.map((c) => `
      <button type="button" class="mate${picks[open] === c.key ? " is-selected" : ""}" data-cand="${escapeHtml(c.key)}">
        <span class="row__body">
          <span class="mate__name">${escapeHtml(c.name)}</span>
          <span class="mate__bio">${escapeHtml(c.pitch)}</span>
        </span>
        <span class="mate__stats">Competence: <b>${c.competence}</b><br />Loyalty: <b>${c.loyalty}</b></span>
      </button>`).join("")}
  </div>`;

  box.onclick = (e) => {
    const pick = e.target.closest("[data-cand]");
    if (!pick) return;
    const key = pick.dataset.cand;
    // Clicking the one you already chose puts the post back to the doctrine.
    if (picks[open] === key) delete picks[open];
    else picks[open] = key;
    const post = document.querySelector(`[data-post="${open}"]`);
    if (post) {
      post.querySelector(".office__lede").textContent = picks[open]
        ? `You picked the ${picks[open]}.`
        : (roles.find((r) => r.id === open)?.focus || "");
      post.querySelector(".career__go").textContent = picks[open] ? "✓" : "▸";
    }
    paintSlate();
  };
}

void el;
