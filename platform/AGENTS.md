<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Platform vision

This is a multi-organisation football tournament platform. Ambassadors FC
is the first and flagship organisation, but the data model and every
permission check is built so that any club, church, or school can run
their own tournaments here without ever seeing another organisation's
data. Churches Cup is a tournament *type* Ambassadors runs, not a
separate organisation.

This repo also still contains the original, live Churches Cup app
(`index.html`, `Code.gs`, Google Sheets as its datastore, PIN-based shared
login) at the repo root. It keeps serving real tournaments unchanged.
`platform/` is the new system being built alongside it, not a rewrite of
it in place — functionality migrates over deliberately, one vertical
slice at a time, not as a big-bang cutover. Do not touch the root-level
files while working on `platform/` unless a task explicitly calls for it.

Payments are out of scope until explicitly asked for — the brief that
shaped this platform asked for payments to be built last, after the
registration/scheduling core, which is why the Stripe Connect integration
landed after everything else despite being listed earlier in that brief.

# Architecture

- **Framework**: Next.js 16, App Router, Cache Components + Partial
  Prerendering enabled (`next.config.ts`). This is a materially different
  caching model from pre-16 Next.js — read
  `node_modules/next/dist/docs/01-app/02-guides/authentication-with-cache-components.md`
  before writing anything that reads a session or does per-request data
  access, and see "Cache Components conventions" below before assuming you
  already know how this works.
