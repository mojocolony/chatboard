# Chatboard v0.1.4

A lightweight personal board for organizing ChatGPT conversations without changing anything inside ChatGPT itself.

## Repository

**Name:** `chatboard`

**Description:** Personal bookmark board for organizing and syncing ChatGPT conversations.

## What v0.1.4 does

- Add ChatGPT conversation bookmarks.
- Give every bookmark its own independent Chatboard title.
- Organize chats into collapsible categories.
- Rename categories.
- Rearrange categories by dragging their grip handles in Arrange mode.
- Rearrange chats, including between categories, by dragging their grip handles with a clear insertion line.
- Arrange mode is available directly from the top toolbar using Lucide `settings-2`; it is no longer hidden in the menu.
- Move a chat to another category from Edit.
- Temporarily hide chats.
- Archive and restore chats.
- Permanently delete archived bookmarks without affecting ChatGPT.
- Search visible chats.
- IBM Plex Mono throughout.
- Font size controls: 18 / 20 / 22 / 24 / 26 / 28 px base sizes.
- Local cache for immediate startup/offline use.
- Dropbox sync to a single `chatboard.json` data file.
- Dropbox OAuth with PKCE; no Dropbox app secret is stored in the site.
- PWA manifest and service worker.
- Visible version number in the menu.
- Add Chat lives with the top-right controls and opens as a centered modal over the board.
- One-click browser bookmarklet capture support and URL capture support for an iOS Shortcut.

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
7. The app key for this build is already configured in `config.js`.

Do **not** copy or expose an app secret. Chatboard is a browser app and uses PKCE.

## 3. Dropbox app key

The Dropbox app key is already configured in `config.js`. Chatboard does not ask for it in the interface. No Dropbox app secret is stored in the site.

## 4. Connect Dropbox

1. Open Chatboard.
2. Open the menu.
3. Choose **Connect Dropbox**.
4. Tap **Connect Dropbox**.
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
javascript:(()=>{const b='https://mojocolony.github.io/chatboard/';const t=document.title.replace(/^\s*ChatGPT\s*[-|:]\s*/i,'').replace(/\s*[-|:]\s*ChatGPT\s*$/i,'').trim()||'ChatGPT conversation';window.open(b+'?add=1&url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(t),'_blank')})()
```

While viewing a ChatGPT conversation, click the bookmarklet. Chatboard opens in a new tab with the chat URL and title pre-filled. The original ChatGPT conversation stays open.

In Chrome on Mac: show the bookmarks bar, add any bookmark, rename it `Save to Chatboard`, then edit its URL and paste the JavaScript above.

## Notes

- Chatboard never renames, archives, hides, or deletes the real ChatGPT conversation.
- `Hide`, `Archive`, and `Delete permanently` affect only the bookmark in Chatboard.
- Local changes are saved immediately even when Dropbox is unavailable; sync retries when the app returns online.
- Because this is a single-user personal app, v0.1.4 uses simple last-write-wins Dropbox sync rather than a multi-user conflict system.


### Hidden vs Archive

- **Hidden**: temporary. The chat is still active, but removed from the main board until restored.
- **Archive**: long-term. Use it when the chat or project is finished but worth keeping.
- Neither state changes the real ChatGPT conversation.
