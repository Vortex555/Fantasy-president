# 🏛️ Fantasy President

An AI-powered political simulator in the spirit of
[fantasypresidentcareer.com](https://fantasypresidentcareer.com). You take the
oath of office and, each month, respond to an unfolding crisis by **writing a
free-form policy in your own words**. An AI simulation engine then plays out the
consequences across every corner of American politics:

- **National approval** and a **state-by-state map** that shifts with every decision
- **8 stakeholder blocs** (Wall Street, Labor, the Pentagon, Environmentalists,
  Gun Owners, Faith Communities…) that reward and punish you
- **A living economy** — GDP, unemployment, inflation, national debt
- **Checks & balances with real roll-call votes** — big bills get an actual
  **House and Senate vote tally** (party by party, against the majority
  threshold). Congress can **pass, water down, or block** you depending on who
  controls each chamber, and the **Supreme Court** (a real 6–3 bench you can
  reshape by appointing justices) can **strike down** executive overreach.
- **A cabinet you can talk to — and command.** Before you decide, consult your
  Vice President, Chief of Staff, Attorney General, Treasury Secretary — even
  the First Spouse. Each has a name plus **loyalty** and **competence** scores.
  Competence actually matters: a weak secretary **fumbles the rollout** of
  policies in their domain, so you can **dismiss and replace** underperformers
  (at a political cost) via cabinet direct-orders.
- **A campaign-season finale.** At month 46 you enter re-election: a **live,
  three-round presidential debate** against an AI challenger from the opposing
  party. Win the room to build momentum — your debate performance swings the
  final vote.
- **Problems that don't go away.** Unfinished business becomes an **ongoing
  situation** that sits on your desk month after month. Ignore one and its
  severity climbs; at the top it **detonates**, seizing next month's briefing as
  a full-blown crisis and leaving a **permanent scar** on the stakeholders and
  states it touches. Every month you get a fresh crisis *and* the list of what's
  still festering — urgent versus important, and you only get one policy.
- **Congress** (House & Senate) with a midterm shake-up at month 24
- **Three-slant press** — left, center and right outlets spin the same policy
- **A 30-voter focus group** — a recurring panel of Americans, from a Texas
  rancher to a Boston grad student, each with their own state, politics and
  issues. Every one of them reacts every month; a rotating handful speak in
  their own words. Partisanship is sticky: a committed opponent softens on a
  good month but doesn't switch sides.
- An **election result and legacy screen** at the end of the 48-month term

There are no multiple-choice options. Type any policy you want; vague gestures
play poorly, and every choice can create new problems down the road.

> Everything in the game is fictional and AI-generated for gameplay — it is not
> political prediction or commentary.

## Quick start

```bash
npm install

# Optional but recommended — enable live AI turns:
cp .env.example .env      # then paste your Anthropic API key into .env

npm start                 # → http://localhost:3000
```

Open the URL, set up your president, and take the oath.

### Two modes

| Mode | When | What you get |
|------|------|--------------|
| **Live AI** | `ANTHROPIC_API_KEY` is set | Every situation, consequence, headline and voter quote is generated fresh by Claude (Opus 4.8) reacting to exactly what you wrote. |
| **Local simulation** | no key | A built-in, keyword-driven engine so the game is fully playable offline. Reactions are shallower but the whole loop works. |

The app auto-detects which mode it's in and shows a badge on the title screen.
Get a key at [console.anthropic.com](https://console.anthropic.com/).

### Keeping the cost down

Depth doesn't have to mean a huge AI bill, but the levers that actually matter
are not the obvious ones. These numbers are **measured**, not estimated — every
model call logs its real token usage (`[usage] turn (claude-sonnet-5): in 736,
cached 4378, out 1063`), so a regression shows up in the log rather than on the
bill.

A steady-state monthly turn, measured:

| | tokens | cost |
|---|---|---|
| Judge — fresh input | 736 | $0.0015 |
| Judge — cached prefix | 4,378 | $0.0009 |
| Judge — output | 1,063 | $0.0106 |
| Focus group (Haiku, in + out) | 1,700 | $0.0036 |
| | **per turn** | **~1.7¢** |

**Output tokens dominate.** They bill at 5× input, so everything below is really
about producing less of them:

- **Thinking is disabled on the turn.** Reasoning tokens bill at output rates
  and nothing here reads them. Turning it off cut output from 2,843 to 1,063 —
  a 63% drop with no measurable quality loss, because the worked examples in the
  system prompt already do the calibration that reasoning would.
- **Two models, split by job.** The *judgement* (consequences, checks &
  balances, arc verdicts) runs on Sonnet (`FP_MODEL`); the *flavor* (voter
  quotes, advisor chat, debate rounds, opening crises) runs on Haiku
  (`FP_CHAT_MODEL`) at a fifth the price.
- **A bigger prompt is a cheaper prompt.** Caching has a **4,096-token
  minimum** — below it, `cache_control` is silently inert and you pay full
  price. The rules prompt is deliberately over that line, so the 4,378-token
  prefix bills at ~10% on repeat turns. The room it buys is spent on worked
  examples, which is also what protects quality on the cheaper model. It uses a
  1-hour TTL because players spend minutes writing a policy and a 5-minute
  cache would expire mid-think.
- **Most systems are code, not AI.** Congress vote math, whether the Court
  strikes a policy down, the economy, the electoral map, stakeholder
  bookkeeping, arc escalation and all thirty voter *moods* are deterministic
  logic. The model is only asked for what genuinely needs judgement or prose.
- **The focus group buys words, not people.** All 30 voters react every month
  for free; only a rotating cast of 8 is sent to a model for a written quote.

Net effect: a full 48-month career costs roughly **80 cents** of API usage, and
the local-simulation mode costs nothing at all.

## How a turn works

1. You're shown the month's **situation** (a crisis, an opportunity, a quiet month).
2. You write a **policy** — and optionally a **public message / spin**.
3. The server sends your current dashboard state + the situation + **every
   ongoing situation** + your policy to the simulation engine, which returns
   structured consequences: an approval swing, economic movement, stakeholder
   shifts, three newspaper front pages, a focus group, state-level effects, a
   verdict on each ongoing situation, and **next month's situation**.
4. The dashboard updates and the ripple carries forward — decisions compound.

The engine judges arcs cheaply on purpose: the model returns only `addressed:
0–3` per arc plus at most one new arc, and every mechanic downstream —
escalation, detonation, scarring, the arc cap — is deterministic code in
`arcs.js`. The arc list doubles as the presidency's memory, so the simulation
sees what is still unfixed without replaying 47 turns of history into the prompt.

## Project structure

```
src/
  server.js         Express server + the whole HTTP API
  claude.js         Anthropic integration: the judge (Sonnet) + flavor calls (Haiku)
  gameEngine.js     Game state, checks & balances, cabinet, elections, local-sim fallback
  rng.js            Seeded randomness + numeric helpers shared by every subsystem
  arcs.js           Ongoing situations: severity, escalation, detonation, scars
  personas.js       The 30-voter focus group: roster, mood scoring, speaker rotation
  eventPool.js      Hand-written situations for Classic and Hybrid event generation
  firstLady.js      The East Wing: standing, signature cause, deployments
  institutions.js   Fed, FBI, DNI, Joint Chiefs, Surgeon General — terms and vacancies
  specialActions.js Constitutional amendments and structural reform
  foreign.js        Standing with each region of the world
  society.js        Social Engineering mode: the country behind the polling
  deployments.js    Wars, troop levels, casualties and war-weariness
  covert.js         The intelligence war: penetration, pressure, homeland, exposure
  states.js         50 states + DC: electoral votes, tile-map layout, partisan lean
tests/
  arcs.test.js            Arc lifecycle (`npm test`)
  personas.test.js        Focus-group scoring, rotation and quote merging
  specialActions.test.js  Amendment gating, the franchise, and rule by decree
public/
  index.html         Screen shells; every screen body is rendered by its module
  css/
    tokens.css       Colour, type, radius and layout variables
    base.css         Reset, page frame, type scale, screen router
    components.css   Buttons, cards, option pickers, toggles, meters, badges
    screens.css      Careers, scenario, era, character setup, running mate, turn
    dashboard.css    Dashboard, debate stage, legacy screen, advisor drawer
  js/
    main.js          Screen router and the setup → game handoff
    api.js           Every server call in one place
    store.js         In-memory state + saved careers and presidents (localStorage)
    util.js          DOM, escaping, meters, pickers and month formatting
    data/
      catalog.js     Scenarios, eras, parties, mandates, compositions
      ideologies.js  58 ideologies with spectrum positions and bloc effects
      profile.js     The demographic catalogs and their bloc effects
      settings.js    The rules-of-play rack and the guided-bio questions
      government.js  Congress, the bench and cabinet politics, derived from a seed
      rng.js         Seeded randomness, shared with the server
    careers.js       "Your Careers" — resume, delete, start new
    scenario.js      Scenario and era pickers
    character.js     Character setup
    profile.js       The character-profile section of setup
    settings.js      The rules-of-play section of setup
    bio.js           The guided bio, when Custom Bio is on
    runningmate.js   Vice-presidential picker
    dashboard.js     Dashboard shell: timeline, tiles, Congress, court, cabinet, map
    cards/
      institutions.js  Institutional positions, with appoint and dismiss
      firstLady.js     The East Wing card
      specialActions.js The amendments and structural-reform docket
      chart.js         The approval line
      legislature.js   Chamber rosters, caucuses and the Supreme Court bench
      world.js         Foreign relations, society, war and covert cards
    turn.js          Briefing, policy composer, consequences
    drawer.js        Advisor conversations
    campaign.js      Debate stage and the podium clock
    legacy.js        The historical record
```

## API

| Endpoint | Purpose |
|----------|---------|
| `GET /api/meta` | Mode (AI vs local), state metadata, stakeholder list. |
| `POST /api/start` | Begin a career; returns initial state (incl. cabinet & court) + opening crisis. |
| `POST /api/turn` | Resolve a month; returns consequences (incl. `checks` roll-call + `rollout`) + the new state. |
| `POST /api/advisor` | Chat with a cabinet member — `{ advisorId, message, history }`. |
| `POST /api/cabinet/order` | Cabinet direct-order, e.g. dismiss & replace — `{ advisorId, action }`. |
| `POST /api/debate` | Score one debate round & get the challenger's rebuttal. |
| `POST /api/campaign/finish` | Resolve the campaign into an election result. |

At **month 46** a turn returns a state with `phase: "campaign"` — the client
then runs the debate flow and calls `/api/campaign/finish` to produce the
ending.

The server is stateless — the full game state lives on the client and is sent
with each turn, so you can extend it toward multiple saved careers easily.

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `ANTHROPIC_API_KEY` | – | Enables live AI turns. |
| `FP_MODEL` | `claude-sonnet-5` | The judge: consequences, checks & balances, arc verdicts. Set to `claude-opus-4-8` for maximum depth at roughly 2.5× the cost. |
| `FP_CHAT_MODEL` | `claude-haiku-4-5` | Flavor and chat: voter quotes, advisor conversations, debate rounds, opening crises. |
| `PORT` | `3000` | Server port. |

> Set the key in a `.env` file in the project root — but note that on Node an
> **exported shell variable wins over `.env`**, so unset a stale
> `ANTHROPIC_API_KEY` in your shell first or the file is ignored.

## License

MIT
