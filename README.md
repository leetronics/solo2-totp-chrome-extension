# SoloKeys Vault Browser Extension

A browser extension for Chrome/Chromium and Firefox that turns your SoloKeys 2 device into a password manager with built-in TOTP support for 2FA authentication.

## Features

- **🔐 Device-based TOTP**: All secrets stored securely on your SoloKeys 2 hardware key
- **🌐 Site Detection**: Automatically detects matching credentials for current website
- **📱 QR Code Scanning**: Easily add credentials by scanning QR codes
- **👆 Touch Support**: Handles touch-required credentials with on-screen guidance
- **🔒 PIN Protection**: Supports PIN-protected credentials
- **📝 Manual Entry**: Add credentials manually with Base32 secrets
- **⚡ Quick Access**: Generate OTP codes directly from the extension popup
- **📋 Auto-copy**: Optionally auto-copy generated codes to clipboard

## Installation

### Chrome / Chromium

1. Visit the Chrome Web Store (link TBD after publishing)
2. Click "Add to Chrome"
3. Follow the installation prompts

### Firefox Desktop

1. Build the Firefox package with `node build.js --firefox` or `make firefox`
2. For local testing, open `about:debugging#/runtime/this-firefox`
3. Click "Load Temporary Add-on" and select `dist-firefox/manifest.json`
4. For release use, sign the generated `.xpi` with `WEB_EXT_API_KEY=... WEB_EXT_API_SECRET=... npm run sign:firefox`

### From Source (Developer Mode)

**Option A - Quick Install:**
```bash
# Clone and build
git clone <repository-url>
cd chrome-solokeys-totp
make build
./install.sh
```

**Option B - Manual Steps:**
1. Clone or download this repository
2. Build the extension:
   ```bash
   # With Make (if available)
   make build
   
   # Or with Node.js
   node build.js
   ```
3. Load the Chrome build from `dist/` via `chrome://extensions/`, or load the Firefox build from `dist-firefox/` via `about:debugging#/runtime/this-firefox`
4. The extension icon should appear in your browser toolbar

**Option C - Using CRX File:**
```bash
# Build CRX package
make crx

# Then drag solokeys-vault-*.crx onto chrome://extensions/ page
# (Developer mode must be enabled)
```

### Requirements

- Chrome/Chromium or Firefox Desktop
- SoloKeys 2 device with firmware supporting the Vault app
- USB connection to your SoloKeys device

## Usage

### First Time Setup

1. Click the SoloKeys Vault icon in your browser toolbar
2. Click "Connect SoloKeys" to authorize the extension to access your device
3. Select your SoloKeys device from the browser dialog

### Adding Credentials

**Via QR Code (Recommended):**
1. Go to the options page (right-click icon → Options)
2. Click the "Add Credential" tab
3. Click "Scan QR" and point your camera at the 2FA QR code
4. Adjust settings (touch required, PIN protected) if needed
5. Click "Add Credential"

**Via Manual Entry:**
1. Open the options page
2. Enter the credential name (use format: `Service:username@domain`)
3. Paste the secret key from your service's 2FA setup
4. Configure algorithm, digits, and protection options
5. Click "Add Credential"

### Generating OTP Codes

**From Popup:**
1. Click the SoloKeys Vault icon
2. Click on any credential from the list
3. The OTP code will be displayed with a countdown timer
4. Click "Copy to Clipboard" or the code will auto-copy (if enabled)

**From Website:**
1. When visiting a site with matching credentials, an indicator appears on OTP input fields
2. Click the SoloKeys indicator to select a credential
3. The code is automatically filled into the input field

### PIN Management

To set or change your SoloKeys PIN:
1. Open the options page
2. Navigate to the "PIN Management" tab
3. Follow the instructions to set or change your PIN

## Security Notes

- **Secrets never leave the device**: All TOTP secrets are stored securely on your SoloKeys 2 hardware
- **PIN verification**: Optional PIN protection for sensitive credentials
- **Touch confirmation**: Optional physical touch requirement for credential use
- **No browser storage**: Credentials are never stored in browser storage, always fetched fresh from device

## Troubleshooting

### "No device connected"
- Make sure your SoloKeys is plugged in
- Click "Connect SoloKeys" and select your device from the browser dialog
- Try reconnecting the device

### "PIN verification required"
- Some credentials are PIN-protected
- Enter your PIN in the popup or options page

### "Touch required"
- Some credentials require physical button press
- Press the button on your SoloKeys device when prompted

### QR code scanning not working
- Ensure you've granted camera permission to the extension
- Try in a well-lit environment
- Make sure the QR code is clearly visible

## Technical Details

