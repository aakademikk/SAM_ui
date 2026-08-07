# SAM — Core Dashboard Module

Command console for **SAM (Seriously Awesome Machine)**: a direct, sarcastic, brutally
honest executive AI supervisor. Agent fleet supervision, persistent vault memory,
host telemetry, delivery tracking, finance, and a raw command surface — rendered as a
data-dense neon-cyberpunk HUD over a live Three.js neural mesh.

```bash
npm install
npm run dev      # http://localhost:3000
npm run build
npm run typecheck
```

Next.js 15 (App Router) · React 19 · TypeScript strict · Tailwind CSS v4 ·
Zustand 5 · @dnd-kit · @react-three/fiber + drei · Framer Motion.

---

## Architecture

```
src/
├── app/
│   ├── layout.tsx · page.tsx · globals.css      design tokens, ambient themes, keyframes
│   └── api/
│       ├── dashboard/{insights,agents,vault,projects,system,finance,tasks,layout}
│       ├── terminal/                            allow-listed command execution
│       └── chat/                                streaming replies (text/plain chunks)
├── components/
│   ├── background/ParallaxBackground.tsx        neural mesh + data-city skyline + camera rig
│   ├── chat/{AIChatPanel,SamEye}.tsx            omnipresent panel + HAL-lineage optical assembly
│   ├── dashboard/
│   │   ├── DashboardShell.tsx                   data lifecycle, preference → document bridge
│   │   ├── StatCardGrid.tsx                     dnd-kit grid, 4 footprints, dense flow
│   │   ├── WidgetFrame.tsx                      glass shell, ellipsis size menu, hover glow
│   │   ├── TopBar.tsx · ControlDeck.tsx         live estate readout + settings
│   │   ├── widgetRegistry.tsx                   id → component/icon/tone map
│   │   └── widgets/                             the eight widgets
│   └── ui/                                      Sparkline, Gauge, Meter, Skeleton, Indicators
├── lib/
│   ├── personalityEngine.ts                     SAM's voice — every AI string passes through
│   ├── dashboardService.ts                      typed client, retry/timeout/abort/validation
│   ├── utils.ts                                 math, formatting, seeded PRNG, coercion
│   └── server/{telemetry,commands,respond}.ts   estate simulator, interpreter, envelopes
├── store/{userPreferencesStore,dashboardStore}.ts
├── hooks/useLiveClock.ts
└── types/dashboard.ts                           the contract between client and API
```

### The personality engine

`personalityEngine.ts` is the product; the token source is an implementation detail.
The analytical layer emits neutral facts, and this layer decides how brutally they are
delivered.

- **Deterministic.** Line selection is seeded by stable content hashes (FNV-1a), so
  server and client render identical text and a given insight keeps its voice across
  re-renders.
- **Layered.** `sarcasm: 0` strips the editorial entirely and returns clinical output —
  useful for screenshots and board meetings. `3` is unfiltered.
- `voiceParts()` returns `{ lead, body, sting }` so the UI can style the editorial
  separately from the analysis, which is how `AIInsightsWidget` colours SAM's opening
  clause against the neutral body.
- `composeReply()` cites a live `SamContext` snapshot, so chat answers quote real
  numbers instead of inventing them.

### Layout engine

Four footprints — `sm` 1×1, `md-wide` 2×1, `md-tall` 1×2, `lg` 2×2 — placed on a
four-column CSS grid with `grid-auto-flow: dense` so tall widgets do not strand empty
cells. Reordering snaps to cell boundaries because the sortable list *is* the grid
order; there are no free-floating coordinates to round. Keyboard drag is wired with
live-region announcements.

### State and persistence

`userPreferencesStore` persists to `localStorage` synchronously (no default-grid flash
on reload) and debounces a `PATCH /api/dashboard/layout` at 900 ms — drag events fire
dozens of times a second, only the settled result reaches the wire. In-flight requests
are superseded via `AbortController`, and a `beforeunload` handler flushes anything
pending. `reconcileLayout()` drops widgets removed by a deploy and appends widgets
shipped after the operator last saved.

`dashboardStore` holds one slice per domain, each with independent load state, error and
freshness stamp, so a single failing endpoint degrades one widget rather than the
console. Polling cadence is per-slice (system 4 s → finance 60 s) and pauses while the
tab is hidden. Task toggles, insight acknowledgements and task creation are optimistic
with rollback on failure.

### Background

