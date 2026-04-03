// background/service-worker.js
// Background service worker for SoloKeys Secrets extension
// Handles device management through popup relay (WebHID not available in service workers)

import { matchesSite } from '../lib/utils.js';

// Global state
let credentials = [];
let currentTabHostname = null;
let matchingCredentials = [];
let deviceConnected = false;
let recentlyConnected = false;
let pinVerified = false;
let pinSet = null;
let lastConnectionAttempt = 0;
let lastProbeAt = 0;
let nativePort = null;
let nativeRequestInFlight = 0;
let nativeRequestQueue = Promise.resolve();
let lastNativeSuccessAt = 0;

const HOST_NAME = 'com.solokeys.secrets';
const CLIENT_NAME = 'SoloKeys Secrets – Chrome';
const PROBE_COOLDOWN_MS = 1500;
const RECENT_CONNECTION_WINDOW_MS = 15000;
const NATIVE_REQUEST_TIMEOUT_MS = 15000;
const CONNECTED_STATE_FRESH_MS = 10000;

function extractPinSetFlag(response) {
    const candidates = [
        response?.pinSet,
        response?.hasPin,
        response?.pinConfigured,
        response?.pinInitialized,
        response?.secretsPinSet,
        response?.status?.pinSet,
        response?.device?.pinSet,
    ];

    for (const candidate of candidates) {
        if (typeof candidate === 'boolean') {
            return candidate;
        }
    }

    return null;
}

async function persistConnectionState() {
    await chrome.storage.local.set({
        connectionState: {
            wasConnected: deviceConnected,
            lastConnected: deviceConnected ? Date.now() : null,
            pinVerified,
            pinSet,
        }
    });
}

// Initialize on startup
chrome.runtime.onStartup.addListener(initialize);
chrome.runtime.onInstalled.addListener(initialize);

// No JS icon setting - rely on manifest theme_icons

async function initialize() {
    console.log('SoloKeys Secrets: Service worker initialized');
    
    // Load cached credentials so popup can show them when device is disconnected
    const stored = await chrome.storage.local.get(['credentialCache', 'connectionState']);
    if (stored.credentialCache?.credentials) {
        credentials = stored.credentialCache.credentials;
    }
    
    // Restore connection state if we were previously connected
    if (stored.connectionState?.wasConnected) {
        console.log('SoloKeys Secrets: Previous connection detected, will auto-reconnect on next use');
    }
    if (stored.connectionState) {
        const {
            wasConnected,
            pinVerified: storedPinVerified,
            lastConnected,
            pinSet: storedPinSet,
        } = stored.connectionState;
        recentlyConnected = Boolean(
            wasConnected && lastConnected && (Date.now() - lastConnected) < RECENT_CONNECTION_WINDOW_MS
        );
        deviceConnected = false;
        pinVerified = Boolean(recentlyConnected && storedPinVerified);
        pinSet = typeof storedPinSet === 'boolean' ? storedPinSet : null;
    }
    
    // Update badge with any cached matches
    updateBadge();
}

function disconnectNativePort(reason = 'manual') {
    if (!nativePort) {
        return;
    }

    const port = nativePort;
    nativePort = null;

    try {
        port.disconnect();
    } catch (_) {
        // Port already closed.
    }

    console.log(`SoloKeys Secrets: Native host port closed (${reason})`);
}

function ensureNativePort() {
    if (nativePort) {
        return nativePort;
    }

    const port = chrome.runtime.connectNative(HOST_NAME);
    port.onDisconnect.addListener(() => {
        if (nativePort === port) {
            nativePort = null;
        }

        const message = chrome.runtime.lastError?.message || 'Native host disconnected';
        console.warn(`SoloKeys Secrets: ${message}`);
    });

    nativePort = port;
    console.log('SoloKeys Secrets: Native host port opened');
    return port;
}

function sendNativeRequest(payload, options = {}) {
    const run = () => sendNativeRequestWithRetry(payload, options);
    const request = nativeRequestQueue.then(run, run);
    nativeRequestQueue = request.catch(() => {});
    return request;
}

function shouldRetryNativeError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return (
        message.includes('timeout') ||
        message.includes('disconnected') ||
        message.includes('native host has exited') ||
        message.includes('native host exited') ||
        message.includes('broken pipe') ||
        message.includes('specified native messaging host not found')
    );
}

