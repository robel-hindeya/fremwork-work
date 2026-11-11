# Security audit: Safe Browsing "Dangerous site" warning (2026-11-11)

## Verdict

Google Safe Browsing lists `https://fremwork-app.onrender.com/api/auth/session` and the host `fremwork-app.onrender.com` for **social engineering** ("Try to trick visitors into sharing personal info or downloading software"). Checked on the Google Transparency Report on 2026-11-11:

| Host | Status |
| --- | --- |
| `fremwork-app.onrender.com` (workspace) | Some pages unsafe (social engineering) |
| `fremwork-land.onrender.com` (landing) | No data |
| `fremwork.com` | No unsafe content (last updated 2026-11-09) |

No malware, injected script, leaked secret or malicious redirect was found. The listing is explained by how sessions were moved between the two Render sites.

## Most likely cause

After sign-in, the landing site's `/open-app` page built a hidden `<form>` in JavaScript, put the user's Supabase **access and refresh tokens** in hidden inputs, deleted its own auth cookies, and auto-submitted the form to a **different domain**: `https://fremwork-app.onrender.com/api/auth/session`, the exact URL Google listed. The workspace's `/sign-in` also bounced visitors to a login page on that other domain.

That is the signature of a phishing kit: a page on a shared free-hosting domain (`*.onrender.com`, which Safe Browsing scores strictly because it is widely abused) that silently posts credentials to a collection endpoint on another host. Google does not publish its reasons, so this is an inference, but it matches the exact URL and the category.

## Findings

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| 1 | High (cause of listing) | Cross-site, auto-submitted POST of Supabase access/refresh tokens from `fremwork-land.onrender.com/open-app` to `fremwork-app.onrender.com/api/auth/session`. | **Fixed** |
| 2 | Medium | Workspace `/sign-in`, `/sign-up`, `/forgot-password` redirected to a login page on another domain. | **Fixed**: the workspace signs users in itself |
| 3 | Medium | Workspace sent no security headers (no HSTS, clickjacking protection, `nosniff`, referrer policy, or CSP). The landing site already had some. | **Fixed** |
| 4 | Medium | Email confirmation and password-reset links used the implicit flow (tokens in the URL fragment), and `/auth/callback` rejected them. | **Fixed**: PKCE one-time codes |
| 5 | Medium | Runtime dependency advisories: `next` 16.4.3, `@nestjs/common` < 10.4.16, `body-parser` 1.20.4 (DoS), `qs` 6.14.3 (DoS), `multer` 2.0.2 (DoS). | **Fixed**: next 16.4.6, Nest 10.4.22, overrides body-parser 1.20.9, qs 6.17.1, multer 2.5.0 |
| 6 | Low | Remaining advisories need NestJS 10 → 12 (`@nestjs/core`, `@nestjs/config`, `@nestjs/swagger`, `js-yaml`, `lodash`, `file-type`) or affect the undeployed `apps/site` (`next` 15, `postcss`). None is reachable: there are no file uploads, YAML input or lodash templates. | Open (follow-up) |
| 7 | Low | The welcome-email Edge Function's button defaults to `https://fremai.vercel.app/chat` when `APP_URL` is unset. That is a live Vercel deployment behaving like an older workspace copy, but it is an unbranded third domain in email. | Open: set `APP_URL` |
| 8 | Info | No secrets in either repository or its git history (searched for Supabase secret/service-role keys, Resend, Google, Anthropic and GitHub tokens). Only `.env.example` files are tracked and they contain public values. | OK |
| 9 | Info | No `eval`, `document.write`, hidden iframes, obfuscated code or unexpected script tags. External resources: Google Fonts, Swagger UI from cdnjs (API docs only), flag images from flagcdn (admin screen), Supabase, Gemini, Resend. | OK |
| 10 | Info | `npm audit signatures`: registry signatures and attestations verified; no malware advisories in either repo. | OK |
| 11 | Info | Cookies: `HttpOnly`, `Secure` in production, `SameSite=Lax`. Cross-origin writes are rejected by the proxy's same-origin check. The API's CORS is an exact allowlist. | OK |

## Changes

### `robel-hindeya/fremwork-work`

- **Sign-in on the workspace itself.** Removed the redirects to the landing site. `/sign-in` and `/sign-up` now offer "Continue with Google" next to email and password.
- **Google sign-in with PKCE** (`/api/auth/google` → Supabase → Google → `/auth/callback?code=…`). The code verifier lives in an `HttpOnly` cookie scoped to `/auth/callback`; the callback exchanges the one-time code on the server. Tokens never appear in a URL or cross sites.
- **Confirmation and password-reset emails** also use PKCE. Reset links land on `/reset-password` already signed in.
- **`/api/auth/session` is retired.** It ignores anything posted, sets no cookies, makes no Supabase call, and redirects to `/sign-in`. It stays so an old landing deploy cannot break sign-in.
- **Security headers** on every web response: HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, and a CSP with `frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`. `X-Powered-By` is removed. The NestJS API sends the same core headers.
- **Dependencies** patched as in finding 5.
- `apps/site/app/open-app` (undeployed copy of the landing site) no longer posts tokens.
- Tests: four new auth tests (retired handoff, Google PKCE start, callback exchange and rejection, reset email PKCE).

### `robel-hindeya/fremwork-land`

