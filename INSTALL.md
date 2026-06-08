# Install UIDrop (Unpacked)

While UIDrop is between Chrome Web Store releases, you can install it manually from this repo in ~30 seconds. It works exactly the same as the store version.

---

## Step 1 — Download the extension

**Option A · Easiest (no git):**

1. Go to https://github.com/tudorp06/UI-drop
2. Click the green **Code** button → **Download ZIP**
3. Unzip it anywhere (Desktop is fine)
4. You should now have a folder called `UI-drop-main` containing `manifest.json` and other files

**Option B · git:**

```bash
git clone https://github.com/tudorp06/UI-drop.git
```

> Heads up: keep this folder around. Deleting it after install will break the extension. You can move it (e.g. into `Documents/`) — just don't trash it.

---

## Step 2 — Load it into Chrome

1. Open Chrome and go to `chrome://extensions/`
   (paste that into the address bar)
2. In the top-right corner, flip **Developer mode** ON
3. Three new buttons appear in the top-left. Click **Load unpacked**
4. Browse to the `UI-drop-main` folder from Step 1, select it, click **Select Folder**
5. UIDrop appears in your extension list ✓

If you don't see the UIDrop icon in your toolbar:
- Click the puzzle-piece icon (right of the address bar)
- Find **UIDrop**, click the pin icon next to it

---

## Step 3 — Use it

1. Open any website
2. Click the UIDrop icon
3. Hit **Snap this page**
4. Pick where to send: Claude, ChatGPT, Gemini, Cursor, Lovable, Manus
5. Or open the **Snap Library** to save snaps, compare them, export to Tailwind/shadcn/Figma/CSS, etc.

---

## Updating UIDrop later

1. Go back to `chrome://extensions/`
2. Find UIDrop, click the **circular arrow / refresh** icon on its card

If you used Option B (git), `cd` into the folder and run `git pull` first to grab the latest code.

If you used Option A (ZIP), download a fresh ZIP, replace the folder, then hit refresh in `chrome://extensions/`.

---

## Why not just install from the Chrome Web Store?

UIDrop is mid-republish — the listing was removed and is going through Chrome's appeal review process. The extension itself is unchanged and works perfectly; this is just Google paperwork. Once it's back live, you'll be able to install with one click from the store and updates will happen automatically.

In the meantime — installing unpacked is exactly how every Chrome extension developer uses their own work daily. No risk, no telemetry, no accounts. The code is all open at https://github.com/tudorp06/UI-drop.

---

## Troubleshooting

**"This extension may have been corrupted" warning** → make sure you selected the folder that contains `manifest.json` directly (not a parent folder).

**Buttons not opening Claude/ChatGPT/etc.** → grant Chrome the requested host permissions when prompted. You can also check `chrome://extensions/` → UIDrop → Details → Site access = "On all sites".

**Snap Library is locked after a few uses** → that's the trial. Each Pro feature (Compare, exports, Insights, Collections) gets 3 free uses. Unlock for a one-time $3 via the in-library button.

**Anything else** → open an issue at https://github.com/tudorp06/UI-drop/issues
