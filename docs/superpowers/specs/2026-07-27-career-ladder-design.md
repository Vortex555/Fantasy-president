# The Career Ladder — Design

**Date:** 2026-07-27
**Status:** Approved for planning
**Sub-project:** 1 of ~7 — the ladder mechanism. Each future rung is its own spec.

## The idea

One continuous political career that spans offices. You hold a seat, and at the
end of a term you may run again, reach for something higher, or retire. Your
record, your fame, your money and your party's opinion of you follow you between
offices. Reaching past a rung is never blocked — it is simply hard, because the
four things you carry are the four things a stranger does not have.

## Why this is sub-project 1

The eventual goal is a full ladder — school board, city council, mayor, state
legislature, statewide office, governor, US House, US Senate, President — with
every rung as deep as the existing House mode. That is six or seven separate
games, each roughly the size of `house.js` + `committees.js` + a floor UI + its
tests. One spec covering all of it would be fiction.

The ladder *mechanism* is separable from any individual rung, and every rung is
a dead end without it. It can be built and played against the three offices that
already exist, and each office added later plugs into it rather than changing
it. So it goes first.

## Scope

**In:** the career envelope; the four carried assets; the ladder table and
calendar; ballot collision; constitutional age gates; the campaign screen for a
reach; race scoring; the wilderness; migration of existing saves.

**Out, deliberately:** new offices of any kind; party switching; cabinet posts
as career capital; changing how any existing office plays month to month.

## Decisions taken

| Question | Decision |
|---|---|
| Depth of future rungs | Full game at every rung — hence the decomposition above |
| What carries between offices | All four: record, recognition, money, party standing |
| Cost of reaching | Surrender the seat **only** when the ballots collide |
| Losing a reach | The wilderness — the career continues out of office, and a comeback is possible |
| Ceremony of a campaign | One decision screen and a factor breakdown; the full presidential campaign stays special |
| Starting rung | Start at any office, as today — but a career started at the top arrives with none of the four assets |
| Architecture | A career envelope alongside the office state (approach A) |

## Architecture

A save becomes `{ career, state }`. `state` is exactly what each office builds
today and is not restructured. `career` is the portable layer.

Rejected alternatives: unifying the three state shapes (touches every file,
risks every test, buys nothing); a meta-game owning the office games as
sub-sessions (each mode would have to become callable and return a summary —
plumbing for no player-visible gain).

### The envelope

```js
career = {
  id, name, party, gender, ideologyAxis, birthYear,
  year,                                    // the career's calendar
  status,                                  // "in-office" | "wilderness" | "retired"

  offices: [
    { office: "house", seat: "OH-6", stateName: "Ohio",
      terms: 3, from: 2025, to: 2031, rank: "chair",
      ending: "sought-higher",             // re-elected | unseated | sought-higher | retired
      verdict: { score: 61, title: "An Effective Member" } },
  ],

  record: { votes: [], bills: [], confirmations: [] },
  recognition: { national: 8, states: {}, districts: {} },
  warChest: 0,                             // $M
  standing: 50,                            // the party establishment's view
}
```

**The record is not duplicated.** While an office is held, its votes live where
they live today — `state.voteLog`. Only when an office *ends* is that record
folded into `career.record`, each entry tagged with the office it was cast in.
One source of truth at any moment; the archive grows only at transitions. A
twenty-year House career is roughly 240 vote objects (~30KB), comfortable inside
`localStorage` alongside the twelve saves the game already keeps.

**Consequence for scoring.** A reach happens *before* the current office has
ended, so its votes are still in `state.voteLog` and not yet in the archive.
Anything reading "the record" — the campaign screen, race scoring, the verdict —
must read the concatenation of `career.record.votes` and the live
`state.voteLog`. A single helper, `fullRecord(career, state)`, is the only
supported way to ask, so no caller can accidentally see half a career.

**`standing` versus `leadership`.** They are different numbers with different
lifetimes. `state.leadership` is how your caucus in *this chamber* rates you,
month to month, and it already exists. `career.standing` is what the national
party establishment thinks of you, and it changes rarely. On folding, the
office's final `leadership` moves `standing` toward itself by 40% — a career of
loyalty compounds, one bad term does not erase it.

## The four carried assets

### 1. The record

Every vote, bill and confirmation, tagged with the office. At a reach it becomes
opposition research, scored against the *new* constituency: votes that suit the
larger electorate help, votes that do not are drag. A member who voted their
district for six years finds those same votes read back to them statewide.

### 2. Recognition, geographically

The reason skipping is hard, with no difficulty knob involved. Held per
district, per state, and nationally.

- Holding a seat earns recognition in its own constituency. Starting value on
  first election is 55, rising ~6 a term and ~8 per rung of rank held, capped at
  95 — an incumbent is known at home, and a Speaker is known at home by
  everybody.
- **Converting downward-to-upward** uses apportionment the game already has.
  A district converts to its share of the state: `houseRaces` apportions
  districts per state from real electoral votes, so a district is worth about
  `1 / districtsInState` of statewide fame, times a transfer factor of ~0.8 for
  neighbouring media spill.
- A state converts to national at roughly `stateEV / 538`, same transfer.
- **National recognition is also earned directly**, and this is the shortcut
  worth playing for: a gavel, a vote on impeachment, a bill that passed with
  your name on it, a Supreme Court confirmation you decided.

Three terms in a fifteen-district Ohio therefore buys roughly 5% statewide —
which is why a House member reaching for the Senate is a stranger asking for a
promotion, and why the war chest exists.

### 3. Money and donors

