# ZUFA Leads: the CRM

A small sales dashboard for ZUFA Living. Leads land here automatically from:

- **Facebook and Instagram lead ads**, within seconds of someone submitting the form.
- **The website's "Request a site visit" form**, once `CONFIG.crm` in `js/main.js` is set (step 8).
- **Your team**, through the **+ Add lead** button (walk-ins, phone calls, referrals).

The sales team can search and filter leads, move each one through **New → Contacted → Site visit booked → Negotiation → Won / Lost**, assign leads to a salesperson, set a follow-up date, keep notes, call or WhatsApp with one tap, and export to Excel (CSV).

It runs on **Vercel** as a second project from this repository (Root Directory `crm`). The leads are kept in a **Neon Postgres** database, added through the Vercel Marketplace.

---

## How it works

```
Person fills a lead form on Facebook/Instagram
        │
        ▼
Meta sends a "new lead" ping ──► https://YOUR-CRM/webhook
        │                            (the CRM checks it really came from Meta)
        ▼
CRM asks Meta for the lead's answers ──► saves name, phone, email, answers,
                                          campaign / ad set / ad / form  (Neon database)
        ▼
Lead appears on the dashboard as "New"
```

The CRM also catches anything a webhook missed. A **daily** scheduled job (Vercel Cron) re-checks the last three days of leads. So does opening the dashboard, at most once an hour. Leads it already has are skipped. Settings also has a **Fetch leads from Meta now** button that reaches back up to 90 days, which is as long as Meta keeps leads.

---

## What you need

- The **Facebook Page** the ads run from. You must be an admin of it.
- The **Meta Business portfolio** (Business Manager) that owns the Page and the ad account.
- The **Vercel team** that hosts the website. The CRM is a second project there.

Neon's free plan is plenty: hundreds of thousands of leads fit in it.

> Vercel's free **Hobby** plan is meant for personal, non-commercial use. A CRM for a business should run on a **Pro** team. Pro also allows the scheduled check to run every hour instead of once a day (see step 1). Check [vercel.com/pricing](https://vercel.com/pricing) for current prices.

You'll fill in these settings in Vercel → the CRM project → **Settings → Environment Variables**. **Don't email them or paste them into chats.**

| Setting | What it is | Where you get it |
|---|---|---|
| `DATABASE_URL` | The database address | Added for you by Neon (step 1) |
| `ADMIN_PASSWORD` | Your dashboard password | You choose it (12+ characters) |
| `CRON_SECRET` | Stops strangers from triggering the scheduled check | You make it up (16+ random characters) |
| `META_APP_ID` | Your Meta app's number | Step 2 |
| `META_APP_SECRET` | Your Meta app's secret key | Step 2 |
| `META_VERIFY_TOKEN` | A phrase you make up, e.g. `zufa-leads-7Kq2` | You choose it |
| `META_PAGE_ID` | The Facebook Page's number | Step 4 |
| `META_PAGE_ACCESS_TOKEN` | Lets the CRM read the Page's leads | Step 4 |
| `SITE_ORIGINS` | The website address(es) allowed to send enquiries | Step 8 |

> **After changing any Environment Variable, redeploy.** Go to **Deployments → ⋯ on the latest → Redeploy**. Vercel only applies new values to new deployments.

---

## Step 1: Put the CRM online (Vercel + Neon)

1. In Vercel, in the website's team, click **Add New → Project** and import `halotechstudio/client-zufa-living-website`, the same repository as the website.
   - **Project name:** `zufa-crm`
   - **Root Directory:** click **Edit** and choose `crm`. This one matters.
   - **Framework Preset:** Other. Leave the build settings as they are; `crm/vercel.json` sets them.
   - Click **Deploy**. The first deploy works, but you can't log in yet.
2. Add the database:
   - Open the `zufa-crm` project and go to **Storage → Create Database** (or **Marketplace**). Choose **Neon** (Serverless Postgres).
   - Pick the **Free** plan and the region closest to India, e.g. **Singapore (ap-southeast-1)**.
   - When it asks which project to connect, choose `zufa-crm` and tick all environments.
   - Neon adds `DATABASE_URL` to the project by itself. The CRM creates its tables on first use.
3. Under **Settings → Environment Variables**, add:
   - `ADMIN_PASSWORD`: your password
   - `CRON_SECRET`: any long random string. Vercel sends it with each scheduled check, and the CRM ignores scheduled calls without it.
4. Under **Settings → Deployment Protection**, make sure **Production** is *not* protected. "Vercel Authentication" on preview deployments only is fine. Meta has to be able to reach the CRM.
5. **Redeploy**: Deployments → ⋯ → Redeploy.
6. Open the project's address, e.g. `https://zufa-crm.vercel.app`. You should see the green **ZUFA Leads** login page. Log in as **admin** with your password.
7. Your webhook address is that address with `/webhook` on the end, e.g. `https://zufa-crm.vercel.app/webhook`. **Settings** in the dashboard shows it with a Copy button.