async function sendNativeRequestWithRetry(payload, options = {}) {
    const attempts = options.retry ? 2 : 1;
    let lastError = null;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            return await sendNativeRequestNow(payload, options);
        } catch (error) {
            lastError = error;
            disconnectNativePort(attempt === 0 ? 'retry' : 'failed');
            if (attempt + 1 >= attempts || !shouldRetryNativeError(error)) {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 150));
        }
    }

    throw lastError || new Error('Native request failed');
}

function sendNativeRequestNow(payload, options = {}) {
    const timeoutMs = options.timeoutMs ?? NATIVE_REQUEST_TIMEOUT_MS;
    const port = ensureNativePort();

    nativeRequestInFlight += 1;

    return new Promise((resolve, reject) => {
        let settled = false;
        let timeoutId = null;

        const finish = (callback, value) => {
            if (settled) {
                return;
            }
            settled = true;
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            port.onMessage.removeListener(onMessage);
            port.onDisconnect.removeListener(onDisconnect);
            nativeRequestInFlight = Math.max(0, nativeRequestInFlight - 1);
            callback(value);
        };

        const onMessage = (response) => {
            lastNativeSuccessAt = Date.now();
            finish(resolve, response);
        };

        const onDisconnect = () => {
            const message = chrome.runtime.lastError?.message || 'Native host disconnected';
            if (nativePort === port) {
                nativePort = null;
            }
            finish(reject, new Error(message));
        };

        timeoutId = setTimeout(() => {
            disconnectNativePort('request-timeout');
            finish(reject, new Error('Native host request timeout'));
        }, timeoutMs);

        port.onMessage.addListener(onMessage);
        port.onDisconnect.addListener(onDisconnect);

        try {
            port.postMessage(payload);
        } catch (error) {
            disconnectNativePort('post-failed');
            finish(reject, error);
        }
    });
}

async function getExtensionClientId() {
    const stored = await chrome.storage.local.get(['extensionClientId']);
    if (stored.extensionClientId) {
        return stored.extensionClientId;
    }

    const clientId = crypto.randomUUID();
    await chrome.storage.local.set({ extensionClientId: clientId });
    return clientId;
}

async function sendNativeHostAction(payload, options = {}) {
    const clientId = await getExtensionClientId();
    return sendNativeRequest(
        {
            ...payload,
            clientId,
            clientName: CLIENT_NAME,
        },
        options,
    );
}

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    handleMessage(request, sender).then(sendResponse).catch(error => {
        console.error('Message handler error:', error);
        sendResponse({ error: error.message || String(error) });
    });
    return true; // Keep channel open for async response
});

async function handleMessage(request, sender) {
    switch (request.action) {
        case 'updateDeviceState':
            // Popup updates us on device connection status
            deviceConnected = request.connected;
            recentlyConnected = request.connected;
            pinVerified = request.pinVerified || false;
            if (request.pinSet !== undefined) {
                pinSet = typeof request.pinSet === 'boolean' ? request.pinSet : null;
            }
            if (request.credentials) {
                credentials = request.credentials;
                // Persist fresh credentials for offline display
                if (credentials.length) {
                    await chrome.storage.local.set({
                        credentialCache: { credentials, cachedAt: Date.now() }
                    });
                }
            }
            await persistConnectionState();
            updateBadge();
            return { success: true };

        case 'getDeviceState':
            return {
                connected: deviceConnected,
                credentials,
                pinVerified: pinVerified,
                pinSet,
                credentialCount: credentials.length,
                cached: !deviceConnected && credentials.length > 0,
                reconnecting: recentlyConnected && !deviceConnected && credentials.length > 0
            };

        case 'probeDevice':
            return await probeDevice(request.force === true);

        case 'nativeRequest':
            return await sendNativeHostAction(request.payload || {}, {
                timeoutMs: request.timeoutMs,
                retry: true,
            });

        case 'getCredentials':
            return { credentials };

        case 'checkSiteMatch':
            return await handleCheckSiteMatch(request.hostname);

        case 'getMatchingCredentials':
            return { credentials: matchingCredentials };

        case 'setConnectionState':
            // Allow popup to explicitly set connection state
            deviceConnected = request.connected;
            recentlyConnected = request.connected;
            if (request.pinVerified !== undefined) {
                pinVerified = request.pinVerified;
            }
            if (request.pinSet !== undefined) {
                pinSet = typeof request.pinSet === 'boolean' ? request.pinSet : null;
            }
            await persistConnectionState();
            return { success: true };

        case 'openPopup':
            // Open the extension popup
            try {
                await chrome.action.openPopup();
                return { success: true };
            } catch (error) {
                return { success: false, error: error.message };
            }

        case 'generateOTP':
        case 'retryAfterTouch':
            return handleGenerateOTP(request.credentialName);

        case 'getPasswordEntry':
            return handleGetPasswordEntry(request.credentialName);

        default:
            // Unknown actions are handled by popup
            return { error: 'Unknown action in background: ' + request.action };
    }
}

