# The Raidergang — setup guide

You only do this once. It takes about 30–40 minutes. All of it is free.
Never send anyone (including Claude) a password, database password, or the
Google **client secret**. The only values you'll share are the GitHub repo
name and the Supabase project URL.

---

## 1. Supabase: create the database

1. supabase.com → **New project** → name `raidergang`, region **East US**.
   Save the database password in your password manager.
2. When it finishes, open **SQL Editor** → **New query**.
3. Open `supabase/migrations/0001_core.sql` from this repo, paste the whole
   thing, and click **Run**. You should see "Success. No rows returned."
   Then do the same with each later file in that folder, in number order
   (`0002_library.sql` loads the exercise and throwing drill libraries;
   `0004_goods.sql` adds The Goods and goal weight).
   Each file only needs to run once; re-running the library file is harmless.
4. New query again, paste this with **your own Gmail**, and run it:

   ```sql
   select public.bootstrap_admin('your.gmail@gmail.com', 'Myles', 'Martinez');
   ```

   That makes you the first admin. It only works once.
5. **Project Settings → API**. Copy two values; you'll need them in step 3:
   - **Project URL** (looks like `https://abcd1234.supabase.co`)
   - **anon public** key (safe to share; it's built into the app)

## 2. Google: let athletes sign in with Gmail

1. Go to console.cloud.google.com (sign in with the owner Gmail) →
   project dropdown → **New project** → `Raidergang`.
2. **APIs & Services → OAuth consent screen** (may be called **Google Auth Platform**):
   - User type: **External**
   - App name: `The Raidergang`, support email: yours
   - Scopes: leave the defaults (email, profile, openid). Don't add others.
   - **Audience / Publishing status → Publish app** ("In production").
     With only the basic scopes, Google doesn't require a review. If you skip
     this, only Gmails you list as "test users" can sign in.
3. **Credentials → Create credentials → OAuth client ID**
   - Application type: **Web application**, name `Raidergang web`
   - **Authorized redirect URIs** → add:
     `https://YOUR-PROJECT.supabase.co/auth/v1/callback`
     (your Project URL from step 1.5 + `/auth/v1/callback`)
   - Create. Google shows a **Client ID** and **Client secret**.
4. Back in Supabase: **Authentication → Sign In / Providers → Google** →
   enable, paste the Client ID and Client secret → Save.

## 3. Vercel: put the app online

1. vercel.com → **Add New → Project** → import the `raidergang` GitHub repo.
2. Framework: **Vite** (auto-detected). Before deploying, open
   **Environment Variables** and add:
   - `VITE_SUPABASE_URL` = your Project URL
   - `VITE_SUPABASE_ANON_KEY` = your anon public key
3. **Deploy**. You'll get an address like `raidergang.vercel.app`.
4. Back in Supabase: **Authentication → URL Configuration**
   - **Site URL**: your Vercel address (e.g. `https://raidergang.vercel.app`)
   - **Redirect URLs**: add the same address.

## 4. Try it

1. Open the Vercel address → **Sign in with Google** with the Gmail you used
   in step 1.4. You should land on the coach Check-ins board as Admin.
2. **Roster → + Add person** to add the other coaches and the athletes,
   each with the exact Gmail they'll use.
3. Have one athlete sign in on their phone, then **Share → Add to Home
   Screen** (iPhone, in Safari) so it opens like an app.

## Good to know

- **Free-tier pause:** Supabase pauses a free project after 7 days with no
  activity. Daily check-ins keep it awake; over a long break (e.g. winter
  break with nobody logging) it may pause. Un-pausing is one click in the
  Supabase dashboard, and no data is lost.
- **Not invited:** anyone can press "Sign in with Google," but unless their
  Gmail is on the roster they see "You're not on the roster yet" and can't
  read or write anything.
- **Removing someone:** set them to **Inactive** on the roster. They can't
  sign in, and their history is kept.
- **Demo mode:** if the app runs without the two `VITE_` values, it uses
  sample data stored only on that device. Handy for trying changes.
