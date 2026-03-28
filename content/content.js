// content/content.js
// Content script for detecting OTP input fields and site matching

let detectedOTPFields = [];
let matchingCredentials = [];
let hasRequestedCredentials = false;

// Initialize on page load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

function initialize() {
    // Report current site to background script
    reportSite();
    
    // Detect OTP fields
    detectOTPFields();
    
    // Request matching credentials from background
    requestMatchingCredentials();
    
    // Listen for changes (dynamic content)
    observeDOM();
    
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
    
    console.log('SoloKeys TOTP: Detected', detectedOTPFields.length, 'OTP fields');
}

function isOTPField(input) {
    // Check various attributes that indicate an OTP field
    const name = (input.name || '').toLowerCase();
    const id = (input.id || '').toLowerCase();
    const placeholder = (input.placeholder || '').toLowerCase();
    const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
    const autocomplete = (input.getAttribute('autocomplete') || '').toLowerCase();
    const type = input.type || '';
    
    // Explicit OTP markers - highest confidence
    if (autocomplete.includes('one-time')) {
        return true;
    }
    
    // Common OTP field indicators - more specific matching
    const otpSpecificPatterns = [
        'otp', '2fa', 'mfa', 'totp', 
        'verification code', 'auth code', 'authenticator code'
    ];
    
    const hasOtpSpecific = otpSpecificPatterns.some(pattern => 
        name.includes(pattern) || 
        id.includes(pattern) || 
        placeholder.includes(pattern) ||
        ariaLabel.includes(pattern)
    );
    
    // Less reliable patterns - require additional context
    const otpGeneralPatterns = [
        'code', 'token', 
        'verification', 'auth', 'authenticator', 'security'
    ];
    
    const hasOtpGeneral = otpGeneralPatterns.some(pattern => 
        name.includes(pattern) || 
        id.includes(pattern) || 
        placeholder.includes(pattern) ||
        ariaLabel.includes(pattern)
    );
    
    // Additional checks - must look like an OTP input
    const isNumericInput = type === 'number' || input.inputMode === 'numeric' || 
                          (input.getAttribute('pattern') && 
                           input.getAttribute('pattern').matches(/^[\d]{6,8}$/));
    const maxLength = input.maxLength;
    const isCorrectLength = maxLength === 6 || maxLength === 8;
    
    // Input characteristics typical for OTP fields
    const isShortInput = maxLength && maxLength <= 8;
    const hasTypicalSize = (input.clientWidth && input.clientWidth < 150) || 
                          (width && width < 150);
    
    // High confidence: specific OTP label + numeric + correct length
    if (hasOtpSpecific && isNumericInput && isCorrectLength) {
        return true;
    }
    
    // Medium confidence: general OTP label + multiple OTP indicators + correct length
    if (hasOtpGeneral && isNumericInput && isCorrectLength) {
        // Check for multiple OTP indicators to reduce false positives
        const otpIndicatorCount = otpSpecificPatterns.filter(p => 
            name.includes(p) || id.includes(p) || placeholder.includes(p) || ariaLabel.includes(p)
        ).length;
        
        return otpIndicatorCount >= 2;
    }
    
    // Low confidence: only use if very specific context
    // Don't rely on length/numeric alone as it catches too many fields
    
    return false;
}

function enhanceOTPField(input) {
    // Don't add indicator if already added
    if (input.parentElement?.querySelector('.solokeys-indicator')) {
        return;
    }
    
    // Make input position relative if not already
    const inputParent = input.parentElement;
    if (!inputParent) return;
    
    if (getComputedStyle(inputParent).position === 'static') {
        inputParent.style.position = 'relative';
    }
    
    // Always add SoloKeys icon to OTP fields for discovery
    // Show different states based on whether we have matching credentials
    const hasMatches = matchingCredentials.length > 0;
    
    const container = document.createElement('div');
    container.className = 'solokeys-indicator';
    container.style.cssText = `
        position: absolute;
        right: 8px;
        top: 50%;
        transform: translateY(-50%);
        display: flex;
        align-items: center;
        gap: 4px;
        background: ${hasMatches ? '#667eea' : '#888'};
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
        z-index: 1000;
        box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        transition: background 0.2s;
    `;
    
    if (hasMatches) {
        container.innerHTML = `
            <span>🔐</span>
            <span>${matchingCredentials.length} key${matchingCredentials.length > 1 ? 's' : ''}</span>
        `;
        container.title = 'Click to fill with SoloKeys';
    } else {
        container.innerHTML = `<span>🔐</span>`;
        container.title = 'No matching SoloKeys credentials for this site';
    }
    
    container.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (hasMatches) {
            showCredentialSelector(input);
        } else {
            showNotification('No matching credentials for this site', 'info');
            // Open popup to add credentials
            setTimeout(() => {
                chrome.runtime.sendMessage({ action: 'openPopup' });
            }, 500);
        }
    });
    
    // Hover effects
    container.addEventListener('mouseenter', () => {
        container.style.background = hasMatches ? '#5a6fd6' : '#666';
    });
    container.addEventListener('mouseleave', () => {
        container.style.background = hasMatches ? '#667eea' : '#888';
    });
    
    inputParent.appendChild(container);
    
    // Add padding to input so text doesn't overlap with indicator
    input.style.paddingRight = hasMatches ? '70px' : '36px';
}

