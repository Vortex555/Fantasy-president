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
- **Congress** (House & Senate) with a midterm shake-up at month 24
- **Three-slant press** — left, center and right outlets spin the same policy
- **Focus-group voices** — invented voters from across the country react in their own words
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

### Keeping the cost down (how a free tier is even possible)

Depth doesn't have to mean a huge AI bill. This build uses the same levers a
real free-to-play version would:

- **Most systems are code, not AI.** Congress vote math, whether the Court
  strikes a policy down, the economy, the electoral map and stakeholder
  bookkeeping are deterministic game logic in `gameEngine.js`. The expensive
  model is used once per month to judge your policy and narrate the fallout.
- **A cheap-model tier.** Advisor chat and opening crises run on **Haiku**
  (`FP_CHAT_MODEL`) — 5–25× cheaper than the main model — so the many small
  calls barely register.
- **Prompt caching.** The large rules prompt is identical every turn, so it's
  marked `cache_control: ephemeral` and billed at ~10% on repeat turns.
- **Short, structured output.** Turns return compact JSON, keeping the
  expensive output tokens small.

Net effect: a full monthly turn is a fraction of a cent to a few cents, and an
entire capped free game costs pennies — which is exactly how a site like the
original can offer a (rate-limited) free mode and let subscriptions cover it.

## How a turn works

1. You're shown the month's **situation** (a crisis, an opportunity, a quiet month).
2. You write a **policy** — and optionally a **public message / spin**.
3. The server sends your current dashboard state + the situation + your policy to
   the simulation engine, which returns structured consequences: an approval
   swing, economic movement, stakeholder shifts, three newspaper front pages, a
   focus group, state-level effects, and **next month's situation**.
4. The dashboard updates and the ripple carries forward — decisions compound.

## Project structure

```
src/
  server.js      Express server + API (/api/meta, /api/start, /api/turn, /api/advisor)
  claude.js      Anthropic integration: turn simulation (Opus, cached) + advisor chat (Haiku)
  gameEngine.js  Game state, checks & balances, cabinet, elections, local-sim fallback
  states.js      50 states + DC: electoral votes, tile-map layout, partisan lean
public/
  index.html     Setup, dashboard, situation room, consequences, chat modal, legacy screen
  styles.css     Presidential dark theme
  app.js         Client rendering, dashboard, US tile-map, advisor chat, turn flow
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
| `FP_MODEL` | `claude-opus-4-8` | Override the model. |
| `PORT` | `3000` | Server port. |

## License

MIT
