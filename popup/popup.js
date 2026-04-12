// popup/popup.js
// Popup UI logic for SoloKeys Vault extension

import NativeTransport from '../lib/native-transport.js';
import { filterVisibleCredentials, matchesSite } from '../lib/utils.js';

// Global state
let device = null;
let credentials = [];
let matchingCredentials = [];
let currentOTP = null;
let currentCredential = null;
let timerInterval = null;
let isConnected = false;
let pendingCredentialName = null;
let pendingAction = 'display'; // 'display' | 'copy' | 'type'
let isSyncing = false;
let currentHostname = '';
let foundQRCodes = [];
const PASSWORD_ONLY_PREFIX = '__solo_pw__:';
const passwordEntryCache = new Map();
let currentPasswordEntry = null;
let currentPasswordCacheKey = null;
let passwordVisible = false;
let passwordHideTimer = null;
let reconnectInFlight = null;
let messageTimeoutId = null;
let showCachedFallback = false;

function refreshMatchingCredentials() {
    if (!currentHostname) {
        matchingCredentials = [];
        return;
    }

    matchingCredentials = credentials.filter(cred =>
        matchesSite(cred.name, currentHostname)
    );
}

async function syncConnectionState(connected, pinVerified = false) {
    try {
        await chrome.runtime.sendMessage({
            action: 'setConnectionState',
            connected,
            pinVerified,
        });
    } catch (error) {
        console.warn('Failed to sync connection state:', error);
    }
}

async function markDisconnected(keepCachedCredentials = true) {
    isConnected = false;
    device = null;
    if (!keepCachedCredentials) {
        credentials = [];
    }
    await syncConnectionState(false, false);
}

function isExpectedConnectionError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return (
        message.includes('native host') ||
        message.includes('gui is not running') ||
        message.includes('not found') ||
        message.includes('timeout') ||
        message.includes('socket') ||
        message.includes('host')
    );
}

function logConnectionIssue(context, error) {
    if (isExpectedConnectionError(error)) {
        console.warn(`${context}: ${error?.message || error}`);
        return;
    }
    console.error(context, error);
}

function isPasswordOnlyCredential(credential) {
    return credential?.passwordOnly || credential?.type === 'PASSWORD';
}

function getPasswordCacheKey(credential) {
    return credential?.rawName || credential?.name;
}

function buildPasswordLookupNames(credential) {
    const names = [];
    if (credential?.passwordOnly) {
        const prefixed = `${PASSWORD_ONLY_PREFIX}${credential.name}`;
        if (!names.includes(prefixed)) names.push(prefixed);
    }
    const primary = credential?.rawName || credential?.name;
    if (primary && !names.includes(primary)) names.push(primary);
    if (credential?.name && !names.includes(credential.name)) {
        names.push(credential.name);
    }
    return names;
}

function formatCredentialSummary(credential) {
    const passwordOnly = isPasswordOnlyCredential(credential);
    const parts = [];

    if (passwordOnly) {
        parts.push('Password Safe');
    } else {
        if (credential?.type) parts.push(credential.type);
        if (credential?.algorithm) parts.push(credential.algorithm);
    }

    if (credential?.hasPasswordSafe && !passwordOnly) {
        parts.push('Password Safe');
    }

    return parts.join(' • ') || 'Credential';
}

function getCachedPasswordEntry(cacheKey) {
    const cached = passwordEntryCache.get(cacheKey);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
        passwordEntryCache.delete(cacheKey);
        return null;
    }
    return cached;
}

function storeCachedPasswordEntry(cacheKey, entry) {
    passwordEntryCache.set(cacheKey, {
        entry,
        expiresAt: Date.now() + 30_000,
        usedLogin: false,
        usedPassword: false,
    });
}

function markCachedPasswordFieldUsed(cacheKey, field) {
    const cached = getCachedPasswordEntry(cacheKey);
    if (!cached) return;
    if (field === 'login') cached.usedLogin = true;
    if (field === 'password') cached.usedPassword = true;
    const loginDone = cached.usedLogin || !cached.entry?.login;
    const passwordDone = cached.usedPassword || !cached.entry?.password;
    if (loginDone && passwordDone) {
        passwordEntryCache.delete(cacheKey);
    } else {
        passwordEntryCache.set(cacheKey, cached);
    }
}

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    await loadStateFromBackground();
    await checkCurrentSite();
    // Try to connect in background, but don't block UI
    silentConnect();
});

function setupEventListeners() {
    document.getElementById('connectBtn').addEventListener('click', handleConnect);
    document.getElementById('copyBtn').addEventListener('click', handleCopyOTP);
    document.getElementById('copyLoginBtn').addEventListener('click', handleCopyLogin);
    document.getElementById('copyPasswordBtn').addEventListener('click', handleCopyPassword);
    document.getElementById('togglePasswordBtn').addEventListener('click', togglePasswordVisibility);
    document.getElementById('quickEnableOtp')?.addEventListener('change', syncQuickAddForm);
    document.getElementById('quickEnablePassword')?.addEventListener('change', syncQuickAddForm);
    document.getElementById('optionsLink').addEventListener('click', handleOpenOptions);
    document.getElementById('pinSubmitBtn').addEventListener('click', handlePinSubmit);
    document.getElementById('pinCancelBtn').addEventListener('click', handlePinCancel);
    document.getElementById('pinInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handlePinSubmit();
    });
    
    // Quick add credential listeners
    document.getElementById('toggleQuickAddBtn')?.addEventListener('click', toggleQuickAdd);
    document.getElementById('addQuickCredBtn')?.addEventListener('click', handleQuickAddCredential);
    document.getElementById('scanQrBtn')?.addEventListener('click', handleScanPageForQR);
}

