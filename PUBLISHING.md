# Publishing Guide for SoloKeys Vault Extension

This guide covers different methods to package and distribute the Chrome extension.

## Table of Contents

1. [Chrome Web Store (Recommended)](#chrome-web-store)
2. [Manual Distribution](#manual-distribution)
3. [Enterprise Deployment](#enterprise-deployment)
4. [CI/CD Automation](#cicd-automation)

---

## Chrome Web Store

The Chrome Web Store is the recommended distribution method for end users.

### Prerequisites

- Google Developer Account ($5 one-time fee)
- Extension ZIP file (created by build script)

### Steps

1. **Build the extension:**
   ```bash
   make build
   # or
   node build.js --zip
   ```

2. **Navigate to Chrome Web Store Developer Dashboard:**
   - Go to [chrome.google.com/webstore/devconsole](https://chrome.google.com/webstore/devconsole)
   - Sign in with your Google account

3. **Create a new item:**
   - Click "New Item" button
   - Upload the generated `solokeys-vault-vX.X.X.zip` file

4. **Fill in store listing:**
   - **Description**: Detailed description of the extension
   - **Screenshots**: Add screenshots of the popup and options page
   - **Category**: Productivity or Security
   - **Language**: English (or add more)
   - **Website**: Link to project repository
   - **Support URL**: Link to issues page

5. **Set pricing and distribution:**
   - Select "Free" or set a price
   - Choose visibility (Public, Unlisted, or Private)
   - Select regions

6. **Privacy practices:**
   - Data usage disclosure
   - Privacy policy URL (if collecting any data)
   - SoloKeys Vault does NOT collect user data - all secrets stay on the device

7. **Submit for review:**
   - Click "Submit for review"
   - Wait for approval (typically 1-3 business days)

8. **After approval:**
   - Extension will be published automatically
   - Share the extension URL with users
   - Extension ID will be visible in the dashboard

---

## Manual Distribution

For testing or internal distribution, you can use the generated files directly.

### Method 1: Unpacked Extension (Development)

Best for development and testing:

```bash
# Build
make build

# In Chrome:
# 1. Go to chrome://extensions/
# 2. Enable "Developer mode"
# 3. Click "Load unpacked"
# 4. Select the dist/ folder
```

### Method 2: ZIP File

Users can install the ZIP file:

```bash
# Build
make zip

# Users can:
# 1. Download the ZIP file
# 2. Extract it
# 3. Load as unpacked extension
```

### Method 3: CRX File

Best for enterprise or group distribution:

```bash
# Build CRX (requires Chrome installed)
make crx

# Distribute the .crx file
# Users drag-and-drop onto chrome://extensions/ page
```

**Note:** CRX files from outside the Chrome Web Store show a warning. Users must enable "Developer mode" to install.

---

## Enterprise Deployment

For organizations managing Chrome deployments.

### Group Policy (Windows)

1. **Enable extension installation:**
   - Open Group Policy Editor (`gpedit.msc`)
   - Navigate to: Computer Configuration → Administrative Templates → Google → Google Chrome → Extensions
   - Enable "Configure the list of force-installed apps and extensions"

2. **Add extension ID and update URL:**
   ```
   extension_id;https://clients2.google.com/service/update2/crx
   ```
   
   Or for custom CRX:
   ```
   extension_id;file:///path/to/updates.xml
   ```

3. **Deploy via policy:**
   ```powershell
   # Registry path for machine-wide policy
   HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Google\Chrome\ExtensionInstallForcelist
   
   # Add value:
   # Name: 1
   # Data: your_extension_id;https://clients2.google.com/service/update2/crx
   ```

### Chrome Enterprise (Cloud)

1. Go to [Google Admin Console](https://admin.google.com)
2. Navigate to: Devices → Chrome → Apps & extensions
3. Click "Users & browsers" or "Managed guest sessions"
4. Click "Add app" → "Add from Chrome Web Store"
5. Enter the extension ID or search for "SoloKeys Vault"
6. Select "Force install" or "Allow install"
7. Save changes

### Updates for Enterprise

- Chrome Web Store extensions auto-update
- For custom CRX deployment, host an updates.xml file:
  ```xml
  <?xml version='1.0' encoding='UTF-8'?>
  <gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
    <app appid='YOUR_EXTENSION_ID'>
      <updatecheck codebase='https://your-server.com/solokeys-vault-v1.0.1.crx' version='1.0.1' />
    </app>
  </gupdate>
  ```

---

## CI/CD Automation

### GitHub Actions

A workflow file is included in `.github/workflows/build.yml`. It automatically:

1. Validates the extension on every push
2. Builds the extension
3. Creates releases when tags are pushed

**Setup:**

1. Push to GitHub
2. Go to Actions tab to see builds
3. Create a release:
   ```bash
   git tag v1.0.1
   git push origin v1.0.1
   ```
4. GitHub Actions will automatically create a release with the ZIP file

### Manual Release Checklist

Before releasing a new version:

- [ ] Update version in `manifest.json`
- [ ] Update `CHANGELOG.md` (if exists)
- [ ] Run tests: `make validate`
- [ ] Build: `make build`
- [ ] Test the built extension manually
- [ ] Tag the release: `git tag vX.X.X`
- [ ] Push tags: `git push origin vX.X.X`
- [ ] Create GitHub Release (if not using Actions)
- [ ] Update Chrome Web Store (if published there)

---

## Version Management

### Semantic Versioning

Follow [SemVer](https://semver.org/):
- **MAJOR**: Breaking changes (e.g., manifest v2 → v3)
- **MINOR**: New features, backwards compatible
- **PATCH**: Bug fixes

### Version Bump Script

Create a script to bump versions:

```bash
#!/bin/bash
# bump-version.sh

NEW_VERSION=$1

if [ -z "$NEW_VERSION" ]; then
    echo "Usage: ./bump-version.sh 1.0.1"
    exit 1
fi

# Update manifest.json
sed -i '' "s/\"version\": \"[0-9.]*\"/\"version\": \"$NEW_VERSION\"/" manifest.json

# Update package.json if exists
if [ -f "package.json" ]; then
    sed -i '' "s/\"version\": \"[0-9.]*\"/\"version\": \"$NEW_VERSION\"/" package.json
fi

echo "Version bumped to $NEW_VERSION"
echo "Don't forget to commit and tag!"
```

---

## Troubleshooting

### Build Issues

**"archiver not found"**
```bash
npm install
# or use system zip:
node build.js --zip  # falls back to system zip command
```

**"Chrome not found"**
```bash
# For CRX creation, specify Chrome path:
CHROME_BIN=/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome make crx
```

### Chrome Web Store Issues

**"Manifest is invalid"**
- Ensure manifest.json is valid JSON
- Check all required fields are present
- Validate with: `node build.js --validate`

**"Extension takes too long in review"**
- First submissions take longer
- Ensure all required fields are filled
- Provide clear description and screenshots
- SoloKeys Vault uses WebHID which may require additional review

**"CRX_INSTALL_NOT_ALLOWED"**
- Extension not in allowlist
- User has disabled Developer mode
- Organization policy blocks CRX installation

---

## Support

For issues with:
- **Extension functionality**: Open an issue on GitHub
- **Chrome Web Store**: Contact Chrome Web Store support
- **Enterprise deployment**: See [Chrome Enterprise Help](https://support.google.com/chrome/a/answer/6309116)

## Resources

- [Chrome Extension Publishing Guide](https://developer.chrome.com/docs/webstore/publish/)
- [Chrome Enterprise Extension Management](https://support.google.com/chrome/a/answer/6309116)
- [Extension Manifest Format](https://developer.chrome.com/docs/extensions/mv3/manifest/)
