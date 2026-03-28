// lib/oath.js
// OATH protocol implementation for SoloKeys

import { APDU, Instructions, StatusWords } from './apdu.js';
import { TLV, Tags } from './tlv.js';
import { getTimeChallenge } from './utils.js';

// OATH algorithm constants
const Algorithms = {
    SHA1: 0x01,
    SHA256: 0x02,
    SHA512: 0x03
};

const OathTypes = {
    HOTP: 0x10,
    TOTP: 0x20,
    HMAC: 0x30
};

const Properties = {
    TOUCH_REQUIRED: 0x01,
    PIN_ENCRYPTED: 0x02,
    PWS_DATA: 0x04
};

export class OATHCredential {
    constructor(name, type, algorithm, digits = 6, properties = 0) {
        this.name = name;
        this.type = type || 'TOTP';
        this.algorithm = algorithm || 'SHA1';
        this.digits = digits;
        this.touchRequired = !!(properties & Properties.TOUCH_REQUIRED);
        this.pinEncrypted = !!(properties & Properties.PIN_ENCRYPTED);
        this.properties = properties;
    }
    
    static fromListEntry(data) {
        // Parse credential list entry: kind_algo (1 byte) + name + properties (1 byte)
        const kindAlgo = data[0];
        const type = (kindAlgo & 0xF0) === OathTypes.TOTP ? 'TOTP' : 'HOTP';
        
        let algo;
        switch (kindAlgo & 0x0F) {
            case Algorithms.SHA1: algo = 'SHA1'; break;
            case Algorithms.SHA256: algo = 'SHA256'; break;
            case Algorithms.SHA512: algo = 'SHA512'; break;
            default: algo = 'SHA1';
        }
        
        // Name is all bytes except first and last (properties)
        const nameBytes = data.slice(1, -1);
        const name = new TextDecoder().decode(nameBytes);
        
        const properties = data[data.length - 1];
        
        return new OATHCredential(name, type, algo, 6, properties);
    }
}

export class OATHProtocol {
    constructor(ctaphidDevice) {
        this.device = ctaphidDevice;
        this.pinVerified = false;
    }
    
    async sendAPDU(apdu) {
        const apduBytes = apdu.toBytes();
        console.log('Sending APDU:', Array.from(apduBytes).map(b => b.toString(16).padStart(2, '0')).join(' '));
        
        const response = await this.device.sendSecretsAPDU(apduBytes);
        console.log('Response:', Array.from(response).map(b => b.toString(16).padStart(2, '0')).join(' '));
        
        return APDU.parseResponse(response);
    }
    
    async listCredentials(version = 1) {
        // Request version 1 format (includes properties byte)
        const apdu = new APDU(Instructions.LIST, 0x00, 0x00, new Uint8Array([version]));
        const response = await this.sendAPDU(apdu);
        
        if (!response.success) {
            throw new Error(`Failed to list credentials: 0x${response.sw.toString(16)}`);
        }
        
        // Parse response - each credential is TLV with tag 0x72 (NameList)
        const credentials = [];
        const items = TLV.decodeAll(response.payload);
        
        for (const item of items) {
            if (item.tag === Tags.NAME_LIST) {
                const cred = OATHCredential.fromListEntry(item.value);
                credentials.push(cred);
            }
        }
        
        return credentials;
    }
    
    async calculateOTP(credentialName, type = 'TOTP', period = 30) {
        const nameBytes = new TextEncoder().encode(credentialName);
        
        let challenge;
        if (type === 'TOTP') {
            challenge = getTimeChallenge(period);
        } else {
            // HOTP: use counter 0 for now (should track counter)
            challenge = new Uint8Array(8);
        }
        
        // Build TLV: Tag::Name (0x71) + Tag::Challenge (0x74)
        const data = TLV.encodeMultiple([
            { tag: Tags.NAME, value: nameBytes },
            { tag: Tags.CHALLENGE, value: challenge }
        ]);
        
        // P2=0x01 to request all digits in response
        const apdu = new APDU(Instructions.CALCULATE, 0x00, 0x01, data);
        
        try {
            const response = await this.sendAPDU(apdu);
            
            if (!response.success) {
                if (response.sw === StatusWords.TOUCH_REQUIRED) {
                    throw { type: 'TOUCH_REQUIRED', message: 'Touch required on device' };
                }
                if (response.sw === StatusWords.PIN_REQUIRED) {
                    throw { type: 'PIN_REQUIRED', message: 'PIN verification required' };
                }
                throw new Error(`Failed to calculate OTP: 0x${response.sw.toString(16)}`);
            }
            
            // Parse response: Tag::Response (0x76) with digits + code
            const responseTLV = TLV.decode(response.payload);
            if (responseTLV.tag !== Tags.RESPONSE) {
                throw new Error('Invalid response format');
            }
            
            // Response format: <digits> <4-byte code>
            const digits = responseTLV.value[0];
            const codeBytes = responseTLV.value.slice(1, 5);
            const codeValue = (codeBytes[0] << 24) | (codeBytes[1] << 16) | 
                             (codeBytes[2] << 8) | codeBytes[3];
            const code = (codeValue % Math.pow(10, digits)).toString().padStart(digits, '0');
            
            return code;
        } catch (error) {
            if (error.type) {
                throw error;
            }
            throw new Error(`Failed to calculate OTP: ${error.message}`);
        }
    }
    
