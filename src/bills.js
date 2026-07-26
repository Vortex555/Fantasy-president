import { seeded, clamp, round1 } from "./rng.js";
import { buildCongress } from "../public/js/data/government.js";
import { STATES } from "./states.js";
import { vpSupports } from "./succession.js";

/**
 * Bills on your desk.
 *
 * Congress writes legislation near its own centre of gravity, so what lands on
 * your desk is decided by who is actually in the chamber — a House full of
 * syndicalists sends nationalisation bills, a House full of business
 * Republicans sends deregulation. Only bills that clear both chambers reach
 * you, and then you have exactly two options.
 *
 * Vetoing is not free. A bill that passed on a wide margin will be overridden,
 * and an override is a public humiliation that costs more than signing would
 * have. The reason to veto is when the bill itself is worse than the beating.
 */

// A bill's `axis` is its position on the same −1…+1 spectrum as an ideology.
export const BILL_POOL = [
  // --- Left ---------------------------------------------------------------
  { id: "nationalise_rail", axis: -0.92, domain: "economy",
    title: "Rail Nationalisation Act",
    brief: "Takes the freight and passenger networks into public ownership at assessed value, with a federal operating authority.",
    fx: { approval: -1, labor: 14, wall_street: -16, big_business: -14, economy: { debt: 1.4, gdpGrowth: -0.2 } } },
  { id: "wealth_tax", axis: -0.82, domain: "economy",
    title: "Extreme Wealth Tax Act",
    brief: "An annual levy on net worth above fifty million dollars, collected by a new Treasury division.",
    fx: { approval: 1.5, labor: 12, wall_street: -20, big_business: -12, economy: { debt: -1.6 } } },
  { id: "jobs_guarantee", axis: -0.72, domain: "economy",
    title: "Federal Jobs Guarantee",
    brief: "Guarantees a public-option job at a living wage to any adult who wants one, administered through the states.",
    fx: { approval: 2, labor: 16, wall_street: -10, economy: { unemployment: -1.1, debt: 2.2, inflation: 0.4 } },
    society: { poverty: -1.4, unrest: -6 } },
  { id: "green_transition", axis: -0.62, domain: "health",
    title: "National Decarbonisation Act",
    brief: "Sunsets fossil generation on a ten-year clock and funds the replacement grid.",
    fx: { approval: 0.5, greens: 18, labor: -6, big_business: -10, economy: { debt: 1.8, gdpGrowth: -0.2 } } },
  { id: "universal_care", axis: -0.55, domain: "health",
    title: "Universal Coverage Act",
    brief: "Extends federal health coverage to every resident, funded by payroll and premium reform.",
    fx: { approval: 2.5, labor: 12, civil_rights: 8, big_business: -8, economy: { debt: 2.4 } },
    society: { uninsured: -6, lifeExpectancy: 0.4 } },
  { id: "union_rights", axis: -0.48, domain: "economy",
    title: "Organising Rights Restoration Act",
    brief: "Bans captive-audience meetings, permits card-check recognition and penalises retaliatory dismissal.",
    fx: { approval: 0.5, labor: 18, big_business: -12, wall_street: -6 } },
  { id: "voting_rights", axis: -0.42, domain: "justice",
    title: "Voting Access Act",
    brief: "Sets a federal floor for early voting, mail ballots and same-day registration.",
    fx: { approval: 1, civil_rights: 16, faith: -5, gun_owners: -4 } },
  { id: "childcare", axis: -0.35, domain: "social",
    title: "Universal Childcare Act",
    brief: "Caps childcare costs at seven per cent of household income, with federal top-up payments.",
    fx: { approval: 3, labor: 8, faith: 4, economy: { debt: 1.2 } },
    society: { poverty: -0.8 } },
  { id: "housing_supply", axis: -0.18, domain: "social",
    title: "Housing Supply Act",
    brief: "Ties federal transport money to local permitting reform and funds two million new units.",
    fx: { approval: 2, labor: 6, big_business: 6, greens: -5, economy: { debt: 0.9 } },
    society: { homeownership: 1.2 } },

  // --- Centre -------------------------------------------------------------
  { id: "infrastructure", axis: -0.05, domain: "economy",
    title: "Bridges and Ports Act",
    brief: "A decade of federal spending on roads, bridges, ports and water systems, split by formula.",
    fx: { approval: 3.5, labor: 10, big_business: 8, economy: { gdpGrowth: 0.4, debt: 1.6, unemployment: -0.3 } } },
  { id: "chips_research", axis: 0.02, domain: "economy",
    title: "Domestic Manufacturing Act",
    brief: "Subsidises advanced manufacturing onshore, with clawbacks for firms that offshore afterwards.",
    fx: { approval: 2.5, big_business: 10, labor: 8, economy: { gdpGrowth: 0.3, debt: 1.1 } } },
  { id: "veterans_care", axis: 0.08, domain: "security",
    title: "Veterans Care Expansion",
    brief: "Expands service-connected coverage and funds the backlog of pending claims.",
    fx: { approval: 3, pentagon: 12, faith: 5, economy: { debt: 0.6 } } },
  { id: "opioid_response", axis: 0.12, domain: "health",
    title: "Rural Health and Recovery Act",
    brief: "Funds treatment capacity and clinic staffing in counties with no obstetric or addiction services.",
    fx: { approval: 2.5, faith: 8, labor: 6, economy: { debt: 0.7 } },
    society: { lifeExpectancy: 0.3 } },
  { id: "budget_deal", axis: 0.18, domain: "economy",
    title: "Bipartisan Budget Compromise",
    brief: "A two-year deal that keeps the government open and trims discretionary growth.",
    fx: { approval: 1.5, wall_street: 8, big_business: 6, labor: -6, economy: { debt: -1.2 } } },

  // --- Right --------------------------------------------------------------
  { id: "border_enforcement", axis: 0.38, domain: "security",
    title: "Border Enforcement Act",
    brief: "Funds physical barriers, detention capacity and eight thousand additional agents.",
    fx: { approval: 1, gun_owners: 10, faith: 8, civil_rights: -14, economy: { debt: 0.8 } },
    society: { unrest: 5, population: -0.2 } },
  { id: "tax_cuts", axis: 0.45, domain: "economy",
    title: "Growth and Investment Act",
    brief: "Cuts corporate and top marginal rates and makes prior expensing provisions permanent.",
    fx: { approval: 0.5, wall_street: 18, big_business: 16, labor: -10, economy: { gdpGrowth: 0.4, debt: 2.6 } } },
  { id: "deregulation", axis: 0.52, domain: "economy",
    title: "Regulatory Relief Act",
    brief: "Requires two rules repealed for each new one and strips agencies of independent rulemaking.",
    fx: { approval: -0.5, big_business: 16, wall_street: 12, greens: -16, economy: { gdpGrowth: 0.3 } } },
  { id: "defence_buildup", axis: 0.55, domain: "security",
    title: "Defence Modernisation Act",
    brief: "A shipbuilding and munitions expansion with a five-year procurement floor.",
    fx: { approval: 1, pentagon: 18, big_business: 8, economy: { debt: 2.2, gdpGrowth: 0.2 } } },
  { id: "school_choice", axis: 0.6, domain: "social",
    title: "Education Freedom Act",
    brief: "Converts federal education funding into portable accounts families can spend anywhere.",
    fx: { approval: 0, faith: 16, labor: -14, economy: {} },
    society: { literacy: -0.4 } },
  { id: "crime_bill", axis: 0.65, domain: "justice",
    title: "Public Order Act",
    brief: "Mandatory minimums for armed offences and a federal grant programme for police hiring.",
    fx: { approval: 1.5, gun_owners: 12, pentagon: 6, civil_rights: -18 },
    society: { crime: -22, unrest: 4 } },
  { id: "entitlement_reform", axis: 0.72, domain: "economy",
    title: "Entitlement Solvency Act",
    brief: "Raises the retirement age on a schedule and means-tests the upper benefit tier.",
    fx: { approval: -4, wall_street: 14, labor: -16, faith: -6, economy: { debt: -3.2 } },
    society: { poverty: 1.1 } },

  // --- Fringe: only a radicalised chamber writes these ---------------------
  { id: "abolish_fed", axis: 0.88, domain: "economy", fringe: true,
    title: "Federal Reserve Abolition Act",
    brief: "Winds up the central bank and returns monetary authority to Treasury and the states.",
    fx: { approval: -3, wall_street: -24, big_business: -14, gun_owners: 10, economy: { inflation: 2.4, gdpGrowth: -0.8 } } },
  { id: "national_faith", axis: 0.92, domain: "social", fringe: true,
    title: "National Religious Heritage Act",
    brief: "Establishes scriptural instruction in federally funded schools and a national day of observance.",
    fx: { approval: -4, faith: 24, civil_rights: -26, big_business: -8 },
    society: { unrest: 12 } },
  { id: "abolish_income_tax", axis: 0.95, domain: "economy", fringe: true,
    title: "Income Tax Repeal Act",
    brief: "Repeals the federal income tax outright and funds the government from tariffs and excise.",
    fx: { approval: 2, wall_street: 10, big_business: 12, labor: -12, economy: { debt: 5.5, inflation: 1.2 } } },
  { id: "seize_industry", axis: -0.95, domain: "economy", fringe: true,
    title: "Commanding Heights Act",
    brief: "Brings energy, pharmaceuticals and heavy industry under public ownership and workers' councils.",
    fx: { approval: -4, labor: 26, wall_street: -30, big_business: -28, economy: { gdpGrowth: -1.2, debt: 3.4 } },
    society: { unrest: 14 } },
  { id: "max_income", axis: -0.88, domain: "economy", fringe: true,
    title: "Maximum Income Act",
    brief: "Caps total compensation at a fixed multiple of the federal minimum wage.",
    fx: { approval: -1, labor: 22, wall_street: -28, big_business: -22, economy: { gdpGrowth: -0.6 } } },
  { id: "degrowth_act", axis: -0.85, domain: "health", fringe: true,
    title: "Planetary Limits Act",
    brief: "Sets a declining statutory cap on national energy and material throughput.",
    fx: { approval: -6, greens: 26, labor: -14, big_business: -24, economy: { gdpGrowth: -1.6 } } },
];

