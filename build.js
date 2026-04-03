#!/usr/bin/env node
/**
 * Build script for SoloKeys TOTP Chrome Extension
 * 
 * Usage:
 *   node build.js              - Build and create ZIP for Chrome Web Store
 *   node build.js --zip        - Same as above
 *   node build.js --crx        - Build and create .crx for manual installation
 *   node build.js --validate   - Only validate extension structure
 *   node build.js --clean      - Clean dist directory
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Check if archiver is available
let archiver;
try {
    archiver = require('archiver');
} catch (e) {
    // archiver not installed, we'll use native Node.js methods
}

const args = process.argv.slice(2);
const shouldCreateCRX = args.includes('--crx');
const shouldCreateZIP = args.includes('--zip') || (!shouldCreateCRX && !args.includes('--validate') && !args.includes('--clean'));
const shouldValidateOnly = args.includes('--validate');
const shouldClean = args.includes('--clean');

const EXTENSION_DIR = __dirname;
const DIST_DIR = path.join(EXTENSION_DIR, 'dist');

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
    console.log(`${colors[color]}${message}${colors.reset}`);
}

function error(message) {
    console.error(`${colors.red}✗ ${message}${colors.reset}`);
}

function success(message) {
    console.log(`${colors.green}✓ ${message}${colors.reset}`);
}

function warn(message) {
    console.log(`${colors.yellow}⚠ ${message}${colors.reset}`);
}

// Validate extension structure
function validateExtension() {
    log('\n🔍 Validating extension structure...', 'cyan');
    
    const requiredFiles = [
        'manifest.json',
        'background/service-worker.js',
        'popup/popup.html',
        'popup/popup.js',
        'content/content.js',
        'lib/ctaphid.js',
        'lib/native-transport.js',
        'lib/utils.js',
        'icons/icon.svg',
        'icons/new-logo-16.png',
        'icons/new-logo-48.png',
        'icons/new-logo-128.png'
    ];
    
    let allValid = true;
    
    for (const file of requiredFiles) {
        const filePath = path.join(EXTENSION_DIR, file);
        if (fs.existsSync(filePath)) {
            success(`Found: ${file}`);
        } else {
            error(`Missing: ${file}`);
            allValid = false;
        }
    }
    
    // Validate manifest
    log('\n📋 Validating manifest.json...', 'cyan');
    try {
        const manifestPath = path.join(EXTENSION_DIR, 'manifest.json');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        
        // Check required fields
        const requiredFields = ['manifest_version', 'name', 'version', 'permissions'];
        for (const field of requiredFields) {
            if (manifest[field]) {
                success(`Manifest field: ${field}`);
            } else {
                error(`Missing manifest field: ${field}`);
                allValid = false;
            }
        }
        
        // Check manifest version
        if (manifest.manifest_version !== 3) {
            warn(`Manifest version is ${manifest.manifest_version}, expected 3`);
        }
        
        // Note: WebHID doesn't require a manifest permission in MV3
        // It's accessed via navigator.hid API with user gesture
        
        success('Manifest validation complete');
    } catch (e) {
        error(`Failed to parse manifest.json: ${e.message}`);
        allValid = false;
    }
    
    if (allValid) {
        success('\n✓ Extension structure is valid');
    } else {
        error('\n✗ Extension structure has errors');
        process.exit(1);
    }
    
    return allValid;
}

// Clean dist directory
function cleanDist() {
    log('\n🧹 Cleaning dist directory...', 'cyan');
    
    if (fs.existsSync(DIST_DIR)) {
        fs.rmSync(DIST_DIR, { recursive: true, force: true });
        success('Removed existing dist directory');
    }
    
    fs.mkdirSync(DIST_DIR, { recursive: true });
    success('Created dist directory');
}

// Copy extension files to dist
function copyExtensionFiles() {
    log('\n📦 Copying extension files...', 'cyan');
    
    const filesToCopy = [
        'manifest.json',
        'README.md',
        'test.html'
    ];
    
    const dirsToCopy = [
        'background',
        'popup',
        'content',
        'options',
        'connection',
        'lib',
        'icons'
    ];
    
    // Copy individual files
    for (const file of filesToCopy) {
        const src = path.join(EXTENSION_DIR, file);
        const dest = path.join(DIST_DIR, file);
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
            success(`Copied: ${file}`);
        }
    }
    
    // Copy directories recursively
    function copyRecursive(src, dest) {
        if (!fs.existsSync(src)) return;
        
        const stat = fs.statSync(src);
        if (stat.isDirectory()) {
            if (!fs.existsSync(dest)) {
                fs.mkdirSync(dest, { recursive: true });
            }
            
            const entries = fs.readdirSync(src);
            for (const entry of entries) {
                copyRecursive(path.join(src, entry), path.join(dest, entry));
            }
        } else {
            fs.copyFileSync(src, dest);
        }
    }
    
    for (const dir of dirsToCopy) {
        const src = path.join(EXTENSION_DIR, dir);
        const dest = path.join(DIST_DIR, dir);
        copyRecursive(src, dest);
        success(`Copied: ${dir}/`);
    }
}

// Create ZIP file for Chrome Web Store
async function createZIP() {
    log('\n📦 Creating ZIP package...', 'cyan');
    
    const manifestPath = path.join(EXTENSION_DIR, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const version = manifest.version;
    const zipName = `solokeys-totp-v${version}.zip`;
    const zipPath = path.join(EXTENSION_DIR, zipName);
    
    if (archiver) {
        // Use archiver library
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });
        
        await new Promise((resolve, reject) => {
            output.on('close', () => {
                const size = (archive.pointer() / 1024).toFixed(2);
                success(`Created ${zipName} (${size} KB)`);
                resolve();
            });
            
            archive.on('error', (err) => {
                reject(err);
            });
            
            archive.pipe(output);
            archive.directory(DIST_DIR, false);
            archive.finalize();
        });
    } else {
        // Fallback: use native Node.js and system zip command
        try {
            const cmd = `cd "${DIST_DIR}" && zip -r "../${zipName}" . -x "*.DS_Store" -x "*.git*"`;
            execSync(cmd, { stdio: 'inherit' });
            success(`Created ${zipName}`);
        } catch (e) {
            // If zip command not available, create a simple tar.gz
            try {
                const tarName = `solokeys-totp-v${version}.tar.gz`;
                const cmd = `cd "${DIST_DIR}" && tar -czf "../${tarName}" .`;
                execSync(cmd, { stdio: 'inherit' });
                success(`Created ${tarName} (ZIP not available, created TAR.GZ instead)`);
            } catch (e2) {
                error('Failed to create archive. Please install zip or tar.');
                throw e2;
            }
        }
    }
    
    return zipPath;
}

// Create .crx file for manual installation
function createCRX() {
    log('\n🔐 Creating .crx package...', 'cyan');
    log('Note: Creating .crx requires Chrome and a PEM key file', 'yellow');
    
    const manifestPath = path.join(EXTENSION_DIR, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const version = manifest.version;
    const crxName = `solokeys-totp-v${version}.crx`;
    const crxPath = path.join(EXTENSION_DIR, crxName);
    
    // Check if Chrome is available
    let chromePath;
    const platform = process.platform;
    
    if (platform === 'darwin') {
        chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    } else if (platform === 'win32') {
        chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    } else {
        chromePath = '/usr/bin/google-chrome';
    }
    
    if (!fs.existsSync(chromePath)) {
        warn(`Chrome not found at ${chromePath}`);
        warn('Cannot create .crx file automatically');
        warn('To create .crx manually:');
        warn('  1. Open Chrome and go to chrome://extensions/');
        warn('  2. Enable "Developer mode"');
        warn('  3. Click "Pack extension"');
        warn('  4. Select the dist/ folder');
        return null;
    }
    
    // Check for PEM key
    const pemPath = path.join(EXTENSION_DIR, 'key.pem');
    const hasPEM = fs.existsSync(pemPath);
    
    if (!hasPEM) {
        warn('No key.pem file found');
        warn('A new key will be generated. Keep key.pem safe for future updates!');
    }
    
    try {
        const cmd = hasPEM 
            ? `"${chromePath}" --pack-extension="${DIST_DIR}" --pack-extension-key="${pemPath}"`
            : `"${chromePath}" --pack-extension="${DIST_DIR}"`;
        
        execSync(cmd, { stdio: 'inherit' });
        
        // Chrome creates dist.crx in the parent directory
        const generatedCRX = path.join(EXTENSION_DIR, 'dist.crx');
        if (fs.existsSync(generatedCRX)) {
            fs.renameSync(generatedCRX, crxPath);
            success(`Created ${crxName}`);
            
            if (!hasPEM) {
                const generatedPEM = path.join(EXTENSION_DIR, 'dist.pem');
                if (fs.existsSync(generatedPEM)) {
                    fs.renameSync(generatedPEM, pemPath);
                    success('Generated key.pem - KEEP THIS FILE SAFE!');
                }
            }
        }
        
        return crxPath;
    } catch (e) {
        error('Failed to create .crx file');
        error(e.message);
        return null;
    }
}

// Generate installation instructions
function generateInstructions(zipPath, crxPath) {
    log('\n📝 Generating installation instructions...', 'cyan');
    
    const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, 'manifest.json'), 'utf8'));
    const version = manifest.version;
    
    const instructions = `# SoloKeys TOTP Extension v${version}

## Installation Methods

### Method 1: Chrome Web Store (Recommended for distribution)

1. Upload \`${path.basename(zipPath)}\` to the Chrome Web Store Developer Dashboard
2. Follow the Chrome Web Store publishing process
3. Users can install directly from the store

### Method 2: Developer Mode (Local Installation)

1. Open Chrome and navigate to \`chrome://extensions/\`
2. Enable "Developer mode" in the top right corner
3. Click "Load unpacked"
4. Select the \`dist/\` folder from this directory

### Method 3: .crx File (Enterprise/Group Policy)

1. Distribute the \`${path.basename(crxPath || 'solokeys-totp-vX.X.X.crx')}\` file to users
2. Users can drag-and-drop the .crx file onto \`chrome://extensions/\`
3. Or use Chrome Enterprise policies for automatic installation

## File Structure

\`\`\`
dist/
├── manifest.json
├── background/
│   └── service-worker.js
├── popup/
│   ├── popup.html
│   └── popup.js
├── options/
│   ├── options.html
│   └── options.js
├── content/
│   └── content.js
├── lib/
│   ├── ctaphid.js
│   ├── native-transport.js
│   └── utils.js
├── icons/
│   ├── icon.svg
│   ├── new-logo-16.png
│   ├── new-logo-48.png
│   └── new-logo-128.png
└── README.md
\`\`\`

## Extension ID

The extension ID is generated from the public key in key.pem.
To view the extension ID after installation:
1. Go to chrome://extensions/
2. Find "SoloKeys TOTP"
3. The ID is shown below the extension name

## Permissions Required

- \`hid\`: For USB HID communication with SoloKeys device
- \`storage\`: For extension settings
- \`activeTab\`: For detecting OTP input fields
- \`scripting\`: For content script injection
- \`notifications\`: For touch reminders

## Version History

### v${version}
- Initial release
- TOTP generation via SoloKeys 2
- QR code scanning for credential setup
- Site detection and auto-fill
- PIN and touch protection support

## Support

For issues or questions, please refer to the README.md file.
`;
    
    const instructionsPath = path.join(EXTENSION_DIR, `INSTALL-v${version}.md`);
    fs.writeFileSync(instructionsPath, instructions);
    success(`Created ${path.basename(instructionsPath)}`);
}

// Main build process
async function build() {
    log('\n🔨 Building SoloKeys TOTP Extension...', 'magenta');
    log('=' .repeat(50), 'magenta');
    
    // Validate first
    validateExtension();
    
    if (shouldValidateOnly) {
        return;
    }
    
    // Clean and prepare
    if (shouldClean) {
        cleanDist();
        return;
    }
    
    cleanDist();
    copyExtensionFiles();
    
    let zipPath = null;
    let crxPath = null;
    
    // Create packages
    if (shouldCreateZIP) {
        try {
            zipPath = await createZIP();
        } catch (e) {
            error('Failed to create ZIP: ' + e.message);
        }
    }
    
    if (shouldCreateCRX) {
        crxPath = createCRX();
    }
    
    // Generate instructions
    generateInstructions(zipPath, crxPath);
    
    // Summary
    log('\n' + '='.repeat(50), 'magenta');
    success('Build complete!');
    log('\nOutput files:', 'cyan');
    
    if (zipPath && fs.existsSync(zipPath)) {
        const size = (fs.statSync(zipPath).size / 1024).toFixed(2);
        log(`  📦 ${path.basename(zipPath)} (${size} KB) - Chrome Web Store`, 'green');
    }
    
    if (crxPath && fs.existsSync(crxPath)) {
        const size = (fs.statSync(crxPath).size / 1024).toFixed(2);
        log(`  🔐 ${path.basename(crxPath)} (${size} KB) - Manual install`, 'green');
    }
    
    log(`  📁 dist/ - Unpacked extension`, 'green');
    
    log('\nNext steps:', 'cyan');
    if (shouldCreateZIP) {
        log('  1. Upload the ZIP to Chrome Web Store, OR', 'blue');
    }
    log('  2. Load the dist/ folder in Chrome developer mode', 'blue');
    if (crxPath) {
        log('  3. Distribute the .crx file for manual installation', 'blue');
    }
    log('\nSee INSTALL-*.md for detailed instructions.', 'blue');
}

// Run build
build().catch(err => {
    error('Build failed: ' + err.message);
    console.error(err);
    process.exit(1);
});
