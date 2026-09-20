# Orpa — Backend-Connected Version

This is the Orpa grading app **with a central server**, so the owner can:

- keep all teacher accounts in one place (not just on each phone),
- **suspend or delete** any account (which instantly signs that person out and blocks login),
- **force sign-out** a single active session on demand, and
- watch a **live “who’s online” dashboard** that updates in real time.

Marks/grades are still stored on each teacher’s own device — only **accounts and
sessions** are centralised.

---

## What’s inside

```
Orpa-Server/
  server.js               Node/Express + Socket.IO server (API + live sessions)
  lib/db.js               Simple JSON-file datastore (data/data.json)
  package.json            Dependencies
  .env.example            Copy to .env and set your secrets
  public/                 The Orpa web app (served by the server)
    index.html            Main app
    app.js                App logic (grading, reports, KPIs)
    auth-backend.js       Connects the app to the server (login/register/sessions)
    admin.html            Owner-only admin dashboard
    styles.css, sw.js, manifest.webmanifest, icons, brand image
```

---

## Run it locally

1. Install [Node.js](https://nodejs.org) 16 or newer.
2. In this folder run:
   ```
   npm install
   npm start
   ```
3. Open <http://localhost:8000> — register teachers and use the app.
4. Owner dashboard: sign in with the owner account, then open the user menu
   (top-right) → **🛡️ Admin Dashboard**, or go straight to
   <http://localhost:8000/admin.html>.

### Default owner account
On first run an owner account is created automatically:

- **Email:** value of `OWNER_EMAIL` (default `owner@orpa.local`)
- **Password:** value of `OWNER_PASSWORD` (default `changeme123`)

**Change these** by setting `OWNER_EMAIL` / `OWNER_PASSWORD` before the first run
(or change the password later from the app’s Profile page).

---

## Deploy so Android teachers can use it

Host this server on any Node-friendly platform (Render, Railway, Fly.io, a VPS,
etc.). Set the environment variables from `.env.example`, then share the public
`https://…` URL. Teachers open it in Chrome and can **Add to Home screen** to
install it like an app (the PWA setup is already included).

> **Run it over HTTPS in production.** Logins and tokens must not travel over
> plain HTTP. Most hosts give you HTTPS automatically.

---

## How the owner controls work

| Action            | Effect                                                                 |
|-------------------|------------------------------------------------------------------------|
| **Suspend**       | Blocks future logins **and** ends the user’s current session at once.  |
| **Activate**      | Re-enables a suspended account.                                        |
| **Force sign-out**| Ends the user’s active session now (they must log in again).           |
| **Delete**        | Permanently removes the account.                                       |

Suspend / force-sign-out work by revoking the user’s token **and** disconnecting
their live socket, so the effect is immediate — no waiting for a token to expire.
The owner account itself cannot be suspended or deleted through the panel.

When suspending, the owner can add an **optional reason**, which is included in
the email the teacher receives (see below).

---

## Email alerts

Whenever the owner suspends, reactivates, force-signs-out, or removes a teacher,
Orpa automatically emails that teacher a clear, branded notice. Suspension
and reactivation messages are written as a matching pair so the teacher always
knows the current state of their account.

**No email setup? It still works.** If you don’t configure SMTP, emails are not
actually sent — instead each one is printed to the server console and saved as
`.html` / `.txt` files under `data/emails/`, so you can see exactly what would
have gone out during a pilot.

**To send real emails**, set the `EMAIL_SMTP_*` variables in `.env` (see
`.env.example`). For Gmail, create an App Password and use:

```
EMAIL_SMTP_HOST=smtp.gmail.com
EMAIL_SMTP_PORT=587
EMAIL_SMTP_USER=you@gmail.com
EMAIL_SMTP_PASS=your-16-char-app-password
EMAIL_FROM=Orpa <no-reply@yourschool.com>
```

Email sending is *fire-and-forget*: if the mail server is slow or unreachable,
the admin action still succeeds instantly and the failure is only logged — a
broken mailbox can never block suspensions or logins.

---

## Security notes

- Admin actions are enforced **on the server** (owner role required), not just
  hidden in the UI.
- Passwords are stored hashed with bcrypt; the plain password is never saved.
- Set a strong, unique `JWT_SECRET` and `OWNER_PASSWORD` in production.
- **Always run behind HTTPS in production.** Login tokens and passwords travel
  over the network, so a TLS certificate (e.g. via your host or a reverse proxy)
  is required to keep them safe.
- Keep SMTP credentials (`EMAIL_SMTP_PASS`) only in `.env` / host environment
  variables — never commit them.
- The JSON datastore is fine for a pilot. For large-scale use, move to a real
  database (PostgreSQL/SQLite) — `lib/db.js` is the only file to swap out.

---

## Test

An automated end-to-end check of the whole flow (register, login, suspend,
force-logout, delete, permission guards) is included:

```
node test.js
```
