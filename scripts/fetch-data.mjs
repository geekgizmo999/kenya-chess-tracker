// Pulls every Chess.com account flagged "Kenya" + their ratings, records, and
// today's game count, and writes a single data.json the site loads instantly.
//
// Run with: node scripts/fetch-data.mjs
// Needs Node 18+ (built-in fetch). No dependencies.

import { writeFile } from "node:fs/promises";

const COUNTRY_CODE = "KE";

// Chess.com's country directory (fetched below) can lag for weeks after someone
// sets their flag to Kenya — sometimes it just never catches up. Add usernames
// here (lowercase) for real Kenyan players who should show up regardless of
// whether Chess.com's own list has noticed them yet. Duplicates with the
// official list are handled automatically, so it's safe to add someone here
// even if they later do show up in the country list too.
const MANUAL_ADDITIONS = [
  "simonwangombe",
  // "Elishahezekiah",
  "lolbulinda"
  "Perky_Peril"
  "Kenyaan_coco"
];
const CONCURRENCY = 8;        // how many players are processed at once
const DELAY_MS = 120;         // pause between requests per worker, stay polite to the API
const MAX_RETRIES = 2;        // retry transient failures before giving up on a player
const OUT_FILE = new URL("../data.json", import.meta.url);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJSON(url, { allow404 = false } = {}) {
  const res = await fetch(url, {
    headers: { "User-Agent": "KE64-KenyaChessTracker/1.0 (contact: wangombsimon@gmail.com)" }
  });
  if (res.status === 404 && allow404) return null;
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

// Retries a fetch a few times before giving up — this is the fix for real
// players silently vanishing from the site due to a one-off network blip
// or a transient rate-limit response.
async function fetchWithRetry(url, opts = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetchJSON(url, opts);
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_RETRIES) await sleep(400 * (attempt + 1)); // back off a bit more each retry
    }
  }
  throw lastErr;
}

function todayUTCString() {
  return new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
}

async function fetchGamesToday(username) {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const url = `https://api.chess.com/pub/player/${username}/games/${yyyy}/${mm}`;
  const data = await fetchWithRetry(url, { allow404: true });
  if (!data || !Array.isArray(data.games)) return 0;
  const today = todayUTCString();
  return data.games.filter(g => {
    if (!g.end_time) return false;
    const gameDate = new Date(g.end_time * 1000).toISOString().slice(0, 10);
    return gameDate === today;
  }).length;
}

function extractRecord(stats, key) {
  const r = stats[key]?.record;
  if (!r) return null;
  return { win: r.win ?? 0, loss: r.loss ?? 0, draw: r.draw ?? 0 };
}

async function fetchPlayerRecord(username) {
  const [profile, stats] = await Promise.all([
    fetchWithRetry(`https://api.chess.com/pub/player/${username}`),
    fetchWithRetry(`https://api.chess.com/pub/player/${username}/stats`),
  ]);

  // If this one extra call fails (rate limit, hiccup, whatever), don't let it
  // take the whole player down — they still have real ratings worth keeping.
  let gamesToday = null;
  try {
    gamesToday = await fetchGamesToday(username);
  } catch (e) {
    gamesToday = null; // shows as "—" on the site instead of silently vanishing the player
  }

  return {
    username: profile.username || username,
    name: profile.name || null,
    avatar: profile.avatar || null,
    title: profile.title || null,
    url: profile.url || `https://www.chess.com/member/${username}`,
    ratings: {
      rapid: stats.chess_rapid?.last?.rating ?? null,
      blitz: stats.chess_blitz?.last?.rating ?? null,
      bullet: stats.chess_bullet?.last?.rating ?? null,
      daily: stats.chess_daily?.last?.rating ?? null,
    },
    records: {
      rapid: extractRecord(stats, "chess_rapid"),
      blitz: extractRecord(stats, "chess_blitz"),
      bullet: extractRecord(stats, "chess_bullet"),
      daily: extractRecord(stats, "chess_daily"),
    },
    gamesToday,
  };
}

// Concurrency-limited worker pool, with a small delay between each request.
// Failures are collected (with the reason) instead of silently dropped,
// so you can actually see *why* someone didn't make it into data.json.
async function mapLimit(items, limit, fn) {
  const results = [];
  const failures = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await fn(items[idx]);
      } catch (e) {
        failures.push({ username: items[idx], reason: e.message });
        results[idx] = null;
      }
      await sleep(DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return { results: results.filter(Boolean), failures };
}

function average(nums) {
  const valid = nums.filter(n => n !== null && n !== undefined);
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

async function main() {
  console.log(`Fetching Kenya roster…`);
  const { players: officialUsernames } = await fetchWithRetry(
    `https://api.chess.com/pub/country/${COUNTRY_CODE}/players`
  );

  const officialSet = new Set(officialUsernames.map(u => u.toLowerCase()));
  const extras = MANUAL_ADDITIONS.filter(u => !officialSet.has(u.toLowerCase()));
  const usernames = [...officialUsernames, ...extras];

  console.log(`Found ${officialUsernames.length} accounts flagged Kenya, plus ${extras.length} manual addition(s). Fetching stats…`);

  const { results: rawPlayers, failures } = await mapLimit(usernames, CONCURRENCY, fetchPlayerRecord);
  if (failures.length) {
    console.log(`${failures.length} accounts failed even after retries — see "failures" in data.json.`);
  }

  // Skip accounts with no rating in any format — these have never played a rated game
  // and just add noise/slowness without being useful on a leaderboard.
  const skippedUnrated = [];
  const players = rawPlayers.filter((p) => {
    const r = p.ratings;
    const hasRating = r.rapid !== null || r.blitz !== null || r.bullet !== null || r.daily !== null;
    if (!hasRating) skippedUnrated.push(p.username);
    return hasRating;
  });
  console.log(`${rawPlayers.length} accounts fetched, ${players.length} have at least one rating — keeping those.`);

  players.sort((a, b) => (b.ratings.rapid ?? -1) - (a.ratings.rapid ?? -1));

  const communityStats = {
    avgRapid: average(players.map(p => p.ratings.rapid)),
    avgBlitz: average(players.map(p => p.ratings.blitz)),
    avgBullet: average(players.map(p => p.ratings.bullet)),
    avgDaily: average(players.map(p => p.ratings.daily)),
    gamesToday: players.reduce((sum, p) => sum + (p.gamesToday || 0), 0),
  };

  const payload = {
    generatedAt: new Date().toISOString(),
    countryCode: COUNTRY_CODE,
    totalFound: usernames.length,
    totalWithData: players.length,
    communityStats,
    players,
    // Kept for debugging "why isn't X showing up" — not used by the site UI.
    skippedUnrated,
    failures,
  };

  await writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${players.length} player records to data.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
