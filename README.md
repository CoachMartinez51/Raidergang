# The Raidergang

Wright State Baseball's athlete performance app: daily check-ins, objectives,
The Goods, Lift Prep, The Meatshack and throwing, built around our own system.

- **App:** Vite + React + TypeScript, installable on phones (PWA)
- **Data + login:** Supabase (Postgres, Google sign-in, row-level security)
- **Hosting:** Vercel

First-time setup: see [SETUP.md](SETUP.md).

## Run locally

```bash
npm install
npm run dev          # demo mode with sample data
```

To point at the real database, copy `.env.example` to `.env.local` and fill
in the two values.

## Database

Migrations live in `supabase/migrations/` and are run in order in the
Supabase SQL Editor. Security tests (local Postgres) are in `supabase/tests/`.

Rules the schema enforces:
- Invite-only: a Gmail must be on the roster before it can see anything.
- Athletes see only their own data. Coaches see everyone; view-only coaches
  can't change anything; only admins add people or change access.
- Check-ins and goals are append-only. Edits are new rows; history is kept.
- Every roster, goal and library change is written to `change_history`.

## Build stages

1. ✅ Login, roster, daily check-in, objectives, coach check-in board
2. ✅ Exercise + throwing drill libraries (388 exercises, 60 drills) with coach Library screen
3. Lift blocks: builder, assignments, set logging
4. The Goods, Lift Prep, throwing calendar
5. Trackman + video (version 2)
