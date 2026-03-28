// lib/native-transport.js
// Native messaging transport — forwards messages to solokeys-gui via thin bridge.
// Chrome blocks both WebHID (FIDO) and WebUSB (CCID) for security keys,
// so native messaging is the only path.

const HOST_NAME = 'com.solokeys.totp';

export class NativeTransport {
    constructor() {
        this.connected = false;
        this._clientId = null;   // loaded in connect()
    }

    async connect(timeout = 30000) {
        // Load (or generate) clientId
        const stored = await chrome.storage.local.get(['extensionClientId']);
        if (!stored.extensionClientId) {
            const id = crypto.randomUUID();
            await chrome.storage.local.set({ extensionClientId: id });
            this._clientId = id;
        } else {
            this._clientId = stored.extensionClientId;
        }

        // First ping to establish connection - SoloKeys GUI will show confirmation dialog
        const resp = await this._send({ action: 'ping' });
        if (!resp.success) throw new Error(resp.error || 'Native host ping failed');
        
        // Wait for SoloKeys GUI confirmation with retry logic
        // The GUI might need time for user to approve the connection
        const startTime = Date.now();
        let lastError = null;
        
        while (Date.now() - startTime < timeout) {
            try {
                // Try to send a test message to verify device is actually ready
                const testResp = await this._sendWithTimeout({ action: 'ping' }, 2000);
                if (testResp.success) {
                    this.connected = true;
                    return; // Connection fully established
                }
            } catch (error) {
                lastError = error;
                // SoloKeys GUI might still be waiting for user confirmation
                // Wait a bit before retrying
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        throw new Error(lastError?.message || 'Connection timeout - SoloKeys GUI did not respond. Please check if SoloKeys GUI is running and try again.');
    }
    
    async _sendWithTimeout(msg, timeoutMs) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('Request timeout'));
            }, timeoutMs);
            
            this._send(msg)
                .then(response => {
                    clearTimeout(timeoutId);
                    resolve(response);
                })
                .catch(error => {
                    clearTimeout(timeoutId);
                    reject(error);
                });
        });
    }

    async disconnect() {
        this.connected = false;
    }

    // Called by OATHProtocol — same interface as CTAPHIDDevice / CCIDTransport
    async sendSecretsAPDU(apduBytes) {
        const resp = await this._send({
            action: 'sendAPDU',
            data: Array.from(apduBytes)
        });
        if (!resp.success) throw new Error(resp.error || 'Native host error');
        return new Uint8Array(resp.data);
    }

    _send(msg) {
        const payload = { ...msg, clientId: this._clientId,
                          clientName: 'SoloKeys TOTP \u2013 Chrome' };
        return new Promise((resolve, reject) => {
            chrome.runtime.sendNativeMessage(HOST_NAME, payload, (response) => {
                if (chrome.runtime.lastError) {
                    reject(new Error(
                        'Native host not available: ' + chrome.runtime.lastError.message
                    ));
                } else {
                    resolve(response);
                }
            });
        });
    }
}

export default NativeTransport;
