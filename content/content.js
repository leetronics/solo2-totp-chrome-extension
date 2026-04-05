// content/content.js
// Content script for detecting OTP input fields and site matching

let detectedOTPFields = [];
let detectedPasswordFields = [];
let matchingCredentials = [];
let hasRequestedCredentials = false;
let lastFocusedInput = null;
const SOLOKEYS_ICON_URL = chrome.runtime.getURL('icons/new-logo-16.png');

// Initialize on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

async function initialize() {
    // Report current site to background script
    reportSite();

    const {
        autoDetectOTP = true,
        autoDetectPasswords = true,
    } = await chrome.storage.local.get({
        autoDetectOTP: true,
        autoDetectPasswords: true,
    });

    if (autoDetectOTP) {
        detectOTPFields();
    }

    if (autoDetectPasswords) {
        detectPasswordFields();
    }

    if (autoDetectOTP || autoDetectPasswords) {
        requestMatchingCredentials();
        observeDOM();
    }

    // Track last focused editable element for the Type button.
    // We mark the element with a data attribute so popup's executeScript can
    // find it without depending on the content script's in-memory state.
    document.addEventListener('focusin', (e) => {
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                  t.isContentEditable || t.getAttribute('contenteditable') != null)) {
            if (lastFocusedInput && lastFocusedInput !== t) {
                delete lastFocusedInput.dataset.solokeysFocus;
            }
            lastFocusedInput = t;
            t.dataset.solokeysFocus = '1';
        }
    }, true);

    // Listen for messages from background/popup
    chrome.runtime.onMessage.addListener(handleMessage);
}

function reportSite() {
    const hostname = window.location.hostname;
    if (hostname) {
        chrome.runtime.sendMessage({ 
            action: 'checkSiteMatch', 
            hostname 
        }).catch(() => {});
    }
}

async function requestMatchingCredentials() {
    if (hasRequestedCredentials) return;
    hasRequestedCredentials = true;
    
    try {
        const response = await chrome.runtime.sendMessage({ 
            action: 'getMatchingCredentials' 
        });
        
        if (response.credentials) {
            matchingCredentials = response.credentials;
            // Enhance all detected OTP fields with indicators
            detectedOTPFields.forEach(field => enhanceOTPField(field));
            detectedPasswordFields.forEach(field => enhancePasswordField(field));
        }
    } catch (error) {
        console.log('Could not get matching credentials:', error);
    }
}

function detectOTPFields() {
    // Clear previous detections to avoid duplicates
    detectedOTPFields = [];
    
    // Look for input fields that might be OTP inputs
    const inputs = document.querySelectorAll('input');
    
    inputs.forEach(input => {
        if (isOTPField(input)) {
            detectedOTPFields.push(input);
            enhanceOTPField(input);
        }
    });
    
    console.log('SoloKeys Vault: Detected', detectedOTPFields.length, 'OTP fields');
}

function detectPasswordFields() {
    detectedPasswordFields = [];
    document.querySelectorAll('input[type="password"]').forEach(input => {
        if (isPasswordField(input)) {
            detectedPasswordFields.push(input);
            enhancePasswordField(input);
        }
    });
}

function isPasswordField(input) {
    const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();
    const name = (input.name || '').toLowerCase();
    const id = (input.id || '').toLowerCase();
    return autocomplete.includes('current-password') ||
        autocomplete.includes('password') ||
        name.includes('password') ||
        id.includes('password');
}