- `/open-app` no longer builds or submits a token form. It sends the visitor to the workspace's `/sign-in`. The landing site keeps its own sign-in for its admin area.

## Required configuration

1. **Supabase → Authentication → URL Configuration → Redirect URLs:** add `https://fremwork-app.onrender.com/auth/callback`, and `https://app.fremwork.com/auth/callback` if you will use that domain. Without it, Supabase sends Google and email-link users to the Site URL instead.
2. Google Cloud OAuth client: no change. Its redirect URI stays `https://<project>.supabase.co/auth/v1/callback`.
3. Set the welcome-email function secret `APP_URL` to the workspace URL.

## Requesting a Safe Browsing review

Deploy both services first, then confirm the fix is live: after signing in on the landing site, the browser should go to the workspace's `/sign-in` with no POST to `/api/auth/session`.

1. **Search Console.** Add a URL-prefix property for `https://fremwork-app.onrender.com/` (a Domain property isn't possible on `onrender.com`). Verify it with the HTML-tag method (a `<meta name="google-site-verification">` tag in `apps/web/src/app/layout.tsx`) or the HTML-file method (`apps/web/public/`).
2. Open **Security & Manual Actions → Security issues**. Review the listed URLs and sample pages.
3. Select **I have fixed these issues**, then **Request Review**. Say what was wrong and what changed, for example: "The landing site auto-submitted session tokens to /api/auth/session on this host. That handoff is removed: the workspace now authenticates on its own origin with Supabase PKCE, and /api/auth/session accepts no credentials. There is no phishing or third-party content." Google says phishing reviews usually finish within a few days.
4. Alternatively, or as well, report the warning as a mistake at <https://safebrowsing.google.com/safebrowsing/report_error/>.
5. Re-check status at <https://transparencyreport.google.com/safe-browsing/search?url=fremwork-app.onrender.com>.

**Strongly recommended:** serve the workspace from your own domain (`app.fremwork.com`) instead of a shared `onrender.com` subdomain. Reputation then belongs to your domain, and `app.fremwork.com` is already in the API's CORS defaults.

## Follow-up audit (same day, after deploying `99c1699` and landing `57ec4a2`)

**Deploys verified live.** The workspace serves its own `/sign-in`, `/sign-up`, `/forgot-password` and `/reset-password` (200). `/api/auth/google` starts Supabase PKCE. A cross-site POST to `/api/auth/session` returns `303 /sign-in` with no cookie. Security headers are on every response. The landing `/open-app` bundle contains only a `/sign-in` link: no form, no tokens, no `/api/auth/session`.

**The Safe Browsing listing covers the whole host, not specific endpoints.** The Transparency Report gives the same "social engineering" verdict for `/api/auth/google`, `/api/health` and `/zz-nonexistent-path-8841` (a path that never existed). `/api/auth/google` was not detected separately; Chrome warns on every URL under `fremwork-app.onrender.com` until Google re-reviews the host. The listing predates the fixes, and the pattern that most likely caused it (cross-site token POST) is no longer served.

**Live crawl of every route (42 paths).** Private pages redirect to `/sign-in` on the same host. Private APIs return `401` JSON. Auth POST routes return `405` to GET. The only off-site redirect is `/api/auth/google` → this project's Supabase `/auth/v1/authorize`, which forwards to `accounts.google.com`.

**Public pages and scripts.** The four public pages load only same-origin assets (11 `/_next` chunks, logo, icon); their HTML references no external host. Their three inline scripts are Next.js's bootstrap. Across all 14 JavaScript bundles (689 KB), the only external URLs are `w3.org` (SVG namespaces), `nextjs.org`, `react.dev` and `github.com` (framework error and license strings). There are no beacons, WebSockets or wallet code. The one `atob` decodes React's server-component stream; `crypto.subtle` is Next's router-cache hash.

**Redirect and proxy abuse probes.** The image optimizer rejects external and protocol-relative URLs (400). `next`/`redirect_to` query parameters are ignored. `//evil.example` normalises to a same-host path. CORS sends no `Access-Control-Allow-Origin` to foreign origins. A spoofed `Host` header is blocked at Render's edge (Cloudflare 403), and a client-supplied `X-Forwarded-Proto` is overwritten by the platform.

| # | Severity | Finding | Status |
| --- | --- | --- | --- |
| 12 | Medium | `publicOrigin()` trusted `X-Forwarded-Host`, which Render passes through from the client. `X-Forwarded-Host: evil.example` made `/` redirect to `https://evil.example/sign-in` and made `/api/auth/google` send `redirect_to=https://evil.example/auth/callback` to Supabase. A link cannot set this header, Supabase's redirect allowlist should refuse unknown hosts, and PKCE stops a stolen code from being redeemed, so there was no practical account takeover. It was still a header-driven open redirect with cache-poisoning potential. | **Fixed**: only the platform-routed `Host` header is used. Regression test added. |
| 13 | Info | Dependencies rechecked: no malware advisories; 541 registry signatures and 58 attestations verified; install scripts only in `@nestjs/core` (donation notice) and `fsevents` (optional, macOS). The 10 remaining production advisories are finding 6. | Unchanged |

**Conclusion.** The live application has no phishing content, injected code or malicious redirect. The listing was a reasonable automated response to a real design flaw (the cross-site token handoff), now removed. The current listing is stale rather than a false positive about the original behaviour. Request the review described above.
