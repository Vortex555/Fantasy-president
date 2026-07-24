"use strict";

import { $, el, escapeHtml, track, toneFor } from "./util.js";
import { G, saveCareer } from "./store.js";
import { askAdvisor, dismissAdvisor } from "./api.js";

let onChange = () => {};

const advisorById = (id) => (G.state.cabinet || []).find((a) => a.id === id);

export function openDrawer(advisorId, changed) {
  const a = advisorById(advisorId);
  if (!a) return;
  onChange = changed || (() => {});
  G.currentAdvisor = advisorId;

  $("drawerEmoji").textContent = a.emoji;
  $("drawerName").textContent = a.name;
  $("drawerRole").textContent = a.role;
  // The First Spouse is family, not staff — there is no dismissing them.
  $("drawerFire").classList.toggle("hidden", a.id === "spouse");
  renderStats(a);
  renderLog(advisorId);
  $("drawer").classList.remove("hidden");
  const input = $("drawerInput");
  input.value = "";
  input.focus();
}

export function closeDrawer() {
  $("drawer").classList.add("hidden");
}

function renderStats(a) {
  $("drawerStats").innerHTML = [["Loyalty", a.loyalty], ["Competence", a.competence]]
    .map(([label, v]) => `<div>
      <span class="eyebrow">${label} <b style="color:${toneFor(v)}">${v}</b></span>
      <div style="margin-top:6px">${track(v, toneFor(v))}</div>
    </div>`).join("");
}

function renderLog(id) {
  const log = $("drawerLog");
  log.innerHTML = "";
  const msgs = G.chats[id] || [];
  if (!msgs.length) {
    const a = advisorById(id);
    log.appendChild(el("div", "drawer__hint",
      `${escapeHtml(a.name)} is ready. Ask about ${escapeHtml(a.focus)}.`));
  }
  for (const m of msgs) {
    log.appendChild(el("div", `bubble bubble--${m.role === "advisor" ? "them" : "me"}`, escapeHtml(m.text)));
  }
  log.scrollTop = log.scrollHeight;
}

async function send() {
  const id = G.currentAdvisor;
  const input = $("drawerInput");
  const text = input.value.trim();
  if (!text || !id) return;

  G.chats[id] = G.chats[id] || [];
  const priorHistory = G.chats[id].slice();
  G.chats[id].push({ role: "me", text });
  input.value = "";
  renderLog(id);

  const typing = el("div", "bubble bubble--them", "…");
  $("drawerLog").appendChild(typing);
  $("drawerSend").disabled = true;
  try {
    const res = await askAdvisor(G.state, G.event, id, priorHistory, text);
    G.chats[id].push({ role: "advisor", text: res.reply || "…" });
  } catch (err) {
    G.chats[id].push({ role: "advisor", text: `(The line dropped — ${err.message})` });
  } finally {
    $("drawerSend").disabled = false;
    renderLog(id);
    input.focus();
  }
}

async function fire() {
  const id = G.currentAdvisor;
  const a = advisorById(id);
  if (!a || a.id === "spouse") return;
  if (!confirm(`Dismiss ${a.name} as ${a.role}? A replacement will be sworn in, but firing carries a political cost and rattles the rest of the cabinet.`)) return;

  $("drawerFire").disabled = true;
  try {
    const res = await dismissAdvisor(G.state, id);
    if (res.rejected) {
      alert(res.note || "The order was refused.");
      return;
    }
    G.state = res.state;
    G.chats[id] = [];
    const replacement = advisorById(id);
    $("drawerName").textContent = replacement.name;
    renderStats(replacement);
    G.chats[id].push({
      role: "advisor",
      text: `${replacement.name.split(" ")[0]} here, reporting as your new ${replacement.role}. What do you need?`,
    });
    renderLog(id);
    saveCareer();
    onChange();
  } catch (err) {
    alert("The order could not be carried out: " + err.message);
  } finally {
    $("drawerFire").disabled = false;
  }
}

export function wireDrawer() {
  $("drawerClose").onclick = closeDrawer;
  $("drawerSend").onclick = send;
  $("drawerFire").onclick = fire;
  $("drawer").addEventListener("click", (e) => { if (e.target.id === "drawer") closeDrawer(); });
  $("drawerInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); send(); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer();
  });
}
