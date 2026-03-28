// popup/popup.js
// Popup UI logic for SoloKeys TOTP extension

import NativeTransport from '../lib/native-transport.js';
import OATHProtocol from '../lib/oath.js';
import { matchesSite } from '../lib/utils.js';

// Global state
let device = null;
let oath = null;
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
        isConnected = response.connected;
        credentials = response.credentials || [];
        
        // Always show credentials (cached or live)
        updateConnectionStatus(isConnected, credentials.length, response.cached);
        renderCredentials();
    } catch (error) {
        console.error('Failed to load state:', error);
        // Still try to show cached credentials
        const stored = await chrome.storage.local.get(['credentialCache']);
        if (stored.credentialCache?.credentials) {
            credentials = stored.credentialCache.credentials;
            renderCredentials();
        }
    }
}

function isCachedWhileOffline() {
    return !isConnected && credentials.length > 0;
}

async function silentConnect() {
    // Only try to connect if not already connected
    if (isConnected || isSyncing) return;
    
    // Check if we should auto-connect (were connected recently)
    const stored = await chrome.storage.local.get(['connectionState']);
    const shouldAutoConnect = stored.connectionState?.wasConnected && 
        stored.connectionState?.lastConnected &&
        (Date.now() - stored.connectionState.lastConnected) < 300000; // 5 minutes
    
    if (shouldAutoConnect) {
        try {
            isSyncing = true;
            await connectToDevice(true); // silent mode
        } catch (error) {
            console.log('Silent connect failed:', error.message);
        } finally {
            isSyncing = false;
        }
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

function updateConnectionStatus(connected, count, isCached = false) {
    const indicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('deviceStatus');
    const connectBtn = document.getElementById('connectBtn');

    if (connected) {
        indicator.classList.add('connected');
        statusText.textContent = `Connected to SoloKeys GUI • ${count} credentials`;
        connectBtn.textContent = 'Reconnect';
        isConnected = true;
    } else if (isCached) {
        indicator.classList.remove('connected');
        statusText.textContent = `Cached • ${count} credentials`;
        connectBtn.textContent = 'Connect to SoloKeys GUI';
        isConnected = false;
    } else {
        indicator.classList.remove('connected');
        statusText.textContent = 'Not connected to SoloKeys GUI';
        connectBtn.textContent = 'Connect to SoloKeys GUI';
        isConnected = false;
    }
}

async function handleConnect() {
    const connectBtn = document.getElementById('connectBtn');
    connectBtn.textContent = 'Connecting...';
    connectBtn.disabled = true;

    try {
        await connectToDevice(false); // explicit user action, not silent
    } catch (error) {
        console.error('Connection error:', error);
        showMessage('Connection failed: ' + error.message, 'error');
        updateConnectionStatus(false, credentials.length, isCachedWhileOffline());
    } finally {
        connectBtn.disabled = false;
    }
}

async function connectToDevice(silent = false) {
    device = new NativeTransport();
    await device.connect();

    oath = new OATHProtocol(device);

    let creds = [];
    try {
        creds = await oath.listCredentials();
    } catch (e) {
        console.warn('Could not list credentials:', e);
    }

    credentials = creds;
    isConnected = true;

    await chrome.runtime.sendMessage({
        action: 'updateDeviceState',
        connected: true,
        credentials: creds,
        pinVerified: oath.pinVerified
    });

    updateConnectionStatus(true, creds.length);
    renderCredentials();
    
    if (!silent) {
        showMessage('Connected to SoloKeys GUI!', 'success');
    }

    const connectBtn = document.getElementById('connectBtn');
    connectBtn.textContent = 'Reconnect';
    connectBtn.disabled = false;
}

// Generate OTP then execute the requested action.
// action: 'display' (show in panel) | 'copy' (to clipboard) | 'type' (fill page)
async function generateOTP(credential, action = 'display') {
    if (!isConnected || !oath) {
        // Try to connect first
        try {
            showMessage('Connecting to SoloKeys GUI...', 'info');
            await connectToDevice();
        } catch (error) {
            showMessage('Connect to SoloKeys GUI to generate a code', 'info');
            return;
        }
    }

    currentCredential = credential;
    pendingCredentialName = credential.name;
    pendingAction = action;

    try {
        const otp = await oath.calculateOTP(credential.name);
        executeOTPAction(otp, credential, action);
    } catch (error) {
        if (error.type === 'TOUCH_REQUIRED') {
            showTouchOverlay();
            pollForTouch(credential.name);
        } else if (error.type === 'PIN_REQUIRED') {
            showPinModal();
        } else {
            showMessage(error.message || 'Failed to generate OTP', 'error');
            // Connection might be stale, mark as disconnected
            isConnected = false;
            updateConnectionStatus(false, credentials.length, true);
        }
    }
}

function executeOTPAction(otp, credential, action) {
    if (action === 'copy') {
        navigator.clipboard.writeText(otp)
            .then(() => showMessage('Code copied to clipboard', 'success'))
            .catch(() => showMessage('Failed to copy', 'error'));
    } else if (action === 'type') {
        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
            if (!tab) {
                showMessage('No active tab', 'error');
                return;
            }
            chrome.tabs.sendMessage(tab.id, { action: 'fillOTP', otp }, (response) => {
                if (chrome.runtime.lastError || !response?.success) {
                    // Fallback: copy to clipboard
                    navigator.clipboard.writeText(otp)
                        .then(() => showMessage('No OTP field found — code copied instead', 'info'))
                        .catch(() => showMessage('Failed to copy', 'error'));
                } else {
                    showMessage('Code typed!', 'success');
                    setTimeout(() => window.close(), 600);
                }
            });
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
            const otp = await oath.calculateOTP(credentialName);
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

function renderCredentials() {
    document.getElementById('credentialCount').textContent = credentials.length;

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
                <p>${isConnected ? 'No credentials found' : 'Connect to SoloKeys GUI to see credentials'}</p>
                ${isConnected ? '<button class="btn" id="addFirstCredBtn" style="margin-top: 8px;">Add Credential</button>' : ''}
            </div>
        `;
        document.getElementById('addFirstCredBtn')?.addEventListener('click', handleOpenOptions);
    } else {
        const cachedBanner = cached
            ? '<div class="message info" style="margin:0 0 8px;">Showing cached credentials — connect to SoloKeys GUI to generate codes</div>'
            : '';
        list.innerHTML = cachedBanner + credentials.map(cred =>
            createCredentialItem(cred, matchingCredentials.some(m => m.name === cred.name), cached)
        ).join('');
        attachCredentialHandlers(list, credentials, cached);
    }
}

function attachCredentialHandlers(container, credList, cached) {
    credList.forEach(cred => {
        const el = container.querySelector(`[data-name="${CSS.escape(cred.name)}"]`);
        if (!el) return;

        // Row click (not on action buttons) → show OTP display panel
        el.addEventListener('click', (e) => {
            if (e.target.closest('.btn-row')) return;
            if (cached) {
                showMessage('Connect to SoloKeys GUI to generate a code', 'info');
            } else {
                generateOTP(cred, 'display');
            }
        });

        el.querySelector('.type-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            generateOTP(cred, 'type');
        });

        el.querySelector('.copy-btn')?.addEventListener('click', (e) => {
            e.stopPropagation();
            generateOTP(cred, 'copy');
        });
    });
}

function createCredentialItem(cred, isMatching, isCached = false) {
    const badges = [];
    if (cred.touchRequired) badges.push('<span class="badge touch">Touch</span>');
    if (cred.pinEncrypted) badges.push('<span class="badge pin">PIN</span>');
    if (isCached) badges.push('<span class="badge">Cached</span>');

    const actionButtons = isCached ? '' : `
        <button class="btn-row type-btn" title="Type into focused field">Type</button>
        <button class="btn-row copy-btn" title="Copy to clipboard">Copy</button>
    `;

    return `
        <div class="credential-item ${isMatching ? 'matching' : ''}" data-name="${escapeHtml(cred.name)}">
            <div style="min-width:0; flex:1;">
                ${badges.length ? `<div class="credential-badges">${badges.join('')}</div>` : ''}
                <div class="credential-name">${escapeHtml(cred.name)}</div>
                <div class="credential-type">${cred.type} • ${cred.algorithm}</div>
            </div>
            <div class="credential-actions">
                ${actionButtons}
            </div>
        </div>
    `;
}

function displayOTP(otp, credential) {
    currentOTP = otp;
    document.getElementById('otpCredentialName').textContent = credential.name;
    document.getElementById('otpCode').textContent = otp;
    document.getElementById('otpSection').classList.remove('hidden');
    startOTPTimer();
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
    if (!pin || !oath) return;

    try {
        const result = await oath.verifyPIN(pin);

        if (result.success) {
            hidePinModal();
            showMessage('PIN verified successfully', 'success');

            if (pendingCredentialName) {
                const cred = credentials.find(c => c.name === pendingCredentialName);
                if (cred) generateOTP(cred, pendingAction);
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

function showMessage(text, type) {
    const area = document.getElementById('messageArea');
    const msg = document.createElement('div');
    msg.className = `message ${type}`;
    msg.textContent = text;
    area.innerHTML = '';
    area.appendChild(msg);
    setTimeout(() => { msg.remove(); }, 5000);
}

// Quick Add Credential Functions
function toggleQuickAdd() {
    const form = document.getElementById('quickAddForm');
    const btn = document.getElementById('toggleQuickAddBtn');
    const qrResults = document.getElementById('qrResults');
    
    if (form.classList.contains('hidden')) {
        form.classList.remove('hidden');
        btn.textContent = '− Cancel';
        
        // Pre-fill credential name with current site
        const nameInput = document.getElementById('quickCredName');
        if (currentHostname && !nameInput.value) {
            // Extract domain name without TLD
            const parts = currentHostname.split('.');
            const siteName = parts.length > 1 ? parts[parts.length - 2] : parts[0];
            nameInput.value = siteName.charAt(0).toUpperCase() + siteName.slice(1);
            nameInput.focus();
            nameInput.select();
        }
    } else {
        form.classList.add('hidden');
        btn.textContent = '+ Add Credential for This Site';
        qrResults.style.display = 'none';
    }
}

async function handleQuickAddCredential() {
    const nameInput = document.getElementById('quickCredName');
    const secretInput = document.getElementById('quickCredSecret');
    
    const name = nameInput.value.trim();
    const secret = secretInput.value.trim();
    
    if (!name) {
        showMessage('Please enter a credential name', 'error');
        return;
    }
    
    if (!secret) {
        showMessage('Please enter or scan a secret key', 'error');
        return;
    }
    
    // Ensure we're connected
    if (!isConnected || !oath) {
        try {
            showMessage('Connecting to SoloKeys GUI...', 'info');
            await connectToDevice();
        } catch (error) {
            showMessage('Please connect to SoloKeys GUI first', 'error');
            return;
        }
    }
    
    // Decode secret
    let secretBytes;
    try {
        secretBytes = base32Decode(secret);
    } catch (error) {
        showMessage('Invalid secret key format. Must be Base32 encoded.', 'error');
        return;
    }
    
    try {
        const result = await oath.addCredential(name, secretBytes, 'TOTP', 'SHA1', 6, {});
        if (result.success) {
            showMessage('Credential added successfully!', 'success');
            nameInput.value = '';
            secretInput.value = '';
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
    if (!oath) return;
    try {
        credentials = await oath.listCredentials();
        await chrome.runtime.sendMessage({
            action: 'updateDeviceState',
            connected: true,
            credentials,
            pinVerified: oath.pinVerified
        });
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
        
        const response = await chrome.tabs.sendMessage(tab.id, { action: 'scanPageForQR' });
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
                        document.getElementById('quickCredName').value = parsed.label || parsed.issuer || '';
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
        showMessage('Failed to scan page: ' + error.message, 'error');
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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