function isOTPField(input) {
    const name = (input.name || '').toLowerCase();
    const id = (input.id || '').toLowerCase();
    const placeholder = (input.placeholder || '').toLowerCase();
    const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
    const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();
    const type = input.type || '';

    // Check associated <label> text (e.g. "Einmalpasswort (OTP)")
    const labelEl = input.id
        ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)
        : input.closest('label');
    const labelText = (labelEl?.textContent || '').toLowerCase();

    // High confidence: explicit autocomplete
    if (autocomplete.includes('one-time')) return true;

    const otpSpecificPatterns = [
        'otp', '2fa', 'mfa', 'totp',
        'verification code', 'auth code', 'authenticator code'
    ];

    const hasOtpSpecific = otpSpecificPatterns.some(pattern =>
        name.includes(pattern) ||
        id.includes(pattern) ||
        placeholder.includes(pattern) ||
        ariaLabel.includes(pattern) ||
        labelText.includes(pattern)
    );

    const otpGeneralPatterns = [
        'code', 'token',
        'verification', 'auth', 'authenticator', 'security'
    ];

    const hasOtpGeneral = otpGeneralPatterns.some(pattern =>
        name.includes(pattern) ||
        id.includes(pattern) ||
        placeholder.includes(pattern) ||
        ariaLabel.includes(pattern) ||
        labelText.includes(pattern)
    );

    // Numeric-ish types
    const isTypedNumeric = type === 'number' || type === 'tel' ||
        input.inputMode === 'numeric' ||
        (input.getAttribute('pattern') && /[\d]{6,8}/.test(input.getAttribute('pattern')));

    // type=text is also valid for OTP fields
    const isTextInput = type === 'text' || type === '' || !type;

    const maxLength = input.maxLength;
    const isCorrectLength = maxLength >= 4 && maxLength <= 8;

    // URL/page context signal
    const pageIsOTPRelated = /2fa|mfa|otp|totp|verify|authenticate|authenticator/i.test(
        location.href + document.title
    );

    // High confidence: specific OTP keyword + right input type
    // Accept maxLength === -1 (no constraint set) — keyword evidence alone is sufficient
    if (hasOtpSpecific && (isTypedNumeric || isTextInput) && (isCorrectLength || maxLength === -1)) return true;

    // Medium: on an OTP page + general keyword + short field (or unconstrained length)
    if (pageIsOTPRelated && hasOtpGeneral && (isCorrectLength || maxLength === -1)) return true;

    // Medium: multiple general OTP indicators
    if (hasOtpGeneral && (isTypedNumeric || isTextInput) && isCorrectLength) {
        const count = otpSpecificPatterns.filter(p =>
            name.includes(p) || id.includes(p) || placeholder.includes(p) || ariaLabel.includes(p)
        ).length;
        return count >= 2;
    }

    return false;
}

function enhanceOTPField(input) {
    if (input.dataset.solokeyEnhanced) return;
    input.dataset.solokeyEnhanced = 'true';

    const hasMatches = matchingCredentials.length > 0;

    const btn = document.createElement('button');
    btn.className = 'solokeys-autofill-btn';
    btn.title = hasMatches ? 'Autofill with SoloKeys Vault' : 'No matching SoloKeys Vault credentials';
    btn.innerHTML = `<img src="${SOLOKEYS_ICON_URL}" alt="" style="width:16px;height:16px;display:block;">`;
    btn.style.cssText = `
        position: fixed;
        z-index: 2147483647;
        width: 22px; height: 22px;
        padding: 0;
        border: none;
        border-radius: 0;
        background: transparent;
        color: inherit;
        font-size: 12px;
        cursor: pointer;
        line-height: 22px;
        text-align: center;
        box-shadow: none;
        display: flex; align-items: center; justify-content: center;
        opacity: ${hasMatches ? '1' : '0.45'};
    `;

    function reposition() {
        const r = input.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) { btn.style.display = 'none'; return; }
        btn.style.display = 'flex';
        btn.style.top  = (r.top  + (r.height - 22) / 2) + 'px';
        btn.style.left = (r.right - 26) + 'px';
    }

    btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        showCredentialSelector(input);
    });

    document.body.appendChild(btn);
    reposition();

    const ro = new ResizeObserver(reposition);
    ro.observe(input);
    window.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('resize', reposition, { passive: true });

    // Add padding so text doesn't cover icon
    input.style.paddingRight = (parseInt(getComputedStyle(input).paddingRight) || 0) + 26 + 'px';

    // Store reference for later updates
    input._solokeyBtn = btn;
}

