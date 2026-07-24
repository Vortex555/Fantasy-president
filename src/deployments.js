import { seeded, clamp, round1 } from "./rng.js";

/**
 * Deployments & war.
 *
 * A war is not a policy, it is a clock. Troops abroad generate casualties every
 * month whether or not the president thinks about them, and war-weariness only
 * ever goes one way while they are there. The interesting decision is never
 * "should we win" — it is how much longer you are willing to pay.
 *
 * Classic mode: troop levels, casualties, weariness.
 * Strategic mode: adds objectives that can actually be completed, and a
 * negotiated settlement that ends a war without a withdrawal's stigma.
 */

/** Wars a president inherits, by the era they walk into. */
const INHERITED = [
  { from: 2022, wars: [
    { id: "eastern_europe", name: "Eastern Europe support mission", theatre: "Europe",
      troops: 12000, intensity: 2, objective: "Keep the alliance supplied without becoming a belligerent" },
  ] },
  { from: 2009, wars: [
    { id: "afghanistan", name: "Afghanistan", theatre: "Central Asia",
      troops: 68000, intensity: 4, objective: "Break the insurgency's momentum and hand over to local forces" },
    { id: "iraq", name: "Iraq drawdown", theatre: "Middle East",
      troops: 142000, intensity: 3, objective: "Leave without the country collapsing behind you" },
  ] },
  { from: 2003, wars: [
    { id: "iraq", name: "Iraq", theatre: "Middle East",
      troops: 148000, intensity: 5, objective: "Hold the cities and stand up a government" },
    { id: "afghanistan", name: "Afghanistan", theatre: "Central Asia",
      troops: 20000, intensity: 3, objective: "Deny the country as a base" },
  ] },
  { from: 1965, wars: [
    { id: "vietnam", name: "Vietnam", theatre: "Southeast Asia",
      troops: 184000, intensity: 5, objective: "Convince the North that the cost is not worth it" },
  ] },
  { from: 1950, wars: [
    { id: "korea", name: "Korea", theatre: "East Asia",
      troops: 326000, intensity: 5, objective: "Restore the line and end the fighting" },
  ] },
];

export function buildDeployments(scenario) {
  if (!scenario.war || scenario.war === "off") return null;
  const year = scenario.startYear || 2025;
  const era = INHERITED.find((e) => year >= e.from);
  const wars = (era?.wars || []).map((w) => ({
    ...w,
    monthsActive: 0,
    casualties: 0,
    progress: 0,      // strategic mode: 0-100 toward the objective
    status: "active",
  }));
  return { mode: scenario.war, wars, weariness: wars.length ? 18 : 0, peaceTalks: null };
}

export const ORDERS = [
  { id: "escalate", label: "Escalate", desc: "Send more. Faster progress, more casualties, and the clock speeds up." },
  { id: "hold", label: "Hold", desc: "Maintain the current posture and absorb the monthly cost." },
  { id: "draw_down", label: "Draw down", desc: "Reduce the footprint. Fewer losses, slower progress." },
  { id: "withdraw", label: "Withdraw", desc: "Leave. Ends the casualties immediately and hands the outcome to whoever stays." },
  { id: "negotiate", label: "Open talks", desc: "Strategic mode only. Trade progress for a settlement.", strategicOnly: true },
];

/** Read a president's own words for an order, so war responds to policy text. */
export function inferOrders(text) {
  const t = String(text || "").toLowerCase();
  const orders = {};
  if (/\b(withdraw|pull out|bring them home|end the war|leave)\b/.test(t)) orders.default = "withdraw";
  else if (/\b(surge|escalate|reinforce|send more|double down|more troops)\b/.test(t)) orders.default = "escalate";
  else if (/\b(draw down|reduce|scale back|fewer troops|drawdown)\b/.test(t)) orders.default = "draw_down";
  else if (/\b(negotiat|peace talks|ceasefire|settlement|armistice)\b/.test(t)) orders.default = "negotiate";
  return orders;
}

const ORDER_FX = {
  escalate:  { troops: 1.35, progress: 9,  casualtyRate: 1.6, weariness: 3.5 },
  hold:      { troops: 1,    progress: 3,  casualtyRate: 1,   weariness: 1.6 },
  draw_down: { troops: 0.72, progress: 1,  casualtyRate: 0.6, weariness: 0.6 },
  withdraw:  { troops: 0,    progress: 0,  casualtyRate: 0.2, weariness: -2 },
  negotiate: { troops: 0.9,  progress: 2,  casualtyRate: 0.7, weariness: -1 },
};

