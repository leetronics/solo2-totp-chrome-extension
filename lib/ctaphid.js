// lib/ctaphid.js
// CTAPHID protocol implementation using WebHID

// CTAPHID constants
const CID_BROADCAST = 0xffffffff;
const PACKET_SIZE = 64;

// Command codes
const Commands = {
    PING: 0x01,
    MSG: 0x03,
    INIT: 0x06,
    CBOR: 0x10,
    CANCEL: 0x11,
    KEEPALIVE: 0x1b,
    ERROR: 0x3f,
    VENDOR_FIRST: 0x40,
    VENDOR_LAST: 0x7f
};

// SoloKeys vendor commands
const VendorCommands = {
    VERSION: 0x61,
    UUID: 0x62,
    LOCKED: 0x63,
    BOOT_TO_BOOTLOADER: 0x51,
    REBOOT: 0x53,
    SECRETS: 0x70  // OATH APDU tunnel
};

export class CTAPHIDDevice {
    constructor() {
        this.device = null;
        this.cid = CID_BROADCAST;
        this.connected = false;
        this._pendingReports = [];
        this._reportResolvers = [];
        this._inputReportHandler = null;
    }
    
    async requestDevice() {
        try {
            console.log('WebHID: Requesting device...');
            
            // First, check if there are any previously authorized devices
            const existingDevices = await navigator.hid.getDevices();
            console.log('WebHID: Existing authorized devices:', existingDevices.length);
            existingDevices.forEach(d => {
                console.log(`  - ${d.productName} (VID: 0x${d.vendorId.toString(16)}, PID: 0x${d.productId.toString(16)})`);
            });
            
            // If we have an existing SoloKeys device, use it
            const existingSoloKeys = existingDevices.find(d => 
                d.vendorId === 0x1209 && 
                (d.productId === 0xBEEE || d.productId === 0xB000)
            );
            
            if (existingSoloKeys) {
                console.log('WebHID: Using existing authorized SoloKeys device');
                this.device = existingSoloKeys;
                return true;
            }
            
            // Try SoloKeys-specific filters first
            console.log('WebHID: Opening device picker with SoloKeys filters...');
            let devices;
            
            try {
                devices = await navigator.hid.requestDevice({
                    filters: [
                        { vendorId: 0x1209, productId: 0xBEEE }, // SoloKeys normal mode
                        { vendorId: 0x1209, productId: 0xB000 }  // SoloKeys bootloader
                    ]
                });
            } catch (filterError) {
                console.log('WebHID: Filtered request failed, trying empty filters...', filterError);
                // Fallback: show all HID devices
                devices = await navigator.hid.requestDevice({
                    filters: []
                });
            }
            
            console.log('WebHID: Device picker returned', devices.length, 'devices');
            
            if (devices.length > 0) {
                this.device = devices[0];
                console.log('WebHID: Selected device:', this.device.productName, 
                    `(VID: 0x${this.device.vendorId.toString(16)}, PID: 0x${this.device.productId.toString(16)})`);
                return true;
            }
            
            console.log('WebHID: No device selected by user');
            return false;
        } catch (error) {
            console.error('WebHID: Failed to request device:', error);
            throw new Error(`Failed to request HID device: ${error.message}. Make sure you're using Chrome 89+ and have a SoloKeys device plugged in.`);
        }
    }
    
    async getConnectedDevice() {
        const devices = await navigator.hid.getDevices();
        const soloDevice = devices.find(d => 
            d.vendorId === 0x1209 && 
            (d.productId === 0xBEEE || d.productId === 0xB000)
        );
        
        if (soloDevice) {
            this.device = soloDevice;
            return soloDevice;
        }
        return null;
    }
    
    async connect() {
        if (!this.device) {
            const device = await this.getConnectedDevice();
            if (!device) {
                throw new Error('No SoloKeys device found. Please click the extension icon to select a device.');
            }
            this.device = device;
        }
        
        if (!this.device.opened) {
            await this.device.open();
        }

        // Set up event-driven input report queue
        this._pendingReports = [];
        this._reportResolvers = [];
        this._inputReportHandler = (event) => {
            const data = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
            if (this._reportResolvers.length > 0) {
                this._reportResolvers.shift()(data);
            } else {
                this._pendingReports.push(data);
            }
        };
        this.device.addEventListener('inputreport', this._inputReportHandler);

        // Allocate channel ID
        await this.initChannel();
        this.connected = true;

        return true;
    }

    async disconnect() {
        if (this._inputReportHandler && this.device) {
            this.device.removeEventListener('inputreport', this._inputReportHandler);
            this._inputReportHandler = null;
        }
        if (this.device && this.device.opened) {
            await this.device.close();
        }
        this.connected = false;
        this.cid = CID_BROADCAST;
    }

