# Ummah Chat — Real Muslim Community Chat App

A real-time chat platform for Muslims worldwide: topic-based rooms, user accounts,
live messages, online presence, typing indicators, and basic moderation.
Built with plain HTML/CSS/JS + **Supabase** (Auth, Postgres, Realtime). No build step.

## One-time setup (~10 minutes, all free)

### 1. Create a Supabase project
1. Go to https://supabase.com/dashboard → **New project**
2. Name it `ummah-chat`, set a database password, pick the nearest region → **Create**
3. Wait ~2 minutes for the project to start

### 2. Create the database tables
1. In the left menu open **SQL Editor** → **New query**
2. Copy the entire contents of `supabase/schema.sql` from this repo, paste, and **Run**
3. You should see "Success. No rows returned" — tables, security policies and 6 rooms are created

### 3. Connect the app
1. Go to **Project Settings → API**
2. Copy the **Project URL** and the **anon public** key
3. Open `js/config.js` and paste them in, then commit/push

### 4. Make yourself admin (moderation)
1. Open the app, **Sign up** with your email
2. In Supabase go to **Authentication → Users**, copy your **UID**
3. In **SQL Editor** run:
   ```sql
   insert into admins (user_id) values ('PASTE-YOUR-UID-HERE');
   ```
4. Reload the app — you can now delete any message; your name shows an ADMIN badge

### 5. Host it (free options)
- **Supabase-free simplest:** drag the project folder into https://app.netlify.com/drop (free)
- Or **GitHub Pages**: repo Settings → Pages → Deploy from branch
- Or **Cloudflare Pages / Vercel** — all free for this

## Features
- Email signup/login (Supabase Auth)
- 6 topic rooms (edit them in the `rooms` table)
- Real-time messages + live delete (Supabase Realtime)
- Online-now list + typing indicators (Realtime Presence)
- Delete own messages; admins delete any message
- Report button → stored in `reports` table for review
- Mobile responsive (drawer sidebar + slide-in users panel)

## Security notes
- Row Level Security is ON: only signed-in users can read/chat
- The `anon` key is safe to ship in client code — RLS protects the data
- Never commit the `service_role` key anywhere

## Roadmap ideas
- Google sign-in (Supabase Auth → Providers → Google)
- Private/direct messages, image uploads (Supabase Storage)
- Profanity filter, mute/ban, prayer-time bot