/**
 * One month of every active war. Returns the events worth telling the player
 * about, and mutates `next` with the cost.
 */
export function tickDeployments(next, policyText) {
  const dep = next.deployments;
  if (!dep || !dep.wars.length) return [];

  const strategic = dep.mode === "strategic";
  const inferred = inferOrders(policyText).default || "hold";
  const events = [];

  for (const war of dep.wars) {
    if (war.status !== "active") continue;

    let order = inferred;
    if (order === "negotiate" && !strategic) order = "hold";
    const fx = ORDER_FX[order];
    const r = seeded(`${next.scenario.presidentName}|${war.id}|${next.month}`);

    war.monthsActive += 1;
    war.troops = Math.round(war.troops * fx.troops);

    // Casualties scale with how many are there and how hot it is.
    const monthly = Math.round((war.troops / 1000) * war.intensity * 0.45 * fx.casualtyRate * (0.6 + r.next()));
    war.casualties += monthly;
    dep.weariness = clamp(dep.weariness + fx.weariness + monthly / 260);

    if (strategic) {
      war.progress = clamp(war.progress + fx.progress * (0.6 + r.next() * 0.8));
    }

    if (order === "withdraw" || war.troops < 500) {
      war.status = "withdrawn";
      war.troops = 0;
      events.push({ war: war.name, kind: "withdrawn",
        detail: `You ended the deployment. ${war.casualties.toLocaleString()} casualties over ${war.monthsActive} months, and the outcome now belongs to whoever is still standing there.` });
      next.approval = clamp(round1(next.approval + (dep.weariness > 55 ? 2.4 : -1.6)));
      next.stakeholders.pentagon = clamp(next.stakeholders.pentagon - 8);
      continue;
    }

    if (strategic && war.progress >= 100) {
      war.status = "won";
      war.troops = Math.round(war.troops * 0.2);
      events.push({ war: war.name, kind: "objective_met",
        detail: `The objective was met: ${war.objective.toLowerCase()}. The bulk of the force comes home.` });
      next.approval = clamp(round1(next.approval + 4));
      next.stakeholders.pentagon = clamp(next.stakeholders.pentagon + 10);
      continue;
    }

    if (order === "negotiate" && strategic) {
      dep.peaceTalks = dep.peaceTalks || { war: war.id, months: 0 };
      dep.peaceTalks.months += 1;
      // Talks land faster from a position of strength.
      if (dep.peaceTalks.months >= 3 && r.between(1, 100) <= 30 + war.progress / 2) {
        war.status = "settled";
        war.troops = 0;
        dep.peaceTalks = null;
        events.push({ war: war.name, kind: "settled",
          detail: "A negotiated settlement was signed. Nobody calls it a victory and nobody calls it a defeat." });
        next.approval = clamp(round1(next.approval + 3));
        dep.weariness = clamp(dep.weariness - 20);
        continue;
      }
    }

    events.push({
      war: war.name, kind: order, troops: war.troops, casualties: monthly,
      detail: `${monthly.toLocaleString()} casualties this month with ${war.troops.toLocaleString()} deployed.` +
        (strategic ? ` Progress toward the objective: ${Math.round(war.progress)}%.` : ""),
    });
  }

  // War-weariness is a straight drag on a president, every single month.
  if (dep.weariness > 40) {
    next.approval = clamp(round1(next.approval - (dep.weariness - 40) / 22));
  }
  dep.weariness = clamp(dep.weariness - 0.7); // memory fades slowly
  return events;
}

export function deploymentsSummary(state) {
  const dep = state.deployments;
  if (!dep || !dep.wars.length) return "";
  const active = dep.wars.filter((w) => w.status === "active");
  if (!active.length) return `No active deployments. War-weariness ${Math.round(dep.weariness)}/100.`;
  return active
    .map((w) => `${w.name}: ${w.troops.toLocaleString()} deployed, ${w.casualties.toLocaleString()} total casualties, ${w.monthsActive} months`)
    .join("; ") + `. War-weariness ${Math.round(dep.weariness)}/100.`;
}
