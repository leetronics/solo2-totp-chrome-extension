// options/options.js
// Options page logic for SoloKeys TOTP extension

import NativeTransport from '../lib/native-transport.js';
import OATHProtocol from '../lib/oath.js';

let isConnected = false;
let credentials = [];
let device = null;
let oath = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    setupTabs();
    await loadSettings();
    await checkDeviceStatus();
});

function setupEventListeners() {
    // Connection
    document.getElementById('connectBtn').addEventListener('click', handleConnect);

    // Tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });

    // Add credential
    document.getElementById('addCredBtn').addEventListener('click', handleAddCredential);
    document.getElementById('clearFormBtn').addEventListener('click', clearAddForm);
    document.getElementById('scanQrBtn').addEventListener('click', handleScanQR);

    // PIN management
    document.getElementById('setPinBtn').addEventListener('click', handleSetPIN);
    document.getElementById('changePinBtn').addEventListener('click', handleChangePIN);

    // Settings
    document.getElementById('saveSettingsBtn').addEventListener('click', saveSettings);
    document.getElementById('resetSettingsBtn').addEventListener('click', resetSettings);

    // PIN modal
    document.getElementById('modalPinSubmit').addEventListener('click', handleModalPinSubmit);
    document.getElementById('modalPinCancel').addEventListener('click', hidePinModal);
    document.getElementById('modalPinInput').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleModalPinSubmit();
    });
}

function setupTabs() {
    // Already handled in setupEventListeners
}

function switchTab(tabId) {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));

    document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
    document.getElementById(`${tabId}Tab`).classList.add('active');
}

async function loadSettings() {
    const settings = await chrome.storage.local.get({
        autoCopy: false,
        showNotifications: true
    });

    document.getElementById('autoCopy').checked = settings.autoCopy;
    document.getElementById('showNotifications').checked = settings.showNotifications;
}

async function saveSettings() {
    const settings = {
        autoCopy: document.getElementById('autoCopy').checked,
        showNotifications: document.getElementById('showNotifications').checked
    };

    await chrome.storage.local.set(settings);
    showMessage('Settings saved successfully', 'success');
}

async function resetSettings() {
    await chrome.storage.local.set({
        autoCopy: false,
        showNotifications: true
    });
    await loadSettings();
    showMessage('Settings reset to defaults', 'info');
}

async function checkDeviceStatus() {
    try {
        await connectToDevice();
    } catch (error) {
        console.log('Auto-connect failed:', error.message);
    }
}

function updateConnectionStatus(connected, count) {
    const indicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    const connectBtn = document.getElementById('connectBtn');
    const helpText = document.getElementById('connectHelp');

    if (connected) {
        indicator.classList.add('connected');
        statusText.textContent = `Connected to SoloKeys GUI • ${count} credential${count !== 1 ? 's' : ''}`;
        connectBtn.style.display = 'none';
        if (helpText) helpText.style.display = 'none';
        isConnected = true;
    } else {
        indicator.classList.remove('connected');
        statusText.textContent = 'Not connected to SoloKeys GUI';
        connectBtn.textContent = 'Connect to SoloKeys GUI';
        connectBtn.style.display = 'block';
        isConnected = false;
    }
}

async function handleConnect() {
    const connectBtn = document.getElementById('connectBtn');
    const helpText = document.getElementById('connectHelp');
    
    connectBtn.textContent = 'Connecting...';
    connectBtn.disabled = true;
    if (helpText) {
        helpText.style.display = 'block';
        helpText.textContent = 'Check SoloKeys GUI for confirmation dialog...';
    }

    try {
        await connectToDevice();
    } catch (error) {
        console.error('Connection error:', error);
        showMessage('Connection failed: ' + error.message, 'error');
        if (helpText) {
            helpText.style.display = 'block';
            helpText.textContent = 'Click to try again';
        }
    } finally {
        connectBtn.disabled = false;
    }
}