This extension communicates with SoloKeys 2 devices using:
- **WebHID API**: For USB HID communication
- **CTAPHID Protocol**: For device communication
- **ISO 7816 APDU**: Command structure
- **OATH Protocol**: TOTP/HOTP implementation (vendor command 0x70)

### Supported Commands

- `LIST` (0xA1): List all credentials
- `CALCULATE` (0xA2): Generate OTP code
- `PUT` (0x01): Add new credential
- `DELETE` (0x02): Remove credential
- `VERIFY_PIN` (0xB2): Verify device PIN
- `SET_PIN` (0xB4): Set initial PIN
- `CHANGE_PIN` (0xB3): Change existing PIN

## Development

### Project Structure

```
chrome-solokeys-totp/
├── manifest.json           # Extension manifest
├── background/             # Service worker
│   └── service-worker.js   # Device management & OATH protocol
├── popup/                  # Extension popup UI
│   ├── popup.html
│   └── popup.js
├── options/                # Options page
│   ├── options.html
│   └── options.js
├── content/                # Content script
│   └── content.js          # Site detection & field enhancement
├── lib/                    # Shared libraries
│   ├── ctaphid.js          # CTAPHID/WebHID communication
│   ├── apdu.js             # ISO 7816 APDU
│   ├── tlv.js              # TLV encoding
│   ├── oath.js             # OATH protocol
│   └── utils.js            # Utility functions
└── icons/                  # Extension icons
```

### Building & Packaging

#### Prerequisites

- Node.js 14+ (for build scripts)
- Chrome/Chromium or Firefox Desktop for testing

#### Quick Build

```bash
# Install dependencies (optional, for enhanced ZIP creation)
npm install

# Build both browser packages
make build
# or
node build.js

# Create the Chrome package only
make zip
# or
node build.js --chrome

# Create the Firefox package only
make firefox
# or
node build.js --firefox

# Sign the Firefox release package
WEB_EXT_API_KEY=... WEB_EXT_API_SECRET=... npm run sign:firefox

# Create CRX for manual installation
make crx
# or
node build.js --chrome --crx
```

#### Build Options

- `node build.js` - Build Chrome and Firefox packages
- `node build.js --chrome` - Build Chrome outputs only
- `node build.js --firefox` - Build Firefox outputs only
- `node build.js --crx` - Build both browsers and add a Chrome CRX
- `node build.js --validate` - Validate extension without building
- `node build.js --clean` - Clean build artifacts
- `make package` - Build both browsers and a Chrome CRX

#### Installation Methods

**Method 1: Chrome Web Store (Recommended for distribution)**
1. Build the extension: `make build`
2. Upload `solokeys-vault-chrome-v<version>.zip` to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/)
3. Follow the publishing process
4. Share the extension ID with users

**Method 2: Firefox Package**
1. Build the extension: `make firefox`
2. Load `dist-firefox/manifest.json` via `about:debugging#/runtime/this-firefox` for local testing
3. Sign `solokeys-vault-firefox-v<version>.xpi` via `npm run sign:firefox` for release distribution

### Firefox Signing

Firefox release builds for normal Firefox channels must be signed. The repo includes a signing helper based on Mozilla's `web-ext sign`.

```bash
npm install
npm run build:firefox
WEB_EXT_API_KEY=... WEB_EXT_API_SECRET=... npm run sign:firefox
```

This writes a normalized signed artifact as `solokeys-vault-firefox-v<version>-signed.xpi`.

**Method 3: Developer Mode (For testing)**
1. Build: `make build`
2. Chrome/Chromium: open `chrome://extensions/`, enable "Developer mode", then load `dist/`
3. Firefox: open `about:debugging#/runtime/this-firefox`, then load `dist-firefox/manifest.json`

**Method 4: Automated Installation Helper**
```bash
# Run the install script
./install.sh

# Or limit output to one browser
./install.sh --chrome
./install.sh --firefox
```

**Method 5: Manual CRX Installation**
1. Build: `make crx`
2. Open Chrome → `chrome://extensions/`
3. Enable "Developer mode"
4. Drag and drop the `.crx` file onto the page

### Development Workflow

```bash
# 1. Validate extension structure
make validate

# 2. Build for testing
make build

# 3. Load dist/ in Chrome or dist-firefox/manifest.json in Firefox

# 4. Make changes and rebuild
make build

# 5. Create distribution package
make package

# 6. Clean build artifacts when done
make clean
```

## License

MIT License - See LICENSE file for details

## Credits

- Based on the SoloKeys OATH protocol used by Vault
- Inspired by the SoloKeys GUI application
- Uses jsQR library for QR code scanning