async function loadStateFromBackground() {
    try {
        const response = await chrome.runtime.sendMessage({ action: 'getDeviceState' });
        credentials = response.credentials || [];
        showCachedFallback = false;

        if (response.connected) {
            device = new NativeTransport();
            isConnected = true;
            updateConnectionStatus(true, credentials.length);
        } else if (credentials.length > 0 || response.cached) {
            // Render cached state optimistically like a live connection.
            // If the silent probe fails afterwards, we switch to explicit cached UI.
            isConnected = false;
            updateConnectionStatus(true, credentials.length, false, false);
        } else {
            updateConnectionStatus(false, credentials.length, false);
        }
        refreshMatchingCredentials();
        renderCredentials();
    } catch (error) {
        console.error('Failed to load state:', error);
        // Still try to show cached credentials
        const stored = await chrome.storage.local.get(['credentialCache']);
        if (stored.credentialCache?.credentials) {
            credentials = filterVisibleCredentials(stored.credentialCache.credentials);
            showCachedFallback = false;
            updateConnectionStatus(true, credentials.length, false, false);
            refreshMatchingCredentials();
            renderCredentials();
        }
    }
}

function isCachedWhileOffline() {
    return !isConnected && showCachedFallback && credentials.length > 0;
}

async function silentConnect() {
    if (isSyncing) return;
    try {
        isSyncing = true;
        const probe = await chrome.runtime.sendMessage({ action: 'probeDevice' });
        if (probe?.connected) {
            if (!device) {
                device = new NativeTransport();
            }
            credentials = probe.credentials || credentials;
            showCachedFallback = false;
            isConnected = true;
            updateConnectionStatus(true, credentials.length);
            refreshMatchingCredentials();
            renderCredentials();
            return;
        }
        await markDisconnected(true);
        showCachedFallback = credentials.length > 0;
        updateConnectionStatus(false, credentials.length, showCachedFallback);
        refreshMatchingCredentials();
        renderCredentials();
    } catch (_) {
        showCachedFallback = credentials.length > 0;
        updateConnectionStatus(false, credentials.length, showCachedFallback);
        refreshMatchingCredentials();
        renderCredentials();
    } finally {
        isSyncing = false;
    }
}

async function checkCurrentSite() {
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.url) {
            currentHostname = new URL(tab.url).hostname;
            const response = await chrome.runtime.sendMessage({
                action: 'checkSiteMatch',
                hostname: currentHostname
            });
            matchingCredentials = response.credentials || [];
            renderCredentials();
        }
    } catch (error) {
        console.error('Failed to check site:', error);
    }
}

function updateConnectionStatus(
    connected,
    count,
    isCached = false,
    affectConnectionState = true,
) {
    const deviceSection = document.getElementById('deviceSection');
    const indicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('deviceStatus');
    const connectBtn = document.getElementById('connectBtn');
    const helpText = document.getElementById('connectHelp');

    deviceSection.classList.toggle('hidden', connected);
    connectBtn.style.display = 'none';
    connectBtn.disabled = false;
    if (helpText) {
        helpText.style.display = 'none';
    }

    if (connected) {
        indicator.classList.add('connected');
        statusText.textContent = '';
        if (affectConnectionState) {
            isConnected = true;
        }
    } else if (isCached) {
        indicator.classList.remove('connected');
        statusText.textContent = `Showing ${count} cached credential${count !== 1 ? 's' : ''}`;
        if (affectConnectionState) {
            isConnected = false;
        }
    } else {
        indicator.classList.remove('connected');
        statusText.textContent = 'Insert your Solo 2 to access credentials';
        if (affectConnectionState) {
            isConnected = false;
        }
    }
}

function updateCredentialSectionTitle() {
    const title = document.getElementById('allCredentialsTitle');
    title.textContent = `ALL CREDENTIALS (${credentials.length})`;
}

async function handleConnect() {
    const connectBtn = document.getElementById('connectBtn');
    const helpText = document.getElementById('connectHelp');

    connectBtn.textContent = 'Connecting...';
    connectBtn.disabled = true;
    helpText.style.display = 'block';
    helpText.textContent = 'Connecting to Solo 2…';

    try {
        await connectToDevice(false);
        helpText.style.display = 'none';
    } catch (error) {
        logConnectionIssue('Connection error', error);
        showMessage('Connection failed: ' + error.message, 'error');
        updateConnectionStatus(false, credentials.length, isCachedWhileOffline());
        helpText.style.display = 'block';
        helpText.textContent = error.message?.includes('ative host')
            ? 'Native messaging host not found — install it via SoloKeys GUI → Settings → Browser.'
                : 'Click to try again';
        connectBtn.textContent = 'Connect to Solo 2';
        connectBtn.disabled = false;
    }
}