async function connectToDevice() {
    try {
        device = new NativeTransport();
        await device.connect(30000); // 30 second timeout for user confirmation

        oath = new OATHProtocol(device);

        credentials = [];
        try {
            credentials = await oath.listCredentials();
        } catch (e) {
            console.warn('Could not list credentials:', e);
        }

        isConnected = true;
        updateConnectionStatus(true, credentials.length);
        renderCredentialList();
        showMessage('Connected to SoloKeys GUI!', 'success');

        // Sync state to background
        await chrome.runtime.sendMessage({
            action: 'updateDeviceState',
            connected: true,
            credentials,
            pinVerified: oath.pinVerified
        });
    } catch (error) {
        console.error('Failed to connect to SoloKeys GUI:', error);
        showMessage('Failed to connect: ' + error.message, 'error');
        const connectBtn = document.getElementById('connectBtn');
        connectBtn.textContent = 'Connect to SoloKeys GUI';
        isConnected = false;
    }
}

        isConnected = true;
        updateConnectionStatus(true, credentials.length);
        renderCredentialList();
        showMessage('Connected to SoloKeys GUI!', 'success');

        // Sync state to background
        await chrome.runtime.sendMessage({
            action: 'updateDeviceState',
            connected: true,
            credentials,
            pinVerified: oath.pinVerified
        });
    } catch (error) {
        console.error('Failed to connect to device:', error);
        showMessage('Failed to connect: ' + error.message, 'error');
        const connectBtn = document.getElementById('connectBtn');
        connectBtn.textContent = 'Connect Device';
    }
}

async function loadCredentials() {
    if (!oath) return;
    try {
        credentials = await oath.listCredentials();
        renderCredentialList();
        updateConnectionStatus(isConnected, credentials.length);
    } catch (error) {
        console.error('Failed to load credentials:', error);
        showMessage('Failed to load credentials: ' + error.message, 'error');
    }
}

