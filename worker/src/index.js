// KE64 submit-a-player endpoint (Cloudflare Worker).
//
// POST /api/submit  { username, website (honeypot), turnstileToken? }
//  - validates the Chess.com account exists AND its country is Kenya (KE)
//  - appends the username to additions.json in the GitHub repo
//  - the daily job then picks it up and the player appears on the board
//
// Secrets (wrangler secret put ...): GITHUB_TOKEN, optional TURNSTILE_SECRET
// Vars (wrangler.toml): GITHUB_REPO, GITHUB_BRANCH, ADDITIONS_PATH, ALLOWED_ORIGINS

const UA = "KE64-KenyaChessTracker/1.0 (+https://kenya-chess-tracker.onrender.com)";

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const allow = origin && allowed.includes(origin) ? origin : allowed[0] || "*";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function normalizeUsername(raw) {
  if (typeof raw !== "string") return null;
  let u = raw.trim().toLowerCase();
  // Accept a pasted profile URL too, e.g. chess.com/member/Foo
  const m = u.match(/chess\.com\/member\/([^/?#]+)/);
  if (m) u = m[1];
  if (!/^[a-z0-9_-]{3,25}$/.test(u)) return null;
  return u;
}

async function verifyTurnstile(token, secret, ip) {
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token || "");
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  return !!data.success;
}

async function chessComPlayer(username) {
  const res = await fetch(`https://api.chess.com/pub/player/${username}`, {
    headers: { "User-Agent": UA },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`chess.com ${res.status}`);
  return res.json();
}

async function githubGetAdditions(env) {
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${env.ADDITIONS_PATH}?ref=${env.GITHUB_BRANCH}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": UA,
    },
  });
  if (!res.ok) throw new Error(`github get ${res.status}`);
  const data = await res.json();
  const content = JSON.parse(atob(data.content.replace(/\n/g, "")));
  const usernames = Array.isArray(content?.usernames) ? content.usernames : [];
  return { usernames, sha: data.sha };
}

async function githubPutAdditions(env, usernames, sha, username) {
  const body = {
    message: `Add ${username} via submit form`,
    content: btoa(JSON.stringify({ usernames }, null, 2) + "\n"),
    sha,
    branch: env.GITHUB_BRANCH,
  };
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/${env.ADDITIONS_PATH}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": UA,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  return res;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    const cors = corsHeaders(origin, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/api/submit") {
      return json({ error: "Not found" }, 404, cors);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400, cors);
    }

    // Honeypot: real users leave this empty; bots fill it.
    if (payload.website) return json({ ok: true }, 200, cors);

    const username = normalizeUsername(payload.username);
    if (!username) {
      return json({ error: "Enter a valid Chess.com username." }, 400, cors);
    }

    // Optional spam protection.
    if (env.TURNSTILE_SECRET) {
      const ok = await verifyTurnstile(
        payload.turnstileToken,
        env.TURNSTILE_SECRET,
        request.headers.get("CF-Connecting-IP")
      );
      if (!ok) return json({ error: "Spam check failed — please retry." }, 400, cors);
    }

    // Validate the account exists and is flagged Kenya.
    let player;
    try {
      player = await chessComPlayer(username);
    } catch (e) {
      return json({ error: "Couldn't reach Chess.com, try again shortly." }, 502, cors);
    }
    if (!player) {
      return json({ error: `No Chess.com account named "${username}".` }, 404, cors);
    }
    if (!(player.country || "").endsWith("/KE")) {
      return json(
        { error: "That account's Chess.com country isn't set to Kenya, so it can't be auto-added." },
        422,
        cors
      );
    }

    // Append to additions.json (retry once on a concurrent-edit conflict).
    for (let attempt = 0; attempt < 2; attempt++) {
      let current;
      try {
        current = await githubGetAdditions(env);
      } catch (e) {
        return json({ error: "Server storage error." }, 500, cors);
      }
      const set = new Set(current.usernames.map((u) => String(u).toLowerCase()));
      if (set.has(username)) {
        return json({ ok: true, already: true, message: "Already on the list — it'll appear after the next daily refresh." }, 200, cors);
      }
      const next = [...current.usernames, username];
      const res = await githubPutAdditions(env, next, current.sha, username);
      if (res.ok) {
        return json({ ok: true, message: "Added! It'll appear after the next daily refresh." }, 200, cors);
      }
      if (res.status === 409) continue; // sha changed, retry
      return json({ error: "Couldn't save submission." }, 500, cors);
    }
    return json({ error: "Busy, please retry." }, 503, cors);
  },
};