async function connectToDevice(silent = false) {
    if (reconnectInFlight) {
        return reconnectInFlight;
    }

    reconnectInFlight = (async () => {
        device = new NativeTransport();
        try {
            const backgroundState = await chrome.runtime.sendMessage({ action: 'getDeviceState' });
            if (backgroundState?.connected) {
                credentials = backgroundState.credentials || credentials;
                isConnected = true;
                showCachedFallback = false;
                updateConnectionStatus(true, credentials.length);
                refreshMatchingCredentials();
                renderCredentials();
                clearMessage();
                return;
            }

            await device.connect(5000);
            const credentialState = await device.listCredentialsWithMeta();
            const creds = credentialState.credentials;

            credentials = creds;
            isConnected = true;

            await chrome.runtime.sendMessage({
                action: 'updateDeviceState',
                connected: true,
                credentials: creds,
                pinVerified: false,
                pinSet: credentialState.pinSet,
            });

            updateConnectionStatus(true, creds.length);
            refreshMatchingCredentials();
            renderCredentials();
            clearMessage();

            if (!silent) {
                showMessage('Solo 2 connected!', 'success');
            }
        } catch (error) {
            await markDisconnected(true);
            showCachedFallback = credentials.length > 0;
            updateConnectionStatus(false, credentials.length, showCachedFallback);
            refreshMatchingCredentials();
            renderCredentials();
            throw error;
        }
    })();

    try {
        await reconnectInFlight;
    } finally {
        reconnectInFlight = null;
    }
}

// Generate OTP then execute the requested action.
// action: 'display' (show in panel) | 'copy' (to clipboard) | 'type' (fill page)
async function generateOTP(credential, action = 'display') {
    if (isPasswordOnlyCredential(credential)) {
        return handlePasswordEntry(credential, action);
    }

    if (!isConnected || !device) {
        // Try to connect first
        try {
            await connectToDevice(true);
        } catch (error) {
            showMessage('Insert your Solo 2 to generate a code', 'info');
            return;
        }
    }

    currentCredential = credential;
    pendingCredentialName = credential.rawName || credential.name;
    pendingAction = action;

    try {
        const otp = await device.calculateOTP(credential.rawName || credential.name);
        executeOTPAction(otp, credential, action);
    } catch (error) {
        if (error.type === 'TOUCH_REQUIRED') {
            showTouchOverlay();
            pollForTouch(credential.rawName || credential.name);
        } else if (error.type === 'PIN_REQUIRED') {
            showPinModal();
        } else {
            const message = error.message || String(error);
            if (message.toLowerCase().includes('no solokeys device connected')) {
                await markDisconnected(true);
                showCachedFallback = credentials.length > 0;
                updateConnectionStatus(false, credentials.length, showCachedFallback);
                renderCredentials();
            }
            showMessage(message || 'Failed to generate OTP', 'error');
        }
    }
}

async function handlePasswordEntry(credential, action = 'display', options = {}) {
    const { fromTouchPoll = false } = options;
    if (!isConnected || !device) {
        try {
            await connectToDevice(true);
        } catch (error) {
            showMessage('Insert your Solo 2 to load the password', 'info');
            return;
        }
    }

    currentCredential = credential;
    pendingCredentialName = credential.rawName || credential.name;
    pendingAction = action;

    const cacheKey = getPasswordCacheKey(credential);
    const cachedEntry = getCachedPasswordEntry(cacheKey)?.entry;

    if (!cachedEntry && credential.touchRequired && !fromTouchPoll) {
        showTouchOverlay();
    }

    try {
        let entry = cachedEntry;
        if (!entry) {
            let lastError = null;
            let emptyEntry = null;
            for (const lookupName of buildPasswordLookupNames(credential)) {
                let result;
                try {
                    result = await device.getPasswordEntry(lookupName);
                } catch (error) {
                    lastError = error;
                    continue;
                }

                const candidate = result.credential || {};
                if (candidate.password || candidate.login || candidate.metadata) {
                    entry = candidate;
                    break;
                }

                if (!emptyEntry) {
                    emptyEntry = candidate;
                }
            }

            if (!entry) {
                if (lastError) {
                    throw lastError;
                }
                entry = emptyEntry;
            }
            if (entry && (entry.password || entry.login || entry.metadata)) {
                storeCachedPasswordEntry(cacheKey, entry);
            }
        }

        const value = entry.password || entry.login || '';
        if (!value) {
            hideTouchOverlay();
            showMessage('No password data stored for this credential', 'info');
            return;
        }

        hideTouchOverlay();
        if (action === 'copy') {
            await navigator.clipboard.writeText(value);
            markCachedPasswordFieldUsed(cacheKey, entry.password ? 'password' : 'login');
            showMessage('Password copied to clipboard', 'success');
        } else if (action === 'type') {
            executeOTPAction(value, credential, 'type');
            markCachedPasswordFieldUsed(cacheKey, entry.password ? 'password' : 'login');
        } else {
            displayPassword(entry, credential);
        }
    } catch (error) {
        if (error.type === 'TOUCH_REQUIRED') {
            if (fromTouchPoll) {
                throw error;
            }
            currentCredential = credential;
            pendingCredentialName = credential.rawName || credential.name;
            pendingAction = action;
            showTouchOverlay();
            pollForPasswordTouch(credential, action);
        } else if (error.type === 'PIN_REQUIRED') {
            hideTouchOverlay();
            showPinModal();
        } else {
            hideTouchOverlay();
            const message = error.message || String(error);
            if (message.toLowerCase().includes('no solokeys device connected')) {
                await markDisconnected(true);
                showCachedFallback = credentials.length > 0;
                updateConnectionStatus(false, credentials.length, showCachedFallback);
                renderCredentials();
            }
            showMessage(error.message || 'Failed to load password entry', 'error');
        }
    }
}