function showCredentialSelector(input) {
    // Remove existing selector
    const existing = document.querySelector('.solokeys-selector');
    if (existing) existing.remove();
    
    const selector = document.createElement('div');
    selector.className = 'solokeys-selector';
    selector.style.cssText = `
        position: absolute;
        top: 100%;
        left: 0;
        right: 0;
        background: white;
        border: 1px solid #ddd;
        border-radius: 4px;
        margin-top: 4px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 1001;
        max-height: 200px;
        overflow-y: auto;
    `;
    
    selector.innerHTML = matchingCredentials.map(cred => `
        <div class="solokeys-option" data-name="${escapeHtml(cred.name)}" style="
            padding: 10px 12px;
            cursor: pointer;
            border-bottom: 1px solid #eee;
            display: flex;
            justify-content: space-between;
            align-items: center;
        ">
            <span>${escapeHtml(cred.name)}</span>
            <span style="font-size: 11px; color: #888;">${cred.type}</span>
        </div>
    `).join('');
    
    // Add click handlers
    selector.querySelectorAll('.solokeys-option').forEach(option => {
        option.addEventListener('click', async () => {
            const credName = option.dataset.name;
            await generateAndFillOTP(input, credName);
            selector.remove();
        });
        
        option.addEventListener('mouseenter', () => {
            option.style.background = '#f5f5f5';
        });
        option.addEventListener('mouseleave', () => {
            option.style.background = 'transparent';
        });
    });
    
    input.parentElement.appendChild(selector);
    
    // Close on click outside
    setTimeout(() => {
        document.addEventListener('click', function closeSelector(e) {
            if (!selector.contains(e.target)) {
                selector.remove();
                document.removeEventListener('click', closeSelector);
            }
        });
    }, 0);
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
        } else if (response.touchRequired) {
            showNotification('Please touch your SoloKeys', 'info');
            // Poll for touch
            pollForTouchAndFill(input, credentialName);
        } else if (response.pinRequired) {
            showNotification('PIN required. Open the extension popup.', 'warning');
            input.style.opacity = '';
        } else {
            showNotification(response.message || 'Failed to generate OTP', 'error');
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
    notif.textContent = '🔐 SoloKeys: ' + message;
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
        }
    });
    
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
}