    async _nextReport(timeout = 5000) {
        if (this._pendingReports.length > 0) return this._pendingReports.shift();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                const idx = this._reportResolvers.indexOf(resolve);
                if (idx >= 0) this._reportResolvers.splice(idx, 1);
                reject(new Error('Response timeout'));
            }, timeout);
            this._reportResolvers.push((data) => { clearTimeout(timer); resolve(data); });
        });
    }
    
    async initChannel() {
        // Send INIT command to get a channel ID
        const nonce = crypto.getRandomValues(new Uint8Array(8));
        const cmd = Commands.INIT;
        
        await this.sendPacket(CID_BROADCAST, cmd, nonce);
        const response = await this.receiveResponse();
        
        if (response.cmd !== Commands.INIT || response.data.length < 17) {
            throw new Error('Invalid INIT response');
        }
        
        // Extract CID from response (bytes 8-11)
        this.cid = (response.data[8] << 24) | 
                   (response.data[9] << 16) | 
                   (response.data[10] << 8) | 
                   response.data[11];
        
        return this.cid;
    }
    
    async sendPacket(cid, cmd, data) {
        const packets = this.fragmentMessage(cid, cmd, data);
        for (const packet of packets) {
            await this.device.sendReport(0, packet);
        }
    }
    
    fragmentMessage(cid, cmd, data) {
        const packets = [];
        const totalLen = data.length;
        
        // First packet (initialization packet)
        const initPacket = new Uint8Array(PACKET_SIZE);
        initPacket[0] = (cid >> 24) & 0xFF;
        initPacket[1] = (cid >> 16) & 0xFF;
        initPacket[2] = (cid >> 8) & 0xFF;
        initPacket[3] = cid & 0xFF;
        initPacket[4] = cmd | 0x80; // Command byte with high bit set
        initPacket[5] = (totalLen >> 8) & 0xFF;
        initPacket[6] = totalLen & 0xFF;
        
        const firstPacketDataLen = Math.min(data.length, PACKET_SIZE - 7);
        initPacket.set(data.slice(0, firstPacketDataLen), 7);
        packets.push(initPacket);
        
        // Continuation packets
        let seq = 0;
        let offset = firstPacketDataLen;
        while (offset < data.length) {
            const contPacket = new Uint8Array(PACKET_SIZE);
            contPacket[0] = (cid >> 24) & 0xFF;
            contPacket[1] = (cid >> 16) & 0xFF;
            contPacket[2] = (cid >> 8) & 0xFF;
            contPacket[3] = cid & 0xFF;
            contPacket[4] = seq;
            
            const dataLen = Math.min(data.length - offset, PACKET_SIZE - 5);
            contPacket.set(data.slice(offset, offset + dataLen), 5);
            packets.push(contPacket);
            
            seq++;
            offset += dataLen;
        }
        
        return packets;
    }
    
    async receiveResponse(timeout = 5000) {
        const startTime = Date.now();
        const chunks = [];
        let expectedLen = null;
        let receivedCmd = null;
        let seq = 0;

        while (true) {
            const elapsed = Date.now() - startTime;
            if (elapsed >= timeout) throw new Error('Response timeout');

            const data = await this._nextReport(timeout - elapsed);

            const packetCid = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];

            // Check if this is for our channel
            if (packetCid !== this.cid && packetCid !== CID_BROADCAST) {
                continue;
            }

            const byte4 = data[4];

            if (byte4 & 0x80) {
                // Initialization packet
                receivedCmd = byte4 & 0x7F;
                expectedLen = (data[5] << 8) | data[6];
                chunks.push(data.slice(7));
            } else {
                // Continuation packet
                if (byte4 !== seq) {
                    throw new Error('Sequence mismatch');
                }
                chunks.push(data.slice(5));
                seq++;
            }

            // Check if we have all data
            const totalReceived = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            if (expectedLen !== null && totalReceived >= expectedLen) {
                const fullData = new Uint8Array(totalReceived);
                let offset = 0;
                for (const chunk of chunks) {
                    fullData.set(chunk, offset);
                    offset += chunk.length;
                }

                return {
                    cmd: receivedCmd,
                    data: fullData.slice(0, expectedLen)
                };
            }
        }
    }
    
    async sendCommand(cmd, data = new Uint8Array(0)) {
        if (!this.connected) {
            await this.connect();
        }
        
        await this.sendPacket(this.cid, cmd, data);
        return await this.receiveResponse();
    }
    
    async vendorCommand(vendorCmd, data = new Uint8Array(0)) {
        return await this.sendCommand(vendorCmd, data);
    }
    
    async sendSecretsAPDU(apduData) {
        // Send APDU through the Secrets tunnel (command 0x70)
        const response = await this.vendorCommand(VendorCommands.SECRETS, apduData);
        return response.data;
    }
}

export default CTAPHIDDevice;