function enhancePasswordField(input) {
    if (input.dataset.solokeyPasswordEnhanced) return;
    input.dataset.solokeyPasswordEnhanced = 'true';

    const hasMatches = matchingCredentials.some(cred => cred.hasPasswordSafe);
    const btn = document.createElement('button');
    btn.className = 'solokeys-password-btn';
    btn.title = hasMatches ? 'Fill password with SoloKeys Vault' : 'No matching SoloKeys Vault password entries';
    btn.innerHTML = `<img src="${SOLOKEYS_ICON_URL}" alt="" style="width:16px;height:16px;display:block;">`;
    btn.style.cssText = `
        position: fixed;
        z-index: 2147483647;
        width: 22px; height: 22px;
        padding: 0;
        border: none;
        border-radius: 0;
        background: transparent;
        color: inherit;
        font-size: 12px;
        cursor: pointer;
        line-height: 22px;
        text-align: center;
        box-shadow: none;
        display: flex; align-items: center; justify-content: center;
        opacity: ${hasMatches ? '1' : '0.45'};
    `;

    function reposition() {
        const r = input.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) { btn.style.display = 'none'; return; }
        btn.style.display = 'flex';
        btn.style.top  = (r.top  + (r.height - 22) / 2) + 'px';
        btn.style.left = (r.right - 52) + 'px';
    }

    btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        showPasswordSelector(input);
    });

    document.body.appendChild(btn);
    reposition();
    const ro = new ResizeObserver(reposition);
    ro.observe(input);
    window.addEventListener('scroll', reposition, { passive: true });
    window.addEventListener('resize', reposition, { passive: true });
    input._solokeyPasswordBtn = btn;
}

function parseCredentialName(name) {
    const idx = name.indexOf(':');
    if (idx === -1) return { domain: name, username: '' };
    return { domain: name.slice(0, idx), username: name.slice(idx + 1) };
}

async function showCredentialSelector(input) {
    const existing = document.querySelector('.solokeys-selector');
    if (existing) existing.remove();

    // Use matching credentials if available, otherwise fetch all
    let creds = matchingCredentials;
    let label = 'Matching credentials';
    if (creds.length === 0) {
        try {
            const resp = await chrome.runtime.sendMessage({ action: 'getCredentials' });
            creds = resp.credentials || [];
            label = 'All credentials';
        } catch (_) {}
    }

    if (creds.length === 0) {
        chrome.runtime.sendMessage({ action: 'openPopup' });
        return;
    }

    const selector = document.createElement('div');
    selector.className = 'solokeys-selector';
    selector.style.cssText = `
        position: fixed;
        background: white;
        color: #111;
        border: 1px solid #ddd;
        border-radius: 6px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.2);
        z-index: 2147483647;
        min-width: 220px;
        max-height: 260px;
        overflow-y: auto;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 13px;
        line-height: 1.4;
        text-align: left;
        color-scheme: light;
    `;

    // Header
    const header = document.createElement('div');
    header.textContent = label;
    header.style.cssText = `
        padding: 6px 12px;
        font-size: 11px;
        color: #666;
        background: #fafafa;
        border-bottom: 1px solid #eee;
        border-radius: 6px 6px 0 0;
        user-select: none;
    `;
    selector.appendChild(header);

    creds.forEach(cred => {
        const { domain, username } = parseCredentialName(cred.name);
        const option = document.createElement('div');
        option.className = 'solokeys-option';
        option.dataset.name = cred.name;
        option.style.cssText = `
            padding: 9px 12px;
            cursor: pointer;
            border-bottom: 1px solid #f0f0f0;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 8px;
            color: #111;
        `;
        const nameEl = document.createElement('span');
        nameEl.style.cssText = 'overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
        nameEl.innerHTML = username
            ? `<span style="color:#333">${escapeHtml(domain)}</span><span style="color:#bbb">:</span><span style="color:#888">${escapeHtml(username)}</span>`
            : `<span style="color:#333">${escapeHtml(domain)}</span>`;
        const typeEl = document.createElement('span');
        typeEl.textContent = cred.type;
        typeEl.style.cssText = 'font-size:11px;color:#666;flex-shrink:0;';
        option.appendChild(nameEl);
        option.appendChild(typeEl);

        option.addEventListener('mouseenter', () => { option.style.background = '#f5f7ff'; });
        option.addEventListener('mouseleave', () => { option.style.background = ''; });
        option.addEventListener('click', async () => {
            selector.remove();
            await generateAndFillOTP(input, cred.rawName || cred.name);
        });
        selector.appendChild(option);
    });

    document.body.appendChild(selector);

    // Position below (or above) the icon button
    const btn = input._solokeyBtn;
    const anchor = btn ? btn.getBoundingClientRect() : input.getBoundingClientRect();
    const selH = selector.offsetHeight;
    const spaceBelow = window.innerHeight - anchor.bottom - 8;
    if (spaceBelow >= selH || spaceBelow >= 120) {
        selector.style.top = (anchor.bottom + 4) + 'px';
    } else {
        selector.style.top = Math.max(8, anchor.top - selH - 4) + 'px';
    }
    // Align right edge with button, clamp to viewport
    const left = Math.min(anchor.right - selector.offsetWidth, window.innerWidth - selector.offsetWidth - 8);
    selector.style.left = Math.max(8, left) + 'px';

    // Close on click outside
    setTimeout(() => {
        document.addEventListener('click', function closeSelector(e) {
            if (!selector.contains(e.target) && e.target !== btn) {
                selector.remove();
                document.removeEventListener('click', closeSelector);
            }
        });
    }, 0);
}