function renderCredentialList() {
    const list = document.getElementById('credentialList');

    if (credentials.length === 0) {
        list.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🔑</div>
                <p>No credentials found on device</p>
                <button class="btn" onclick="switchTab('add')" style="margin-top: 16px;">Add Your First Credential</button>
            </div>
        `;
        return;
    }

    list.innerHTML = credentials.map(cred => `
        <div class="credential-card" data-credential-name="${escapeHtml(cred.name)}">
            <div class="credential-info">
                <h3>${escapeHtml(cred.name)}</h3>
                <p>${cred.type} • ${cred.algorithm} • ${cred.digits} digits</p>
                <div class="credential-badges">
                    ${cred.touchRequired ? '<span class="badge touch">Touch Required</span>' : ''}
                    ${cred.pinEncrypted ? '<span class="badge pin">PIN Protected</span>' : ''}
                </div>
            </div>
            <button class="btn btn-danger delete-cred-btn">Delete</button>
        </div>
    `).join('');
    
    // Attach delete handlers using event delegation
    list.querySelectorAll('.delete-cred-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const card = e.target.closest('.credential-card');
            const name = card.dataset.credentialName;
            deleteCredential(name);
        });
    });
}

async function deleteCredential(name) {
    const confirmed = await showConfirmDialog(
        'Delete Credential',
        `Are you sure you want to delete "${name}"? This cannot be undone.`
    );
    if (!confirmed) return;

    if (!oath) {
        showMessage('Not connected to SoloKeys GUI', 'error');
        return;
    }

    try {
        const result = await oath.deleteCredential(name);
        if (result.success) {
            showMessage('Credential deleted successfully', 'success');
            await loadCredentials();
        } else {
            showMessage(result.message || 'Failed to delete credential', 'error');
        }
    } catch (error) {
        showMessage('Error: ' + error.message, 'error');
    }
}

function showConfirmDialog(title, message) {
    return new Promise((resolve) => {
        document.getElementById('confirmTitle').textContent = title;
        document.getElementById('confirmMessage').textContent = message;
        const modal = document.getElementById('confirmModal');
        modal.style.display = 'flex';

        const okBtn = document.getElementById('confirmOkBtn');
        const cancelBtn = document.getElementById('confirmCancelBtn');

        function close(result) {
            modal.style.display = 'none';
            okBtn.removeEventListener('click', onOk);
            cancelBtn.removeEventListener('click', onCancel);
            resolve(result);
        }

        function onOk() { close(true); }
        function onCancel() { close(false); }

        okBtn.addEventListener('click', onOk);
        cancelBtn.addEventListener('click', onCancel);
    });
}

async function handleAddCredential() {
    const name = document.getElementById('credName').value.trim();
    const secret = document.getElementById('credSecret').value.trim();
    const type = document.getElementById('credType').value;
    const algorithm = document.getElementById('credAlgorithm').value;
    const digits = parseInt(document.getElementById('credDigits').value);
    const touchRequired = document.getElementById('credTouch').checked;
    const pinEncrypted = document.getElementById('credPin').checked;

    if (!name) {
        showMessage('Please enter a credential name', 'error');
        return;
    }

    if (!secret) {
        showMessage('Please enter or scan a secret key', 'error');
        return;
    }

    if (!oath) {
        showMessage('Not connected to SoloKeys GUI', 'error');
        return;
    }

    let secretBytes;
    try {
        secretBytes = base32Decode(secret);
    } catch (error) {
        showMessage('Invalid secret key format. Must be Base32 encoded.', 'error');
        return;
    }

    try {
        const result = await oath.addCredential(name, secretBytes, type, algorithm, digits, { touchRequired, pinEncrypted });
        if (result.success) {
            showMessage('Credential added successfully!', 'success');
            clearAddForm();
            await loadCredentials();
            switchTab('credentials');
        } else {
            showMessage(result.message || 'Failed to add credential', 'error');
        }
    } catch (error) {
        if (error.type === 'PIN_REQUIRED') {
            showPinModal(async (pin) => {
                const pinResult = await oath.verifyPIN(pin);
                if (pinResult.success) {
                    const retryResult = await oath.addCredential(name, secretBytes, type, algorithm, digits, { touchRequired, pinEncrypted });
                    if (retryResult.success) {
                        showMessage('Credential added successfully!', 'success');
                        clearAddForm();
                        await loadCredentials();
                        switchTab('credentials');
                    } else {
                        showMessage(retryResult.message || 'Failed to add credential', 'error');
                    }
                } else {
                    showMessage(pinResult.message || 'Invalid PIN', 'error');
                }
            });
        } else {
            showMessage('Error: ' + error.message, 'error');
        }
    }
}

function clearAddForm() {
    document.getElementById('credName').value = '';
    document.getElementById('credSecret').value = '';
    document.getElementById('credType').value = 'TOTP';
    document.getElementById('credAlgorithm').value = 'SHA1';
    document.getElementById('credDigits').value = '6';
    document.getElementById('credTouch').checked = false;
    document.getElementById('credPin').checked = false;
}

async function handleScanQR() {
    const scanBtn = document.getElementById('scanQrBtn');

    scanBtn.textContent = 'Scanning...';
    scanBtn.disabled = true;

    try {
        // Query all tabs to find QR codes
        const tabs = await chrome.tabs.query({});
        let allResults = [];
        let scannedTabs = 0;
        let accessibleTabs = 0;

        for (const tab of tabs) {
            // Skip invalid pages
            if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://'))) {
                continue;
            }
            accessibleTabs++;

            try {
                const response = await chrome.tabs.sendMessage(tab.id, { action: 'scanPageForQR' });
                if (response?.results?.length > 0) {
                    allResults = allResults.concat(response.results.map(r => ({ ...r, tabTitle: tab.title, tabId: tab.id })));
                }
                scannedTabs++;
            } catch (e) {
                // Tab may not have content script or be accessible, skip
                continue;
            }
        }

        if (allResults.length === 0) {
            if (accessibleTabs === 0) {
                showMessage('No accessible tabs found. Please open a website first.', 'info');
            } else if (scannedTabs === 0) {
                showMessage('Could not scan any tabs. Try refreshing the pages first.', 'info');
            } else {
                showMessage('No QR codes found on any open page', 'info');
            }
        } else {
            showQRCodeSelector(allResults);
        }
    } catch (error) {
        console.error('Scan error:', error);
        showMessage('Failed to scan: ' + error.message, 'error');
    } finally {
        scanBtn.textContent = '🔍 Find QR on Page';
        scanBtn.disabled = false;
    }
}

function showQRCodeSelector(results) {
    // Create modal for QR code selection
    const modal = document.createElement('div');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 2000;
    `;
    
    modal.innerHTML = `
        <div style="background: white; padding: 24px; border-radius: 12px; max-width: 500px; max-height: 80vh; overflow-y: auto;">
            <h3 style="margin-bottom: 16px;">Select QR Code (${results.length} found)</h3>
            <div id="qrSelectorList"></div>
            <button class="btn btn-secondary" id="closeQrSelector" style="width: 100%; margin-top: 16px;">Cancel</button>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const list = modal.querySelector('#qrSelectorList');
    list.innerHTML = results.map((qr, index) => `
        <div class="qr-select-item" data-index="${index}" style="
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 12px;
            background: #f8f9fa;
            border-radius: 8px;
            margin-bottom: 8px;
            cursor: pointer;
            transition: background 0.2s;
        ">
            <img src="${qr.imgSrc}" style="width: 60px; height: 60px; object-fit: contain; border-radius: 4px; border: 1px solid #ddd;">
            <div style="flex: 1; overflow: hidden;">
                <div style="font-weight: 500; margin-bottom: 4px;">${qr.tabTitle || 'Unknown page'}</div>
                <div style="font-size: 12px; color: #666; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${qr.url.substring(0, 60)}...</div>
            </div>
        </div>
    `).join('');
    
    // Add click handlers
    list.querySelectorAll('.qr-select-item').forEach(item => {
        item.addEventListener('click', () => {
            const index = parseInt(item.dataset.index);
            const qr = results[index];
            const parsed = parseOTPAuthURL(qr.url);
            
            if (parsed) {
                document.getElementById('credName').value = parsed.label || parsed.issuer || '';
                document.getElementById('credSecret').value = parsed.secret || '';
                document.getElementById('credAlgorithm').value = parsed.algorithm || 'SHA1';
                document.getElementById('credDigits').value = parsed.digits || '6';
                showMessage('QR code selected!', 'success');
            }
            
            modal.remove();
        });
        
        item.addEventListener('mouseenter', () => {
            item.style.background = '#e3f2fd';
        });
        item.addEventListener('mouseleave', () => {
            item.style.background = '#f8f9fa';
        });
    });
    
    modal.querySelector('#closeQrSelector').addEventListener('click', () => {
        modal.remove();
    });
    
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
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

async function handleSetPIN() {
    const pin = document.getElementById('newPin').value;

    if (!pin || pin.length < 4) {
        showMessage('PIN must be at least 4 characters', 'error');
        return;
    }

    if (!oath) {
        showMessage('Not connected to SoloKeys GUI', 'error');
        return;
    }

    try {
        const result = await oath.setPIN(pin);
        if (result.success) {
            showMessage('PIN set successfully!', 'success');
            document.getElementById('newPin').value = '';
        } else {
            showMessage(result.message || 'Failed to set PIN', 'error');
        }
    } catch (error) {
        showMessage('Error: ' + error.message, 'error');
    }
}

async function handleChangePIN() {
    const currentPin = document.getElementById('currentPin').value;
    const newPin = document.getElementById('changeNewPin').value;

    if (!currentPin || !newPin) {
        showMessage('Please enter both current and new PIN', 'error');
        return;
    }

    if (newPin.length < 4) {
        showMessage('New PIN must be at least 4 characters', 'error');
        return;
    }

    if (!oath) {
        showMessage('Not connected to SoloKeys GUI', 'error');
        return;
    }

    try {
        const result = await oath.changePIN(currentPin, newPin);
        if (result.success) {
            showMessage('PIN changed successfully!', 'success');
            document.getElementById('currentPin').value = '';
            document.getElementById('changeNewPin').value = '';
        } else {
            showMessage(result.message || 'Failed to change PIN', 'error');
        }
    } catch (error) {
        showMessage('Error: ' + error.message, 'error');
    }
}

// PIN Modal
let pinCallback = null;

function showPinModal(callback) {
    pinCallback = callback;
    document.getElementById('modalPinInput').value = '';
    document.getElementById('pinModal').style.display = 'flex';
    document.getElementById('modalPinInput').focus();
}

function hidePinModal() {
    pinCallback = null;
    document.getElementById('pinModal').style.display = 'none';
}

async function handleModalPinSubmit() {
    const pin = document.getElementById('modalPinInput').value;
    if (!pin || !pinCallback) return;

    hidePinModal();
    await pinCallback(pin);
}

// Utility functions
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

function showMessage(text, type) {
    const area = document.getElementById('messageArea');
    const msg = document.createElement('div');
    msg.className = `message ${type}`;
    msg.textContent = text;
    area.innerHTML = '';
    area.appendChild(msg);

    setTimeout(() => {
        msg.remove();
    }, 5000);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Expose switchTab globally for inline onclick handlers
window.switchTab = switchTab;