> **Custom domain (optional):** in the project, go to **Settings → Domains** and add something like `crm.zufaliving.com`. If you do, use that address everywhere below (Meta webhook, `CONFIG.crm`).
>
> **Hourly instead of daily checks (Pro teams):** in `crm/vercel.json`, change the cron `schedule` from `30 0 * * *` to `0 * * * *`.

---

## Step 2: Create a Meta app

1. Go to **[developers.facebook.com](https://developers.facebook.com)** and log in with the Facebook account that is admin of the ZUFA Page. Click **Get started** if you're asked to register as a developer.
2. Click **My Apps → Create App**.
   - **App name:** `ZUFA Leads CRM`
   - **Use case:** pick the one about **capturing and managing ad leads** (Marketing API), if listed. Otherwise pick **Other**, then app type **Business**.
   - **Business portfolio:** choose the one that owns the ZUFA Page and ad account. This matters: if the app, Page and ad account share one business, you won't need Meta's App Review.
3. Open the app. Go to **App settings → Basic**:
   - Copy the **App ID** into `META_APP_ID`.
   - Click **Show** next to **App secret** and copy it into `META_APP_SECRET`.
   - Set **Privacy Policy URL** to the website's privacy page (its `/privacy.html`).
   - Set **Category** (e.g. Business and pages) and click **Save changes**.
4. Make up a verify phrase (letters, numbers, dashes) and save it as `META_VERIFY_TOKEN`.
5. Add these three values in Vercel and **redeploy**.

## Step 3: Turn on Webhooks

1. In the app, click **Add product** (or **Use cases → Customize**), find **Webhooks**, and click **Set up**.
2. In the drop-down at the top, choose **Page**, then click **Subscribe to this object**.
   - **Callback URL:** your webhook address, e.g. `https://zufa-crm.vercel.app/webhook`
   - **Verify token:** exactly the same phrase as `META_VERIFY_TOKEN`
   - Click **Verify and save**. If Meta reports an error, see "If something goes wrong" below.
3. In the list of Page fields, find **leadgen** and click **Subscribe**.

## Step 4: Get the Page ID and a Page access token

This "key" lets the CRM read the Page's leads.

1. Open the **[Graph API Explorer](https://developers.facebook.com/tools/explorer/)**.
2. On the right, under **Meta App**, choose `ZUFA Leads CRM`.
3. Under **User or Page**, choose **Get User Access Token**. Tick these permissions:
   - `pages_show_list`
   - `pages_read_engagement`
   - `pages_manage_metadata`
   - `pages_manage_ads`
   - `leads_retrieval`
   - `ads_read`, so the CRM can show campaign, ad set and ad names. `ads_management` also works.
4. Click **Generate Access Token**. In the pop-up, choose the ZUFA Page and ad account, and allow everything.
5. Make the token long-lived:
   - Click the small **ⓘ** next to the token, then **Open in Access Token Tool**.
   - Click **Extend Access Token** at the bottom and confirm.
   - Copy the new, long token.
6. Back in the Explorer, paste the long token into the **Access Token** box. Type `me/accounts` in the query field and click **Submit**.
7. The result lists your Pages. For ZUFA Living:
   - `id` is the Page ID. Put it in `META_PAGE_ID`.
   - `access_token` is the Page token. Put it in `META_PAGE_ACCESS_TOKEN`. A Page token made from a long-lived token like this **does not expire**.
8. Save both in Vercel and **redeploy**.

> The token stops working if the person who created it changes their Facebook password, loses admin rights on the Page, or removes the app. If that happens, repeat this step.
>
> A sturdier option for a business: in **Business settings → Users → System users**, create an *Admin* system user and give it the Page and ad account. Click **Generate new token** for the app with the same permissions, then run `me/accounts` with that token as in steps 6–7.

## Step 5: Connect the Page to the app

Log in to the CRM and open **Settings**. The Meta checklist should now show green ticks, including "Token works for the Page ZUFA Living".

If it shows **"Page is not yet sending leads to this app"**, click **Connect Page to this app**. This does the same thing as sending `POST /{page-id}/subscribed_apps?subscribed_fields=leadgen` in the Graph API Explorer.

## Step 6: Check who can access leads

In **[Meta Business Suite](https://business.facebook.com) → Settings → Integrations → Leads access** (on some accounts: **All tools → Leads Center → Settings**), check that the ZUFA Page either has *no restrictions*, or lists **ZUFA Leads CRM** under **CRMs** and your user under **People**. If access has been restricted and the app isn't on the list, Meta withholds the lead details.

## Step 7: Send a test lead

1. Open the **[Lead Ads Testing Tool](https://developers.facebook.com/tools/lead-ads-testing)**.
2. Choose the ZUFA Page and one of its lead forms, then click **Create lead**. To send another test, first click **Delete lead**.
3. Within a few seconds, the test lead should appear on the dashboard as **New**. **Settings → Recent activity** should show "Lead … saved".

Leads made with this tool have no campaign name, because no ad was involved. Real ad leads show the campaign, ad set and ad.

### Take the app Live

While the app is in **Development** mode, Meta only sends leads that involve people who have a role on the app. Real customers' leads arrive only when the app is **Live**.

At the top of the app dashboard, switch **App Mode** to **Live**. This needs the privacy policy URL from step 2.

- If the app, Page and ad account all belong to **your** business portfolio, the standard access you already have is enough. You don't need App Review.
- If Meta asks for **Advanced Access** to `leads_retrieval` or the Pages permissions, it will ask for **App Review** and **Business Verification**. You'd upload company documents and a short screen recording of the CRM. That's only needed if the CRM reads Pages owned by *other* businesses. If Meta asks anyway, follow the steps on the **App Review → Requests** screen.

Then send another test lead to confirm.

## Step 8: Send website enquiries to the CRM

1. In `js/main.js` at the top, set `crm` to your CRM address:
   ```js
   const CONFIG = { email: '…', phone: '…', crm: 'https://zufa-crm.vercel.app' };
   ```
2. In the CRM project, set `SITE_ORIGINS` to every address the website is served from, with no path or trailing slash, separated by commas. For example: `https://zufaliving.com,https://www.zufaliving.com,https://client-zufa-living-website.vercel.app`. Then **redeploy**.
3. Publish the website. Enquiries now go straight into the CRM, marked **Web**. If the CRM can't be reached, the form falls back to opening an email, as before, so no enquiry is lost.

## Step 9: Add your sales team

In **Settings → Sales team**, add each salesperson with a name and a password (8+ characters). They log in with those details, and can filter to **Assigned to me**. Switching someone off logs them out at once, and their leads stay.

Only the **admin** account can open Settings, delete leads, and manage the team. To change the admin password, change `ADMIN_PASSWORD` in Vercel and redeploy.

---

## If something goes wrong

| What you see | Likely cause | Fix |
|---|---|---|
| Meta: "The URL couldn't be validated" | Verify phrase mismatch, not redeployed, or the site is behind Deployment Protection | Check `META_VERIFY_TOKEN`, redeploy, and step 1 point 4 |
| Login page says "Something went wrong" | No database connected | Step 1 point 2, then redeploy |
| Settings: "Rejected a webhook with a bad signature" | Wrong `META_APP_SECRET` | Copy the App secret again (App settings → Basic) and redeploy |
| Settings: ✗ "Token does not work" | Token expired or missing a permission | Redo step 4 |
| Lead shows "Details pending from Meta" | The CRM got the ping but couldn't read the lead (token or Leads access) | Fix the token or step 6, then press **Check Meta for new leads**. The lead fills in. |
| Leads arrive without campaign names | The token lacks `ads_read` / `ads_management` | Redo step 4 with `ads_read` ticked |
| Test leads arrive but real ones don't | The app is still in Development mode | Take the app Live (step 7) |
| Website form opens email instead of saving | `CONFIG.crm` is blank, or the site address isn't in `SITE_ORIGINS` | Step 8 |

**Settings → Recent activity** logs every webhook, sync and error, and is the first place to look. Vercel's **Logs** tab for the project shows anything deeper.

---

## Backups

- **Export CSV** on the Leads page gives you a spreadsheet copy. It exports whatever the filters show, so clear them to export everything.
- Neon keeps a short restore history on the free plan, and can restore the database to an earlier point in time from its console (Vercel → Storage → Open in Neon).

---

## For developers

- **Stack:** Node.js 22.13 or newer.
  - Database: `@neondatabase/serverless` (Neon over HTTP) when `DATABASE_URL` is set.
  - Without `DATABASE_URL`, a local **PGlite** database in `DATA_DIR` (dev dependency), so a local run needs no setup.
- **Local run:** `npm install`, `cp .env.example .env`, fill in `ADMIN_PASSWORD`, then `npm start` and open http://localhost:3000.
- **Tests:** `npm test` runs a 14-check end-to-end test against in-memory PGlite and a fake Graph API. It covers:
  - webhook handshake and signature check
  - lead fetch, de-duplication and the retry path
  - filters, website form and CSV export
  - cron auth and user permissions
- **Layout:**
  - `api/index.js` is the single Vercel Function.
  - `vercel.json` serves `public/` statically, rewrites every other path to that function (`req.url` keeps the original path), and defines the cron.
  - `server.js` is the local server.
  - `lib/app.js`: all routes
  - `lib/meta.js`: Graph API **v26.0** (`GRAPH_API_VERSION`)
  - `lib/leads.js`, `lib/db.js` (schema, created on first use), `lib/auth.js` (scrypt hashes, 30-day session cookies)
- **Endpoints:**

  | Endpoint | Purpose |
  |---|---|
  | `GET/POST /webhook` | Meta (the lead is fetched before the response, since Vercel may stop work after it) |
  | `GET /api/cron/sync` | Vercel Cron, `Authorization: Bearer $CRON_SECRET` |
  | `POST /api/website-lead` | Public, CORS limited to `SITE_ORIGINS`, 5 per IP per 10 minutes (in the database), honeypot field `website` |
  | `/api/*` | Logged-in users only |

- **Meta fields read for each lead:** `id, created_time, field_data, form_id, ad_id, ad_name, adset_id, adset_name, campaign_id, campaign_name, platform, is_organic`. If the token can't read ad names, the CRM falls back to the IDs.
- Every Graph call sends an `appsecret_proof`.
