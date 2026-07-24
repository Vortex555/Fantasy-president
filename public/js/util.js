"use strict";

/** Shared DOM + formatting helpers. No app state lives here. */

export const $ = (id) => document.getElementById(id);

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Build an element from a class and an HTML string. */
export function el(tag, cls, html) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html != null) node.innerHTML = html;
  return node;
}

/** Show exactly one screen and scroll to the top of it. */
export function show(name) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("is-active"));
  const target = $(`screen-${name}`);
  if (target) target.classList.add("is-active");
  window.scrollTo(0, 0);
}

export function loader(on, text) {
  $("loaderText").textContent = text || "The situation is developing…";
  $("loader").classList.toggle("hidden", !on);
}

/** A thin meter. `tone` is any CSS colour value. */
export function track(pct, tone) {
  const w = Math.max(0, Math.min(100, pct));
  return `<div class="track"><i style="width:${w}%;background:${tone || "var(--ink)"}"></i></div>`;
}

/** Traffic-light colour for a 0–100 support score. */
export function toneFor(v) {
  if (v >= 60) return "var(--green)";
  if (v >= 42) return "var(--amber)";
  return "var(--red)";
}

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

/** Month 1 of a term starting in `startYear` January → "January 2025". */
export function monthLabel(month, startYear) {
  const i = (month - 1) % 12;
  const year = startYear + Math.floor((month - 1) / 12);
  return `${MONTHS[i]} ${year}`;
}

export function shortMonthLabel(month, startYear) {
  const label = monthLabel(month, startYear);
  return label.slice(0, 3) + " " + label.split(" ")[1];
}

/** Wire a group of `.opt` buttons as a single-choice picker. */
export function pickerGroup(root, selector, onPick) {
  root.addEventListener("click", (e) => {
    const btn = e.target.closest(selector);
    if (!btn || !root.contains(btn)) return;
    root.querySelectorAll(selector).forEach((b) => b.classList.remove("is-selected"));
    btn.classList.add("is-selected");
    onPick(btn.dataset.value, btn);
  });
}

export function relativeDay(iso) {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "just now";
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