async function handleCheckSiteMatch(hostname) {
    currentTabHostname = hostname;

    if (!currentTabHostname) {
        matchingCredentials = [];
    } else {
        matchingCredentials = credentials.filter(cred =>
            matchesSite(cred.name, currentTabHostname)
        );
    }

    updateBadge();

    // Notify content script
    if (matchingCredentials.length > 0) {
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                await chrome.tabs.sendMessage(tab.id, {
                    action: 'matchingCredentials',
                    credentials: matchingCredentials
                });
            }
        } catch (error) {
            console.log('Could not notify content script:', error);
        }
    }

    return {
        hasMatches: matchingCredentials.length > 0,
        count: matchingCredentials.length,
        credentials: matchingCredentials
    };
}

async function handleGenerateOTP(credentialName) {
    try {
        return await sendNativeHostAction({ action: 'calculateOTP', name: credentialName });
    } catch (error) {
        return { success: false, error: error.message || String(error) };
    }
}

async function probeDevice(force = false) {
    if (!force && (Date.now() - lastProbeAt) < PROBE_COOLDOWN_MS) {
        return {
            success: true,
            connected: deviceConnected,
            credentials,
            pinVerified,
            pinSet,
            cached: !deviceConnected && credentials.length > 0,
        };
    }

    if (
        !force &&
        deviceConnected &&
        nativePort &&
        lastNativeSuccessAt &&
        (Date.now() - lastNativeSuccessAt) < CONNECTED_STATE_FRESH_MS
    ) {
        return {
            success: true,
            connected: true,
            credentials,
            pinVerified,
            pinSet,
            cached: false,
        };
    }

    lastProbeAt = Date.now();

    let response;
    try {
        response = await sendNativeHostAction(
            { action: 'listCredentials' },
            { timeoutMs: NATIVE_REQUEST_TIMEOUT_MS, retry: true },
        );
    } catch (error) {
        response = { success: false, error: error.message || String(error) };
    }

    if (response?.success) {
        deviceConnected = true;
        recentlyConnected = true;
        if (Array.isArray(response.credentials)) {
            credentials = response.credentials;
        }
        const reportedPinSet = extractPinSetFlag(response);
        if (reportedPinSet !== null) {
            pinSet = reportedPinSet;
        }
        await persistConnectionState();
        return {
            success: true,
            connected: true,
            credentials,
            pinVerified,
            pinSet,
            cached: false,
        };
    }

    deviceConnected = false;
    recentlyConnected = false;
    pinVerified = false;
    await persistConnectionState();
    return {
        success: false,
        connected: false,
        credentials,
        pinVerified: false,
        pinSet,
        cached: credentials.length > 0,
        error: response?.error || 'Device not available',
    };
}

async function handleGetPasswordEntry(credentialName) {
    try {
        return await sendNativeHostAction({ action: 'getPasswordEntry', name: credentialName });
    } catch (error) {
        return { success: false, error: error.message || String(error) };
    }
}

function updateBadge() {
    const count = matchingCredentials.length;
    chrome.action.setBadgeText({ text: count > 0 ? count.toString() : '' });
    chrome.action.setBadgeBackgroundColor({ color: '#4CAF50' });
}

// Listen for tab changes to update matching credentials
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab && tab.url) {
            const hostname = new URL(tab.url).hostname;
            await handleCheckSiteMatch(hostname);
        }
    } catch (error) {
        console.log('Tab switch error:', error);
    }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.active && tab.url) {
        try {
            const hostname = new URL(tab.url).hostname;
            await handleCheckSiteMatch(hostname);
        } catch (error) {
            console.log('Tab update error:', error);
        }
    }
});