export const billById = (id) => BILL_POOL.find((b) => b.id === id);

/** How willing a member is to vote for something at `axis`. */
const agreement = (memberAxis, billAxis) => 1 - Math.abs(memberAxis - billAxis) / 2;

// Above this level of agreement a member votes yes. Tuned so a bill written at
// the chamber's own median clears comfortably and one written at the far end
// of the room does not.
const YES_THRESHOLD = 0.78;

/**
 * A full roll call, member by member, on a bill at a given position.
 *
 * `tieBreak` is the Vice President's casting vote, and it only ever applies to
 * a simple majority — an override needs its two thirds on its own, and the
 * Vice President has no vote in it.
 */
export function rollCall(roster, billAxis, { tieBreak = false } = {}) {
  let yes = 0, dYes = 0, rYes = 0;
  for (const m of roster) {
    if (agreement(m.axis, billAxis) < YES_THRESHOLD) continue;
    yes += 1;
    if (m.party === "Democrat") dYes += 1; else rYes += 1;
  }
  const total = roster.length;
  const threshold = Math.floor(total / 2) + 1;
  const passed = yes >= threshold || (tieBreak && yes * 2 === total);
  return {
    yes, no: total - yes, dYes, rYes, total, threshold,
    passed,
    brokenByVp: passed && yes < threshold,
    overrode: yes >= Math.ceil(total * 2 / 3),
    overrideThreshold: Math.ceil(total * 2 / 3),
  };
}

