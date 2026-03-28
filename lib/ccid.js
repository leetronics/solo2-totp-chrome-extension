// lib/ccid.js
// WebUSB CCID transport for SoloKeys OATH applet

// Yubico OATH AID — also used by SoloKeys Solo 2
const OATH_AID = new Uint8Array([0xA0, 0x00, 0x00, 0x05, 0x27, 0x21, 0x01, 0x01]);

const PC_TO_RDR_ICC_POWER_ON = 0x62;
const PC_TO_RDR_XFR_BLOCK    = 0x6F;
const RDR_TO_PC_DATA_BLOCK   = 0x80;

export class CCIDTransport {
    constructor() {
        this.usbDevice = null;
        this.interfaceNumber = null;
        this.bulkOutEndpoint = null;
        this.bulkInEndpoint = null;
        this.seq = 0;
        this.connected = false;
    }

    async connect() {
        if (!this.usbDevice) throw new Error('No USB device set');

        try {
            await this.usbDevice.open();
        } catch (e) {
            if (e.message && e.message.includes('Access denied')) {
                throw new Error(
                    'Access denied opening USB device. On Linux, stop pcscd first: ' +
                    'sudo systemctl stop pcscd pcscd.socket'
                );
            }
            throw e;
        }

        if (this.usbDevice.configuration === null) {
            await this.usbDevice.selectConfiguration(1);
        }

        // Log all interfaces for diagnostics
        const config = this.usbDevice.configuration;
        // Chrome blocks: Audio(1), HID(3), MassStorage(8), SmartCard/CCID(11),
        //                Video(14), Healthcare(15), AV(16), Wireless/BT(224)
        const PROTECTED = new Set([1, 3, 8, 11, 14, 15, 16, 224]);

        const ifaceList = config.interfaces.map(i => {
            const alt = i.alternates[0];
            return `  #${i.interfaceNumber}: class=0x${alt.interfaceClass.toString(16).padStart(2,'0')} subclass=0x${alt.interfaceSubclass.toString(16).padStart(2,'0')} proto=0x${alt.interfaceProtocol.toString(16).padStart(2,'0')} ${PROTECTED.has(alt.interfaceClass) ? '[BLOCKED]' : '[usable]'}`;
        });
        console.log('USB interfaces on device:\n' + ifaceList.join('\n'));

        // Prefer CCID (0x0B), fall back to any non-protected interface with bulk endpoints
        let chosen = null;
        for (const iface of config.interfaces) {
            const alt = iface.alternates[0];
            if (PROTECTED.has(alt.interfaceClass)) continue;
            const hasBulk = alt.endpoints.some(e => e.type === 'bulk');
            if (hasBulk) {
                chosen = { number: iface.interfaceNumber, alt };
                break;
            }
        }

        if (!chosen) {
            throw new Error(
                'No usable USB interface found. All interfaces are blocked by Chrome:\n' +
                ifaceList.join('\n') + '\n\n' +
                'Chrome blocks both FIDO HID (WebHID) and CCID Smart Card (WebUSB) interfaces. ' +
                'A native messaging host is required to access this device.'
            );
        }

        console.log(`Using interface #${chosen.number} (class 0x${chosen.alt.interfaceClass.toString(16)})`);

        await this.usbDevice.claimInterface(chosen.number);
        this.interfaceNumber = chosen.number;

        for (const ep of chosen.alt.endpoints) {
            if (ep.type === 'bulk' && ep.direction === 'out') this.bulkOutEndpoint = ep.endpointNumber;
            if (ep.type === 'bulk' && ep.direction === 'in')  this.bulkInEndpoint  = ep.endpointNumber;
        }

        if (this.bulkOutEndpoint === null || this.bulkInEndpoint === null) {
            throw new Error('Could not find CCID bulk IN/OUT endpoints.');
        }

        // Power on the card slot (ignore failures — some firmware auto-presents)
        try {
            await this._iccPowerOn();
        } catch (e) {
            console.warn('IccPowerOn failed, continuing anyway:', e.message);
        }

        // Select the OATH applet
        await this._selectOATH();

        this.connected = true;
    }

    async disconnect() {
        this.connected = false;
        if (this.usbDevice && this.interfaceNumber !== null) {
            try { await this.usbDevice.releaseInterface(this.interfaceNumber); } catch (_) {}
        }
        if (this.usbDevice) {
            try { await this.usbDevice.close(); } catch (_) {}
        }
        this.interfaceNumber = null;
        this.bulkOutEndpoint = null;
        this.bulkInEndpoint = null;
    }

    // --- CCID helpers ---

    async _iccPowerOn() {
        const msg = new Uint8Array(10);
        msg[0] = PC_TO_RDR_ICC_POWER_ON;
        // dwLength = 0 (bytes 1-4 stay 0)
        msg[5] = 0; // bSlot
        msg[6] = this.seq++ & 0xFF; // bSeq
        // bPowerSelect = 0 (automatic voltage)
        const resp = await this._transfer(msg);
        console.log('IccPowerOn ATR:', Array.from(resp).map(b => b.toString(16).padStart(2, '0')).join(' '));
    }

    async _selectOATH() {
        const apdu = new Uint8Array([
            0x00,             // CLA
            0xA4,             // INS: SELECT
            0x04,             // P1: select by name
            0x00,             // P2
            OATH_AID.length,  // Lc
            ...OATH_AID
        ]);
        const resp = await this.sendSecretsAPDU(apdu);
        const sw = (resp[resp.length - 2] << 8) | resp[resp.length - 1];
        console.log('SELECT OATH:', Array.from(resp).map(b => b.toString(16).padStart(2, '0')).join(' '));
        if (sw !== 0x9000) {
            throw new Error(`OATH applet SELECT failed: SW=0x${sw.toString(16)}`);
        }
    }

    async _transfer(msg) {
        await this.usbDevice.transferOut(this.bulkOutEndpoint, msg);
        const result = await this.usbDevice.transferIn(this.bulkInEndpoint, 65536);
        return new Uint8Array(result.data.buffer, result.data.byteOffset, result.data.byteLength);
    }

    // Called by OATHProtocol — same interface as CTAPHIDDevice.sendSecretsAPDU
    async sendSecretsAPDU(apduBytes) {
        const msg = new Uint8Array(10 + apduBytes.length);
        msg[0] = PC_TO_RDR_XFR_BLOCK;
        const len = apduBytes.length;
        msg[1] = len & 0xFF;
        msg[2] = (len >> 8) & 0xFF;
        msg[3] = (len >> 16) & 0xFF;
        msg[4] = (len >> 24) & 0xFF;
        msg[5] = 0;                    // bSlot
        msg[6] = this.seq++ & 0xFF;    // bSeq
        msg[7] = 0;                    // bBWI
        msg[8] = 0;                    // wLevelParameter lo
        msg[9] = 0;                    // wLevelParameter hi
        msg.set(apduBytes, 10);

        const resp = await this._transfer(msg);

        if (resp[0] !== RDR_TO_PC_DATA_BLOCK) {
            throw new Error(`Unexpected CCID response type: 0x${resp[0].toString(16)}`);
        }

        const dataLen = resp[1] | (resp[2] << 8) | (resp[3] << 16) | (resp[4] << 24);
        const bStatus = resp[7];

        if (bStatus & 0x40) {
            throw new Error(`CCID error: bStatus=0x${bStatus.toString(16)}, bError=0x${resp[8].toString(16)}`);
        }

        return resp.slice(10, 10 + dataLen);
    }
}

export default CCIDTransport;
