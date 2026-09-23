const TOKEN_KEY = 'chatboard.dropbox.token.v1';
const PENDING_KEY = 'chatboard.dropbox.pending.v1';
const APP_KEY_FALLBACK = 'chatboard.dropbox.appKey.v1';
const DROPBOX_FILE = '/chatboard.json';

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomHex(length = 24) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

async function codeChallenge(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function getConfiguredKey() {
  return String(window.CHATBOARD_CONFIG?.dropboxAppKey || localStorage.getItem(APP_KEY_FALLBACK) || '').trim();
}

export function saveAppKey(value) {
  const clean = String(value || '').trim();
  if (clean) localStorage.setItem(APP_KEY_FALLBACK, clean);
  else localStorage.removeItem(APP_KEY_FALLBACK);
  return clean;
}

export function getAppKey() {
  return getConfiguredKey();
}

export function getRedirectUri() {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  return url.toString();
}

function loadToken() {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY) || 'null'); }
  catch { return null; }
}

function saveToken(token) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(token));
}

export function isConnected() {
  const token = loadToken();
  return Boolean(token?.accessToken || token?.refreshToken);
}

export function disconnectDropbox() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PENDING_KEY);
}

export async function beginDropboxConnect(returnUrl = location.href) {
  const appKey = getConfiguredKey();
  if (!appKey) throw new Error('Dropbox app key is not configured.');

  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
  const state = randomHex();
  const challenge = await codeChallenge(verifier);
  const redirectUri = getRedirectUri();

  localStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state, redirectUri, returnUrl }));

  const url = new URL('https://www.dropbox.com/oauth2/authorize');
  url.searchParams.set('client_id', appKey);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('token_access_type', 'offline');
  location.assign(url.toString());
}

async function tokenRequest(params) {
  const response = await fetch('https://api.dropboxapi.com/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error_description || payload.error || `Dropbox token request failed (${response.status})`);
  return payload;
}

export async function finishDropboxCallback() {
  const url = new URL(location.href);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const error = url.searchParams.get('error_description') || url.searchParams.get('error');
  if (!code && !error) return false;
  if (error) throw new Error(error);

  const pending = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
  if (!pending) throw new Error('Dropbox connection could not be completed because the saved login state is missing.');
  if (!returnedState || returnedState !== pending.state) throw new Error('Dropbox login state did not match. Please reconnect.');

  const appKey = getConfiguredKey();
  const payload = await tokenRequest({
    code,
    grant_type: 'authorization_code',
    client_id: appKey,
    code_verifier: pending.verifier,
    redirect_uri: pending.redirectUri,
  });

  saveToken({
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || null,
    expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : null,
    accountId: payload.account_id || null,
  });
  localStorage.removeItem(PENDING_KEY);

  url.searchParams.delete('code');
  url.searchParams.delete('state');
  url.searchParams.delete('error');
  url.searchParams.delete('error_description');
  history.replaceState({}, '', url.toString());
  return true;
}

async function accessToken() {
  const token = loadToken();
  if (!token) throw new Error('Dropbox is not connected.');

  if (token.accessToken && (!token.expiresAt || token.expiresAt > Date.now() + 90_000)) {
    return token.accessToken;
  }

  if (!token.refreshToken) throw new Error('Dropbox session expired. Please reconnect.');
  const appKey = getConfiguredKey();
  if (!appKey) throw new Error('Dropbox app key is not configured.');

  const payload = await tokenRequest({
    grant_type: 'refresh_token',
    refresh_token: token.refreshToken,
    client_id: appKey,
  });

  const refreshed = {
    ...token,
    accessToken: payload.access_token,
    expiresAt: payload.expires_in ? Date.now() + payload.expires_in * 1000 : null,
  };
  saveToken(refreshed);
  return refreshed.accessToken;
}

async function authorizedFetch(url, options = {}) {
  const token = await accessToken();
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
}

export async function downloadBoard() {
  const response = await authorizedFetch('https://content.dropboxapi.com/2/files/download', {
    method: 'POST',
    headers: { 'Dropbox-API-Arg': JSON.stringify({ path: DROPBOX_FILE }) },
  });

  if (response.status === 409) {
    const payload = await response.json().catch(() => ({}));
    const summary = String(payload.error_summary || '');
    if (summary.startsWith('path/not_found/')) return null;
    throw new Error(summary || 'Dropbox could not read Chatboard.');
  }
  if (!response.ok) throw new Error(`Dropbox download failed (${response.status}).`);
  return response.json();
}

export async function uploadBoard(board) {
  const response = await authorizedFetch('https://content.dropboxapi.com/2/files/upload', {
    method: 'POST',
    headers: {
      'Dropbox-API-Arg': JSON.stringify({
        path: DROPBOX_FILE,
        mode: 'overwrite',
        autorename: false,
        mute: true,
      }),
      'content-type': 'application/octet-stream',
    },
    body: JSON.stringify(board, null, 2),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error_summary || `Dropbox upload failed (${response.status}).`);
  }
  return response.json();
}
