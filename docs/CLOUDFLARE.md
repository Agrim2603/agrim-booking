# Cloudflare hosting and maintenance

The website uses a Worker to serve static files and forward API calls to one SQLite-backed Durable Object. The object stores bookings, availability, sessions and rate limits, and sends WebSocket notifications to open pages. No separate D1 database or paid disk is required.

The object uses WebSocket hibernation and automatic ping responses so idle connections do not keep application code running. Notifications contain only `ready` or `change`, never client details. Admin connections are authenticated; private-note changes only notify admin connections. Clients then retrieve permitted data through the usual API. Disconnected visible pages refresh every 30 seconds; connected pages also reconcile every five minutes and when focused.

## Configuration

| Value | Where it goes |
|---|---|
| `ADMIN_PASSWORD` | Worker runtime **secret**, 20–256 characters; use a random value |
| `ZOOM_ACCOUNT_ID`, `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET`, `ZOOM_HOST_USER_ID` | Optional Worker runtime secrets for automatic Zoom creation |
| `PUBLIC_ORIGIN` | Optional runtime variable for one canonical HTTPS custom domain |
| `NODE_VERSION=24` | Build environment variable |
| `.dev.vars` | Local development secrets only; ignored by Git |

No environment values need to be committed for the free deployment. The first request initializes the database automatically. Regular updates retain the database. Changing `ADMIN_PASSWORD` invalidates existing admin sessions; sign in again after rotating it.

Keep the `BookingRoom` class, `BOOKING_ROOM` binding, `primary-calendar-v1` object name, Worker name and existing migration history stable. Do not delete/recreate the Worker to update it. A new identity creates a different database and does not migrate old bookings.

The GitHub Build token needs the Worker deployment permissions offered by Cloudflare's normal Git integration. The SQLite namespace is created through the Worker migration; there is no manual database identifier to paste. If Cloudflare shows a permissions error, review the integration's access to your account rather than placing an API token in your repository. [Workers Builds configuration](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/)

## Export your bookings

While signed in to your live dashboard, open `/api/admin/export` on the same website. Your browser downloads `agrim.booking-backup.json`, containing bookings, settings and private notes. Keep it in secure storage outside GitHub. It includes hashed client tokens but no admin password or session cookies.

This is a portable JSON data export, not a one-click restore mechanism. An import/restore workflow is not included. Keep the original Worker database and ask for migration help before moving providers. Do not delete a production Worker after taking an unverified backup. Local `.wrangler` data and the optional Node database are separate from the live database.

## Free-plan limits

Use the Cloudflare dashboard's usage views. Limits apply across your account and cover API requests, database reads/writes, storage and compute. Static files do not invoke the main Worker by default. On Workers Free, exhausted quotas return errors; recovery depends on the quota reset or freeing storage. Upgrading would change this cost model, so remain on Free for this setup.

- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
- [Storage and compute limits](https://developers.cloudflare.com/durable-objects/platform/limits/)
- [GitHub build allowances](https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/)

## Local commands and validation

`npm run setup:free` generates a local password. `npm run dev` runs Cloudflare's local emulator with durable data under `.wrangler/`. `npm test` creates isolated temporary databases, bundles the Worker, and exercises the API using Cloudflare's local runtime plus the optional Node backend. Tests never create real Zoom meetings or deploy cloud resources.

Local validation covers normal booking/approval, privacy, conflicting reservations and edits, authentication, restart persistence, WebSocket updates and mocked Zoom calls. Cloudflare account deployment, provider quotas and live Zoom authorization require the account-level check in [START-HERE.md](../START-HERE.md).