async function showPasswordSelector(input) {
    const existing = document.querySelector('.solokeys-selector');
    if (existing) existing.remove();

    let creds = matchingCredentials.filter(cred => cred.hasPasswordSafe);
    if (creds.length === 0) {
        try {
            const resp = await chrome.runtime.sendMessage({ action: 'getCredentials' });
            creds = (resp.credentials || []).filter(cred => cred.hasPasswordSafe);
        } catch (_) {}
    }

    if (creds.length === 0) {
        chrome.runtime.sendMessage({ action: 'openPopup' });
        return;
    }

    const selector = document.createElement('div');
    selector.className = 'solokeys-selector';
    selector.style.cssText = `
        position: fixed;
        background: white;
        color: #111;
        border: 1px solid #ddd;
        border-radius: 6px;
        box-shadow: 0 4px 16px rgba(0,0,0,0.2);
        z-index: 2147483647;
        min-width: 220px;
        max-height: 260px;
        overflow-y: auto;
        font-family: system-ui, -apple-system, sans-serif;
        font-size: 13px;
        line-height: 1.4;
        text-align: left;
        color-scheme: light;
    `;

    const header = document.createElement('div');
    header.textContent = 'Matching password entries';
    header.style.cssText = `
        padding: 6px 12px;
        font-size: 11px;
        color: #666;
        background: #fafafa;
        border-bottom: 1px solid #eee;
        border-radius: 6px 6px 0 0;
    `;
    selector.appendChild(header);

    creds.forEach(cred => {
        const option = document.createElement('div');
        option.style.cssText = `
            padding: 9px 12px;
            cursor: pointer;
            border-bottom: 1px solid #f0f0f0;
            color: #111;
        `;
        option.textContent = cred.name;
        option.addEventListener('mouseenter', () => { option.style.background = '#eef8f2'; });
        option.addEventListener('mouseleave', () => { option.style.background = ''; });
        option.addEventListener('click', async () => {
            selector.remove();
            await fillPasswordEntry(input, cred.rawName || cred.name);
        });
        selector.appendChild(option);
    });

    document.body.appendChild(selector);
    const anchor = input._solokeyPasswordBtn ? input._solokeyPasswordBtn.getBoundingClientRect() : input.getBoundingClientRect();
    selector.style.top = (anchor.bottom + 4) + 'px';
    selector.style.left = Math.max(8, anchor.right - selector.offsetWidth) + 'px';
}

function findAssociatedUsernameField(passwordInput) {
    const form = passwordInput.form || passwordInput.closest('form') || document;
    const candidates = form.querySelectorAll('input');
    for (const input of candidates) {
        if (input === passwordInput) continue;
        const type = (input.type || '').toLowerCase();
        const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();
        const name = (input.name || '').toLowerCase();
        const id = (input.id || '').toLowerCase();
        if (
            type === 'email' ||
            type === 'text' ||
            autocomplete.includes('username') ||
            autocomplete.includes('email') ||
            name.includes('user') ||
            name.includes('email') ||
            id.includes('user') ||
            id.includes('email')
        ) {
            return input;
        }
    }
    return null;
}

async function fillPasswordEntry(passwordInput, credentialName) {
    const response = await chrome.runtime.sendMessage({
        action: 'getPasswordEntry',
        credentialName,
    });
    if (!response.success) {
        if (response.error === 'PIN_REQUIRED') {
            showNotification('PIN required — open the extension popup', 'warning');
        } else if (response.error === 'TOUCH_REQUIRED') {
            showNotification('Touch required on your SoloKeys device', 'info');
        } else {
            showNotification(response.error || 'Failed to load password entry', 'error');
        }
        return;
    }

    const entry = response.credential || {};
    const usernameInput = findAssociatedUsernameField(passwordInput);
    if (usernameInput && entry.login) {
        fillInputWithOTP(usernameInput, entry.login);
    }
    if (entry.password) {
        fillInputWithOTP(passwordInput, entry.password);
    }
    showNotification('Filled credentials from SoloKeys Vault', 'success');
}

