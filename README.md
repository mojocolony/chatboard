# Chatboard v0.1.0

A lightweight personal board for organizing ChatGPT conversations without changing anything inside ChatGPT itself.

## Repository

**Name:** `chatboard`

**Description:** Personal bookmark board for organizing and syncing ChatGPT conversations.

## What v0.1.0 does

- Add ChatGPT conversation bookmarks.
- Give every bookmark its own independent Chatboard title.
- Organize chats into collapsible categories.
- Rename categories.
- Rearrange categories with up/down controls.
- Rearrange chats with drag-and-drop on desktop and up/down controls in Arrange mode.
- Move a chat to another category from Edit.
- Temporarily hide chats.
- Archive and restore chats.
- Permanently delete archived bookmarks without affecting ChatGPT.
- Search visible chats.
- IBM Plex Mono throughout.
- Font size controls: A− / A / A+ (20 / 22 / 24 px base sizes).
- Local cache for immediate startup/offline use.
- Dropbox sync to a single `chatboard.json` data file.
- Dropbox OAuth with PKCE; no Dropbox app secret is stored in the site.
- PWA manifest and service worker.
- Visible version number in the menu.
- Capture URL support for future bookmarklet / iOS Shortcut use.

## 1. Upload to GitHub Pages

1. Create a new GitHub repository named `chatboard`.
2. Use the description above.
3. Upload **the contents of this folder** to the repository root.
4. In GitHub, open **Settings → Pages**.
5. Deploy from the `main` branch, root folder.
6. The expected site URL is:
   `https://mojocolony.github.io/chatboard/`

## 2. Create the Dropbox app

1. Open the Dropbox App Console.
2. Create a new app using **Scoped access**.
3. Choose **App folder** access, not Full Dropbox.
4. Name it something like `Chatboard` (the exact Dropbox app name may need to be unique).
5. Enable these permissions/scopes:
   - `files.content.read`
   - `files.content.write`
6. Add this exact Redirect URI:
   `https://mojocolony.github.io/chatboard/`
7. Copy the app key.

Do **not** copy or expose an app secret. Chatboard is a browser app and uses PKCE.

## 3. Put in the Dropbox app key

Open `config.js` and paste the app key:

```js
window.CHATBOARD_CONFIG = {
  dropboxAppKey: "PASTE_APP_KEY_HERE",
};
```

Upload the revised `config.js` to GitHub.

Alternatively, leave `config.js` blank and paste the app key into **Chatboard → menu → Connect Dropbox** on each device.

## 4. Connect Dropbox

1. Open Chatboard.
2. Open the menu.
3. Choose **Connect Dropbox**.
4. Choose **Save key & connect** (or simply connect if the key is already in `config.js`).
5. Approve Dropbox access.
6. Chatboard creates `/chatboard.json` inside its Dropbox App Folder.

The file appears to you in Dropbox under the app's folder in `/Apps/…`, while the Dropbox API sees it as `/chatboard.json` because App Folder access is scoped automatically.

## 5. Capture links directly

Chatboard accepts:

`?add=1&url=CHAT_URL&title=CHAT_TITLE`

After deployment, a browser bookmarklet or iOS Shortcut can use that to pre-fill the Add Chat sheet.

### Mac bookmarklet

Create a bookmark whose URL is:

```text
javascript:(()=>{const u='https://mojocolony.github.io/chatboard/?add=1&url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title);location.href=u})()
```

While viewing a ChatGPT conversation, click the bookmarklet. Chatboard opens with the chat URL and current page title pre-filled.

## Notes

- Chatboard never renames, archives, hides, or deletes the real ChatGPT conversation.
- `Hide`, `Archive`, and `Delete permanently` affect only the bookmark in Chatboard.
- Local changes are saved immediately even when Dropbox is unavailable; sync retries when the app returns online.
- Because this is a single-user personal app, v0.1.0 uses simple last-write-wins Dropbox sync rather than a multi-user conflict system.
