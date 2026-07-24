// ---------------------------------------------------------------------------
// Story arcs — the problems that don't go away.
//
// An arc is an unresolved situation that persists across months. The AI judges
// only whether a given month's policy addressed it (0-3); every mechanic below
// — severity, escalation, detonation, scarring — is deterministic game logic so
// it stays cheap, testable, and identical in local-simulation mode.
//
// Lifecycle:  active ──ignored──▶ severity climbs ──▶ detonated ──▶ scarred
//                   └──addressed──▶ severity falls ──▶ resolved
// ---------------------------------------------------------------------------

export const MAX_ACTIVE_ARCS = 4;
export const MAX_SEVERITY = 5;
export const BIRTH_SEVERITY_CAP = 2;

// An arc only starts bleeding once it is genuinely serious; below this the
// pressure is purely the threat of what it is becoming.
export const DRAG_THRESHOLD = 3;
export const DRAG_PER_SEVERITY = -0.3;
export const MAX_ARC_DRAG = -4;
export const SCAR_DRAG = -0.25;

// Verdict the simulation returns for each active arc.
export const ADDRESSED = { IGNORED: 0, GESTURED: 1, ADDRESSED: 2, RESOLVED: 3 };

// Which corner of the country an arc damages when it goes off. `domain` is the
// load-bearing field: it makes detonation land on specific stakeholders and
// states rather than as a shapeless approval hit.
export const ARC_DOMAINS = {
  economy: {
    label: "Economy",
    stakeholders: ["wall_street", "big_business", "labor"],
    states: ["MI", "OH", "PA", "WI", "NV"],
  },
  security: {
    label: "National Security",
    stakeholders: ["pentagon", "civil_rights"],
    states: ["VA", "TX", "CA", "FL", "NC"],
  },
  justice: {
    label: "Law & Justice",
    stakeholders: ["civil_rights", "gun_owners", "faith"],
    states: ["IL", "NY", "GA", "AZ", "MO"],
  },
  social: {
    label: "Society",
    stakeholders: ["faith", "civil_rights", "labor"],
    states: ["TX", "FL", "CA", "TN", "IA"],
  },
  foreign: {
    label: "Foreign Affairs",
    stakeholders: ["pentagon", "big_business", "greens"],
    states: ["WA", "NY", "CA", "SC", "AK"],
  },
  health: {
    label: "Health & Environment",
    stakeholders: ["greens", "labor", "faith"],
    states: ["WV", "LA", "CA", "FL", "KY"],
  },
};

export const DEFAULT_DOMAIN = "social";
export const ARC_DOMAIN_IDS = Object.keys(ARC_DOMAINS);

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round1 = (v) => Math.round(v * 10) / 10;

function clampInt(v, lo, hi, fallback = lo) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return clamp(n, lo, hi);
}

export function normalizeDomain(domain) {
  const key = String(domain || "").toLowerCase().trim();
  return ARC_DOMAINS[key] ? key : DEFAULT_DOMAIN;
}

// Guess a domain from the text of a policy, so an arc spawned by a blocked bill
// damages the area that bill was actually about.
export function inferDomain(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(ally|allies|foreign|diplomat|treaty|nato|sanction|embassy|summit|negotiat|abroad)\b/.test(t)) return "foreign";
  if (/\b(war|troops|military|defense|deploy|strike|terror|nuclear|invade|weapons|border)\b/.test(t)) return "security";
  if (/\b(tax|budget|deficit|spend|stimulus|econom|jobs|wage|trade|market|inflation|bank|debt|tariff)\b/.test(t)) return "economy";
  if (/\b(climate|carbon|emission|drought|pollut|health|medicare|medicaid|hospital|disease|energy|water)\b/.test(t)) return "health";
  if (/\b(court|justice|crime|police|prosecut|legal|constitution|regulation|civil rights|voting)\b/.test(t)) return "justice";
  return DEFAULT_DOMAIN;
}

export function activeArcs(state) {
  return (state?.arcs || []).filter((a) => a.status === "active" || a.status === "detonated");
}

export function scarredArcs(state) {
  return (state?.arcs || []).filter((a) => a.status === "scarred");
}

export function nextArcId(arcs) {
  let max = 0;
  for (const a of arcs || []) {
    const n = Number(String(a?.id || "").replace(/\D/g, ""));
    if (Number.isFinite(n) && n > max) max = n;
  }
  return `arc_${max + 1}`;
}