async function generateAndFillOTP(input, credentialName) {
    try {
        // Show loading state
        input.style.opacity = '0.5';
        
        const response = await chrome.runtime.sendMessage({ 
            action: 'generateOTP', 
            credentialName 
        });
        
        if (response.success) {
            fillInputWithOTP(input, response.otp);
        } else if (response.error === 'TOUCH_REQUIRED') {
            showNotification('Please touch your SoloKeys', 'info');
            pollForTouchAndFill(input, credentialName);
        } else if (response.error === 'PIN_REQUIRED') {
            showNotification('PIN required — open the extension popup', 'warning');
            input.style.opacity = '';
        } else {
            showNotification(response.error || response.message || 'Failed to generate OTP', 'error');
            input.style.opacity = '';
        }
    } catch (error) {
        showNotification('Error: ' + error.message, 'error');
        input.style.opacity = '';
    }
}

function fillInputWithOTP(input, otp) {
    // Use native setter for React/Vue compatibility
    const nativeSetter = Object.getOwnPropertyDescriptor(
        input.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype,
        'value'
    )?.set;
    
    if (nativeSetter) {
        nativeSetter.call(input, otp);
    } else {
        input.value = otp;
    }
    
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    
    // Flash success
    input.style.background = '#e8f5e9';
    input.style.opacity = '';
    setTimeout(() => {
        input.style.background = '';
    }, 500);
}

async function pollForTouchAndFill(input, credentialName) {
    let attempts = 0;
    const maxAttempts = 30;
    
    const poll = async () => {
        attempts++;
        
        try {
            const response = await chrome.runtime.sendMessage({ 
                action: 'retryAfterTouch', 
                credentialName 
            });
            
            if (response.success) {
                fillInputWithOTP(input, response.otp);
                return;
            }
            
            if (attempts < maxAttempts) {
                setTimeout(poll, 1000);
            } else {
                showNotification('Touch timeout', 'error');
                input.style.opacity = '';
            }
        } catch (error) {
            showNotification('Touch verification failed', 'error');
            input.style.opacity = '';
        }
    };
    
    setTimeout(poll, 1000);
}

