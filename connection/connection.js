// connection/connection.js
// Dedicated connection window for WebHID device selection and operations
// This window stays open to maintain the device connection

import CCIDTransport from '../lib/ccid.js';

let device = null;
let isConnected = false;

// UI Elements
const icon = document.getElementById('icon');
const title = document.getElementById('title');
const description = document.getElementById('description');
const status = document.getElementById('status');
const spinner = document.getElementById('spinner');
const connectBtn = document.getElementById('connectBtn');
const retryBtn = document.getElementById('retryBtn');
const cancelBtn = document.getElementById('cancelBtn');
const debugInfo = document.getElementById('debugInfo');
const webhidSupport = document.getElementById('webhidSupport');
const deviceInfo = document.getElementById('deviceInfo');

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    checkWebHIDSupport();
    setupEventListeners();
    setupMessageListener();
});

function setupMessageListener() {
    // Listen for messages from popup
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        handlePopupMessage(request, sender).then(sendResponse).catch(error => {
            console.error('Message handler error:', error);
            sendResponse({ error: error.message || String(error) });
        });
        return true; // Keep channel open
    });
}

async function handlePopupMessage(request, sender) {
    console.log('Received message from popup:', request.action);
    
    switch (request.action) {
        case 'requestOTP':
            return await handleGenerateOTP(request.credentialName);
            
        case 'verifyPIN':
            return await handleVerifyPIN(request.pin);
            
        case 'getDeviceStatus':
            return {
                connected: isConnected,
                credentialCount: await getCredentialCount()
            };
            
        default:
            return { error: 'Unknown action: ' + request.action };
    }
}

async function getCredentialCount() {
    return 0;
}

async function handleGenerateOTP(credentialName) {
    return { success: false, error: 'Use native transport path' };
}

async function handleVerifyPIN(pin) {
    return { success: false, message: 'Use native transport path' };
}

async function checkWebHIDSupport() {
    if (!navigator.usb) {
        showError(
            'WebUSB Not Supported',
            'Your browser does not support WebUSB. Please use Chrome 61 or later.',
            false
        );
        webhidSupport.textContent = 'WebUSB: NOT SUPPORTED';
        webhidSupport.style.color = '#c62828';
        return;
    }

    webhidSupport.textContent = 'WebUSB: Supported ✓';
    webhidSupport.style.color = '#2e7d32';

    try {
        const devices = await navigator.usb.getDevices();
        if (devices.length > 0) {
            deviceInfo.innerHTML = '<strong>Authorized devices:</strong><br>' +
                devices.map(d => `• ${d.productName} (${d.vendorId.toString(16)}:${d.productId.toString(16)})`).join('<br>');
            deviceInfo.style.display = 'block';
        } else {
            deviceInfo.textContent = 'No authorized USB devices found. Plug in your SoloKeys and click "Select Device".';
        }
    } catch (e) {
        deviceInfo.textContent = 'Error checking devices: ' + e.message;
    }
}

function setupEventListeners() {
    connectBtn.addEventListener('click', handleConnect);
    retryBtn.addEventListener('click', () => {
        resetUI();
        handleConnect();
    });
    cancelBtn.addEventListener('click', () => {
        window.close();
    });
}

function resetUI() {
    icon.textContent = '🔐';
    title.textContent = 'Connect Your SoloKeys';
    description.textContent = 'Click the button below to select your SoloKeys 2 device';
    status.textContent = 'Ready to connect';
    status.className = 'status info';
    spinner.classList.add('hidden');
    connectBtn.classList.remove('hidden');
    retryBtn.classList.add('hidden');
    cancelBtn.textContent = 'Cancel';
}

async function handleConnect() {
    if (!navigator.usb) {
        showError('WebUSB Not Available', 'Please use Chrome 61 or later', false);
        return;
    }
    
    try {
        showConnecting();
        
        // Request device via WebUSB
        const usbDevice = await navigator.usb.requestDevice({
            filters: [
                { vendorId: 0x1209, productId: 0xBEEE },
                { vendorId: 0x1209, productId: 0xB000 }
            ]
        });

        device = new CCIDTransport();
        device.usbDevice = usbDevice;

        deviceInfo.textContent = `Device: ${usbDevice.productName} (${usbDevice.vendorId.toString(16)}:${usbDevice.productId.toString(16)})`;

        updateStatus('Connecting to device...', 'info');
        await device.connect();
        
        console.log('Device connected successfully');
        isConnected = true;
        
        // Update background script with connection state
        await updateBackgroundState(true, [], false);
        
        // Show success
        showSuccess(credentials.length);
        
        // Keep window open but show minimal UI
        setTimeout(() => {
            showMinimizedMode(credentials.length);
        }, 2000);
        
    } catch (error) {
        console.error('Connection error:', error);
        showError(
            'Connection Failed',
            error.message || 'Failed to connect to SoloKeys device',
            true
        );
    }
}

function showMinimizedMode(credentialCount) {
    // Shrink the window to show it's just maintaining connection
    title.textContent = 'SoloKeys Connected';
    description.textContent = `Connection active • ${credentialCount} credential${credentialCount !== 1 ? 's' : ''}`;
    description.style.marginBottom = '12px';
    status.textContent = 'Device connected and ready';
    status.className = 'status success';
    icon.textContent = '🔓';
    spinner.classList.add('hidden');
    connectBtn.classList.add('hidden');
    retryBtn.classList.add('hidden');
    cancelBtn.textContent = 'Disconnect';
    
    // Resize window to be smaller
    window.resizeTo(400, 300);
}

function showConnecting() {
    icon.textContent = '⏳';
    title.textContent = 'Connecting...';
    description.textContent = 'Please select your device from the browser dialog';
    status.textContent = 'Waiting for device selection...';
    status.className = 'status info';
    spinner.classList.remove('hidden');
    connectBtn.classList.add('hidden');
    retryBtn.classList.add('hidden');
    cancelBtn.textContent = 'Cancel';
    debugInfo.classList.remove('hidden');
}

function updateStatus(message, type) {
    status.textContent = message;
    status.className = `status ${type}`;
}

function showSuccess(credentialCount) {
    icon.textContent = '✅';
    title.textContent = 'Connected!';
    description.textContent = `Successfully connected to SoloKeys. Found ${credentialCount} credential${credentialCount !== 1 ? 's' : ''}.`;
    status.textContent = 'Connection successful';
    status.className = 'status success';
    spinner.classList.add('hidden');
    connectBtn.classList.add('hidden');
    retryBtn.classList.add('hidden');
    cancelBtn.textContent = 'Close';
}

function showError(titleText, descText, allowRetry) {
    icon.textContent = '❌';
    title.textContent = titleText;
    description.textContent = descText;
    status.textContent = titleText;
    status.className = 'status error';
    spinner.classList.add('hidden');
    connectBtn.classList.add('hidden');
    retryBtn.classList.remove('hidden');
    cancelBtn.textContent = 'Close';
    debugInfo.classList.remove('hidden');
    isConnected = false;
}

async function updateBackgroundState(connected, credentials, pinVerified) {
    try {
        await chrome.runtime.sendMessage({
            action: 'updateDeviceState',
            connected: connected,
            credentials: credentials,
            pinVerified: pinVerified
        });
        console.log('Background state updated');
    } catch (error) {
        console.error('Failed to update background state:', error);
    }
}