async function scanImagesForQR() {
    const images = document.querySelectorAll('img');
    const results = [];

    for (const img of images) {
        try {
            // Skip display:none or hidden images
            const style = window.getComputedStyle(img);
            if (style.display === 'none' || style.visibility === 'hidden' || 
                parseFloat(style.opacity) === 0) {
                continue;
            }

            // Get dimensions - handle various ways images might be sized
            let width = img.naturalWidth || img.width || 
                       parseInt(style.width) || img.clientWidth || 0;
            let height = img.naturalHeight || img.height || 
                        parseInt(style.height) || img.clientHeight || 0;

            // Fallback to getting from attributes
            if (width === 0 || height === 0) {
                width = parseInt(img.getAttribute('width')) || 0;
                height = parseInt(img.getAttribute('height')) || 0;
            }

            // For TOTP-related images, be more lenient with size
            const id = (img.id || '').toLowerCase();
            const className = (img.className || '').toLowerCase();
            const isTotpRelated = id.includes('totp') || id.includes('qr') || 
                                id.includes('mfa') || id.includes('2fa') ||
                                className.includes('totp') || className.includes('qr') || 
                                className.includes('mfa') || className.includes('authenticator');

            // Skip very small images unless they're TOTP-related
            if (!isTotpRelated && width < 50 && height < 50) continue;
            
            // Even for non-TOTP images, don't skip if reasonably sized for QR
            if (width < 30 || height < 30) continue;

            // Ensure image is loaded
            if (!img.complete && img.naturalWidth === 0 && img.naturalHeight === 0) {
                // Wait for image to load with timeout
                await new Promise((resolve, reject) => {
                    const timeoutId = setTimeout(() => {
                        reject(new Error('Image load timeout'));
                    }, 3000);
                    
                    img.onload = () => {
                        clearTimeout(timeoutId);
                        resolve();
                    };
                    img.onerror = () => {
                        clearTimeout(timeoutId);
                        reject(new Error('Image load error'));
                    };
                });
                
                // Update dimensions after loading
                width = img.naturalWidth || img.width || 
                       parseInt(style.width) || img.clientWidth || 0;
                height = img.naturalHeight || img.height || 
                        parseInt(style.height) || img.clientHeight || 0;
            }

            // Skip if still no valid dimensions
            if (width === 0 || height === 0) continue;

            // Create canvas to draw image
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            // Handle potential overflow/canvas size limits
            const maxDimension = 2000;
            if (width > maxDimension || height > maxDimension) {
                const scale = Math.min(maxDimension / width, maxDimension / height);
                width = Math.round(width * scale);
                height = Math.round(height * scale);
            }
            
            canvas.width = width;
            canvas.height = height;

            try {
                // Draw image to canvas
                ctx.drawImage(img, 0, 0, width, height);
                
                // Get image data
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                
                // Check if image has actual data (not completely transparent)
                let hasData = false;
                for (let i = 3; i < imageData.data.length; i += 4) {
                    if (imageData.data[i] > 0) { // Alpha channel > 0
                        hasData = true;
                        break;
                    }
                }
                
                if (!hasData) {
                    console.log('SoloKeys: Skipping transparent image');
                    continue;
                }

                // Try to decode QR with multiple attempts
                let code = null;
                
                // Attempt 1: Normal
                try {
                    code = jsQR(imageData.data, imageData.width, imageData.height);
                } catch (e) {
                    // Try with inversion
                    try {
                        code = jsQR(imageData.data, imageData.width, imageData.height, {
                            inversionAttempts: 'attemptBoth'
                        });
                    } catch (e2) {
                        // Try with gamma correction
                        try {
                            // Create a copy with adjusted contrast
                            const adjusted = new Uint8ClampedArray(imageData.data);
                            for (let i = 0; i < adjusted.length; i += 4) {
                                // Increase contrast
                                adjusted[i] = Math.min(255, ((adjusted[i] - 128) * 1.5 + 128)); // R
                                adjusted[i+1] = Math.min(255, ((adjusted[i+1] - 128) * 1.5 + 128)); // G
                                adjusted[i+2] = Math.min(255, ((adjusted[i+2] - 128) * 1.5 + 128)); // B
                            }
                            code = jsQR(adjusted, imageData.width, imageData.height, {
                                inversionAttempts: 'attemptBoth'
                            });
                        } catch (e3) {
                            // All attempts failed
                        }
                    }
                }

                if (code && code.data.startsWith('otpauth://')) {
                    console.log('SoloKeys: Found OTP QR code in', 
                              isTotpRelated ? 'TOTP-related image' : 'image',
                              '(size:', width, 'x', height, ') -', 
                              code.data.substring(0, 50) + '...');
                    results.push({
                        url: code.data,
                        imgSrc: img.src,
                        width: width,
                        height: height,
                        isTotpRelated
                    });
                } else if (code) {
                    // Found QR but not OTP
                    console.log('SoloKeys: Found non-OTP QR code in image (size:', 
                              width, 'x', height, '):', 
                              code.data.substring(0, 30) + '...');
                }
            } catch (drawError) {
                console.log('SoloKeys: Error drawing image to canvas:', drawError.message);
                continue;
            }
        } catch (error) {
            // Only log errors for TOTP-related images to reduce noise
            const id = (img.id || '').toLowerCase();
            const className = (img.className || '').toLowerCase();
            const isTotpRelated = id.includes('totp') || id.includes('qr') || 
                                id.includes('mfa') || id.includes('2fa') ||
                                className.includes('totp') || className.includes('qr') || 
                                className.includes('mfa') || className.includes('authenticator');
                                
            if (isTotpRelated) {
                console.log('SoloKeys: Error processing TOTP-related image:', error.message);
            }
            continue;
        }
    }

    // Sort results: TOTP-related first, then by size (largest first)
    results.sort((a, b) => {
        if (a.isTotpRelated !== b.isTotpRelated) {
            return b.isTotpRelated ? -1 : 1; // TOTP-related first
        }
        return (b.width * b.height) - (a.width * a.height); // Largest first
    });

    console.log('SoloKeys: Scan complete, found', results.length, 'QR codes');
    if (results.length > 0) {
        console.log('SoloKeys: Best result:', 
                   results[0].isTotpRelated ? 'TOTP-related' : 'regular', 
                   'image', results[0].width, 'x', results[0].height);
    }
    return results;
}

function handleMessage(request, sender, sendResponse) {
    switch (request.action) {
        case 'matchingCredentials':
            matchingCredentials = request.credentials || [];
            // Re-enhance all fields with new credential info
            detectedOTPFields.forEach(field => {
                // Remove old indicator
                const oldIndicator = field.parentElement?.querySelector('.solokeys-indicator');
                if (oldIndicator) oldIndicator.remove();
                // Re-add with updated state
                enhanceOTPField(field);
            });
            sendResponse({ received: true });
            break;

        case 'fillOTP': {
            const otp = request.otp;
            let filled = false;
            const active = document.activeElement;

            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
                fillInputWithOTP(active, otp);
                filled = true;
            } else if (detectedOTPFields.length > 0) {
                const field = detectedOTPFields[0];
                field.focus();
                fillInputWithOTP(field, otp);
                filled = true;
            }

            sendResponse({ success: filled });
            break;
        }
        
        case 'scanPageForQR':
            scanImagesForQR().then(results => {
                sendResponse({ results });
            });
            return true; // Keep channel open for async

        default:
            sendResponse({});
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
