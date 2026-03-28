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

    async connect() {
        // Load (or generate) clientId
        const stored = await chrome.storage.local.get(['extensionClientId']);
        if (!stored.extensionClientId) {
            const id = crypto.randomUUID();
            await chrome.storage.local.set({ extensionClientId: id });
            this._clientId = id;
        } else {
            this._clientId = stored.extensionClientId;
        }

        const resp = await this._send({ action: 'ping' });
        if (!resp.success) throw new Error(resp.error || 'Native host ping failed');
        this.connected = true;
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
