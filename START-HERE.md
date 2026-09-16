# Put your booking website online for free

You need a **GitHub account** and a **Cloudflare account on Workers Free**. Your website will use a free HTTPS address ending in `workers.dev`. No custom domain or Render subscription is needed.

## 1. Put the updated project in GitHub

Extract the ZIP, then open the inner folder containing `package.json` in VS Code.

If you already have a repository, clone it with GitHub Desktop, copy these project contents into that clone, then commit and push. Include the `.github` folder and the other provided Git configuration files. Do not copy a `.git` folder inside another repository. Do not copy `.env`, `.dev.vars`, `.wrangler`, local databases or `node_modules`.

For a new repository, create an empty repository at [GitHub](https://github.com/new). From this project folder, run:

```bash
git init
git add .
git commit -m "Set up free consultation booking website"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/agrim-booking.git
git push -u origin main
```

Replace `YOUR-USERNAME`. Use your normal GitHub login or GitHub Desktop. At the top level of your repository you should see `package.json`, `wrangler.jsonc`, `public/` and `cloudflare/`.

If replacing the older Render package, remove its old `render.yaml` from your repository. Removing that file does not cancel an already-running Render service. This free setup does not require Render.

## 2. Connect Cloudflare to the repository

1. Sign up or sign in at [Cloudflare](https://dash.cloudflare.com/). Stay on **Workers Free**.
2. Open **Workers & Pages → Create application** and choose the option to import/connect a Git repository. Select **Workers**, if asked which hosting product to use.
3. Connect GitHub, allow access to your booking repository, and select it.
4. Use these settings:

| Setting | Value |
|---|---|
| Worker/project name | `agrim-consultations` |
| Production branch | `main` |
| Root directory | Repository root (leave the default) |
| Build command | `npm run check && npm test` |
| Deploy command | `npm run deploy` |
| Build variable | `NODE_VERSION` = `24` |
| Non-production branch builds | Disabled for this first setup |

5. Choose **Deploy**. Cloudflare installs the locked dependencies, runs the tests, and creates the website and its persistent database from `wrangler.jsonc`.

The initial website is intentionally closed for booking until your admin password is set. If the build fails, open the build log and check the root directory, Node version and Worker name first.

## 3. Set your private admin password

Open your deployed Worker → **Settings → Variables and Secrets → Add**.

| Setting | Value |
|---|---|
| Type | Secret |
| Name | `ADMIN_PASSWORD` |
| Value | A unique random password of at least 20 characters, maximum 256 |

Use a password manager to generate and save the password. Choose **Deploy** or **Save and deploy** after adding it.

This must be a **runtime secret**, not a build variable. Do not put the password in `wrangler.jsonc`, GitHub, frontend JavaScript or chat.

## 4. Configure your calendar

Open the HTTPS website address shown by Cloudflare, for example:

`https://agrim-consultations.YOUR-SUBDOMAIN.workers.dev`

Add `/dashboard` to the same address and sign in. Select **Edit availability** and set your days, start times, notice, blocked dates and time zone. The starting time zone is Australia/Sydney; clients can view times in their own zone. The free edition starts with 30-minute consultations.

## 5. Start with free Zoom meetings

Use a free Zoom Basic account. Create a meeting in Zoom, paste its participant join link into the relevant booking, and accept it. Clients receive the link on their private confirmation page. Zoom Basic meetings have a 40-minute limit, so 30-minute consultations fit. [Zoom free meeting limits](https://www.zoom.com/en/products/virtual-meetings/features/free-video-conferencing/)

Automatic Zoom creation is optional and requires connecting your Zoom app credentials; see [docs/ZOOM.md](docs/ZOOM.md). You do not need those credentials to launch with manually added join links. Automatic email delivery and Google/Outlook calendar sync are not connected.

## 6. Check it before sharing

Open the client page in a private/incognito window while keeping your dashboard open. Request an available time. Check that the request appears in your dashboard and that the slot disappears from availability. Add a private note and Zoom join link, then accept. Check that the client confirmation updates to show the join link and does not show the note. Decline the test booking when finished, and cancel the test Zoom meeting in Zoom.

Share the public website address with clients. Keep your dashboard password and client confirmation links private.

## Future updates

Commit and push changes to `main`. Cloudflare runs the configured checks and deploys the update; the durable booking database stays in place. Your computer can be off once the website is deployed. Check the Cloudflare dashboard if you approach free usage limits. [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [storage and live-update quotas](https://developers.cloudflare.com/durable-objects/platform/pricing/)

If a free quota is exhausted, requests may fail until it resets. Stay on the Free plan to keep hosting at $0. This package has been prepared for deployment; your accounts still need to be connected and the live setup checked.