export function createArc({ id, title, brief, domain, severity, month }) {
  return {
    id,
    title: String(title || "An Unresolved Situation").slice(0, 90),
    brief: String(brief || "").slice(0, 400),
    domain: normalizeDomain(domain),
    severity: clampInt(severity, 1, BIRTH_SEVERITY_CAP, 1),
    bornMonth: month,
    ignoredStreak: 0,
    lastAddressedMonth: null,
    status: "active",
    log: [],
  };
}

// A new arc proposed by the simulation, validated and only accepted if there is
// room. The AI proposes; the engine decides.
export function acceptProposal(arcs, proposal, month) {
  if (!proposal || !proposal.title) return null;
  if (activeArcs({ arcs }).length >= MAX_ACTIVE_ARCS) return null;
  return createArc({
    id: nextArcId(arcs),
    title: proposal.title,
    brief: proposal.brief,
    domain: proposal.domain,
    severity: proposal.severity,
    month,
  });
}

// Legislative defeats read differently depending on what was being attempted,
// so a second blocked bill never produces an arc identical to the first.
const BLOCKED_TITLES = {
  economy: "Your Economic Agenda, Dead on the Floor",
  security: "Your Security Bill, Killed in Committee",
  justice: "Your Justice Bill, Blocked",
  social: "Your Domestic Agenda, Stalled",
  foreign: "Your Foreign Policy Bill, Blocked",
  health: "Your Health Bill, Left for Dead",
};

// Is this exact kind of failure already sitting on the desk? If so the problem
// is already represented and a duplicate arc would just be noise.
function alreadyTracked(arcs, source, domain) {
  return activeArcs({ arcs }).some((a) => a.source === source && a.domain === domain);
}

// A policy that Congress killed or the Court struck down leaves the underlying
// problem sitting there — that is an arc by definition.
export function arcFromChecks(arcs, checks, policy, month) {
  if (activeArcs({ arcs }).length >= MAX_ACTIVE_ARCS) return null;

  if (checks?.court?.status === "struck_down") {
    if (alreadyTracked(arcs, "court", "justice")) return null;
    return {
      ...createArc({
        id: nextArcId(arcs),
        title: "Struck Down, and Still Unsolved",
        brief: "The Court threw out your order, and the problem it was meant to fix is exactly where you left it. Your own party wants to know what the plan is now.",
        domain: "justice",
        severity: 2,
        month,
      }),
      source: "court",
    };
  }

  if (checks?.congress?.status === "blocked") {
    const domain = inferDomain(policy);
    if (alreadyTracked(arcs, "congress", domain)) return null;
    return {
      ...createArc({
        id: nextArcId(arcs),
        title: BLOCKED_TITLES[domain],
        brief: "Your bill died on the floor and nothing has replaced it. The problem it addressed is still out there, and now it has your name on it.",
        domain,
        severity: 2,
        month,
      }),
      source: "congress",
    };
  }

  return null;
}

// A compact block describing every live arc, fed into the turn prompt. This
// doubles as the presidency's memory: the running record of unfinished business.
export function describeArcs(arcs) {
  const live = activeArcs({ arcs });
  if (!live.length) return "ONGOING SITUATIONS: none — your desk is clear of carry-over problems.";
  const lines = live.map((a) => {
    const age = a.monthsActive != null ? a.monthsActive : "";
    const flag = a.status === "detonated" ? " [DETONATED — this blew up and is on the desk NOW]" : "";
    return `- id=${a.id} | severity ${a.severity}/5 | ${ARC_DOMAINS[a.domain].label} | "${a.title}" — ${a.brief}${flag}${age ? ` (running ${age} months)` : ""}`;
  });
  return `ONGOING SITUATIONS (carried over from previous months — judge each one against THIS month's policy):\n${lines.join("\n")}`;
}

function domainDamage(domain, stakeholderHit, stateHit) {
  const d = ARC_DOMAINS[normalizeDomain(domain)];
  const stakeholders = {};
  const states = {};
  for (const id of d.stakeholders) stakeholders[id] = stakeholderHit;
  for (const code of d.states) states[code] = stateHit;
  return { stakeholders, states };
}

function merge(target, source) {
  for (const [k, v] of Object.entries(source)) target[k] = (target[k] || 0) + v;
}

