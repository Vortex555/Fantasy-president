"use strict";

import { $, escapeHtml, track, toneFor, loader } from "../util.js";
import { G, saveCareer } from "../store.js";
import { deployEastWing, editFirstLady } from "../api.js";
import { openDrawer } from "../drawer.js";

/**
 * The East Wing card. Standing is the number that matters here and it is
 * shown next to the president's own, because the whole point is that the
 * spouse is usually more trusted — and that spending it costs it.
 */

export function firstLadyCard(state) {
  const lady = state.firstLady;
  if (!lady) return "";
  const trusted = lady.standing - Math.round(state.approval);

  return `<div class="card" id="firstLadyCard">
    <div class="card__head">
      <span class="eyebrow">🌹 ${escapeHtml(lady.title)}</span>
      <span class="hint">Standing: <b style="color:${toneFor(lady.standing)}">${lady.standing}</b>${
        trusted > 3 ? ` · ${trusted} points above you` : trusted < -3 ? ` · ${-trusted} below you` : " · level with you"}</span>
    </div>

    <div class="person__top">
      <div>
        <div class="person__name">${escapeHtml(lady.name)}</div>
        <div class="person__tags">${escapeHtml(lady.trait)}</div>
        <p class="person__bio">${escapeHtml(lady.bio)}</p>
        <p class="hint" style="margin-top:6px">Signature cause: <b>${escapeHtml(lady.cause)}</b></p>
      </div>
      <div class="person__stats">
        <div style="margin-bottom:8px">${track(lady.standing, toneFor(lady.standing))}</div>
        <button class="btn btn--sm" data-advisor="spouse">💬 Talk</button>
        <button class="btn btn--sm" id="editLady">✎ Edit</button>
      </div>
    </div>

    <div class="eastwing">
      <input id="eastWingInput" type="text" maxlength="200"
        placeholder="Send her somewhere — a cause, a crisis, a campaign stop…" />
      <button class="btn btn--primary" id="eastWingGo">Deploy the East Wing</button>
    </div>
    ${lady.deployments?.length ? `<p class="hint" style="margin:10px 0 0">Last sent: ${
      escapeHtml(lady.deployments.at(-1).instruction)}</p>` : ""}
  </div>`;
}

async function deploy(refresh) {
  const input = $("eastWingInput");
  const instruction = input.value.trim();
  if (instruction.length < 3) {
    input.focus();
    input.style.borderColor = "var(--red)";
    setTimeout(() => (input.style.borderColor = ""), 900);
    return;
  }

  loader(true, "The East Wing is on the road…");
  try {
    const res = await deployEastWing(G.state, instruction);
    if (res.rejected) return alert(res.note);
    G.state = res.state;
    saveCareer();
    const o = res.outcome;
    alert(`${o.note}\n\nApproval ${o.approvalChange >= 0 ? "+" : ""}${o.approvalChange} · ` +
      `${G.state.firstLady.title} standing ${o.standingChange >= 0 ? "+" : ""}${o.standingChange}`);
    refresh();
  } catch (err) {
    alert("The deployment failed: " + err.message);
  } finally {
    loader(false);
  }
}

async function edit(refresh) {
  const lady = G.state.firstLady;
  const name = prompt(`Rename the ${lady.title}:`, lady.name);
  if (name === null) return;

  const causes = G.meta.firstLadyCauses || [];
  const list = causes.map((c, i) => `${i + 1}. ${c.label}`).join("\n");
  const answer = prompt(`Signature cause — enter a number, or cancel to keep "${lady.cause}":\n\n${list}`);
  const chosen = answer ? causes[Number(answer) - 1] : null;

  loader(true, "Redrafting the East Wing's brief…");
  try {
    const res = await editFirstLady(G.state, name.trim(), chosen?.id);
    G.state = res.state;
    saveCareer();
    refresh();
  } catch (err) {
    alert("The change could not be made: " + err.message);
  } finally {
    loader(false);
  }
}

export function wireFirstLady(root, refresh) {
  root.addEventListener("click", (e) => {
    if (e.target.id === "eastWingGo") return deploy(refresh);
    if (e.target.id === "editLady") return edit(refresh);
  });
  root.addEventListener("keydown", (e) => {
    if (e.target.id === "eastWingInput" && e.key === "Enter") {
      e.preventDefault();
      deploy(refresh);
    }
  });
}
