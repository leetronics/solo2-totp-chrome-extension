// lib/tlv.js
// TLV (Tag-Length-Value) encoder and decoder for OATH protocol

export const Tags = {
    NAME: 0x71,
    NAME_LIST: 0x72,
    KEY: 0x73,
    CHALLENGE: 0x74,
    RESPONSE: 0x76,
    PROPERTY: 0x78,
    VERSION: 0x79,
    INITIAL_MOVING_FACTOR: 0x7A,
    PASSWORD: 0x80,
    NEW_PASSWORD: 0x81,
    PIN_COUNTER: 0x82,
    SERIAL: 0x8F,
    ALGORITHM: 0x7B
};

export class TLV {
    static encode(tag, value) {
        const valueBytes = typeof value === 'string' 
            ? new TextEncoder().encode(value) 
            : new Uint8Array(value);
        
        const result = new Uint8Array(2 + valueBytes.length);
        result[0] = tag;
        result[1] = valueBytes.length;
        result.set(valueBytes, 2);
        return result;
    }
    
    static encodeMultiple(items) {
        // items: array of {tag, value}
        let totalLength = 0;
        const encodedItems = items.map(item => {
            const encoded = this.encode(item.tag, item.value);
            totalLength += encoded.length;
            return encoded;
        });
        
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const encoded of encodedItems) {
            result.set(encoded, offset);
            offset += encoded.length;
        }
        return result;
    }
    
    static decode(data, offset = 0) {
        if (offset >= data.length) {
            return null;
        }
        
        const tag = data[offset];
        const length = data[offset + 1];
        const value = data.slice(offset + 2, offset + 2 + length);
        
        return {
            tag,
            length,
            value,
            nextOffset: offset + 2 + length
        };
    }
    
    static decodeAll(data) {
        const items = [];
        let offset = 0;
        
        while (offset < data.length) {
            const item = this.decode(data, offset);
            if (!item) break;
            items.push(item);
            offset = item.nextOffset;
        }
        
        return items;
    }
    
    static findTag(data, tag) {
        const items = this.decodeAll(data);
        return items.find(item => item.tag === tag);
    }
}

export default TLV;