/**
 * Advance every arc by one month.
 *
 * Pure: takes the current arcs and this month's verdicts, returns a brand-new
 * arc list plus the deltas the caller should fold into the game state.
 *
 * @param {object}   input
 * @param {Array}    input.arcs      current state.arcs
 * @param {Array}    input.verdicts  [{ id, addressed: 0-3, note }] from the simulation
 * @param {object}   input.proposal  optional new arc proposed by the simulation
 * @param {object}   input.checks    this turn's checks & balances result
 * @param {string}   input.policy    the policy text (used to domain-tag spawned arcs)
 * @param {number}   input.month     the month being resolved
 */
export function advanceArcs({ arcs = [], verdicts = [], proposal = null, checks = null, policy = "", month = 1 }) {
  const byId = new Map((verdicts || []).filter((v) => v && v.id != null).map((v) => [String(v.id), v]));

  const out = [];
  const events = [];
  const stakeholders = {};
  const states = {};
  let approvalChange = 0;
  let stabilityChange = 0;
  let detonation = null;

  for (const arc of arcs) {
    // Resolved arcs are history; scarred ones are permanent drag.
    if (arc.status === "resolved") {
      out.push(arc);
      continue;
    }
    if (arc.status === "scarred") {
      approvalChange += SCAR_DRAG;
      out.push(arc);
      continue;
    }

    const verdict = byId.get(String(arc.id));
    const addressed = clampInt(verdict?.addressed, 0, 3, 0);
    const note = String(verdict?.note || "").slice(0, 240);
    const monthsActive = month - arc.bornMonth + 1;
    const log = [...arc.log, { month, addressed, note }].slice(-12);

    // --- A detonated arc had its moment last month. However you handled the
    // fallout, it leaves a mark; handling it well only makes the mark smaller.
    if (arc.status === "detonated") {
      const scale = [1, 0.7, 0.4, 0.15][addressed];
      const dmg = domainDamage(arc.domain, Math.round(-8 * scale), Math.round(-4 * scale));
      merge(stakeholders, dmg.stakeholders);
      merge(states, dmg.states);
      approvalChange += round1(-3 * scale);
      out.push({ ...arc, status: "scarred", scarredMonth: month, scarScale: scale, monthsActive, log });
      events.push({
        id: arc.id, title: arc.title, kind: "scarred", severity: arc.severity, domain: arc.domain, note,
        detail: addressed >= 2
          ? "You got your arms around it late, but the damage is done and permanent."
          : "It went off in your hands and you never recovered the ground. The scar is permanent.",
      });
      continue;
    }

    // --- Decisively resolved.
    if (addressed >= ADDRESSED.RESOLVED) {
      approvalChange += round1(0.8 * arc.severity);
      out.push({ ...arc, status: "resolved", resolvedMonth: month, monthsActive, lastAddressedMonth: month, ignoredStreak: 0, log });
      events.push({
        id: arc.id, title: arc.title, kind: "resolved", severity: arc.severity, domain: arc.domain, note,
        detail: `Closed out after ${monthsActive} month${monthsActive === 1 ? "" : "s"}.`,
      });
      continue;
    }

    // --- Meaningfully addressed: the pressure comes off a notch.
    if (addressed === ADDRESSED.ADDRESSED) {
      const severity = arc.severity - 1;
      if (severity <= 0) {
        approvalChange += 0.8;
        out.push({ ...arc, severity: 0, status: "resolved", resolvedMonth: month, monthsActive, lastAddressedMonth: month, ignoredStreak: 0, log });
        events.push({ id: arc.id, title: arc.title, kind: "resolved", severity: 0, domain: arc.domain, note, detail: "Worked down to nothing." });
      } else {
        approvalChange += 0.4;
        out.push({ ...arc, severity, monthsActive, lastAddressedMonth: month, ignoredStreak: 0, log });
        events.push({ id: arc.id, title: arc.title, kind: "eased", severity, domain: arc.domain, note, detail: `Eased to severity ${severity}.` });
      }
      continue;
    }

    // --- Gestured at: buys a month, changes nothing.
    if (addressed === ADDRESSED.GESTURED) {
      out.push({ ...arc, monthsActive, ignoredStreak: 0, log });
      events.push({ id: arc.id, title: arc.title, kind: "holding", severity: arc.severity, domain: arc.domain, note, detail: "Held steady — acknowledged, but not actually dealt with." });
      continue;
    }

    // --- Ignored at maximum severity: it goes off.
    if (arc.severity >= MAX_SEVERITY) {
      const dmg = domainDamage(arc.domain, -12, -5);
      merge(stakeholders, dmg.stakeholders);
      merge(states, dmg.states);
      approvalChange += -6;
      stabilityChange += -7;
      const detonated = { ...arc, status: "detonated", detonatedMonth: month, monthsActive, ignoredStreak: arc.ignoredStreak + 1, log };
      out.push(detonated);
      detonation = { arc: detonated, monthsActive };
      events.push({
        id: arc.id, title: arc.title, kind: "detonated", severity: MAX_SEVERITY, domain: arc.domain, note,
        detail: `Ignored for ${monthsActive} months. It has now forced itself onto your desk.`,
      });
      continue;
    }

    // --- Ignored: it grows.
    const severity = Math.min(MAX_SEVERITY, arc.severity + 1);
    out.push({ ...arc, severity, monthsActive, ignoredStreak: arc.ignoredStreak + 1, log });
    events.push({
      id: arc.id, title: arc.title, kind: "escalated", severity, domain: arc.domain, note,
      detail: severity >= MAX_SEVERITY ? "At breaking point. Ignore it once more and it goes off." : `Escalated to severity ${severity}.`,
    });
  }

  // --- Monthly drag from serious, unresolved problems.
  let drag = 0;
  for (const arc of out) {
    if (arc.status === "active" && arc.severity >= DRAG_THRESHOLD) {
      drag += arc.severity * DRAG_PER_SEVERITY;
    }
  }
  approvalChange += Math.max(MAX_ARC_DRAG, round1(drag));

  // --- Births. Checks & balances first, then the simulation's own proposal.
  const spawned = [];
  const fromChecks = arcFromChecks(out, checks, policy, month);
  if (fromChecks) {
    out.push(fromChecks);
    spawned.push(fromChecks);
  }
  const fromAi = acceptProposal(out, proposal, month);
  if (fromAi) {
    out.push(fromAi);
    spawned.push(fromAi);
  }
  for (const arc of spawned) {
    events.push({
      id: arc.id, title: arc.title, kind: "opened", severity: arc.severity, domain: arc.domain,
      note: arc.brief, detail: "A new situation has opened on your desk.",
    });
  }

  return {
    arcs: out,
    events,
    spawned,
    detonation,
    approvalChange: round1(approvalChange),
    stabilityChange,
    stakeholders,
    states,
  };
}

