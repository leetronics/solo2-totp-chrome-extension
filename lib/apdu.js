// lib/apdu.js
// ISO 7816 APDU builder and parser

export const Instructions = {
    PUT: 0x01,
    DELETE: 0x02,
    SET_CODE: 0x03,
    RESET: 0x04,
    LIST: 0xA1,
    CALCULATE: 0xA2,
    VALIDATE: 0xA3,
    CALCULATE_ALL: 0xA4,
    SEND_REMAINING: 0xA5,
    VERIFY_CODE: 0xB1,
    VERIFY_PIN: 0xB2,
    CHANGE_PIN: 0xB3,
    SET_PIN: 0xB4,
    GET_CREDENTIAL: 0xB5,
    UPDATE_CREDENTIAL: 0xB7
};

export const StatusWords = {
    SUCCESS: 0x9000,
    APP_NOT_FOUND: 0x6A82,
    WRONG_PIN_MASK: 0x63C0,
    PIN_REQUIRED: 0x6982,
    PIN_BLOCKED: 0x6983,
    TOUCH_REQUIRED: 0x6985,
    INVALID_DATA: 0x6A80,
    MORE_DATA: 0x6100
};

export class APDU {
    constructor(ins, p1 = 0, p2 = 0, data = null, le = 0) {
        this.cla = 0x00; // ISO 7816 class
        this.ins = ins;
        this.p1 = p1;
        this.p2 = p2;
        this.data = data;
        this.le = le;
    }
    
    toBytes() {
        let length = 4; // CLA + INS + P1 + P2
        
        if (this.data && this.data.length > 0) {
            if (this.data.length <= 255) {
                length += 1 + this.data.length; // Lc + data
            } else {
                length += 3 + this.data.length; // Extended Lc + data
            }
        }
        
        if (this.le > 0) {
            length += 1; // Le
        }
        
        const result = new Uint8Array(length);
        let offset = 0;
        
        result[offset++] = this.cla;
        result[offset++] = this.ins;
        result[offset++] = this.p1;
        result[offset++] = this.p2;
        
        if (this.data && this.data.length > 0) {
            if (this.data.length <= 255) {
                result[offset++] = this.data.length;
            } else {
                result[offset++] = 0x00;
                result[offset++] = (this.data.length >> 8) & 0xFF;
                result[offset++] = this.data.length & 0xFF;
            }
            result.set(this.data, offset);
            offset += this.data.length;
        }
        
        if (this.le > 0) {
            result[offset] = this.le;
        }
        
        return result;
    }
    
    static parseResponse(data) {
        if (data.length < 2) {
            throw new Error('Response too short');
        }
        
        const sw1 = data[0];
        const sw2 = data[1];
        const sw = (sw1 << 8) | sw2;
        const payload = data.slice(2);
        
        return {
            sw,
            sw1,
            sw2,
            payload,
            success: sw === StatusWords.SUCCESS
        };
    }
    
    static isWrongPin(sw) {
        return (sw & 0xFFF0) === StatusWords.WRONG_PIN_MASK;
    }
    
    static getPinAttempts(sw) {
        if (this.isWrongPin(sw)) {
            return sw & 0x000F;
        }
        return null;
    }
}

export default APDU;