    async verifyPIN(pin) {
        const pinBytes = new TextEncoder().encode(pin);
        const data = TLV.encode(Tags.PASSWORD, pinBytes);
        
        const apdu = new APDU(Instructions.VERIFY_PIN, 0x00, 0x00, data);
        const response = await this.sendAPDU(apdu);
        
        if (response.success) {
            this.pinVerified = true;
            return { success: true };
        }
        
        if (APDU.isWrongPin(response.sw)) {
            const attempts = APDU.getPinAttempts(response.sw);
            return { success: false, attempts, message: `Wrong PIN. ${attempts} attempts remaining.` };
        }
        
        if (response.sw === StatusWords.PIN_BLOCKED) {
            return { success: false, blocked: true, message: 'PIN is blocked.' };
        }
        
        return { success: false, message: `PIN verification failed: 0x${response.sw.toString(16)}` };
    }
    
    async setPIN(pin) {
        const pinBytes = new TextEncoder().encode(pin);
        const data = TLV.encode(Tags.PASSWORD, pinBytes);
        
        const apdu = new APDU(Instructions.SET_PIN, 0x00, 0x00, data);
        const response = await this.sendAPDU(apdu);
        
        if (response.success) {
            return { success: true };
        }
        
        return { success: false, message: `Failed to set PIN: 0x${response.sw.toString(16)}` };
    }
    
    async changePIN(oldPin, newPin) {
        const oldPinBytes = new TextEncoder().encode(oldPin);
        const newPinBytes = new TextEncoder().encode(newPin);
        
        const data = TLV.encodeMultiple([
            { tag: Tags.PASSWORD, value: oldPinBytes },
            { tag: Tags.NEW_PASSWORD, value: newPinBytes }
        ]);
        
        const apdu = new APDU(Instructions.CHANGE_PIN, 0x00, 0x00, data);
        const response = await this.sendAPDU(apdu);
        
        if (response.success) {
            return { success: true };
        }
        
        if (APDU.isWrongPin(response.sw)) {
            const attempts = APDU.getPinAttempts(response.sw);
            return { success: false, attempts, message: `Wrong PIN. ${attempts} attempts remaining.` };
        }
        
        return { success: false, message: `Failed to change PIN: 0x${response.sw.toString(16)}` };
    }
    
    async addCredential(name, secret, type = 'TOTP', algorithm = 'SHA1', digits = 6, options = {}) {
        const nameBytes = new TextEncoder().encode(name);
        
        // Build kind+algo byte
        let kindAlgo;
        if (type === 'TOTP') {
            kindAlgo = OathTypes.TOTP;
        } else {
            kindAlgo = OathTypes.HOTP;
        }
        
        switch (algorithm) {
            case 'SHA1': kindAlgo |= Algorithms.SHA1; break;
            case 'SHA256': kindAlgo |= Algorithms.SHA256; break;
            case 'SHA512': kindAlgo |= Algorithms.SHA512; break;
            default: kindAlgo |= Algorithms.SHA1;
        }
        
        // Build key TLV: kind_algo + digits + secret
        const keyData = new Uint8Array(2 + secret.length);
        keyData[0] = kindAlgo;
        keyData[1] = digits;
        keyData.set(secret, 2);
        
        const items = [
            { tag: Tags.NAME, value: nameBytes },
            { tag: Tags.KEY, value: keyData }
        ];
        
        // Add properties if touch required or PIN encrypted
        if (options.touchRequired || options.pinEncrypted) {
            let props = 0;
            if (options.touchRequired) props |= Properties.TOUCH_REQUIRED;
            if (options.pinEncrypted) props |= Properties.PIN_ENCRYPTED;
            items.push({ tag: Tags.PROPERTY, value: new Uint8Array([props]) });
        }
        
        const data = TLV.encodeMultiple(items);
        const apdu = new APDU(Instructions.PUT, 0x00, 0x00, data);
        
        const response = await this.sendAPDU(apdu);
        
        if (response.success) {
            return { success: true };
        }
        
        if (response.sw === StatusWords.PIN_REQUIRED) {
            throw { type: 'PIN_REQUIRED', message: 'PIN verification required to add protected credential' };
        }
        
        return { success: false, message: `Failed to add credential: 0x${response.sw.toString(16)}` };
    }
    
    async deleteCredential(name) {
        const nameBytes = new TextEncoder().encode(name);
        const data = TLV.encode(Tags.NAME, nameBytes);
        
        const apdu = new APDU(Instructions.DELETE, 0x00, 0x00, data);
        const response = await this.sendAPDU(apdu);
        
        if (response.success) {
            return { success: true };
        }
        
        return { success: false, message: `Failed to delete credential: 0x${response.sw.toString(16)}` };
    }
    
    resetPINState() {
        this.pinVerified = false;
    }
}

export default OATHProtocol;