# Host from your own server

The GitHub repository contains both the website and its backend. You need a computer/server that stays online, persistent storage, a domain pointing to it, and HTTPS. Merely enabling GitHub Pages will not run this project.

## Docker with automatic HTTPS

1. Install Docker Engine with Compose on your server and clone your GitHub repository.
2. Create `.env` from `.env.example`. Set a unique random `ADMIN_PASSWORD` with at least 16 characters.
3. Set `PUBLIC_ORIGIN=https://booking.your-domain.example` and add `SITE_DOMAIN=booking.your-domain.example` to `.env`. Replace the example with your real domain.
4. Point the domain to your server. Allow incoming TCP 80 and 443. For home hosting, your router must forward them to the server, and the internet connection must permit inbound traffic. Carrier-grade NAT can prevent direct inbound access; use a suitable tunnel/reverse proxy or a hosted server in that case.
5. Start the complete stack:

```bash
docker compose --profile https up -d --build
docker compose logs --tail=50 app
```

The app uses a named Docker volume for SQLite. Caddy handles HTTPS and streams live updates. The app’s HTTP port is bound to loopback on the host, while Caddy is public. `TRUST_PROXY=true` is intended only behind your trusted reverse proxy; do not directly expose the Node HTTP port.

If you already manage HTTPS with another reverse proxy, run `docker compose up -d --build` without the `https` profile and proxy the same public origin to `127.0.0.1:3000`. Disable response buffering for `/api/events` and `/api/admin/events`, and allow long-lived event streams.

## Update from GitHub

Commit and push changes to GitHub. After the checks pass, run on your server:

```bash
git pull --ff-only
docker compose --profile https up -d --build
```

This rebuilds the application while retaining the data volume. Do **not** use `docker compose down -v` for routine updates; it deletes the named data volumes. Only one instance should use this database. A restart briefly interrupts streaming updates; browsers reconnect automatically.

## Back up and restore

Create a consistent snapshot inside the container:

```bash
docker compose exec app node scripts/backup.mjs /app/data/manual-backup.sqlite
docker compose cp app:/app/data/manual-backup.sqlite ./manual-backup.sqlite
```

Use a new filename each time. Copy the backup to secure off-server storage. Backups include client information and private notes and must not be committed to GitHub.

To restore, stop the application, preserve a copy of the current data volume, replace `bookings.sqlite` with the backup, and remove only the old database’s `bookings.sqlite-wal` and `bookings.sqlite-shm` companion files while the app is stopped. Restore ownership so the Node user can read and write it, then start the application. Never replace a database while the server is running.

## Before accepting real clients

Open the public page in a separate browser from the admin dashboard. Submit a test request, verify the slot disappears, accept it, and check the private confirmation link. Check a second anonymous browser cannot read `/api/admin/bookings`. Verify your available hours, Zoom joining behavior and backup location.

This configuration does not automatically synchronize with Google/Outlook or send email. Keep external calendar conflicts reflected in your availability until a calendar integration is added.
