# Agrim Consultation Booking — free hosting edition

A professional calendar booking website with a private dashboard, approval workflow, private notes, Zoom join links and live updates. The default deployment uses **Cloudflare Workers Free** with a persistent SQLite-backed Durable Object. GitHub stores your code and triggers deployment.

**Start with [START-HERE.md](START-HERE.md)** for the exact steps to put it online from GitHub. No paid Render server or separate database account is required. The free `workers.dev` address includes HTTPS; a custom domain is optional.

## Included

| Feature | Behavior |
|---|---|
| Client calendar | View available times in the client's selected time zone and request a consultation |
| Availability | Edit weekdays, times, blocked dates, duration, notice and booking window |
| Private dashboard | Password sign-in; accept, decline or cancel; keep meeting notes private |
| Persistent data | Durable SQLite keeps bookings, settings and notes across normal deployments |
| Live updates | Hibernating WebSockets update open pages; reconnect and periodic refresh handle interruptions |
| Booking protection | Availability check and reservation happen in one atomic database transaction |
| Zoom | Paste a meeting join link, or optionally connect server credentials for automatic creation on acceptance |
| Client confirmation | Private confirmation URL shows approval and join link without exposing notes |
| Deployment | Cloudflare configuration and GitHub checks included |
| Local alternative | Original Node.js/SQLite and Docker self-hosting also remain available |

Availability is managed inside this app. Google/Outlook calendar synchronization and automatic email delivery are not connected. The dashboard prepares an email that you can send from your mail app. The free edition starts with **30-minute** appointments to fit within Zoom Basic's 40-minute meeting limit; you can change the duration in your dashboard. [Zoom's free plan](https://www.zoom.com/en/products/virtual-meetings/features/free-video-conferencing/)

## Monthly hosting cost

The default setup is **$0 within Cloudflare's Free plan limits**. Remain on Workers Free to keep this setup free. When a free quota is exhausted, the affected service can stop responding until the quota resets or capacity is freed; the app does not purchase an upgrade.

Workers Free currently includes 100,000 dynamic requests per day, with static asset requests free. Durable Objects Free includes 100,000 requests/day, 5 million SQL row reads/day and 100,000 row writes/day, plus storage and compute allowances. These are account-wide limits and are not a number of bookings. GitHub-connected Cloudflare builds include 3,000 minutes/month. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), [build limits](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)

Custom domains, paid Zoom features and any upgrades you select are separate. Pricing checked 13 September 2026. See [Cloudflare hosting notes](docs/CLOUDFLARE.md) for maintenance and backups.

## Run the free edition on your computer

Install **Node.js 24 LTS**, open the project folder in VS Code, and run:

```bash
npm ci
npm run setup:free
npm run dev
```

Open http://localhost:8787 and http://localhost:8787/dashboard. The generated admin password is in your local `.dev.vars` file. This file is ignored by Git. Local data stays under the ignored `.wrangler/` directory, separate from your live data. No Cloudflare login is needed for local development.

## GitHub and deployment

Follow [START-HERE.md](START-HERE.md). The repository root must contain `package.json`, `wrangler.jsonc`, `cloudflare/`, `public/` and `.github/`.

- Build command: `npm run check && npm test`
- Deploy command: `npm run deploy`
- Production branch: `main`
- Worker name: `agrim-consultations`
- Runtime secret: `ADMIN_PASSWORD` (a unique random password of 20–256 characters)

Cloudflare connects to GitHub and builds/deploys successful commits. `wrangler.jsonc` provisions the SQLite-backed Durable Object automatically on the first deployment. Keep the Worker name, class, binding, migration and `primary-calendar-v1` identity stable after you start using the app: changing them can create a different database.

GitHub Pages only serves static files, so it cannot run this booking backend. Use the included Cloudflare deployment for the complete app.

## Commands

| Command | Purpose |
|---|---|
| `npm run setup:free` | Create a local admin password without replacing an existing file |
| `npm run dev` | Run the free Cloudflare edition locally |
| `npm run check` | JavaScript and HTML checks |
| `npm test` | Build the Worker and test both backends locally, without cloud deployment |
| `npm run test:free` | Build and test the Cloudflare backend only |
| `npm run deploy:check` | Validate and bundle deployment without publishing |
| `npm run deploy` | Publish to your signed-in Cloudflare account |
| `npm run setup` then `npm start` | Run the optional original Node server on port 3000 |
| `npm run dev:node` | Watch the optional Node server locally |

Optional manual deployment: `npx wrangler login`, `npm run deploy`, then `npx wrangler secret put ADMIN_PASSWORD`. The last command prompts privately for the password. These commands use your own Cloudflare account.

## Files

- `cloudflare/`: Free backend, durable database and WebSocket updates.
- `public/`: Shared client calendar and admin interface.
- `server/`: Shared scheduling/Zoom helpers and optional standalone Node server.
- `wrangler.jsonc`: Cloudflare hosting and automatic database provisioning.
- `.github/workflows/ci.yml`: Linux and Windows Node 24 checks.
- `docs/`: Free deployment, Zoom, and optional self-hosting instructions.
- `.dev.vars.example`: Example local Cloudflare secrets; no real credentials.
- `Dockerfile`, `compose.yaml`: Optional [self-hosting](docs/SELF-HOSTING.md).

## Security and data

Secrets stay in Cloudflare runtime settings and are never included in public assets. The app refuses bookings until a strong admin secret has been set. Sessions use random tokens, HttpOnly/SameSite cookies, 12-hour expiry and CSRF checks. Changing the Cloudflare admin secret invalidates existing sessions. Rate limits survive Worker restarts. A high-entropy password is required; use the generated password or a password manager.

Only the authenticated admin can retrieve names, email addresses, topics and private notes. Public availability contains times only. The token in a client's confirmation URL grants access to that appointment's status and Zoom join URL; it should stay private. The database stores a hash of that token.

New deployments start with a new calendar database. Data from the earlier hosted Site, Node server, or Render is not imported automatically. Do not delete the Worker or change its database identity to make routine updates. Back up your data as described in [CLOUDFLARE.md](docs/CLOUDFLARE.md).

The app is designed for one host's calendar. Account deployment and live Zoom authorization must be completed in your accounts. Local tests do not prove that your account configuration is correct; follow the short two-browser check in START-HERE after deployment.

No open-source license has been selected. Choose one before distributing under open-source terms.