/** Where a chamber's centre of gravity actually sits. */
export function chamberMedian(roster) {
  if (!roster.length) return 0;
  const axes = roster.map((m) => m.axis).sort((a, b) => a - b);
  return axes[Math.floor(axes.length / 2)];
}

const rosterFor = (state) => buildCongress(state, STATES);

/**
 * What Congress sends up this month. Bills are drawn near the House's own
 * median — the chamber writes what the chamber believes — and only those that
 * clear both chambers reach the president's desk.
 */
export function originateBills(state, roster = rosterFor(state)) {
  if (state.congressDissolved) return [];

  const r = seeded(`${state.rosterSeed}|bills|${state.month}`);
  // Roughly half of months bring something; a busy Congress brings two.
  const count = r.chance(0.42) ? 0 : r.chance(0.72) ? 1 : 2;
  if (!count) return [];

  const median = chamberMedian(roster.house);
  const radical = state.scenario?.radicals === true;
  const seen = new Set(state.billHistory || []);

  // Congress can only send what it can actually pass, so the roll call is the
  // filter — not a guess about what the chamber "would" write. Anything that
  // clears both chambers is a candidate; the chamber simply prefers the ones
  // closest to its own centre of gravity.
  const candidates = BILL_POOL
    .filter((b) => (radical || !b.fringe) && !seen.has(b.id))
    .map((bill) => ({
      bill,
      house: rollCall(roster.house, bill.axis),
      senate: rollCall(roster.senate, bill.axis, { tieBreak: vpSupports(state, bill.axis) }),
    }))
    .filter((c) => c.house.passed && c.senate.passed)
    .map((c) => ({ ...c, weight: 1 / (0.12 + Math.abs(c.bill.axis - median)) }));
  if (!candidates.length) return [];

  const out = [];
  for (let i = 0; i < count && candidates.length; i++) {
    const picked = r.weighted(candidates, candidates.map((c) => c.weight));
    candidates.splice(candidates.indexOf(picked), 1);
    const { bill, house, senate } = picked;

    const sponsor = pickSponsor(roster.house, bill.axis, r);
    out.push({
      id: bill.id,
      title: bill.title,
      brief: bill.brief,
      axis: bill.axis,
      domain: bill.domain,
      fringe: Boolean(bill.fringe),
      arrivedMonth: state.month,
      sponsor: sponsor ? `${sponsor.title} ${sponsor.name} (${sponsor.party[0]}-${sponsor.state})` : "a bipartisan group",
      sponsorIdeology: sponsor?.ideology || "",
      house, senate,
    });
  }
  return out;
}