A war chest that follows you. Leadership standing converts to leadership PAC
money, so voting the party line buys the thing you need to run for the next
seat — which is the same trade the House mode is already built on. Spending uses
the existing `spendEffect` (square-root returns divided by constituency size).

### 4. The party's opinion

`standing` decides whether the establishment clears the field or recruits
somebody against you. Below a threshold, a reach means a contested primary
before you ever meet the other party.

## The ladder

A table, so later rungs are additions rather than rewrites:

```js
const LADDER = [
  { id: "house",     title: "US Representative", termYears: 2, constituency: "district" },
  { id: "senate",    title: "US Senator",        termYears: 6, constituency: "state"    },
  { id: "president", title: "President",         termYears: 4, constituency: "nation"   },
];
```

Nothing is blocked by rung height. The four assets decide survivability.

### The calendar

Real, and already computable from what exists. Presidential elections fall on
years divisible by four; midterms on the even years between; the whole House
every even year; a third of the Senate each cycle via the existing `senateCycle`
and `senateRaces`. Every era start year in the game (1949, 1961, 1993, 2001,
2013, 2025) sits correctly against this.

### Ballot collision

Surrender the seat **only** when the office wanted shares a ballot with the seat
held:

| Situation | Collides |
|---|---|
| House → Senate | Always — both on the same even year. All or nothing. |
| Senator, year 2 of 6 → President | No. Keeps the seat, risks only time. |
| Senator whose class is up → President | Yes. |
| Governor mid-term → President | No — which is why governors run so often. |

### Age

Constitutional minimums are honoured: 25 for the House, 30 for the Senate, 35
for the presidency. `birthYear` comes from the character profile's age at
creation and advances with the career calendar, so a young member can be locked
out of a seat their polling would otherwise win.

## Running for it

One screen, reached at a term boundary when you declare.

- **The opponent is drawn from the world, not invented.** `governors.js` builds
  fifty named governors with ambition and mandate; `primary.js` already produces
  challengers. A Senate race against a governor you have watched on the map for
  six years is the ladder paying off.
- **The four factors are shown** before you commit: recognition gap, record,
  money, establishment.
- **You choose what to run on**: your record, their record, or the office you
  are leaving.
- **You commit money** across the constituency.
- Then the primary if the party is not with you, then the general.

### Scoring

Returns the same shape `runReelection` already returns — `{ margin, won, … }`
with a named contribution per factor — so the existing election screen renders
it as factor bars with no new UI concepts.

Contributions (starting values, to be tuned in implementation):

| Factor | Source |
|---|---|
| Ground | Partisan lean of the constituency, as today |
| Recognition | `(yours − theirs) × 0.12` |
| Record | Drag per vote that is off-message for the new electorate |
| Money | Existing `spendEffect` |
| Establishment | `(standing − 50) × 0.08`, and a primary below the threshold |
| Wave | Existing `nationalEnvironment` |
| Incumbency | Only when the ballots did not collide |

## The wilderness

Out of office, time moves a year at a time. Each year offers a small number of
real choices:

| Choice | Effect |
|---|---|
| Lobbying | Money up, standing up, record permanently tainted |
| Cable news | Recognition holds and hardens toward your side |
| Nonprofit / teaching | Recognition decays, reputation stays clean |
| The party circuit | Standing recovers fastest, money slowest |
| Nothing | Everything decays |

Baseline drift per year: recognition ×0.8, war chest ×0.75, standing pulled
toward 50 by 0.15. The party also re-rates you on *how* you left — a loyal
soldier who lost a brutal race is owed something; a maverick who lost is
finished.

Each year the game shows what is on the next ballot and whether you can reach
it. Retiring closes the record and writes the verdict.

## Integration

1. **`src/career.js`** — new. Envelope, ladder table, calendar, collision,
   recognition maths, folding an office into the archive.
2. **`src/ladderRace.js`** — new. Scores a race in the existing factor shape.
3. **`createGame`** — accepts an optional `career` and seeds the new office from
   it, so a Senate career reached from three House terms starts warmer than a
   stranger's.
4. **The one real hook:** the term-boundary branch in `advanceHouseMonth`,
   `advanceSenateMonth` and the presidential term end. Today it is "re-elect or
   end"; it becomes "re-elect, reach, or retire". Nothing *inside* a term
   changes, and the presidential game's own month-46 campaign — debates, the
   spending map, the fifty-one calls — is untouched. A sitting president seeking
   re-election plays exactly what they play today.

   A seat you vacate to reach is filled by somebody else, drawn from the same
   roster the world is already built from. It is not held open, and running for
   it again later means unseating whoever took it.
5. **Client** — a "What next?" screen at term boundaries, a wilderness screen,
   and a careers list that can display a career spanning offices.

### Migration

Existing saves are a bare `state` with no envelope. On load, a save without a
`career` is wrapped in one synthesised from the state it has — office, seat,
terms served, and whatever record is present. Nothing already played is lost,
and any current career can begin climbing from where it stands.

## Testing

- Recognition conversion: a district converts to its apportioned share of the
  state; a state to its EV share of the nation.
- The collision truth table, all four rows.
- Constitutional age gates at each rung.
- A stranger loses a Senate race to a well-known governor; a three-term veteran
  with money and establishment backing beats the same governor.
- Wilderness decay, and a comeback that succeeds.
- Folding an office into the career preserves every vote, tagged.
- Migration: an existing single-office save loads, plays, and can reach.
- Determinism: the same career and the same seed produce the same race.

## Success criteria

- A House career can reach for the Senate, lose, spend two years in the
  wilderness, and win a comeback — as one continuous save.
- Starting a fresh Senate career and reaching one from three House terms produce
  visibly different races, and the difference is legible on the factor bars.
- No existing save breaks, and no office plays differently month to month.