Three composited layers: emissive receding columns (`data-city.jpg`), a proximity graph
of ~150–410 nodes with signal packets travelling the edges (`neural-net1.jpg`), and a
CSS vignette. Node budget scales with intensity *and* viewport. The camera drifts
against pointer position with frame-rate-independent damping — the lag is the effect.
At `backgroundIntensity: 0` the canvas unmounts entirely. A `WebGLBoundary` catches
context failures so a blocked or exhausted GPU degrades to the painted gradient instead
of a white screen.

---

## Wiring real infrastructure

`src/lib/server/telemetry.ts` is the seam. Route handlers read from one singleton
whose emitted shapes are the contract in `types/dashboard.ts`. Replace its internals
with Prometheus, the Docker Engine API, the n8n REST API and a Postgres ledger, and no
client code changes.

Until then it models the estate honestly rather than serving fixtures: state advances
with wall-clock time, agents finish tasks and pick up new ones, series are true ring
buffers, and **insights are derived from threshold crossings** — SAM notices CPU
saturation or a budget overrun in the same numbers the widgets are drawing, and writes
it up once rather than every poll.

### Command execution — read this before connecting anything

`src/lib/server/commands.ts` **never shells out.** It resolves an allow-listed verb to
a known operation against the in-process estate model. That is deliberate: an HTTP
endpoint that pipes request bodies into a shell is a remote code execution hole, not a
feature.

Chaining (`;` `&&` `|`), substitution (`` ` `` `$()`), `sudo`, recursive `rm`, and
arbitrary egress (`curl`/`wget`/`nc`) are refused explicitly, each with the reason SAM
gives for refusing. To connect real infrastructure, replace individual handlers with
scoped, authenticated clients — Docker over a unix socket, n8n with a service token, a
job runner for Python — and keep the allow-list model. Never interpolate operator input
into a shell string.

### Attaching a model to chat

`POST /api/chat` composes replies locally today. To attach a provider, replace
`composeReply` with your call and keep routing the result through `applyVoice` — the
tone layer is what makes it SAM. The endpoint already streams: it returns chunked
`text/plain`, and `dashboardService.streamChat` is an async generator that yields
deltas, so the panel renders SAM mid-sentence.

### Authentication

There is none. `/api/dashboard/layout` stores a single tenant on `globalThis`. Before
this is exposed to anything but localhost, put a session in front of every route and key
layout persistence by user id.

---

## Widgets

| Widget | Live surface |
| --- | --- |
| `AIInsightsWidget` | Threshold-derived observations, severity-sorted, personality-framed, acknowledgeable, with expandable recommended actions |
| `AgentFleetWidget` | Per-agent node indicators whose spin rate tracks CPU, task progress, live memory/token consumption, swarm filters, and pause/resume/boost/kill supervision |
| `VaultMemoryWidget` | Rotating index core ringed by cluster weights, throughput bars, retrieval log, and a live query input |
| `CommandTerminalWidget` | Scrollback, command history (↑/↓), Tab completion, Ctrl+C, colour-coded streams, SAM's editorial on exit codes |
| `ActiveProjectsWidget` | Atwood Systems deployments — phase, health, blockers, budget burn, deploy targets |
| `SystemHealthWidget` | Graduated-bezel health gauge, CPU/memory/network sparklines, service mesh state, automation failure rate |
| `FinanceBalanceWidget` | Balances with trend sparkline, net burn, runway (∞ when revenue covers burn), per-account deltas |
| `DailyTasksWidget` | Quick-add with priority cycling, optimistic toggles, overdue detection, streak |

Every widget adapts its content to its footprint: `sm` renders the headline number,
`lg` renders the full expression.

---

## Interaction

| | |
| --- | --- |
| `⌘K` / `Ctrl+K` | Summon SAM |
| Drag the grip | Reorder widgets (keyboard accessible: focus grip → Space → arrows → Space) |
| Widget `⋯` | Resize (1×1 / 2×1 / 1×2 / 2×2), refresh, hide |
| `⚙` | Ambient theme, background intensity, sarcasm level, density, reduced motion, reset layout |
| Terminal `Tab` | Complete the verb |
| Chat `/exec <cmd>` | Run a command through the same allow-listed interpreter |

Five ambient themes (void, plasma, toxic, ember, ghost) remap an accent triad through
CSS custom properties — no component knows which theme is active. `prefers-reduced-motion`
is honoured at the CSS layer, and the in-app toggle additionally freezes the Three.js
render loop and Framer Motion.