- **Database**: Supabase (Postgres + Auth + Row Level Security). No
  Supabase project has been created yet — `NEXT_PUBLIC_SUPABASE_URL` etc.
  are placeholders until one exists (see `.env.local.example`). Every
  migration in `supabase/migrations/` has been applied against a
  throwaway local Postgres 16 instance and exercised with real
  authenticated-role queries before being trusted (see "How migrations
  get verified" below) — but none of it has run against an actual
  Supabase/PostgREST deployment yet, so Supabase-specific behaviour
  (connection pooling, Realtime, Storage, Edge Functions) is unverified.
- **Payments**: Stripe Connect, destination-charge pattern. Each
  organisation gets its own Express account
  (`/orgs/[orgSlug]/admin/stripe`); a paid registration's Checkout Session
  transfers the organiser's share directly to their connected account via
  `payment_intent_data.transfer_data`, with a flat platform fee taken via
  `application_fee_amount` (`PLATFORM_FEE_BPS` in `lib/payments.ts` — a
  placeholder rate, not a real pricing decision). The platform never
  holds organiser tournament revenue itself.
- **Scheduling engine**: `brackets-manager` + `brackets-memory-db`,
  used as a pure computation library — an in-memory instance is created,
  asked to generate or advance a bracket, read back, and then discarded.
  It is not our data layer. See "Fixtures and brackets" below.
- **Mobile**: not started. If/when it is, Expo (React Native) is the
  planned approach — it shares the Supabase client and TypeScript types
  with this Next.js app, so auth/registration/scoring logic doesn't get
  reimplemented a second time. Don't start it speculatively; it was
  explicitly deferred until the web app's API/auth/schema are stable.

# Security model — read this before touching auth or payments

**Row Level Security is the real authorization boundary. Anything in the
UI (a hidden button, a client-side role check) is a convenience, never
protection.** Every `lib/orgs.ts`-style "is this user allowed to see
this" helper exists only to decide what renders — the actual enforcement
is the RLS policy or SECURITY DEFINER function underneath it, and that
has been independently tested to reject what the UI never offers in the
first place. Don't let that discipline slip: if you add a new mutation,
ask "what stops an attacker from calling this directly with curl and a
stolen session token" before asking "what does the button do."

**Two deliberate ways business logic can bypass per-row RLS, and when
each is the right tool:**

1. **SECURITY DEFINER SQL functions** (`register_team_for_tournament`,
   `submit_score`, `resolve_score`, `confirm_free_registration`,
   `reserve_registration_for_payment`) — used when a mutation's
   correctness depends on business rules that are awkward or unsafe to
   express as a blanket row policy (atomic capacity checks under
   concurrency, "the submitter can't confirm their own score", "a paid
   tournament can't be confirmed without paying"). Each one re-checks
   authorization itself (`manages_team()` / `administers_tournament()`)
   because being SECURITY DEFINER means it does *not* inherit the
   caller's RLS restrictions automatically — skipping that re-check
   inside the function would be a real hole, not just redundant.
2. **The service-role client** (`lib/supabase/admin.ts`,
   `createAdminClient()`) — used only to perform a system-level
   consequence of an action whose authorization was *already* fully
   checked through a normal RLS-respecting path a moment earlier in the
   same request: `lib/bracket.ts`'s `advanceBracket()` runs only right
   after `resolve_score()` has already confirmed a score, and the Stripe
   webhook runs only after signature verification has already proven the
   event is genuinely from Stripe. Never reach for the service-role
   client as a shortcut around writing a real policy — it has no
   authorization logic of its own, which is exactly why its use has to
   stay confined to these "trusted consequence of something already
   checked" call sites. `bracket_stages` and `webhook_events` have *no*
   authenticated-role write policy at all, specifically so this is the
   only path in.

**Found-and-fixed gaps worth knowing about, so the same mistake doesn't
get reintroduced:** the original `registrations` UPDATE policy let a team
manager set their own registration to *any* status directly, including
`confirmed` — meaning a team could have self-confirmed a paid entry
without ever paying. It's now split: team managers can only self-service
a transition to `withdrawn`; everything else requires a tournament admin
or one of the functions above (see
`20261127250000_tighten_registration_updates.sql`). Similarly, the Stripe
webhook's idempotency check originally treated *any* insert failure
(including a transient network error) as "duplicate, skip" — which would
have silently dropped a real payment confirmation and told Stripe not to
retry. It now only treats a genuine Postgres unique-violation (`23505`)
as a duplicate; anything else returns 500 so Stripe's retry actually
fires, and the idempotency marker is released if processing fails after
being claimed, so the retry can succeed instead of being skipped forever.

# Cache Components conventions

Next 16's Cache Components model is not the pre-16 default-dynamic
behaviour. The rule that matters most here: **any function that reads
the session (directly or via `lib/supabase/server.ts`'s `createClient()`,
which reads cookies internally) is request-time and must be called from
inside a `<Suspense>` boundary**, or the build fails. The established
pattern across this codebase:

- `lib/auth.ts`'s `getCurrentUser()` / `getCurrentMemberships()` use
  `"use cache: private"` — the session read happens once, the result is
  cached in the browser only, never on the server.
- Everything else that reads via the per-request Supabase client
  (`lib/teams.ts`, `lib/tournaments.ts`, `lib/fixtures.ts`) is deliberately
  **not** cached at all (no `"use cache"` directive) — just a plain async
  function, dynamic by nature, called from a Server Component that sits
  behind its own `<Suspense fallback=...>`. This was a deliberate choice
  over trying to cache RLS-gated multi-tenant reads: getting a cache
  key/tag wrong on data that must stay tenant-isolated is a worse failure
  mode than "this page isn't as fast as it could be" — revisit only with
  real care, not as a casual optimisation pass.
- A dynamic route segment (`params` as a Promise) is *also* a
  request-time API under Cache Components — even reading `params` has to
  happen inside a Suspense boundary, not just the data fetch that follows
  it. See the nested-Suspense structure in
  `app/tournaments/[orgSlug]/[tournamentSlug]/page.tsx` for the pattern:
  one outer boundary around the `params` + tournament lookup, a nested
  one around the session-dependent registration panel underneath it.
- Known cosmetic gap: a `notFound()` call inside a nested Suspense
  boundary renders the correct not-found UI but the HTTP status code can
  come back 200 instead of 404, because the response has already started
  streaming with a 200 before the boundary resolves. Not fixed — would
  need trading away instant-navigation streaming for that route, which
  hasn't seemed worth it yet for an internal tool, but matters if/when
  SEO or strict HTTP semantics are needed on public tournament pages.
- `middleware.ts` doesn't exist here — Next 16 renamed the convention to
  `proxy.ts` (`src/proxy.ts`), exporting a `proxy()` function instead of
  `middleware()`. Don't recreate a `middleware.ts` file out of habit.

# Data model

Core tables (all in `supabase/migrations/20261127180000_core_schema.sql`
unless noted): `organisations`, `platform_admins`, `profiles`,
`memberships` (org-scoped roles: `org_admin`, `tournament_admin`,
`volunteer`, `referee`, `club_admin` — a user with no membership row is
just a spectator, including anonymous visitors), `teams` /
`team_contacts` / `team_managers` (contact details are split from the
public team record specifically so a tournament page can list team names
without exposing a parent/manager's personal details — see
"Safeguarding" below), `tournaments`, `competitions`, `pitches`,
`registrations`, `rosters`, `payments`, `fixtures`, `scores`, `notices`,
`audit_log`. Later migrations add: `bracket_stages` (knockout bracket
progression state, `20261127220000`), `webhook_events` (Stripe idempotency,
`20261127240000`).

**Registration lifecycle**: `pending` → (`confirmed` directly for a free
tournament, or `reserved` while a paid tournament's Checkout Session is
open) → `confirmed` once paid, or `waitlisted` if the tournament was full
at registration time, or `cancelled` (an expired, unpaid reservation,
swept lazily — see below) / `withdrawn` (self-service). Fixture
generation only considers `confirmed` registrations.

**Capacity and reservation expiry are enforced in SQL, not in the app.**
`register_team_for_tournament()` locks the tournament row and does the
capacity count + insert in one transaction specifically so concurrent
registrations can't oversell a tournament — this was verified with a real
concurrency test (20 simultaneous connections racing for 5 spots produced
exactly 5 `pending` + 15 `waitlisted`, not an approximation). There is no
background job sweeping expired `reserved` registrations; the same
function sweeps *its own tournament's* expired reservations to
`cancelled` every time it runs, which is correct under the same row lock
but means an expired reservation only actually clears on the next
registration attempt for that tournament, not the instant it expires.

**Fixtures and brackets**: `fixtures`/`scores` are deliberately generic
(`round` and `group_label` are free text) — they store whatever shape a
competition's format produced, they don't encode one bracket format
themselves. Round-robin fixtures are fully determined at generation time
(every match's opponents are known immediately, no dependency chain) and
written once. Knockout fixtures are not: a later round starts as
"TBD vs TBD" and gets filled in as earlier rounds are confirmed, via
`bracket_stages` storing `brackets-manager`'s own serialized state per
competition and `lib/bracket.ts`'s `advanceBracket()` rehydrating it,
feeding in a confirmed result, and syncing whichever matches just became
resolvable back into `fixtures`. **Single elimination only** — double
elimination's winner/loser-bracket crossover and grand-final-reset logic
has not been verified against the real library the way everything else
here has (see the round-robin and knockout generation commits for what
*was* verified: participant-id-to-seeding-order mapping, bye handling,
round labelling, an actual 8-team and 5-team play-through including an
upset). Don't add double elimination support without doing the same
level of verification first — it is genuinely easy to get the
loser-bracket routing subtly wrong.

A knockout match that ends level with no penalty result recorded is
**not** auto-resolved — `advanceBracket()` refuses to guess a winner and
leaves the bracket un-advanced rather than silently picking a side.
**Known gap**: if an admin directly edits a confirmed score afterwards
(the existing organiser-override path) to add a penalty result, that
direct edit does not currently re-trigger `advanceBracket()` — the
bracket stays stuck until something is built to wire that up.

# How migrations get verified

Every migration in this repo has been applied against a throwaway local
Postgres 16 instance (`pg_ctlcluster 16 main start`, a disposable
database, a hand-rolled minimal stand-in for Supabase's `auth.users` /
`auth.uid()`) and exercised with real queries run `set role authenticated`
with a session variable standing in for the JWT claim, *not* just
eyeballed as SQL text. This has caught real bugs before they'd have
reached a live project — most notably the registration self-confirm hole
and the webhook idempotency bug described above, both found by testing
the actual authorization behaviour, not by code review alone. Keep doing
this for new migrations: write the policy or function, then write a
short scenario script that proves both the allowed case and the rejected
case, the same way `register_team_for_tournament`'s concurrency test or
the knockout bracket's full play-through were verified. A migration that
"looks right" and a migration that has been shown to reject what it
should reject are not the same thing.

# Safeguarding

This platform will eventually handle youth and junior team data. Known,
deliberate design choices so far: team contact details (name/email/phone)
live in `team_contacts`, a separate table from the public `teams` record,
with its own RLS restricted to the team's own managers and that
tournament's admins — never public, even though team *names* are. A
`tournaments.suppress_public_results` flag exists as a placeholder for
league rules that forbid publishing junior scores, but it's tournament-
wide, not per-age-category — real per-age-group granularity (the way
churches-cup's junior/U19 handling needed first-names-only and no public
scores specifically for 2016–2020 age groups) has **not** been built yet.
Do not assume this flag is sufficient before any tournament involving
children goes live on this platform — treat it as a known gap, not a
solved problem.

# Business rules worth knowing before changing related code

- Entry fee of 0 means a free tournament; `confirm_free_registration()`
  explicitly refuses to run on anything with `entry_fee_cents > 0`, and
  `reserve_registration_for_payment()` explicitly refuses to run on
  anything with `entry_fee_cents = 0` — these are intentionally mutually
  exclusive checks, not an oversight if you're wondering why both exist.
- `register_team_for_tournament()` takes a `p_channel` parameter
  (`'website'` or `'app'`) distinguishing app-exclusive early access from
  general website registration, per the brief's requirement that app
  users get a registration head start. The mobile app doesn't exist yet,
  so this is currently always called with `'website'` — the plumbing is
  ready for the app's priority window, the window itself has no real
  user yet.
- Group-stage team distribution (`lib/scheduling.ts`'s
  `splitIntoGroups()`) is a simple round-robin split by array index. It
  does **not** implement "avoid teams from the same club in the same
  group" — deferred deliberately, flagged in code, not forgotten.
- The Stripe platform fee (`PLATFORM_FEE_BPS` in `lib/payments.ts`) is a
  placeholder value, not a pricing decision — don't treat its current
  number as meaningful.

# Working conventions

- **Never attempt the whole brief in one slice.** Each piece of work in
  this repo's history has been one coherent, independently-verified
  vertical slice (schema → auth → registration → scheduling → payments),
  committed and pushed on its own, not a sprawling partial
  implementation of everything at once. Keep doing that.
- **Test before trusting, every time, even under time pressure.** Every
  migration has a verification story (see above). Every non-trivial piece
  of third-party library behaviour this codebase depends on
  (`brackets-manager`'s participant-id assignment order, Stripe's
  Checkout Session `expires_at` minimum, the real shape of Stripe's
  Connect API params) was checked against the actual installed
  dependency's source or types before being relied on, not assumed from
  training data or documentation memory — both Next.js 16 and the current
  Stripe SDK have real, easy-to-get-wrong differences from older
  versions.
- Local-only test artifacts (throwaway Postgres databases, scratch SQL/
  JS files used to verify a migration) are never committed — if you add
  a verification script, keep it out of the repo unless it's meant to be
  a lasting test.
