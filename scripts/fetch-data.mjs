// Pulls every Chess.com account flagged "Kenya" + their ratings,
// and writes a single data.json that the site loads instantly (no live API calls in the browser).
//
// Run with: node scripts/fetch-data.mjs
// Needs Node 18+ (built-in fetch). No dependencies.

import { writeFile } from "node:fs/promises";

const COUNTRY_CODE = "KE";
const CONCURRENCY = 8;        // how many stat-fetches run at once
const DELAY_MS = 120;         // small pause between requests to stay polite to the API
const OUT_FILE = new URL("../data.json", import.meta.url);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "KE64-KenyaChessTracker/1.0 (contact: your-email@example.com)" }
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function fetchPlayerRecord(username) {
  const [profile, stats] = await Promise.all([
    fetchJSON(`https://api.chess.com/pub/player/${username}`),
    fetchJSON(`https://api.chess.com/pub/player/${username}/stats`),
  ]);
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
  };
}

// Concurrency-limited worker pool, with a small delay between each request.
async function mapLimit(items, limit, fn) {
  const results = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      try {
        results[idx] = await fn(items[idx]);
      } catch (e) {
        console.warn(`  skip ${items[idx]}: ${e.message}`);
        results[idx] = null;
      }
      await sleep(DELAY_MS);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results.filter(Boolean);
}

async function main() {
  console.log(`Fetching Kenya roster…`);
  const { players: usernames } = await fetchJSON(
    `https://api.chess.com/pub/country/${COUNTRY_CODE}/players`
  );
  console.log(`Found ${usernames.length} accounts flagged Kenya. Fetching stats…`);

  const players = await mapLimit(usernames, CONCURRENCY, fetchPlayerRecord);

  // Sort once here too, so even a raw view of data.json is already useful.
  players.sort((a, b) => (b.ratings.rapid ?? -1) - (a.ratings.rapid ?? -1));

  const payload = {
    generatedAt: new Date().toISOString(),
    countryCode: COUNTRY_CODE,
    totalFound: usernames.length,
    totalWithData: players.length,
    players,
  };

  await writeFile(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${players.length} player records to data.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
