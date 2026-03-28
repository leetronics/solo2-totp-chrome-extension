# Quick Start Guide

Get the SoloKeys TOTP extension running in under 5 minutes!

## Prerequisites

- Node.js 14+ (for build scripts)
- Chrome 89+ (with WebHID support)
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
3. Open Chrome extensions page

Then manually:
1. Enable "Developer mode"
2. Click "Load unpacked"
3. Select the `dist/` folder

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
```

## First Use

1. **Connect your SoloKeys:**
   - Plug in your SoloKeys 2 device
   - Click the SoloKeys icon in Chrome toolbar
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
make build      # Build extension (creates ZIP)
make zip        # Create ZIP for Chrome Web Store
make crx        # Create CRX for manual install
make package    # Create both ZIP and CRX

# Development
make validate   # Validate extension structure
make clean      # Clean build artifacts
make deps       # Install dependencies
make help       # Show all commands

# Or use Node directly
node build.js --zip       # Build with ZIP
node build.js --crx       # Build CRX
node build.js --validate  # Validate only
```

## Troubleshooting

**"No device found"**
- Ensure SoloKeys is plugged in
- Try a different USB port
- Check Chrome has WebHID permission

**"Build fails"**
- Make sure Node.js is installed: `node --version`
- Try installing dependencies: `npm install`
- Check all files are present: `make validate`

**"Extension doesn't load"**
- Verify you're loading the `dist/` folder, not the root
- Check Chrome is version 89+
- Look for errors in Chrome DevTools

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

# 4. Test in Chrome
#    - Reload extension in chrome://extensions/
#    - Or click the reload icon on the extension card

# 5. Repeat until satisfied

# 6. Create release
make package
# Creates:
#   - solokeys-totp-vX.X.X.zip (for Chrome Web Store)
#   - solokeys-totp-vX.X.X.crx (for manual install)
```

## Need Help?

- 📖 Full documentation: [README.md](README.md)
- 🚀 Publishing guide: [PUBLISHING.md](PUBLISHING.md)
- 🔧 Build reference: Run `make help`
- 🐛 Issues: Check GitHub issues or create a new one

Happy authenticating! 🔐