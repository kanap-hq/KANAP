# Marketing redesign — assumption log

Running record of decisions I made autonomously while building phases 2–8
without stopping to ask. Review each before we push to prod.

Format: **Decision**, **Why**, **Alternative if you disagree**.

---

## Global

### A-1. Positioning pillars — REVISED 2026-06-27 (review of the agentic refonte)
**Decision (current):** Five pillars on the home, in this order: the three originals (**Practitioner-built · Simple & powerful · Truly open source**) plus two new ones (**The whole IT department in one system · Agents that take work off your team**). The plan §1.2 proposed *replacing* the originals with a new triad; in review we chose to keep the originals and add the breadth + agents angle instead. The would-be third new pillar ("Open source, self-hosted, yours to extend") was dropped as redundant with "Truly open source".
**Why:** Extend the existing home rather than replace it. The home keeps the platform's identity; the deep agent narrative lives on `/features/agents`, not the home. ("Radically affordable" remains retired as a headline claim; affordability stays factual on `/offer`.)
**Alternative:** Trim back to a single positioning triad if five pillars read as too many.

### A-2. License framing
**Decision:** AGPL v3 (taken from the old site's JSON-LD). Mentioned on `/offer`, `/on-premise`, `/security`, footer.
**Why:** The old site's structured data listed AGPL v3.
**Alternative:** Different license — tell me and I'll update everywhere.

### A-3. GitHub URL
**Decision:** `https://github.com/kanap-hq/kanap` (public repo per CLAUDE.md).
**Why:** Matches the remote in CLAUDE.md.

### A-4. App / docs URLs
**Decision:** `https://app.kanap.net` (sign-in target), `https://doc.kanap.net` (docs).
**Why:** Current production subdomains referenced in the existing site.

### A-5. Plaid (AI assistant) — EXTENDED 2026-06-26 (plan §11)
**Decision:** KANAP now presents **two AI surfaces over one record**: **Plaid** is the interaction layer (a person asks questions and makes changes in plain language) and **Agents** are the action layer (autonomous work over the same record, under measured trust). Plaid is still named on `/features/ai` and the homepage module strip and is still positioned as MCP-capable; the `/features/ai` page is reframed as the human-driven counterpart to Agents, and the two cross-link ("ask versus act").
**Why:** The agent runtime is real and is the headline strength; the site must show both surfaces without conflating them.
**Alternative:** Collapse both under a single "AI" page if the two-surface split confuses visitors.

### A-6. Trust strip placeholder
**Decision:** Homepage has an empty "Used by IT teams worldwide" slot with a soft "share your story" link to `/contact`, not hidden. Logos are placeholder SVGs I can swap out when you have them.
**Why:** You said: prepare the section.

### A-7. Currency
**Decision:** All pricing in EUR (€), same as the old site.

---

## Pricing

### A-8. Cloud pricing values — SUPERSEDED 2026-06-26 (plan §6.10 / §10.3 / §11)
**Decision (current):** A **single Hosted KANAP plan at €249/mo or €2,490/yr**. The old Starter / Standard / Max tiers (and any other) are obsolete; every reference is purged from copy. Hosted includes all features, agents included (BYO LLM key), cloud hosting, auto updates, isolated data, support.
**Retired:** Starter €49/mo · Standard €149/mo · Max €249/mo with per-tier contributor and Plaid-message caps.
**Why:** Pricing settled to one clear hosted plan alongside the free self-hosted product. Locked in `REFONTE-AGENTIC.md` §10.3.
**Reconciliation status (2026-06-27):** the live GTC (`content/legal/en.ts` `sales`) is already tier-agnostic, Article 4 references "multiple plans described on the pricing page" with no tier names, so it needs no refonte rewrite. The obsolete Free/Starter/Standard copy lived only in the old `marketing/site/sales.html`, which has been deleted. A general counsel review of the GTC remains a standing legal item, not a refonte blocker.

### A-9. Support-contract pricing — RESOLVED
**Decision:** Self-Hosted Support: €2,490/yr, annual billing only. Includes all features, unlimited contributors, priority email support, 20% consulting discount, BYOK for Plaid.
**Why:** From the old offer page.

### A-9b. Consulting rates — RESOLVED
**Decision:** Included on `/offer`: 1h €190 / subscriber €150; half-day €690 / €550; full-day €1,250 / €1,000.
**Why:** From old offer page table.

### A-10. Trial length
**Decision:** "14-day free trial" mentioned on `/trial/start` and CTAs.
**Why:** `TRIAL_PERIOD_DAYS` default in `backend/src/public/public.controller.ts` was 14.
**Alternative:** Different duration.

---

## Pages / sitemap

### A-11. New pages scope
Built in phases: `/changelog`, `/security`, `/on-premise`. Confirmed in chat.
**Extended 2026-06-26:** add `/features/agents` (+ `/fr`, `/de`, `/es` variants) to the sitemap. It is a new top section of the Features area, reachable from the Features dropdown and the footer Product group. See A-36.

### A-12. Legal pages
**Decision:** I ported the content from the old `/privacy`, `/terms`, `/sales`, `/legal` pages into the new shell verbatim, with only minor typographic cleanup. Did not rewrite legal copy.
**Why:** Legal copy shouldn't change based on a design refresh without explicit review by you or counsel.

### A-13. Changelog content
**Decision:** I seeded `/changelog` with one generic "April 2026 — New marketing site" entry as a template. Future entries are expected to be written as MDX in `src/content/changelog/`.
**Why:** I don't have authoritative changelog history.

---

## Conversion funnel

### A-14. Trial signup form fields
**Decision:** Same 5 fields as the current `activate.html` modal: organization name, country, subdomain slug, admin email, CAPTCHA.
**Why:** The backend endpoint `/api/public/start-trial` expects these.

### A-15. CAPTCHA provider
**Decision:** Cloudflare Turnstile (matches the old site). Site key is read from `PUBLIC_TURNSTILE_SITE_KEY` at build time; falls back to a placeholder that lets the form render but warns in console. Real key must be set in `.env` before production.
**Why:** Old site used Turnstile; keeps backend unchanged.
**Action for you:** Set `PUBLIC_TURNSTILE_SITE_KEY` in your build env.

### A-16. `/trial/start` replaces the modal-on-offer approach
**Decision:** The "Start free trial" CTA opens a dedicated `/trial/start` page rather than a modal.
**Why:** Shareable URL, trackable funnel step, simpler responsive behavior. Explained in the plan.

### A-17. `/trial/check-email` is new
**Decision:** Post-submit the user lands on `/trial/check-email?email=...` which confirms the email was sent and tells them what to do next. The old flow just showed an inline status string.
**Why:** Better conversion UX, clearer mental model.

### A-18. Activation handoff unchanged
**Decision:** After workspace is created, `/trial/activate` redirects to `{tenant_url}/reset-password#{token}?from=trial` — same as the current flow.
**Why:** Backend contract unchanged.

---

## SEO / analytics

### A-19. Analytics
**Decision:** No analytics script in the site. Audience is measured with Cloudflare Web Analytics, which is cookieless and injected at the Cloudflare edge. Google Analytics was removed.
**Why:** No cookies, no consent banner, nothing stored on the visitor's device.

### A-20. Sitemap generation
**Decision:** Using `@astrojs/sitemap` with per-locale entries (`/`, `/fr/`, `/de/`, `/es/`) and `i18n` config. Auto-generated at build.
**Why:** Zero-maintenance, always in sync with routes.

### A-21. JSON-LD
**Decision:** `SoftwareApplication` + `Organization` on homepage; `WebPage` + `Product` on `/offer`; `FAQPage` on `/faq`; `BreadcrumbList` on feature pages.
**Why:** Matches/extends the old site's structured data.

### A-22. OG images
**Decision:** Default `og-image.png` for all pages, with **per-page OG now supported** (2026-06-27): `BaseLayout` takes an optional `ogImage` prop, and `scripts/og.mjs` renders branded 1200×630 cards into `public/og/<name>.png` (puppeteer-core + system chromium, same setup as `shoot.mjs`). The first tailored card, `public/og/agents.png`, is wired on `/features/agents`. Add more pages to the `CARDS` map in `scripts/og.mjs` and pass `ogImage` from the page.

### A-23. Canonical domain
**Decision:** `https://kanap.net` (matches old site's `site` config).

---

## Design / charter

### A-24. Teal scope on marketing
**Decision:** Teal is used only for (1) primary CTAs, (2) active nav underline, (3) prose/inline links, (4) focus rings, (5) the contact-us / "share your story" action links. Not for feature card accents, not for icons, not for module names.
**Why:** App charter explicitly bans teal everywhere else.

### A-25. Module accent colors
**Decision:** Marketing modules (Budget / IT-Ops / Portfolio / Knowledge / AI) are **not color-coded**. They are neutrally styled cards. The old site had Budget=blue / IT-Ops=purple / Portfolio=teal — I dropped this.
**Why:** Charter: "monochrome-dominant. Color signifies, not decorates." Module badges are decorative.
**Alternative:** Bring back module accent colors if you want visual distinction on the hub page.

### A-26. Typography
**Decision:** Inter 400/500 only. Hero 56–72px (display scale), section 32–40px, body 15px. App typography scale (14/13/12/11) applies everywhere else.
**Why:** Charter rule.

### A-27. No heavy shadows
**Decision:** Cards use the charter's card treatment exactly (border + hover shadow). No floating "3D" effects.

### A-28. Dark mode contrast check
**Decision:** Every new component is tested against both `:root` (light) and `:root[data-theme="dark"]`. No hardcoded colors in any component.

---

## Tech

### A-29. Font delivery
**Decision:** Inter + JetBrains Mono via Google Fonts (`<link>` preconnect). Not self-hosted in phase 1. I recommend switching to `@fontsource-variable/*` before launch for privacy and perf. Flagged in phase 8.

### A-30. MDX for content
**Decision:** Feature pages use Astro components with content in TypeScript arrays, not MDX. MDX pulled in would add @astrojs/mdx dependency with no concrete benefit for phase 1–5. Could revisit for `/changelog` where long-form content matters.

### A-31. Old `marketing/site/` directory
**Decision:** Left untouched but excluded from Docker build (via `.dockerignore`). Delete-whenever-ready.

### A-32. Content in locale JSONs
**Decision:** Page body copy lives in `src/i18n/{locale}.json`. Very long prose (legal pages, eventually the changelog) goes in per-locale Astro pages to avoid JSON bloat. FR/DE/ES copy is my best effort; Phase 6 refines with `/translate`.

---

## Known open items — for your review

### Content / business decisions
1. Pricing settled (A-8 superseded) — single Hosted KANAP plan at €249/mo or €2,490/yr; old tiers purged. Confirm the offer TypeScript files in `src/content/offer/` read this way after the Phase 2 pass.
2. Self-Hosted Support pricing (A-9) — I kept €2,490/yr; confirm or update
3. ~~GTC legal document lists Free/Starter/Standard tiers~~ — RESOLVED 2026-06-27: the live GTC is already tier-agnostic (Article 4 points to the pricing page, no tier names); obsolete tier copy lived only in the deleted `marketing/site/`. A general counsel review of the GTC stays a standing item.
4. **Connector / agent lead-capture funnel** — "Ask for a connector" links to `/contact` from the Agents page, the connector/transparency block, and Contact. This is a conversion path alongside the trial funnel. Confirm where these leads should land (shared inbox vs. dedicated form) before launch.
5. Real testimonials (A-6) — the homepage has a placeholder "trust strip" pointing to `/contact` for stories. Fill it in when you have any
6. Per-page OG images (A-22) — per-page OG is now wired and `/features/agents` has its own card (`scripts/og.mjs` → `public/og/agents.png`). Still using the default elsewhere; add cards for `/offer`, other `/features/*`, `/security` when wanted.
7. Module accent colour decision (A-25) — currently monochrome. Worth revisiting on the `/features` hub for visual distinction?

### Infrastructure / deployment
8. Set `PUBLIC_TURNSTILE_SITE_KEY` in the build env before production for `/trial/start` (form works without it locally but should have it on for real traffic)
9. Analytics: Cloudflare Web Analytics is injected at the edge (zone RUM set to "Enable"); nothing to configure in the build
10. Font self-hosting (A-29) — currently Google Fonts. Swap to `@fontsource-variable/inter` + `@fontsource-variable/jetbrains-mono` before prod for privacy/perf
11. Delete or archive old `marketing/site/` — no longer built or served, kept for reference

### Translations
12. **Legal pages (privacy, terms, sales, legal) are English-only.** FR/DE/ES routes render the same English text with a "currently available in English only" banner. Professional legal translation required before these can be binding in other jurisdictions
13. **FR content was written by me.** DE and ES for homepage/offer/on-premise were also hand-written by me. Feature pages + secondary pages (FAQ, security, changelog, contact) DE/ES were generated by a translation agent using the FR files as a reference. Review the Spanish and German feature copy before prod; the translations are reasonable but a native reviewer will catch nuance
14. **Agentic refonte is EN-first (A-37).** The new `/features/agents` page renders EN in all locales (fr/de/es re-export en), and the rewritten home/Plaid copy lands in `*/en.ts` only, so FR/DE/ES temporarily show the pre-refonte positioning. Run `/extract` then `/translate` before launch so all locales tell the new story.

### Changes from the old site
15. URL rename `/features/it-ops` → `/features/it-landscape` (A-33). 301 redirect is already configured in `nginx.conf`. No action needed on your side — this is done.
16. `/activate.html` is gone; replaced by `/trial/activate`. 301 redirect in place.
17. The modal-on-offer trial form is now a real page at `/trial/start`. Old offer-page-scroll-to-modal anchors will no longer work — update any external links.
18. Trial funnel added two new pages: `/trial/check-email` and `/trial/expired`. These didn't exist in the old flow. The backend contract (POST `/api/public/start-trial`, POST `/api/public/activate-trial`) is unchanged.

### A-33. IT Ops URL rename
**Decision:** Module is labeled "IT Landscape" (per the old site copy). URL moves from `/features/it-ops` to `/features/it-landscape` — cleaner match with the label.
**Why:** Old site inconsistency (label "IT Landscape" at URL `/features/it-ops.html`).
**Action for you:** Add a 301 from `/features/it-ops` to `/features/it-landscape` at the nginx/edge level before launch. Noted in phase 8.

---

## Agentic refonte (added 2026-06-26)

These entries come from `REFONTE-AGENTIC.md` (decisions locked §10). They govern the repositioning of the whole site around the agentic vision.

### A-34. Three-layer model is the site's organizing principle
**Decision:** The site is structured around three layers, named descriptively, never as a punchy slogan: **the record** (KANAP holds the full picture of the IT department), **the interaction** (Plaid works it in plain language), **the action** (agents act on the same record under measured trust). The model appears on the home, organizes the Features dropdown, and frames the Features hub. Agents are the newest and most visible layer, not the whole product; the two layers beneath are what make KANAP a platform rather than one more agent tool.
**Why:** Keeps the breadth from being drowned by the agent hook while still leading with agents.
**Alternative:** A flat "list of features" framing if the layer model reads as too abstract.

### A-35. Voice / anti-slop rules and the locked vocabulary are binding for all copy
**Decision:** All copy, all locales, follows `REFONTE-AGENTIC.md` §2 (voice) and §3 (vocabulary). In short: one plain declarative sentence per headline; no em-dashes, no two-beat period-split headlines, no parallel antithesis, no negation pivots, no prose triads, no buzzwords (seamless, effortless, powerful, robust, unlock, leverage, supercharge, revolutionize, cutting-edge), no colon-subtitle or "Meet KANAP"/"Imagine" openers. One word per concept: **agent**, **autonomy / autonomy level** (describe it, do not name the scale), **connector**, **the record / your IT data**, **isolation between customers** (say "your data is isolated"), **approval / review**, **sources the agent used**, **runs on your servers**.
**Why:** Coherence and to avoid machine-written cadence. The current `/features/ai` title (a negation pivot) and the home "Everything connected. Always under control." (a two-beat split) are rewritten under this rule.
**Alternative:** Relax specific rules per page if they make a headline awkward.

### A-36. Features dropdown is a flat list, Agents first; no top-level Agents nav item
**Decision:** The Features dropdown is a flat list in this order: **Agents, Plaid, IT landscape, Budget management, Portfolio management, Knowledge.** Agents leads so the hook is visible at the point of navigation. The six top-level nav items are unchanged (no separate top-level "Agents" item, which would tip the site back toward agent-only). The `nav.featuresAi` label is normalized to "Plaid" (it previously carried a redundant "· AI assistant" suffix no other item had). The footer Product group gains an **Agents** link, and the footer tagline changes to "The open-source platform your IT department runs on. Self-host it, or let us run it."
**Why:** Plan §5.2 / §6.15. The grouped-by-layer dropdown was considered and dropped as not worth the build.
**Alternative:** Group the dropdown by layer if the flat list gets long.

### A-37. EN-first rollout; FR/DE/ES of changed pages are temporarily stale
**Decision:** This refonte writes EN copy only. New/rewritten copy lands in `*/en.ts`; the new `/features/agents` content ships as four files where `fr/de/es` re-export `en` (so the build stays green and the page renders EN until translated). New `HomeContent` narrative bands are **optional** fields, so the existing FR/DE/ES home files still type-check and keep their current copy; those locales render the pre-refonte home (and pre-refonte Plaid copy) until the translation pass runs. No page is broken, but FR/DE/ES are intentionally inconsistent with the new EN positioning in the interim.
**Why:** The plan is EN-first (§7); translation is a later phase (`/extract` then `/translate`, FR hand-checked, DE/ES machine-then-native-reviewed). Avoids destroying existing translations before they are regenerated from the new EN.
**Action for you:** Run the translation pass before launch so FR/DE/ES match the new EN story.
