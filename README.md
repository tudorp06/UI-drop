<p align="center">
  <img src="icons/icon128.png" width="96" alt="UIDrop" />
</p>

<h1 align="center">UIDrop</h1>

<p align="center">
  See a site you love. Read its design system. Build from it.
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#privacy">Privacy</a>
</p>

---

## What it does

UIDrop is a Chrome extension that reads any webpage's design system in one click and sends it straight to your AI coding assistant.

You open a site you find inspiring, click the UIDrop icon, hit **Snap this page**, and the extension extracts the full design system — colors, fonts, type scale, border radii, spacing tokens, shadows, gradients, and component styles — packaged as a structured brief your AI can act on immediately.

From there, three buttons send the brief straight into **Claude**, **Cursor**, or **ChatGPT (Codex)**, or you can copy it to clipboard and drag the captured screenshot into any AI chat.

## How it works

1. **Snap** any page you're looking at
2. **Read** the full design system — colors, fonts, tokens, components, gradients
3. **Send** to Claude, Cursor, or ChatGPT — opens the AI with the brief pre-pasted, or drag the screenshot directly into any chat

The schema is generated entirely in-browser using deterministic JavaScript heuristics over computed CSS. No AI inference, no external APIs, no servers, no accounts.

## Install

**Chrome Web Store**: *(link pending review)*

**Manual install** (load unpacked):

1. Clone this repo
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the cloned folder

## Tech

Vanilla JavaScript, no frameworks, no build step. Manifest V3.

- `content.js` — runs on the snapped page; walks the DOM via `getComputedStyle` and extracts structural design tokens
- `popup.js` — receives the tokens, derives the palette and component styles via heuristics, renders the schema
- `background.js` — handles the screenshot and the cross-tab inject when sending to Claude or ChatGPT

## Privacy

UIDrop runs entirely in your browser. No servers, no analytics, no data collection.

When you send the brief to Claude or ChatGPT, the brief is sent **to that AI service** — governed by their privacy policy, not UIDrop's. Full [privacy policy](#).

## License

MIT
