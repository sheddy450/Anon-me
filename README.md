# ANON_ME! — putting it online

This folder is the complete app. It needs two free services: **Supabase** (accounts,
database, live messages) and a **static host** such as Netlify (serves the pages).
Allow about 30 minutes. Menu names in Supabase change now and then, so a label may
differ slightly from what is written here.

## What is in the folder

| File | What it is |
|---|---|
| `index.html` | The page and its styling |
| `app.js` | All app behaviour |
| `config.js` | Your settings: the only file you need to edit |
| `schema.sql` | Database setup, run once in Supabase |

## Step 1 — Create the Supabase project

1. Go to supabase.com, sign up, and create a **New project**. Pick any name and a
   strong database password. Wait for it to finish setting up.

## Step 2 — Set up the database

1. In the project, open **SQL Editor** → **New query**.
2. Open `schema.sql` from this folder, copy everything, paste it in, press **Run**.
3. You should see "Success". Run it only once.

## Step 3 — Check the email settings

The app signs people up with an email link: they tap the link in their inbox and
land back in the app, logged in. Supabase's standard emails already do this, so you
don't need to edit any email templates.

1. Go to **Authentication → Sign In / Providers → Email**.
2. Make sure **Confirm email** is switched **on**, then click **Save** if you changed it.

## Step 4 — Connect the app

1. In Supabase open **Project Settings → API** (or "API Keys").
2. Copy the **Project URL** and the **anon / publishable** key.
   Never use the `service_role` / secret key in this app.
3. Open `config.js`, paste both values between the quotes, and save.
4. Optional in the same file: your Telegram community link, ads, and sponsors.

## Step 5 — Put it online

1. Go to app.netlify.com/drop and drag this whole folder onto the page.
2. Netlify gives you an address such as `https://your-name.netlify.app`.
   You can rename it, or connect your own domain, in Netlify's settings.
3. Back in Supabase, open **Authentication → URL Configuration**:
   - Set **Site URL** to that address, e.g. `https://anonme.netlify.app` (no slash at the end).
   - Under **Redirect URLs**, click **Add URL** and add the same address followed by
     `/**`, e.g. `https://anonme.netlify.app/**`.
   - Click **Save**. Email links won't open your app until this is done.

Any other static host (Vercel, Cloudflare Pages, GitHub Pages) works the same way.

## Step 6 — Test it with two devices

1. Open your address and create an account. Open the email from Supabase and tap
   **Confirm your mail**. You land back in the app, logged in.
2. Copy your link (it looks like `https://your-site/?u=YourName`).
3. Open the link on a second phone or a private browser window and send a message.
4. It should appear in your inbox within a second or two. Reply, and the sender sees
   your reply on their screen within a few seconds.

## Before you invite many people

- **Email sending.** Supabase's built-in email only sends a few emails per hour
  across the whole project, and the emails come from Supabase rather than ANON_ME!.
  For real sign-ups, connect an email service (Resend, Brevo, Mailgun and similar
  have free tiers) under **Authentication → Emails → SMTP Settings**. Once that's
  connected you can also edit the email wording under **Authentication → Emails → Templates**.
- **Blocked words.** The list is short. Add words in **Table Editor → blocked_words**.
- **Reports.** Reported chats land in **Table Editor → reports**. Check it regularly.
- **Abuse limits.** One browser can start 5 chats per 10 minutes. A determined
  person can get around this by clearing browser data; stronger limits need a
  server-side function that checks the sender's network address.
- **Terms and privacy.** A public app that handles email addresses and private
  messages needs a privacy policy and terms of use. Add them to the About screen.

## How it works, briefly

- People who sign up get a link. Visitors to that link need no account.
- A visitor's browser keeps a random secret key. That key, not a name or address,
  is what lets them return to their chat. The inbox owner never sees it.
- Each chat closes after 10 messages. The owner can block or report a chat.
- Logging in uses email and password (the design showed a username field; Supabase
  signs people in by email, and looking up an email from a username would expose
  users' email addresses).
