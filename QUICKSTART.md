# Quick Start Guide

Get the SoloKeys Vault extension running in under 5 minutes on Chrome/Chromium or Firefox!

## Prerequisites

- Node.js 14+ (for build scripts)
- Chrome/Chromium or Firefox Desktop
- SoloKeys 2 device

## Installation

### Option 1: Quick Script (Easiest)

```bash
# Run the quickstart script
./quickstart.sh
```

This will:
1. Check dependencies
2. Build the extension
3. Build Chrome and Firefox outputs

Then manually:
1. Chrome/Chromium: open `chrome://extensions/`, enable "Developer mode", then load `dist/`
2. Firefox: open `about:debugging#/runtime/this-firefox`, then load `dist-firefox/manifest.json`

### Option 2: Make Commands

```bash
# Install dependencies and build
make install

# Or step by step:
make deps     # Install npm packages
make build    # Build extension
```

### Option 3: Manual Steps

```bash
# 1. Install dependencies (optional but recommended)
npm install

# 2. Build the extension
node build.js

# 3. Load in Chrome
#    - Open chrome://extensions/
#    - Enable Developer mode
#    - Click "Load unpacked"
#    - Select dist/ folder
#
# 4. Or load in Firefox
#    - Open about:debugging#/runtime/this-firefox
#    - Click "Load Temporary Add-on"
#    - Select dist-firefox/manifest.json
```

## First Use

1. **Connect your SoloKeys:**
   - Plug in your SoloKeys 2 device
   - Click the SoloKeys Vault icon in your browser toolbar
   - Click "Connect SoloKeys"
   - Select your device from the dialog

2. **Add a credential:**
   - Go to a website with 2FA setup (e.g., GitHub)
   - Start the 2FA setup process
   - Right-click SoloKeys icon → Options
   - Click "Add Credential" tab
   - Click "Scan QR" and scan the QR code
   - Or enter details manually
   - Click "Add Credential"

3. **Generate OTP:**
   - Visit the website
   - When you see the OTP input field, click the SoloKeys indicator
   - Select your credential
   - The code is automatically filled!

## Available Commands

```bash
# Build commands
make build      # Build Chrome + Firefox packages
make zip        # Build Chrome package only
make firefox    # Build Firefox package only
make sign-firefox # Sign Firefox package with AMO credentials
make crx        # Create Chrome CRX for manual install
make package    # Build both browsers and a Chrome CRX

# Development
make validate   # Validate extension structure
make clean      # Clean build artifacts
make deps       # Install dependencies
make help       # Show all commands

# Or use Node directly
node build.js             # Build Chrome + Firefox packages
node build.js --chrome    # Build Chrome only
node build.js --firefox   # Build Firefox only
node build.js --crx       # Build browsers + Chrome CRX
node build.js --validate  # Validate only
node scripts/sign-firefox.js # Sign Firefox package
```

## Troubleshooting

**"No device found"**
- Ensure SoloKeys is plugged in
- Try a different USB port
- Check your browser has WebHID permission

**"Build fails"**
- Make sure Node.js is installed: `node --version`
- Try installing dependencies: `npm install`
- Check all files are present: `make validate`

**"Extension doesn't load"**
- Chrome/Chromium: load `dist/`, not the repo root
- Firefox: load `dist-firefox/manifest.json`, not the repo root
- Look for errors in the browser extension console

## Next Steps

- 📖 Read the full [README.md](README.md)
- 🚀 See [PUBLISHING.md](PUBLISHING.md) for distribution
- 🐛 Report issues on GitHub
- 💡 Check out the code in `lib/` to understand the protocol

## File Structure

```
chrome-solokeys-totp/
├── manifest.json              # Extension manifest
├── build.js                   # Build script
├── Makefile                   # Make commands
├── install.sh                 # Installation helper
├── quickstart.sh             # Quick start script
├── README.md                  # Full documentation
├── PUBLISHING.md             # Distribution guide
├── dist/                     # Built extension (created by build)
├── background/               # Service worker
├── popup/                    # Extension popup UI
├── options/                  # Options page
├── content/                  # Content scripts
├── lib/                      # Shared libraries
└── icons/                    # Extension icons
```

## Development Workflow

```bash
# 1. Make changes to source files

# 2. Validate
make validate

# 3. Build
make build

# 4. Test in your target browser
#    - Chrome/Chromium: reload in chrome://extensions/
#    - Firefox: reload from about:debugging#/runtime/this-firefox

# 5. Repeat until satisfied

# 6. Create release
make package
# Creates:
#   - solokeys-vault-chrome-vX.X.X.zip
#   - solokeys-vault-firefox-vX.X.X.xpi
#   - solokeys-vault-chrome-vX.X.X.crx
```

## Need Help?

- 📖 Full documentation: [README.md](README.md)
- 🚀 Publishing guide: [PUBLISHING.md](PUBLISHING.md)
- 🔧 Build reference: Run `make help`
- 🐛 Issues: Check GitHub issues or create a new one

Happy authenticating.
