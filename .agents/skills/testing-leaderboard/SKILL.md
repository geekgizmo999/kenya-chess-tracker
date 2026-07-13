---
name: testing-leaderboard
description: Test the KE64 Kenya Chess.com leaderboard (index.html) end-to-end — search ranking, share rank-card modal, sort/medals, and branding. Use when verifying UI changes to the leaderboard.
---

# Testing the KE64 leaderboard

Single static page: `index.html` fetches `./data.json` (~9,600 players), renders a paginated
table (`PAGE_SIZE = 25`), sortable by Rapid/Blitz/Bullet/Daily/**Best rating**/A–Z. Per-row share
icon opens a canvas rank-card modal. Columns include **Win %** (derived from `records{win,loss,draw}`)
and a **Titled only** filter toggle. Search, sort, and the titled filter are mirrored into the URL
(`?q=&sort=&titled=1`) and restored on load.

## Where to test
- **Preferred:** the PR's Netlify deploy preview (`https://deploy-preview-<N>--kenya-chess-tracker.netlify.app`).
  It's public, no auth, and serves the real `data.json`. Find the URL in the PR's netlify[bot] comment
  or via `git_pr_checks`.
- **Local fallback:** `python3 -m http.server 8100` from the repo root, open `http://localhost:8100/index.html`.
  Needs a `data.json` next to `index.html` (the repo's committed one works).
- JS syntax check without a browser:
  `awk '/^<script>$/{f=1;next} /^<\/script>$/{f=0} f' index.html > /tmp/ke64.js && node --check /tmp/ke64.js`

## Core assertions (each designed so a broken build looks different)
1. **Search keeps true rank** — search a known mid-table player (e.g. `gm_nyandoro` ≈ #7). The row must
   show its full-list rank, NOT #1, and with no gold medal. This is the classic regression: filtering
   before ranking makes any search result show as #1.
2. **Rank card** — click the row's share icon; the modal's big number must match the row's rank; `Esc` closes it.
3. **Medals** — only ranks 1/2/3 are gold/silver/bronze on rating sorts; ranks 4+ plain; A–Z shows no medals.
4. **Sort ↔ header sync** — changing the sort dropdown reorders rows and highlights the matching column
   header; the "Record (X)" and "Win % (X)" header labels follow the sort.
5. **Branding** — KE64 crown logo + wordmark in the hero, same `assets/favicon.svg` in the browser tab.
6. **Win %** — must equal `win/(win+loss+draw)` for the active format and change when the sort changes
   (e.g. a player is 65% under Rapid but 60% under Blitz). Renders "—" when the player has no games.
7. **Titled only** — toggling shows only players with a title (GM/IM/NM/WFM/WCM…) at their TRUE ranks
   (e.g. #4/#44/#90, NOT renumbered 1-3); toggle turns gold; URL gains `titled=1`.
8. **Best rating** sort — ranks by each player's single highest rating across formats; a bullet/blitz
   specialist can outrank a higher-rapid player. Record/Win% then follow each player's own best format.
9. **Deep links** — loading `?q=<user>&sort=blitz` directly must pre-fill search, select the sort,
   highlight the header, and show the player's true rank (not #1). Validate `sort` against the allowed
   keys so a junk `?sort=xyz` is ignored.

## Tips
- The table only renders the current page (25 rows); use search to isolate a specific player quickly.
- Use the `zoom` action on rank cells / headers to confirm medal coloring and header highlight — colors
  are subtle at full-screen scale.
- Dismiss the Netlify "Deploy Preview" banner before recording so it doesn't cover row 7+.
- Player ranks shift daily as data refreshes; pick the search target from the current top of the list
  rather than hard-coding a rank.

## Devin Secrets Needed
None — the deploy preview and local server require no credentials.
