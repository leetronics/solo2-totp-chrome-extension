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
let lastConnectionAttempt = 0;
let lastProbeAt = 0;

const PROBE_COOLDOWN_MS = 1500;
const RECENT_CONNECTION_WINDOW_MS = 15000;

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
        const { wasConnected, pinVerified: storedPinVerified, lastConnected } = stored.connectionState;
        recentlyConnected = Boolean(
            wasConnected && lastConnected && (Date.now() - lastConnected) < RECENT_CONNECTION_WINDOW_MS
        );
        deviceConnected = false;
        pinVerified = Boolean(recentlyConnected && storedPinVerified);
    }
    
    // Update badge with any cached matches
    updateBadge();
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
            if (request.credentials) {
                credentials = request.credentials;
                // Persist fresh credentials for offline display
                if (credentials.length) {
                    await chrome.storage.local.set({
                        credentialCache: { credentials, cachedAt: Date.now() }
                    });
                }
            }
            // Save connection state
            await chrome.storage.local.set({
                connectionState: { 
                    wasConnected: deviceConnected, 
                    lastConnected: deviceConnected ? Date.now() : null,
                    pinVerified,
                }
            });
            updateBadge();
            return { success: true };

        case 'getDeviceState':
            return {
                connected: deviceConnected,
                credentials,
                pinVerified: pinVerified,
                credentialCount: credentials.length,
                cached: !deviceConnected && credentials.length > 0,
                reconnecting: recentlyConnected && !deviceConnected && credentials.length > 0
            };

        case 'probeDevice':
            return await probeDevice(request.force === true);

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
            await chrome.storage.local.set({
                connectionState: { 
                    wasConnected: deviceConnected, 
                    lastConnected: deviceConnected ? Date.now() : null,
                    pinVerified,
                }
            });
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
    const { extensionClientId } = await chrome.storage.local.get(['extensionClientId']);
    if (!extensionClientId) return { success: false, error: 'Not paired with SoloKeys GUI' };

    return new Promise(resolve => {
        chrome.runtime.sendNativeMessage(
            'com.solokeys.secrets',
            { action: 'calculateOTP', name: credentialName,
              clientId: extensionClientId, clientName: 'SoloKeys Secrets – Chrome' },
            (response) => {
                if (chrome.runtime.lastError) {
                    resolve({ success: false, error: chrome.runtime.lastError.message });
                } else {
                    resolve(response);
                }
            }
        );
    });
}

async function probeDevice(force = false) {
    if (!force && (Date.now() - lastProbeAt) < PROBE_COOLDOWN_MS) {
        return {
            success: true,
            connected: deviceConnected,
            credentials,
            pinVerified,
            cached: !deviceConnected && credentials.length > 0,
        };
    }

    lastProbeAt = Date.now();

    const { extensionClientId } = await chrome.storage.local.get(['extensionClientId']);
    if (!extensionClientId) {
        deviceConnected = false;
        pinVerified = false;
        return {
            success: false,
            connected: false,
            credentials,
            pinVerified: false,
            cached: credentials.length > 0,
            error: 'Not paired with SoloKeys GUI',
        };
    }

    const response = await new Promise(resolve => {
        chrome.runtime.sendNativeMessage(
            'com.solokeys.secrets',
            {
                action: 'listCredentials',
                clientId: extensionClientId,
                clientName: 'SoloKeys Secrets – Chrome',
            },
            (nativeResponse) => {
                if (chrome.runtime.lastError) {
                    resolve({ success: false, error: chrome.runtime.lastError.message });
                } else {
                    resolve(nativeResponse || { success: false, error: 'No response from native host' });
                }
            }
        );
    });

    if (response?.success) {
        deviceConnected = true;
        recentlyConnected = true;
        if (Array.isArray(response.credentials)) {
            credentials = response.credentials;
        }
        await chrome.storage.local.set({
            connectionState: {
                wasConnected: true,
                lastConnected: Date.now(),
                pinVerified,
            }
        });
        return {
            success: true,
            connected: true,
            credentials,
            pinVerified,
            cached: false,
        };
    }

    deviceConnected = false;
    recentlyConnected = false;
    pinVerified = false;
    await chrome.storage.local.set({
        connectionState: {
            wasConnected: false,
            lastConnected: null,
            pinVerified: false,
        }
    });
    return {
        success: false,
        connected: false,
        credentials,
        pinVerified: false,
        cached: credentials.length > 0,
        error: response?.error || 'Device not available',
    };
}

async function handleGetPasswordEntry(credentialName) {
    const { extensionClientId } = await chrome.storage.local.get(['extensionClientId']);
    if (!extensionClientId) return { success: false, error: 'Not paired with SoloKeys GUI' };

    return new Promise(resolve => {
        chrome.runtime.sendNativeMessage(
            'com.solokeys.secrets',
            { action: 'getPasswordEntry', name: credentialName,
              clientId: extensionClientId, clientName: 'SoloKeys Secrets – Chrome' },
            (response) => {
                if (chrome.runtime.lastError) {
                    resolve({ success: false, error: chrome.runtime.lastError.message });
                } else {
                    resolve(response);
                }
            }
        );
    });
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
