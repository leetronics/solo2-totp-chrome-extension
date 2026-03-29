// lib/native-transport.js
// Native messaging transport — forwards messages to the native host binary.
// Chrome blocks both WebHID (FIDO) and WebUSB (CCID) for security keys,
// so native messaging is the only path.

const HOST_NAME = 'com.solokeys.totp';

export class NativeTransport {
    constructor() {
        this.connected = false;
        this._clientId = null;   // loaded in connect()
    }

    async connect(timeout = 5000) {
        // Load (or generate) clientId
        const stored = await chrome.storage.local.get(['extensionClientId']);
        if (!stored.extensionClientId) {
            const id = crypto.randomUUID();
            await chrome.storage.local.set({ extensionClientId: id });
            this._clientId = id;
        } else {
            this._clientId = stored.extensionClientId;
        }

        const resp = await this._sendWithTimeout({ action: 'ping' }, timeout);
        if (!resp?.success) {
            throw new Error(resp?.error || 'Native host returned an error');
        }
        this.connected = true;
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

    // High-level semantic methods — same return shapes as the old OATHProtocol API
    async listCredentials() {
        const r = await this._send({ action: 'listCredentials' });
        if (!r.success) throw new Error(r.error);
        return r.credentials;
    }

    async calculateOTP(name, _type, period = 30) {
        const r = await this._send({ action: 'calculateOTP', name });
        if (!r.success) {
            if (r.error === 'TOUCH_REQUIRED') throw { type: 'TOUCH_REQUIRED', message: 'Touch required' };
            if (r.error === 'PIN_REQUIRED')   throw { type: 'PIN_REQUIRED',   message: 'PIN required' };
            throw new Error(r.error);
        }
        return r.otp;
    }

    async verifyPIN(pin)            { return this._send({ action: 'verifyPIN', pin }); }
    async setPIN(pin)               { return this._send({ action: 'setPIN', pin }); }
    async changePIN(oldPin, newPin) { return this._send({ action: 'changePIN', oldPin, newPin }); }

    async addCredential(name, secret, type = 'TOTP', algorithm = 'SHA1', digits = 6, opts = {}) {
        const secretB32 = this._bytesToBase32(secret);
        return this._send({
            action: 'addCredential', name, secret: secretB32, type, algorithm, digits,
            touchRequired: opts.touchRequired || false,
            pinProtected:  opts.pinProtected  || false,
        });
    }

    async deleteCredential(name) { return this._send({ action: 'deleteCredential', name }); }

    _bytesToBase32(bytes) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        let bits = '';
        for (const b of bytes) bits += b.toString(2).padStart(8, '0');
        let result = '';
        for (let i = 0; i + 5 <= bits.length; i += 5) {
            result += alphabet[parseInt(bits.substr(i, 5), 2)];
        }
        const pad = (8 - result.length % 8) % 8;
        return result + '='.repeat(pad);
    }

    _send(msg) {
        const payload = { ...msg, clientId: this._clientId,
                          clientName: 'SoloKeys TOTP – Chrome' };
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