function showNotification(message, type = 'info') {
    // Create or update notification element
    let notif = document.querySelector('.solokeys-notification');
    if (!notif) {
        notif = document.createElement('div');
        notif.className = 'solokeys-notification';
        notif.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 12px 20px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 500;
            z-index: 10000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            transition: opacity 0.3s;
        `;
        document.body.appendChild(notif);
    }
    
    const colors = {
        info: { bg: '#667eea', text: 'white' },
        success: { bg: '#4caf50', text: 'white' },
        warning: { bg: '#ff9800', text: 'white' },
        error: { bg: '#f44336', text: 'white' }
    };
    
    const color = colors[type] || colors.info;
    notif.style.background = color.bg;
    notif.style.color = color.text;
    notif.textContent = '🔐 SoloKeys Vault: ' + message;
    notif.style.opacity = '1';
    
    clearTimeout(notif.hideTimeout);
    notif.hideTimeout = setTimeout(() => {
        notif.style.opacity = '0';
    }, 5000);
}

function observeDOM() {
    const observer = new MutationObserver((mutations) => {
        let shouldDetect = false;
        
        mutations.forEach(mutation => {
            if (mutation.type === 'childList') {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType === Node.ELEMENT_NODE) {
                        if (node.tagName === 'INPUT' || node.querySelector('input')) {
                            shouldDetect = true;
                        }
                    }
                });
            }
        });
        
        if (shouldDetect) {
            detectOTPFields();
            detectPasswordFields();
        }
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

async function decodeQRFromImage(img) {
    // Draw to canvas — works for data: URLs and same-origin images
    const w = img.naturalWidth || img.clientWidth || 0;
    const h = img.naturalHeight || img.clientHeight || 0;
    if (w < 30 || h < 30) return null;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    try {
        ctx.drawImage(img, 0, 0, w, h);
    } catch (_) {
        return null; // CORS-tainted
    }

    const imageData = ctx.getImageData(0, 0, w, h);

    // jsQR is injected as a content script (lib/jsqr.js)
    if (typeof jsQR !== 'undefined') {
        const code = jsQR(imageData.data, w, h, { inversionAttempts: 'attemptBoth' });
        if (code) return code.data;
    }

    // Fallback: BarcodeDetector (works on Android and some desktop configs)
    if (typeof BarcodeDetector !== 'undefined') {
        try {
            const supported = await BarcodeDetector.getSupportedFormats().catch(() => []);
            if (supported.includes('qr_code')) {
                const detector = new BarcodeDetector({ formats: ['qr_code'] });
                const barcodes = await detector.detect(canvas);
                if (barcodes.length > 0) return barcodes[0].rawValue;
            }
        } catch (_) { /* skip */ }
    }

    return null;
}

async function scanImagesForQR() {
    const images = document.querySelectorAll('img');
    const results = [];

    for (const img of images) {
        const style = window.getComputedStyle(img);
        if (style.display === 'none' || style.visibility === 'hidden' ||
            parseFloat(style.opacity) === 0) continue;

        const url = await decodeQRFromImage(img);
        if (url && url.startsWith('otpauth://')) {
            console.log('SoloKeys Vault: Found OTP QR code -', url.substring(0, 60));
            results.push({ url, imgSrc: img.src });
        }
    }

    console.log('SoloKeys Vault: Scan complete, found', results.length, 'QR codes');
    return results;
}

function handleMessage(request, sender, sendResponse) {
    switch (request.action) {
        case 'matchingCredentials':
            matchingCredentials = request.credentials || [];
            detectedOTPFields.forEach(field => {
                const btn = field._solokeyBtn;
                if (btn) {
                    btn.style.opacity = matchingCredentials.length > 0 ? '1' : '0.45';
                }
                if (!field.dataset.solokeyEnhanced) enhanceOTPField(field);
            });
            detectedPasswordFields.forEach(field => {
                const btn = field._solokeyPasswordBtn;
                if (btn) {
                    btn.style.opacity = matchingCredentials.some(cred => cred.hasPasswordSafe) ? '1' : '0.45';
                }
                if (!field.dataset.solokeyPasswordEnhanced) enhancePasswordField(field);
            });
            sendResponse({ received: true });
            break;

        case 'fillOTP': {
            const otp = request.otp;
            // The popup always steals focus when opened, so document.activeElement
            // is body by the time this message arrives. Use lastFocusedInput instead.
            const target = lastFocusedInput;
            if (target) {
                target.focus();
                // Simulate typing via execCommand — dispatches real beforeinput/input
                // events, works with React/Vue/Angular, unlike setting .value directly.
                if (!document.execCommand('insertText', false, otp)) {
                    // execCommand not supported (rare) — fall back to value setter
                    fillInputWithOTP(target, otp);
                }
                sendResponse({ success: true });
            } else {
                sendResponse({ success: false });
            }
            break;
        }
        
        case 'scanPageForQR':
            scanImagesForQR().then(results => {
                sendResponse({ results });
            });
            return true; // Keep channel open for async

        case 'settingsUpdated': {
            const autoDetectOTP = request.settings?.autoDetectOTP ?? true;
            const autoDetectPasswords = request.settings?.autoDetectPasswords ?? true;

            if (!autoDetectOTP) {
                detectedOTPFields.forEach(field => {
                    if (field._solokeyBtn) { field._solokeyBtn.remove(); field._solokeyBtn = null; }
                    delete field.dataset.solokeyEnhanced;
                });
                detectedOTPFields = [];
            } else if (detectedOTPFields.length === 0) {
                detectOTPFields();
            }

            if (!autoDetectPasswords) {
                detectedPasswordFields.forEach(field => {
                    if (field._solokeyPasswordBtn) { field._solokeyPasswordBtn.remove(); field._solokeyPasswordBtn = null; }
                    delete field.dataset.solokeyPasswordEnhanced;
                });
                detectedPasswordFields = [];
            } else if (detectedPasswordFields.length === 0) {
                detectPasswordFields();
            }

            if (!autoDetectOTP && !autoDetectPasswords) {
                matchingCredentials = [];
            } else {
                requestMatchingCredentials();
                observeDOM();
            }
            sendResponse({ received: true });
            break;
        }

        default:
            sendResponse({});
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
