import { round1 } from "./rng.js";

/**
 * What the histories say.
 *
 * A career now generates a great deal of record — elections fought, situations
 * closed or left to scar, a Constitution amended or bent, statehouses courted
 * or crushed — and the closing screen used to show almost none of it. This is
 * the verdict on all of it: deterministic, specific, and willing to be rude.
 *
 * The rule is that every line has to point at something the player actually
 * did. A verdict that could be pasted onto any presidency is not a verdict.
 */

const START = { gdpGrowth: 2.4, unemployment: 4.1, inflation: 3.0 };

const RANKS = [
  { at: 78, title: "Transformative", note: "A presidency the country is still arguing about, and still living inside." },
  { at: 62, title: "Consequential", note: "You changed things. Not all of them on purpose, but you changed them." },
  { at: 48, title: "Competent", note: "The country was handed back in working order. That is rarer than it sounds." },
  { at: 34, title: "Forgettable", note: "A presidency that happened. The histories will be short." },
  { at: 20, title: "Damaging", note: "The country spent years undoing this." },
  { at: 0, title: "Catastrophic", note: "A cautionary tale, taught to schoolchildren." },
];

/**
 * The verdict, as a score out of 100 and the evidence for it.
 *
 * Approval is deliberately a minority of the total. A president who was liked
 * and fixed nothing scores below one who was hated and closed out four crises,
 * because that is how history actually works.
 */
export function historicalVerdict(state) {
  const findings = [];
  const ending = state.ending?.type;
  let score = 50; // an ordinary presidency starts here and argues its way out

  // --- What was actually resolved
  const arcs = state.arcs || [];
  const resolved = arcs.filter((a) => a.status === "resolved").length;
  const scarred = arcs.filter((a) => a.status === "scarred").length;
  const open = arcs.filter((a) => a.status === "active" || a.status === "detonated").length;

  score += resolved * 5 - scarred * 6 - open * 2.5;
  if (resolved) findings.push({ good: true, text: `Closed out ${resolved} situation${resolved === 1 ? "" : "s"} that could have defined the term.` });
  if (scarred) findings.push({ good: false, text: `Let ${scarred} problem${scarred === 1 ? "" : "s"} detonate. The damage was permanent.` });
  if (open) findings.push({ good: false, text: `Left ${open} still open on the desk for a successor.` });

  // --- The country's condition
  const eco = state.economy || START;
  const misery = (eco.unemployment - START.unemployment) + (eco.inflation - START.inflation);
  score -= misery * 1.5;
  if (misery <= -2) findings.push({ good: true, text: `Handed over a materially better economy — unemployment ${eco.unemployment}%, inflation ${eco.inflation}%.` });
  else if (misery >= 4) findings.push({ good: false, text: `Unemployment and inflation both worse than you found them.` });

  // --- Standing
  const approval = state.approval ?? 50;
  score += (approval - 50) * 0.35;
  const peak = Math.max(approval, ...(state.history || []).map((h) => h.approval ?? 0));
  if (peak - approval > 25) findings.push({ good: false, text: `Peaked at ${Math.round(peak)}% and finished at ${Math.round(approval)}%. The country fell out of love with you in public.` });

  // --- Elections
  const won = (state.elections || []).length;
  score += won * 8;
  if (won) findings.push({ good: true, text: `Won ${won} national election${won === 1 ? "" : "s"} as a sitting president.` });

  for (const m of state.midterms || []) {
    const net = (m.houseSwing || 0) + (m.senateSwing || 0);
    if (net <= -30) {
      score -= 5;
      findings.push({ good: false, text: `The midterms were a rout — ${Math.abs(m.houseSwing)} House seats gone in a night.` });
    } else if (net > 0) {
      score += 5;
      findings.push({ good: true, text: `Gained seats at a midterm, which almost no president manages.` });
    }
  }
  if (state.primaryResult) {
    if (state.primaryResult.won) {
      score += 3;
      findings.push({ good: true, text: `Survived a challenge from inside your own party and was renominated.` });
    }
  }

  // --- The institutions you were lent
  const ledger = state.specialActions || {};
  if (state.congressDissolved) {
    score -= 45;
    findings.push({ good: false, text: `Dissolved Congress. Whatever else is written, this is the first line of it.` });
  }
  if ((ledger.passed || []).includes("expand_court")) {
    score -= 12;
    findings.push({ good: false, text: `Packed the Supreme Court, and every president since has been asked whether they would do it again.` });
  }
  if (state.electorate?.excluded) {
    score -= 30;
    findings.push({ good: false, text: `Took the vote from part of the country. The republic did not fully recover.` });
  }
  if (state.twentyFifthSurvived) {
    score -= 6;
    findings.push({ good: false, text: `Your own cabinet tried to remove you as unfit, and ${state.twentyFifthSurvived > 1 ? `${state.twentyFifthSurvived} times` : "once"} failed.` });
  }
  if ((state.jeopardy?.acquittals || 0) > 0) {
    score -= 6;
    findings.push({ good: false, text: `Impeached and acquitted. You kept the office and the asterisk.` });
  }
  if ((ledger.passed || []).length && !state.congressDissolved) {
    const count = ledger.passed.length;
    score += count * 4;
    findings.push({ good: true, text: `Amended or restructured the Constitution ${count} time${count === 1 ? "" : "s"} — few presidents change the rules themselves.` });
  }

  // --- The states
  const defiance = Object.values(state.governors || {});
  if (defiance.length) {
    const avg = defiance.reduce((a, b) => a + b, 0) / defiance.length;
    const revolt = defiance.filter((d) => d >= 80).length;
    if (revolt >= 12) {
      score -= 8;
      findings.push({ good: false, text: `${revolt} statehouses ended the term in open revolt against Washington.` });
    } else if (avg <= 30) {
      score += 5;
      findings.push({ good: true, text: `Left the states co-operating with the federal government, which is not the usual state of affairs.` });
    }
  }

  // --- Legislation
  const signed = (state.billLog || []).filter((b) => b.outcome === "signed").length;
  const overridden = (state.billLog || []).filter((b) => b.outcome === "overridden").length;
  if (signed >= 6) { score += 4; findings.push({ good: true, text: `Signed ${signed} acts of Congress into law.` }); }
  if (overridden >= 2) { score -= 5; findings.push({ good: false, text: `Was overridden ${overridden} times. Congress learned it did not need you.` }); }

  if (ending === "removed" || ending === "incapacitated") { score -= 20; }
  if (ending === "primaried") { score -= 10; }
  if (ending === "autocrat") { score -= 40; }

  const final = Math.max(0, Math.min(100, Math.round(score)));

  // Some endings are not a point on a scale. A president removed by the Senate
  // and a president who abolished Congress both score near zero, and calling
  // them the same thing tells the player nothing.
  const rank = state.congressDissolved || ending === "autocrat"
    ? { title: "The Republic Did Not Survive You", note: "There was no election, because there was nobody left to call one." }
    : ending === "removed" || ending === "incapacitated"
      ? { title: "Removed from Office", note: "You did not finish. The machinery the Constitution provides for was used, and it worked." }
      : ending === "primaried"
        ? { title: "Denied the Nomination", note: "Your own party ended this before the country got the chance." }
        : RANKS.find((r) => final >= r.at) || RANKS[RANKS.length - 1];

  return {
    score: final,
    title: rank.title,
    summary: rank.note,
    // Strongest evidence first, and always show both sides where both exist.
    findings: [
      ...findings.filter((f) => f.good),
      ...findings.filter((f) => !f.good),
    ].slice(0, 8),
    resolved, scarred, open,
    terms: state.term || 1,
  };
}
