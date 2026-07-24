import { seeded, clamp, round1 } from "./rng.js";

/**
 * Covert operations.
 *
 * Four dials that trade against each other and never all go up at once:
 *   penetration — how far inside the networks you are
 *   pressure    — how hard you are hitting them in their havens
 *   homeland    — how hardened the target at home is
 *   exposure    — how close the whole thing is to being on a front page
 *
 * Pressure without penetration produces martyrs. Penetration without pressure
 * produces excellent intelligence about an attack you did not stop. Every
 * action raises exposure, and an exposed programme costs you the allies who
 * were quietly helping.
 */

export const COVERT_ACTIONS = [
  {
    id: "penetrate", label: "Run agents into the networks",
    desc: "Slow, patient recruitment. Buys you warning time and nothing you can announce.",
    fx: { penetration: 9, exposure: 4, pressure: -1 },
  },
  {
    id: "strike", label: "Strike the havens",
    desc: "Direct action against leadership. Visible results, and a recruiting poster for them.",
    fx: { pressure: 12, exposure: 9, penetration: -4 },
  },
  {
    id: "harden", label: "Harden the homeland",
    desc: "Screening, hardening, interagency plumbing. Unglamorous and the reason nothing happens.",
    fx: { homeland: 11, exposure: 2 },
  },
  {
    id: "partners", label: "Work through partners",
    desc: "Let allied services do it. Cheaper, deniable, and only as good as they are.",
    fx: { penetration: 5, pressure: 5, exposure: -3, homeland: 2 },
  },
  {
    id: "go_quiet", label: "Go quiet",
    desc: "Stand the programme down for a month and let the reporting go cold.",
    fx: { exposure: -14, penetration: -3, pressure: -5 },
  },
];

export function buildCovert(scenario) {
  if (!scenario.covert) return null;
  const r = seeded(`${scenario.presidentName}|covert|${scenario.startYear}`);
  return {
    penetration: r.between(28, 48),
    pressure: r.between(30, 50),
    homeland: r.between(35, 55),
    exposure: r.between(10, 25),
    threat: r.between(38, 58),   // how much plotting is actually underway
    lastAction: null,
    log: [],
  };
}

const actionById = (id) => COVERT_ACTIONS.find((a) => a.id === id);

/** Read the president's own words for a covert posture. */
export function inferCovertAction(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(infiltrat|recruit|inform|penetrat|human intelligence|humint|agent)\b/.test(t)) return "penetrate";
  if (/\b(strike|drone|raid|kill|target|eliminate|decapitat)\b/.test(t)) return "strike";
  if (/\b(screen|harden|airport|port security|domestic|watchlist|fusion cent)\b/.test(t)) return "harden";
  if (/\b(allied|partner|liaison|share intelligence|joint operation)\b/.test(t)) return "partners";
  if (/\b(stand down|pause|suspend|go quiet|halt operations)\b/.test(t)) return "go_quiet";
  return null;
}

/**
 * One month of the shadow war. `chosen` is an explicit order from the covert
 * screen; if there isn't one, the month's policy text is read for a posture.
 */
export function tickCovert(next, policyText, chosen) {
  const c = next.covert;
  if (!c) return null;

  const actionId = chosen || inferCovertAction(policyText);
  const action = actionById(actionId);
  const r = seeded(`${next.scenario.presidentName}|covert|${next.month}`);
  const events = [];

  if (action) {
    for (const [k, v] of Object.entries(action.fx)) c[k] = clamp(c[k] + v);
    c.lastAction = action.id;
  } else {
    // Left alone, a programme decays and the story cools.
    c.penetration = clamp(c.penetration - 2);
    c.exposure = clamp(c.exposure - 3);
  }

  // The DNI's competence is worth real points here.
  const dni = next.institutions?.dni;
  const dniBonus = dni && !dni.vacant ? (dni.holder.competence - 60) / 12 : -3;
  c.penetration = clamp(c.penetration + dniBonus * 0.4);

  // Threat grows on its own, faster where you are not looking.
  const growth = 4 - c.pressure / 22 - c.penetration / 30;
  c.threat = clamp(c.threat + growth + r.next() * 2 - 1);

  // A plot matures. Penetration gives warning; homeland decides whether the
  // warning was enough.
  if (c.threat > 62 && r.between(1, 100) <= (c.threat - 55)) {
    const warned = r.between(1, 100) <= c.penetration;
    const stopped = warned && r.between(1, 100) <= c.homeland + 15;

    if (stopped) {
      events.push({ kind: "disrupted",
        detail: "A plot was rolled up before it moved. The country will never hear the details, which is the job." });
      next.approval = clamp(round1(next.approval + 0.6));
      c.threat = clamp(c.threat - 22);
    } else if (warned) {
      events.push({ kind: "near_miss",
        detail: "You had the warning and the homeland was not hard enough to use it. The attack was partially disrupted; the casualties are still real." });
      next.approval = clamp(round1(next.approval - 3.5));
      next.stability = clamp(next.stability - 5);
      c.threat = clamp(c.threat - 14);
    } else {
      events.push({ kind: "attack",
        detail: "A mass-casualty attack got through with no warning at all. There will be a commission, and it will have your name on it." });
      next.approval = clamp(round1(next.approval - 8));
      next.stability = clamp(next.stability - 12);
      next.stakeholders.pentagon = clamp(next.stakeholders.pentagon - 10);
      c.threat = clamp(c.threat - 25);
      c.homeland = clamp(c.homeland + 12); // the country hardens after the fact
    }
  }

  // Exposure is the other way to lose. A leaked programme burns your sources.
  if (c.exposure > 70 && r.between(1, 100) <= c.exposure - 60) {
    events.push({ kind: "leak",
      detail: "The programme leaked. Allied services are suspending cooperation and your sources are going dark." });
    next.approval = clamp(round1(next.approval - 2.6));
    c.penetration = clamp(c.penetration - 18);
    c.exposure = clamp(c.exposure - 30);
    next.stakeholders.civil_rights = clamp(next.stakeholders.civil_rights - 7);
  }

  c.log = [...events.map((e) => ({ month: next.month, ...e })), ...(c.log || [])].slice(0, 10);
  return { action: action?.id || null, events };
}

export function covertSummary(state) {
  const c = state.covert;
  if (!c) return "";
  return `Covert programme — penetration ${Math.round(c.penetration)}, pressure ${Math.round(c.pressure)}, ` +
    `homeland hardening ${Math.round(c.homeland)}, exposure ${Math.round(c.exposure)}, active threat ${Math.round(c.threat)}.`;
}