// The briefing a detonated arc forces into next month's slot, replacing
// whatever fresh crisis the simulation had lined up.
export function detonationEvent(detonation) {
  const { arc, monthsActive } = detonation;
  return {
    title: `${arc.title} — It Blows Up`,
    brief: `${arc.brief} You have left this alone for ${monthsActive} months and it has finally broken open. It is the only thing anyone in Washington is talking about this morning, and there is nowhere left to put it.`,
    fromArc: arc.id,
    detonated: true,
  };
}

// ---------------------------------------------------------------------------
// Local-simulation judging. No model available, so score how much of the arc's
// own language the policy actually engages with. Crude, but every mechanic
// above behaves identically either way.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "your", "with", "that", "this", "have", "has",
  "from", "they", "them", "their", "will", "would", "been", "were", "was", "its", "it's", "into",
  "over", "under", "than", "then", "what", "when", "who", "how", "all", "any", "can", "out", "now",
  "new", "one", "two", "his", "her", "him", "she", "our", "off", "per", "yet", "still", "about",
]);

function keywords(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .split(/[^a-z']+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w))
  );
}

export function mockJudgeArcs(arcs, policyText) {
  const policy = keywords(policyText);
  return activeArcs({ arcs }).map((arc) => {
    const terms = keywords(`${arc.title} ${arc.brief}`);
    if (!terms.size) return { id: arc.id, addressed: 0, note: "No mention of it." };
    let hits = 0;
    for (const t of terms) if (policy.has(t)) hits++;
    const overlap = hits / terms.size;
    const addressed = overlap >= 0.28 ? 3 : overlap >= 0.16 ? 2 : overlap >= 0.06 ? 1 : 0;
    const note = [
      "Went unmentioned this month.",
      "Touched on it, but only glancingly.",
      "Real effort went into this one.",
      "Directly and decisively taken on.",
    ][addressed];
    return { id: arc.id, addressed, note };
  });
}
