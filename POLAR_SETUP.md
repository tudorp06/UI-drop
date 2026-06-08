# Polar.sh Setup for UIDrop Pro ($2 one-time)

You need to do this once on polar.sh before the in-extension paywall will work.
Takes ~5 minutes.

---

## 1. Create your Polar account + organization

1. Go to https://polar.sh and sign up (use GitHub login if you can — fastest)
2. Create an **Organization** (e.g. `uidrop`)
3. Verify your email if prompted

## 2. Create the product

1. Dashboard → **Products** → **New Product**
2. Fill in:
   - **Name:** `UIDrop Pro — Snap Library`
   - **Description:** `Unlimited Compare, Export (Figma/CSS/Canva), Insights, Skill mode, and Collections in the UIDrop Snap Library. One-time payment, yours forever.`
   - **Pricing type:** `One-time purchase`
   - **Price:** `$2.00 USD`
   - **License keys:** **TOGGLE ON** ✓  (critical — this is what the extension validates)
     - Activation limit: leave blank (unlimited devices)
     - Expires after: leave blank (never expires)
3. Save the product

## 3. Grab the values you need to paste into the code

After saving, copy these from the Polar dashboard:

- **Organization ID** — Settings → General → `org_xxxxxxxxxxxx`
- **Product ID** — Open the product → URL contains `/products/<id>` or shown on the product page
- **Checkout URL** — Product page → "Share" or "Checkout link" → looks like:
  `https://buy.polar.sh/polar_cl_xxxxxxxxx` (this is what users click to pay)

Tell me those three values when you have them, and I'll paste them into `gate.js`.
For now I've put `__REPLACE_ME__` placeholders so the build still loads.

## 4. (Optional) Webhook for analytics

If you want a server-side log of every purchase:
- Settings → Webhooks → Add endpoint
- Skip this if you don't have a backend — license validation is fully client-side.

---

## How the in-extension flow works

1. User browses the Snap Library freely
2. Each gated feature (Compare, Export, Insights, Skill, Collections) shows a "3 left" counter
3. After 5 uses → soft paywall modal appears with **Unlock for $2** button
4. Clicking it opens your Polar checkout URL in a new tab
5. Polar sends them a license key after payment (shown on success page + emailed)
6. User comes back, clicks **"Already paid? Enter license key"** in the modal
7. Extension calls `POST https://api.polar.sh/v1/customer-portal/license-keys/validate` with the key
8. If valid → `license.valid = true` saved to `chrome.storage.local` → all gates unlocked forever

No backend needed. No tax handling needed (Polar is Merchant of Record). Refunds handled by Polar.

---

## Removing ExtPay

Once Polar is live and you've validated one test purchase end-to-end:
- Remove `ExtPay.js` from the extension folder
- Remove the `importScripts('ExtPay.js')` line from `background.js`
- Remove the ExtPay app from your extensionpay.com dashboard

For now both can coexist — ExtPay isn't called by anything in v1.5.0.