/** The member closest to the bill's politics gets their name on it. */
function pickSponsor(roster, billAxis, r) {
  const near = [...roster]
    .sort((a, b) => Math.abs(a.axis - billAxis) - Math.abs(b.axis - billAxis))
    .slice(0, 12);
  return near.length ? near[Math.floor(r.next() * near.length)] : null;
}

/** Apply a bill's consequences to a state that is about to become law. */
function enact(next, bill) {
  const fx = billById(bill.id)?.fx || {};
  next.approval = clamp(round1(next.approval + (fx.approval || 0)));

  for (const [key, value] of Object.entries(fx)) {
    if (key === "approval" || key === "economy") continue;
    if (next.stakeholders[key] != null) {
      next.stakeholders[key] = clamp(Math.round(next.stakeholders[key] + value));
    }
  }
  if (fx.economy && next.scenario.economy !== false) {
    const e = fx.economy;
    next.economy.gdpGrowth = clamp(round1(next.economy.gdpGrowth + (e.gdpGrowth || 0)), -7, 7);
    next.economy.unemployment = clamp(round1(next.economy.unemployment + (e.unemployment || 0)), 1.5, 25);
    next.economy.inflation = clamp(round1(next.economy.inflation + (e.inflation || 0)), -3, 40);
    next.economy.debt = round1(next.economy.debt + (e.debt || 0));
  }
  const society = billById(bill.id)?.society;
  if (society && next.society) {
    for (const [k, v] of Object.entries(society)) {
      if (next.society[k] != null) next.society[k] = round1(next.society[k] + v);
    }
  }
}

/**
 * Sign it or veto it.
 *
 * Signing a bill your own side hates costs you with them. Vetoing invites an
 * override, and being overridden is worse than either — it is a public
 * demonstration that Congress does not need you.
 */
export function actOnBill(state, billId, action) {
  const bill = (state.bills || []).find((b) => b.id === billId);
  if (!bill) return { rejected: true, note: "No such bill is on your desk." };
  if (action !== "sign" && action !== "veto") return { rejected: true, note: "Sign it or veto it." };

  const next = structuredClone(state);
  next.bills = (next.bills || []).filter((b) => b.id !== billId);
  next.billHistory = [...(next.billHistory || []), billId];
  next.billLog = next.billLog || [];

  if (action === "sign") {
    enact(next, bill);
    next.billLog.unshift({ month: state.month, id: bill.id, title: bill.title, outcome: "signed" });
    return {
      state: next, outcome: "signed",
      note: `You signed the ${bill.title}. It is law.`,
    };
  }

  // A veto. Congress gets its say.
  const roster = rosterFor(state);
  const house = rollCall(roster.house, bill.axis);
  // The casting vote cannot save a veto: an override is a two-thirds question.
  const senate = rollCall(roster.senate, bill.axis, { tieBreak: vpSupports(state, bill.axis) });
  const overridden = house.overrode && senate.overrode;

  if (overridden) {
    enact(next, bill);
    next.approval = clamp(round1(next.approval - 3.5));
    next.stability = clamp(next.stability - 6);
    next.billLog.unshift({ month: state.month, id: bill.id, title: bill.title, outcome: "overridden" });
    return {
      state: next, outcome: "overridden", house, senate,
      note: `Your veto of the ${bill.title} was overridden — ${house.yes}–${house.no} in the House and ` +
        `${senate.yes}–${senate.no} in the Senate. It is law anyway, and everyone watched it happen.`,
    };
  }

  // The veto held. Cheaper, but the sponsors remember.
  next.approval = clamp(round1(next.approval - 0.8));
  next.billLog.unshift({ month: state.month, id: bill.id, title: bill.title, outcome: "vetoed" });
  return {
    state: next, outcome: "vetoed", house, senate,
    note: `You vetoed the ${bill.title} and the override failed — ${house.yes} of ${house.overrideThreshold} ` +
      `needed in the House. It is dead.`,
  };
}

/** Bills left unsigned for too long: Congress moves on and you look passive. */
export function ageBills(next) {
  const bills = next.bills || [];
  if (!bills.length) return [];
  const expired = bills.filter((b) => next.month - b.arrivedMonth >= 3);
  if (!expired.length) return [];

  next.bills = bills.filter((b) => next.month - b.arrivedMonth < 3);
  next.approval = clamp(round1(next.approval - 0.6 * expired.length));
  next.billHistory = [...(next.billHistory || []), ...expired.map((b) => b.id)];
  return expired;
}

/** A line for the AI's context block. */
export function billsSummary(state) {
  const bills = state.bills || [];
  if (!bills.length) return "";
  return `Bills awaiting your signature: ${bills.map((b) =>
    `${b.title} (passed ${b.house.yes}–${b.house.no} House, ${b.senate.yes}–${b.senate.no} Senate)`).join("; ")}.`;
}