function executeOTPAction(otp, credential, action) {
    if (action === 'copy') {
        navigator.clipboard.writeText(otp)
            .then(() => showMessage('Code copied to clipboard', 'success'))
            .catch(() => showMessage('Failed to copy', 'error'));
    } else if (action === 'type') {
        chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
            if (!tab) { showMessage('No active tab', 'error'); return; }

            let typed = false;
            try {
                // executeScript transfers DOM focus properly before running, unlike
                // sendMessage which fires while the popup still owns window focus.
                const [result] = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    // Runs in the tab — data-solokeys-focus marks the last field the
                    // user touched, set by the content script's focusin listener.
                    func: (otp) => {
                        const el = document.querySelector('[data-solokeys-focus]');
                        if (!el) return false;
                        el.focus();
                        // execCommand now works because the tab has focus
                        if (document.execCommand('insertText', false, otp)) return true;
                        // execCommand not available (sandboxed / non-editable) — fall back
                        const proto = el instanceof HTMLTextAreaElement
                            ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
                        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                        if (setter) setter.call(el, el.value + otp);
                        else el.value += otp;
                        el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: otp, bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        return true;
                    },
                    args: [otp]
                });
                typed = result?.result === true;
            } catch (_) { /* scripting not permitted on this page */ }

            if (typed) {
                showMessage('Code typed!', 'success');
                setTimeout(() => window.close(), 600);
            } else {
                navigator.clipboard.writeText(otp)
                    .then(() => showMessage('No focused field — code copied to clipboard', 'info'))
                    .catch(() => showMessage('Failed to copy', 'error'));
            }
        });
    } else {
        displayOTP(otp, credential);
    }
}

async function pollForTouch(credentialName) {
    let attempts = 0;
    const maxAttempts = 30;

    const poll = async () => {
        attempts++;
        try {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const otp = await device.calculateOTP(credentialName);
            hideTouchOverlay();
            executeOTPAction(otp, currentCredential, pendingAction);
        } catch (error) {
            if (error.type === 'TOUCH_REQUIRED' && attempts < maxAttempts) {
                setTimeout(poll, 1000);
            } else {
                hideTouchOverlay();
                showMessage(
                    attempts >= maxAttempts ? 'Touch timeout' : (error.message || 'Failed to generate OTP'),
                    'error'
                );
            }
        }
    };

    setTimeout(poll, 1000);
}

async function pollForPasswordTouch(credential, action) {
    let attempts = 0;
    const maxAttempts = 30;

    const poll = async () => {
        attempts++;
        try {
            await new Promise(resolve => setTimeout(resolve, 1000));
            hideTouchOverlay();
            await handlePasswordEntry(credential, action, { fromTouchPoll: true });
        } catch (error) {
            if (error?.type === 'TOUCH_REQUIRED' && attempts < maxAttempts) {
                setTimeout(poll, 1000);
                return;
            }
            hideTouchOverlay();
            showMessage(
                attempts >= maxAttempts ? 'Touch timeout' : (error?.message || 'Failed to load password entry'),
                'error'
            );
        }
    };

    setTimeout(poll, 1000);
}

