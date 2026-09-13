# Agrim Consultation Booking

A complete GitHub repository package for a consultation booking website. Clients request available times; the host accepts requests, adds private notes and provides Zoom meeting links. The app runs on your own computer or on a server connected to your GitHub repository.

**GitHub stores the source and runs the checks. The included Render configuration runs the live website and its database.** GitHub Pages alone cannot run this server application. A Docker setup is also included for hosting from your own server.

## What works

| Feature | Included behavior |
|---|---|
| Client booking | Available dates and times, client name/email/topic, pending requests |
| Private dashboard | Password sign-in, accept/decline/cancel, private meeting notes |
| Your availability | Edit weekdays, start times, duration, time zone, notice period and blocked dates |
| Live updates | Server-sent events refresh open pages after a change; 15-second fallback |
| Double-booking protection | SQLite transaction checks overlapping appointments; pending requests hold the time |
| Client confirmation | A private link shows acceptance and the Zoom join link, without private notes |
| Zoom | Paste a meeting link, or configure the optional server credentials to create meetings on acceptance |
| Persistence | Bookings and settings survive restarts on a persistent local disk |
| GitHub checks | Syntax, booking integration and privacy tests on Linux and Windows |
| Deployment | Render Blueprint and Docker/Caddy configurations |

Automatic email delivery and Google/Outlook calendar synchronization are **not connected**. The dashboard provides a prepared email link you send from your mail app. Availability is managed inside this app; it does not read events from another calendar. Cancelling a booking does not delete a meeting already created in Zoom.

## 1. Run on your computer

Install **Node.js 24 LTS** and Git. Open the extracted project folder in VS Code, then run in its terminal:

```bash
npm ci
npm run setup
npm start
```

Open **http://localhost:3000**. Your admin dashboard is **http://localhost:3000/dashboard**.

`npm run setup` creates an ignored `.env` file with a random admin password. Open that file locally and copy `ADMIN_PASSWORD` into a password manager. The password is never included in the browser bundle or a public API response. Running setup again preserves your existing configuration.

Use the exact `localhost` URL above for local sign-in. `PUBLIC_ORIGIN` must match the browser’s origin. Stop the server with `Ctrl+C`.

The app has no third-party runtime packages and no frontend build step. It uses Node's built-in HTTP, cryptography and SQLite modules. SQLite may show an experimental-feature warning on some Node 24 releases.

## 2. Push the whole folder to GitHub

Create a new empty GitHub repository named `agrim-booking`. For this first push, leave GitHub’s “Add README”, license and `.gitignore` options unchecked; these project files are already included where applicable.

From the extracted project root (the folder containing `package.json`), run:

```bash
git init
git add .
git commit -m "Add consultation booking application"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/agrim-booking.git
git push -u origin main
```

Replace `YOUR-USERNAME` with your GitHub username. Authenticate through GitHub’s normal Git/GitHub Desktop login; do not put tokens in source files.

If you already have a repository, clone it first, copy this package’s contents into that clone, then add/commit/push. Do not copy a nested `.git` directory. This package intentionally contains no Git history or remote credentials.

The `.github/workflows/ci.yml` workflow starts automatically. A successful run confirms the app checks on both operating systems. No deployment or service purchase is made merely by pushing this repository.

## 3. Make it live from GitHub

1. Push the repository and confirm its **Actions** checks pass.
2. Sign in to Render and connect your GitHub account.
3. Choose **New → Blueprint**, then select this repository and the `main` branch.
4. Render reads `render.yaml`. **Review the paid web-service and persistent-disk cost before proceeding.** The disk is needed to keep SQLite bookings across deployments; an ephemeral/free filesystem is not suitable for this configuration.
5. Enter a new, unique **ADMIN_PASSWORD** of at least 16 characters when prompted. Keep it in Render’s environment settings and your password manager.
6. Create the Blueprint and wait for deployment. Render supplies an HTTPS website address. Open it and add `/dashboard` to sign in.
7. Set your actual available hours in **Edit availability**, then share the public address with clients.

Future pushes to `main` deploy when the GitHub checks pass. The application and data are hosted on Render, while you manage the project through GitHub. You can use your own domain later; set `PUBLIC_ORIGIN` to that exact HTTPS origin and redeploy. Use one canonical hostname for sign-in and bookings.

For your own server/home computer, see [Self-hosting](docs/SELF-HOSTING.md). It must stay running and have a reachable HTTPS address for external clients.

## 4. Configure Zoom (optional)

The site works without Zoom credentials. You can paste a participant join link into a booking and accept it. Clients see it on their private confirmation page.

To create a unique meeting automatically when you accept a request, configure the four server variables in [Zoom setup](docs/ZOOM.md). No Zoom API request is made just by running tests or starting the app. Real creation starts when an authenticated host accepts a booking after Zoom is configured.

## Repository layout

```text
public/             Client page, admin interface, styles and browser code
server/             HTTP API, authentication, scheduling, SQLite and Zoom integration
scripts/            Local setup, syntax checks and database backup
tests/              Booking, security, persistence, live-update and Zoom tests
docs/               Deployment and Zoom instructions
.github/workflows/  GitHub checks
render.yaml         GitHub-connected live deployment
Dockerfile          Portable application image
compose.yaml        Persistent Docker deployment with optional HTTPS proxy
.env.example        Documented server environment values
```

## Commands

| Command | Purpose |
|---|---|
| `npm run setup` | Create local configuration without replacing an existing file |
| `npm start` | Start the website |
| `npm run dev` | Restart the server when source files change |
| `npm run check` | Check JavaScript syntax and inline-script policy |
| `npm test` | Run integration tests in temporary databases |
| `npm run backup -- /path/to/new-backup.sqlite` | Create a consistent SQLite backup |

## Deployment and data notes

- Run **one application process/instance** with one persistent disk. Horizontal scaling requires a shared database and shared event delivery; that is outside this configuration.
- Do not commit `.env`, credentials, database files or backups. The included ignore rules exclude these files. Store backups securely outside the server and test restoration.
- The database is initialized and versioned on first startup. Keep it between deployments. New deployments of this exported project start with an empty database; data from the earlier hosted site is not automatically copied.
- Admin sessions use server-side tokens, HttpOnly cookies, SameSite=Strict, CSRF checks and password verification. Production requires HTTPS and enables secure cookies. Sessions expire after 12 hours and are invalidated on restart.
- Public availability never includes client names, email addresses or notes. Booking tokens are stored as hashes. The token in a client’s private URL grants access to that booking’s status and join link; clients should not share it publicly.
- Zoom credentials stay on the server. Tests mock Zoom; a real Zoom account must be connected and checked before using automated meeting creation with clients.
- GitHub Actions, Docker, Render and live Zoom authorization have not been run in your accounts as part of this export. Local Linux Node 24 checks and integration tests passed; account configuration and a live end-to-end smoke test are still required.

## References

- [GitHub Pages is static hosting](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)
- [Render Blueprint configuration](https://render.com/docs/blueprint-spec)
- [Render persistent disks](https://render.com/docs/disks)
- [Node.js SQLite API](https://nodejs.org/api/sqlite.html)
- [Zoom server-to-server OAuth](https://developers.zoom.us/docs/internal-apps/s2s-oauth/)

No open-source license has been selected for your project. Choose one before distributing the repository under open-source terms.
