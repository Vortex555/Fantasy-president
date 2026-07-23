# 🏛️ Fantasy President

An AI-powered political simulator in the spirit of
[fantasypresidentcareer.com](https://fantasypresidentcareer.com). You take the
oath of office and, each month, respond to an unfolding crisis by **writing a
free-form policy in your own words**. An AI simulation engine then plays out the
consequences across every corner of American politics:

- **National approval** and a **state-by-state map** that shifts with every decision
- **32→8 stakeholder blocs** (Wall Street, Labor, the Pentagon, Environmentalists,
  Gun Owners, Faith Communities…) that reward and punish you
- **A living economy** — GDP, unemployment, inflation, national debt
- **Congress** (House & Senate) with a midterm shake-up at month 24
- **Three-slant press** — left, center and right outlets spin the same policy
- **Focus-group voices** — invented voters from across the country react in their own words
- Elections and a **legacy screen** at the end of the 48-month term

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
  server.js      Express server + API (/api/meta, /api/start, /api/turn)
  claude.js      Anthropic API integration (prompt + JSON parsing)
  gameEngine.js  Game state, turn application, elections, local-sim fallback
  states.js      50 states + DC: electoral votes, tile-map layout, partisan lean
public/
  index.html     Setup, dashboard, consequences, and legacy screens
  styles.css     Presidential dark theme
  app.js         Client rendering, dashboard, US tile-map, turn flow
```

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
