# KE64 submit-a-player endpoint (Cloudflare Worker)

Lets visitors suggest a Chess.com username. If the account exists **and** its
Chess.com country is set to Kenya, the Worker appends the username to
`additions.json` in this repo. The daily GitHub Action reads that file, so the
player shows up on the next refresh.

## One-time deploy

1. Install Wrangler and log in to your Cloudflare account:
   ```bash
   npm install -g wrangler
   wrangler login
   ```

2. Create a **fine-grained GitHub Personal Access Token** with access limited to
   the `geekgizmo999/kenya-chess-tracker` repo and **Repository permissions →
   Contents: Read and write**. Then store it as a Worker secret:
   ```bash
   cd worker
   wrangler secret put GITHUB_TOKEN
   # paste the token when prompted
   ```

3. (Optional) Add spam protection with Cloudflare Turnstile. Create a widget at
   dash.cloudflare.com → Turnstile, then:
   ```bash
   wrangler secret put TURNSTILE_SECRET
   ```
   and add the Turnstile client widget to the form in `index.html` (send the
   token as `turnstileToken` in the POST body).

4. Deploy:
   ```bash
   wrangler deploy
   ```
   Wrangler prints the URL, e.g. `https://ke64-submit.<your-subdomain>.workers.dev`.

5. Put that URL (with `/api/submit`) into `SUBMIT_ENDPOINT` near the bottom of
   `index.html`, commit, and push.

## Config (`wrangler.toml` `[vars]`)

- `GITHUB_REPO` — `owner/repo` to write to.
- `GITHUB_BRANCH` — branch to commit to (`main`).
- `ADDITIONS_PATH` — file to append to (`additions.json`).
- `ALLOWED_ORIGINS` — comma-separated origins allowed to call the endpoint (CORS).

## API

`POST /api/submit`

```json
{ "username": "somebody", "website": "" }
```

- `website` is a honeypot — leave empty; bots that fill it get a silent no-op.
- Returns `{ ok: true, message }` on success, or `{ error }` with a 4xx/5xx.
