// lib/utils.js
// Utility functions for SoloKeys TOTP extension

export function bufToHex(buffer) {
    return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

export function hexToBuf(hex) {
    const bytes = [];
    for (let i = 0; i < hex.length; i += 2) {
        bytes.push(parseInt(hex.substr(i, 2), 16));
    }
    return new Uint8Array(bytes);
}

export function base32Decode(str) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const cleaned = str.toUpperCase().replace(/[^A-Z2-7]/g, '');
    const bits = cleaned.split('').map(c => alphabet.indexOf(c).toString(2).padStart(5, '0')).join('');
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
        bytes.push(parseInt(bits.substr(i, 8), 2));
    }
    return new Uint8Array(bytes);
}

export function getTimeChallenge(period = 30) {
    const now = Math.floor(Date.now() / 1000);
    const counter = Math.floor(now / period);
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    view.setBigUint64(0, BigInt(counter), false); // Big-endian
    return new Uint8Array(buffer);
}

export function truncateOTP(digest, digits = 6) {
    const offset = digest[digest.length - 1] & 0x0f;
    const binary = ((digest[offset] & 0x7f) << 24) |
                   ((digest[offset + 1] & 0xff) << 16) |
                   ((digest[offset + 2] & 0xff) << 8) |
                   (digest[offset + 3] & 0xff);
    const otp = binary % Math.pow(10, digits);
    return otp.toString().padStart(digits, '0');
}

export function matchesSite(credentialName, hostname) {
    // Match credential name against hostname
    // Supports: exact match, subdomain match, or credential name contains hostname
    const name = credentialName.toLowerCase();
    const host = hostname.toLowerCase();
    
    // Remove common TOTP labels like ":user@domain.com"
    const cleanName = name.split(':')[0];
    
    return cleanName === host || 
           host.endsWith('.' + cleanName) ||
           cleanName.includes(host) ||
           host.includes(cleanName);
}