function renderCredentials() {
    updateCredentialSectionTitle();

    const cached = isCachedWhileOffline();

    // Matching credentials section
    const matchingSection = document.getElementById('matchingSection');
    const matchingList = document.getElementById('matchingList');

    if (matchingCredentials.length > 0) {
        matchingSection.classList.remove('hidden');
        matchingList.innerHTML = matchingCredentials.map(cred =>
            createCredentialItem(cred, true, cached)
        ).join('');
        attachCredentialHandlers(matchingList, matchingCredentials, cached);
    } else {
        matchingSection.classList.add('hidden');
    }

    // All credentials
    const list = document.getElementById('credentialList');

    if (credentials.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🔑</div>
                <p>${isConnected ? 'No credentials found' : 'Insert your Solo 2 to see credentials'}</p>
                ${isConnected ? '<button class="btn" id="addFirstCredBtn" style="margin-top: 8px;">Add Credential</button>' : ''}
            </div>
        `;
        document.getElementById('addFirstCredBtn')?.addEventListener('click', handleOpenOptions);
    } else {
        list.innerHTML = credentials.map(cred =>
            createCredentialItem(
                cred,
                matchingCredentials.some(m => (m.rawName || m.name) === (cred.rawName || cred.name)),
                cached
            )
        ).join('');
        attachCredentialHandlers(list, credentials, cached);
    }
}

function attachCredentialHandlers(container, credList, cached) {
    credList.forEach(cred => {
        const el = container.querySelector(`[data-name="${CSS.escape(cred.rawName || cred.name)}"]`);
        if (!el) return;

        // Row click (not on action buttons) → show OTP display panel
        el.addEventListener('click', (e) => {
            if (e.target.closest('.btn-row')) return;
            if (cached) {
                showMessage(
                    isPasswordOnlyCredential(cred)
                        ? 'Insert your Solo 2 to load the password'
                        : 'Insert your Solo 2 to generate a code',
                    'info'
                );
            } else {
                if (isPasswordOnlyCredential(cred)) {
                    handlePasswordEntry(cred, 'display');
                } else {
                    generateOTP(cred, 'display');
                }
            }
        });

        el.querySelector('.type-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isPasswordOnlyCredential(cred)) {
                handlePasswordEntry(cred, 'type');
            } else {
                generateOTP(cred, 'type');
            }
        });

        el.querySelector('.copy-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isPasswordOnlyCredential(cred)) {
                handlePasswordEntry(cred, 'copy');
            } else {
                generateOTP(cred, 'copy');
            }
        });

        el.querySelector('.password-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            handlePasswordEntry(cred, 'display');
        });
    });
}

function createCredentialItem(cred, isMatching, isCached = false) {
    const badges = [];
    if (cred.touchRequired) badges.push('<span class="badge touch">Touch</span>');
    if (cred.pinEncrypted) badges.push('<span class="badge pin">PIN</span>');
    if (isCached) badges.push('<span class="badge">Cached</span>');

    const { domain, username } = parseCredentialName(cred.name);
    const nameHtml = username
        ? `<span class="cred-domain">${escapeHtml(domain)}</span><span class="cred-sep">:</span><span class="cred-username">${escapeHtml(username)}</span>`
        : `<span class="cred-domain">${escapeHtml(domain)}</span>`;

    const actionButtons = isCached ? '' : (
        isPasswordOnlyCredential(cred)
            ? `
                <button class="btn-row password-btn" title="Show username and password actions">Open</button>
            `
            : `
                <button class="btn-row type-btn" title="Type into focused field">Type</button>
                <button class="btn-row copy-btn" title="Copy to clipboard">Copy</button>
                ${cred.hasPasswordSafe ? '<button class="btn-row password-btn" title="Show username and password actions">PW</button>' : ''}
            `
    );

    return `
        <div class="credential-item ${isMatching ? 'matching' : ''}" data-name="${escapeHtml(cred.rawName || cred.name)}">
            <div style="min-width:0; flex:1;">
                ${badges.length ? `<div class="credential-badges">${badges.join('')}</div>` : ''}
                <div class="credential-name">${nameHtml}</div>
                <div class="credential-type">${formatCredentialSummary(cred)}</div>
            </div>
            <div class="credential-actions">
                ${actionButtons}
            </div>
        </div>
    `;
}

function displayOTP(otp, credential) {
    clearMessage();
    currentOTP = otp;
    currentPasswordEntry = null;
    currentPasswordCacheKey = null;
    passwordVisible = false;
    if (passwordHideTimer) { clearTimeout(passwordHideTimer); passwordHideTimer = null; }
    const { domain, username } = parseCredentialName(credential.name);
    const nameEl = document.getElementById('otpCredentialName');
    nameEl.textContent = '';
    const domainSpan = document.createElement('span');
    domainSpan.className = 'cred-domain';
    domainSpan.textContent = domain;
    nameEl.appendChild(domainSpan);
    if (username) {
        const sep = document.createElement('span');
        sep.className = 'cred-sep';
        sep.textContent = ':';
        const userSpan = document.createElement('span');
        userSpan.className = 'cred-username';
        userSpan.textContent = username;
        nameEl.appendChild(sep);
        nameEl.appendChild(userSpan);
    }
    document.getElementById('otpCode').textContent = otp;
    document.getElementById('otpTimer').style.display = '';
    document.getElementById('copyBtn').innerHTML = '<span>📋</span> Copy to Clipboard';
    document.getElementById('copyBtn').classList.remove('hidden');
    document.getElementById('passwordDetail').classList.add('hidden');
    document.getElementById('otpSection').classList.remove('hidden');
    startOTPTimer();
}

function displayPassword(entry, credential) {
    clearMessage();
    currentOTP = entry.password || entry.login || '';
    currentPasswordEntry = entry;
    currentPasswordCacheKey = getPasswordCacheKey(credential);
    passwordVisible = false;
    if (passwordHideTimer) { clearTimeout(passwordHideTimer); passwordHideTimer = null; }
    if (timerInterval) clearInterval(timerInterval);
    const { domain, username } = parseCredentialName(credential.name);
    const nameEl = document.getElementById('otpCredentialName');
    nameEl.textContent = '';
    const domainSpan = document.createElement('span');
    domainSpan.className = 'cred-domain';
    domainSpan.textContent = domain;
    nameEl.appendChild(domainSpan);
    if (username) {
        const sep = document.createElement('span');
        sep.className = 'cred-sep';
        sep.textContent = ':';
        const userSpan = document.createElement('span');
        userSpan.className = 'cred-username';
        userSpan.textContent = username;
        nameEl.appendChild(sep);
        nameEl.appendChild(userSpan);
    }
    document.getElementById('otpCode').textContent = '';
    document.getElementById('otpTimer').style.display = 'none';
    document.getElementById('copyBtn').classList.add('hidden');
    document.getElementById('passwordDetail').classList.remove('hidden');
    document.getElementById('loginRow').style.display = entry.login ? '' : 'none';
    document.getElementById('passwordRow').style.display = entry.password ? '' : 'none';
    document.getElementById('loginValue').textContent = entry.login || '-';
    document.getElementById('passwordValue').textContent = entry.password ? '***' : '-';
    document.getElementById('togglePasswordBtn').textContent = 'Show';
    document.getElementById('otpSection').classList.remove('hidden');
}

function startOTPTimer() {
    if (timerInterval) clearInterval(timerInterval);

    const period = 30;
    const updateTimer = () => {
        const now = Math.floor(Date.now() / 1000);
        const remaining = period - (now % period);
        const progress = document.getElementById('timerProgress');
        if (progress) {
            const circumference = 100.5;
            const offset = circumference - (remaining / period) * circumference;
            progress.style.strokeDashoffset = offset;
            progress.style.stroke = remaining < 5 ? '#f44336' : '#111';
        }
    };

    updateTimer();
    timerInterval = setInterval(updateTimer, 1000);
}

async function handleCopyOTP() {
    if (!currentOTP) return;
    try {
        await navigator.clipboard.writeText(currentOTP);
        const btn = document.getElementById('copyBtn');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<span>✓</span> Copied!';
        setTimeout(() => { btn.innerHTML = originalHTML; }, 2000);
    } catch (error) {
        showMessage('Failed to copy to clipboard', 'error');
    }
}

async function handleCopyLogin() {
    if (!currentPasswordEntry?.login) return;
    try {
        await navigator.clipboard.writeText(currentPasswordEntry.login);
        if (currentPasswordCacheKey) {
            markCachedPasswordFieldUsed(currentPasswordCacheKey, 'login');
        }
        showMessage('Username copied to clipboard', 'success');
    } catch (error) {
        showMessage('Failed to copy username', 'error');
    }
}

async function handleCopyPassword() {
    if (!currentPasswordEntry?.password) return;
    try {
        await navigator.clipboard.writeText(currentPasswordEntry.password);
        if (currentPasswordCacheKey) {
            markCachedPasswordFieldUsed(currentPasswordCacheKey, 'password');
        }
        showMessage('Password copied to clipboard', 'success');
    } catch (error) {
        showMessage('Failed to copy password', 'error');
    }
}

function togglePasswordVisibility() {
    if (!currentPasswordEntry?.password) return;
    passwordVisible = !passwordVisible;
    document.getElementById('passwordValue').textContent = passwordVisible
        ? currentPasswordEntry.password
        : '***';
    document.getElementById('togglePasswordBtn').textContent = passwordVisible ? 'Hide' : 'Show';
    if (passwordHideTimer) clearTimeout(passwordHideTimer);
    if (passwordVisible) {
        passwordHideTimer = setTimeout(() => {
            passwordVisible = false;
            passwordHideTimer = null;
            document.getElementById('passwordValue').textContent = '***';
            document.getElementById('togglePasswordBtn').textContent = 'Show';
        }, 30_000);
    } else {
        passwordHideTimer = null;
    }
}

function handleOpenOptions(e) {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
}

function showPinModal() {
    document.getElementById('pinModal').classList.remove('hidden');
    document.getElementById('pinInput').value = '';
    document.getElementById('pinInput').focus();
}

function hidePinModal() {
    document.getElementById('pinModal').classList.add('hidden');
}

async function handlePinSubmit() {
    const pin = document.getElementById('pinInput').value;
    if (!pin || !device) return;

    try {
        const result = await device.verifyPIN(pin);

        if (result.success) {
            hidePinModal();
            showMessage('PIN verified successfully', 'success');

            if (pendingCredentialName) {
                const cred = credentials.find(c => (c.rawName || c.name) === pendingCredentialName);
                if (cred) {
                    if (isPasswordOnlyCredential(cred)) {
                        handlePasswordEntry(cred, pendingAction);
                    } else {
                        generateOTP(cred, pendingAction);
                    }
                }
            }
        } else {
            showMessage(result.message || 'Invalid PIN', 'error');
            document.getElementById('pinInput').value = '';
            document.getElementById('pinInput').focus();
        }
    } catch (error) {
        showMessage(error.message || 'PIN verification failed', 'error');
    }
}

function handlePinCancel() {
    hidePinModal();
    pendingCredentialName = null;
    pendingAction = 'display';
}

function showTouchOverlay() {
    document.getElementById('touchOverlay').classList.remove('hidden');
}

function hideTouchOverlay() {
    document.getElementById('touchOverlay').classList.add('hidden');
}

function clearMessage() {
    const area = document.getElementById('messageArea');
    if (messageTimeoutId !== null) {
        clearTimeout(messageTimeoutId);
        messageTimeoutId = null;
    }
    area.innerHTML = '';
}

function showMessage(text, type) {
    const area = document.getElementById('messageArea');
    const msg = document.createElement('div');
    msg.className = `message ${type}`;
    msg.textContent = text;
    clearMessage();
    area.appendChild(msg);
    messageTimeoutId = setTimeout(() => {
        if (area.contains(msg)) {
            msg.remove();
        }
        if (messageTimeoutId !== null) {
            messageTimeoutId = null;
        }
    }, 5000);
}

function syncQuickAddForm() {
    const otpEnabled = document.getElementById('quickEnableOtp')?.checked ?? true;
    const passwordEnabled = document.getElementById('quickEnablePassword')?.checked ?? false;
    document.getElementById('quickOtpFields').classList.toggle('hidden', !otpEnabled);
    document.getElementById('quickPasswordFields').classList.toggle('hidden', !passwordEnabled);
}

// Quick Add Credential Functions
function toggleQuickAdd() {
    const form = document.getElementById('quickAddForm');
    const btn = document.getElementById('toggleQuickAddBtn');
    const qrResults = document.getElementById('qrResults');
    
    if (form.classList.contains('hidden')) {
        form.classList.remove('hidden');
        btn.textContent = '− Cancel';

        // Set domain from current site (read-only)
        const domainInput = document.getElementById('quickCredDomain');
        domainInput.value = currentHostname || '';

        // Clear username and focus it
        const usernameInput = document.getElementById('quickCredUsername');
        usernameInput.value = '';
        document.getElementById('quickEnableOtp').checked = true;
        document.getElementById('quickEnablePassword').checked = false;
        document.getElementById('quickCredSecret').value = '';
        document.getElementById('quickCredLogin').value = '';
        document.getElementById('quickCredPassword').value = '';
        syncQuickAddForm();
        usernameInput.focus();
    } else {
        form.classList.add('hidden');
        btn.textContent = '+ Add Credential for This Site';
        qrResults.style.display = 'none';
    }
}

async function handleQuickAddCredential() {
    const domain = document.getElementById('quickCredDomain').value.trim();
    const username = document.getElementById('quickCredUsername').value.trim();
    const otpEnabled = document.getElementById('quickEnableOtp').checked;
    const passwordEnabled = document.getElementById('quickEnablePassword').checked;
    const secretInput = document.getElementById('quickCredSecret');
    const login = document.getElementById('quickCredLogin').value;
    const password = document.getElementById('quickCredPassword').value;
    const touchRequired = document.getElementById('quickCredTouch').checked;
    const pinProtected = document.getElementById('quickCredPin').checked;

    if (!domain) {
        showMessage('No domain — open the popup on a website first', 'error');
        return;
    }

    const name = username ? `${domain}:${username}` : domain;
    const secret = secretInput.value.trim();

    if (!otpEnabled && !passwordEnabled) {
        showMessage('Enable OTP, Password Safe, or both', 'error');
        return;
    }
    
    // Ensure we're connected
    if (!isConnected || !device) {
        try {
            await connectToDevice(true);
        } catch (error) {
            showMessage('Please insert your Solo 2 first', 'error');
            return;
        }
    }
    
    let secretBytes;
    if (otpEnabled) {
        if (!secret) {
            showMessage('Please enter or scan a secret key', 'error');
            return;
        }
        try {
            secretBytes = base32Decode(secret);
        } catch (error) {
            showMessage('Invalid secret key format. Must be Base32 encoded.', 'error');
            return;
        }
    } else {
        secretBytes = crypto.getRandomValues(new Uint8Array(20));
    }
    
    try {
        const result = await device.addCredential(name, secretBytes, 'TOTP', 'SHA1', 6, {
            touchRequired,
            pinProtected,
            login: passwordEnabled ? login : undefined,
            password: passwordEnabled ? password : undefined,
            passwordOnly: passwordEnabled && !otpEnabled,
        });
        if (result.success) {
            showMessage('Credential added successfully!', 'success');
            document.getElementById('quickCredUsername').value = '';
            secretInput.value = '';
            document.getElementById('quickCredLogin').value = '';
            document.getElementById('quickCredPassword').value = '';
            document.getElementById('quickCredTouch').checked = false;
            document.getElementById('quickCredPin').checked = false;
            toggleQuickAdd();
            
            // Refresh credentials list
            await loadCredentialsFromDevice();
        } else {
            showMessage(result.message || 'Failed to add credential', 'error');
        }
    } catch (error) {
        if (error.type === 'PIN_REQUIRED') {
            showMessage('PIN required. Please verify PIN first.', 'error');
        } else {
            showMessage('Error: ' + error.message, 'error');
        }
    }
}

async function loadCredentialsFromDevice() {
    if (!device) return;
    try {
        const credentialState = await device.listCredentialsWithMeta();
        credentials = credentialState.credentials;
        await chrome.runtime.sendMessage({
            action: 'updateDeviceState',
            connected: true,
            credentials,
            pinVerified: false,
            pinSet: credentialState.pinSet,
        });
        refreshMatchingCredentials();
        renderCredentials();
        updateConnectionStatus(true, credentials.length);
    } catch (error) {
        console.error('Failed to load credentials:', error);
    }
}

// QR Code Scanning from Page
async function handleScanPageForQR() {
    const scanBtn = document.getElementById('scanQrBtn');
    const resultsDiv = document.getElementById('qrResults');
    const resultsList = document.getElementById('qrResultsList');

    scanBtn.textContent = '🔍 Scanning...';
    scanBtn.disabled = true;

    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) {
            showMessage('No active tab', 'error');
            return;
        }

        // Check if this is a valid page for content scripts
        if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') || tab.url.startsWith('file://'))) {
            showMessage('Cannot scan on this page type. Please navigate to a website.', 'error');
            return;
        }

        // Always inject jsqr.js first so jsQR global is available in content script
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['lib/jsqr.js']
            });
        } catch (_) { /* may already be injected, safe to ignore */ }

        // Try to send message to content script, injecting it if not yet loaded
        let response = null;
        try {
            response = await chrome.tabs.sendMessage(tab.id, { action: 'scanPageForQR' });
        } catch (error) {
            if (error.message && error.message.includes('Receiving end does not exist')) {
                // content.js not yet loaded — inject it, then retry
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ['content/content.js']
                    });
                    await new Promise(resolve => setTimeout(resolve, 500));
                    response = await chrome.tabs.sendMessage(tab.id, { action: 'scanPageForQR' });
                } catch (injectionError) {
                    throw new Error('Cannot access this page. Extension may not have permission.');
                }
            } else {
                throw error;
            }
        }

        foundQRCodes = response?.results || [];

        if (foundQRCodes.length === 0) {
            showMessage('No QR codes found on this page', 'info');
            resultsDiv.style.display = 'none';
        } else {
            // Display found QR codes
            resultsList.innerHTML = foundQRCodes.map((qr, index) => `
                <div class="qr-result-item" data-index="${index}" style="
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px;
                    background: #f5f5f5;
                    border-radius: 4px;
                    margin-bottom: 4px;
                    cursor: pointer;
                    font-size: 12px;
                ">
                    <img src="${qr.imgSrc}" style="width: 40px; height: 40px; object-fit: contain; border-radius: 2px;">
                    <div style="flex: 1; overflow: hidden;">
                        <div style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${qr.url.substring(0, 50)}...</div>
                    </div>
                </div>
            `).join('');

            // Add click handlers
            resultsList.querySelectorAll('.qr-result-item').forEach(item => {
                item.addEventListener('click', () => {
                    const index = parseInt(item.dataset.index);
                    const qr = foundQRCodes[index];
                    const parsed = parseOTPAuthURL(qr.url);

                    if (parsed) {
                        // Domain stays fixed; fill username from QR account name
                        document.getElementById('quickCredUsername').value = parsed.label || '';
                        document.getElementById('quickCredSecret').value = parsed.secret || '';
                        resultsDiv.style.display = 'none';
                        showMessage('QR code selected!', 'success');
                    }
                });
            });

            resultsDiv.style.display = 'block';
            showMessage(`Found ${foundQRCodes.length} QR code(s)`, 'success');
        }
    } catch (error) {
        console.error('QR scan error:', error);
        if (error.message && error.message.includes('Receiving end does not exist')) {
            showMessage('Cannot scan this page. Please try refreshing the page first.', 'error');
        } else {
            showMessage('Failed to scan page: ' + error.message, 'error');
        }
    } finally {
        scanBtn.textContent = '🔍 Find QR on Page';
        scanBtn.disabled = false;
    }
}

function parseOTPAuthURL(url) {
    try {
        if (!url.startsWith('otpauth://')) return null;
        
        const parsed = new URL(url);
        const params = new URLSearchParams(parsed.search);
        
        const path = decodeURIComponent(parsed.pathname.substring(1));
        let label = path;
        let issuer = params.get('issuer') || '';
        
        if (path.includes(':')) {
            const parts = path.split(':');
            issuer = parts[0];
            label = parts[1];
        }
        
        return {
            type: parsed.hostname,
            label,
            issuer,
            secret: params.get('secret'),
            algorithm: (params.get('algorithm') || 'SHA1').toUpperCase(),
            digits: params.get('digits') || '6',
            period: params.get('period') || '30'
        };
    } catch (error) {
        console.error('Failed to parse OTP URL:', error);
        return null;
    }
}

// Utility function for Base32 decoding
function base32Decode(str) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const cleaned = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
    
    if (cleaned.length === 0) {
        throw new Error('Empty secret');
    }
    
    const bits = cleaned.split('').map(c => {
        const index = alphabet.indexOf(c);
        if (index === -1) throw new Error('Invalid Base32 character');
        return index.toString(2).padStart(5, '0');
    }).join('');
    
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
        bytes.push(parseInt(bits.substr(i, 8), 2));
    }
    
    return new Uint8Array(bytes);
}

// Split "domain:username" into parts. Domain is everything before the first colon.
function parseCredentialName(name) {
    const idx = name.indexOf(':');
    if (idx === -1) return { domain: name, username: '' };
    return { domain: name.slice(0, idx), username: name.slice(idx + 1) };
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
