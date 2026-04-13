#!/usr/bin/env node
/**
 * Build script for SoloKeys Vault browser extensions.
 *
 * Usage:
 *   node build.js              - Build Chrome + Firefox packages
 *   node build.js --chrome     - Build Chrome outputs only
 *   node build.js --firefox    - Build Firefox outputs only
 *   node build.js --crx        - Also create a Chrome .crx package
 *   node build.js --validate   - Only validate sources/manifests
 *   node build.js --clean      - Clean generated build directories
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let archiver;
try {
    archiver = require('archiver');
} catch (error) {
    archiver = null;
}

const FIREFOX_EXTENSION_ID = 'solokeys-vault@solokeys.dev';
const args = process.argv.slice(2);
const shouldValidateOnly = args.includes('--validate');
const shouldClean = args.includes('--clean');
const shouldCreateCRX = args.includes('--crx');
const buildChrome = !args.includes('--firefox') || args.includes('--chrome');
const buildFirefox = !args.includes('--chrome') || args.includes('--firefox');

const EXTENSION_DIR = __dirname;
const CHROME_DIST_DIR = path.join(EXTENSION_DIR, 'dist');
const FIREFOX_DIST_DIR = path.join(EXTENSION_DIR, 'dist-firefox');
const SHARED_FILES = [
    'README.md',
    'test.html',
];
const SHARED_DIRS = [
    'background',
    'popup',
    'content',
    'options',
    'connection',
    'lib',
    'icons',
];

const colors = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
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

function readJSON(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readBaseManifest() {
    return readJSON(path.join(EXTENSION_DIR, 'manifest.json'));
}

function deepClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function createFirefoxManifest(baseManifest) {
    const manifest = deepClone(baseManifest);
    delete manifest.key;
    manifest.background = {
        scripts: [baseManifest.background.service_worker],
        type: baseManifest.background.type || 'module',
    };
    manifest.browser_specific_settings = {
        gecko: {
            id: FIREFOX_EXTENSION_ID,
        },
    };
    return manifest;
}

function validateManifest(manifest, label) {
    const requiredFields = ['manifest_version', 'name', 'version', 'permissions'];
    let valid = true;

    for (const field of requiredFields) {
        if (manifest[field]) {
            success(`${label} field: ${field}`);
        } else {
            error(`Missing ${label} field: ${field}`);
            valid = false;
        }
    }

    if (manifest.manifest_version !== 3) {
        warn(`${label} manifest version is ${manifest.manifest_version}, expected 3`);
    }

    return valid;
}

function validateExtension() {
    log('\n🔍 Validating extension structure...', 'cyan');

    const requiredFiles = [
        'manifest.json',
        'background/service-worker.js',
        'popup/popup.html',
        'popup/popup.js',
        'content/content.js',
        'options/options.html',
        'options/options.js',
        'lib/native-transport.js',
        'lib/utils.js',
        'icons/new-logo-16.png',
        'icons/new-logo-48.png',
        'icons/new-logo-128.png',
    ];

    let allValid = true;

    for (const relativePath of requiredFiles) {
        const filePath = path.join(EXTENSION_DIR, relativePath);
        if (fs.existsSync(filePath)) {
            success(`Found: ${relativePath}`);
        } else {
            error(`Missing: ${relativePath}`);
            allValid = false;
        }
    }

    log('\n📋 Validating manifests...', 'cyan');
    try {
        const chromeManifest = readBaseManifest();
        const firefoxManifest = createFirefoxManifest(chromeManifest);
        allValid = validateManifest(chromeManifest, 'Chrome') && allValid;
        allValid = validateManifest(firefoxManifest, 'Firefox') && allValid;
        success('Manifest validation complete');
    } catch (err) {
        error(`Failed to validate manifests: ${err.message}`);
        allValid = false;
    }

    if (allValid) {
        success('\n✓ Extension structure is valid');
    } else {
        error('\n✗ Extension structure has errors');
        process.exit(1);
    }
}

function removeIfExists(targetPath) {
    if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
    }
}

function cleanBuildDirs() {
    log('\n🧹 Cleaning build directories...', 'cyan');
    removeIfExists(CHROME_DIST_DIR);
    removeIfExists(FIREFOX_DIST_DIR);
    success('Removed dist/ and dist-firefox/ if present');
}

function copyRecursive(src, dest) {
    if (!fs.existsSync(src)) {
        return;
    }

    const stat = fs.statSync(src);
    if (stat.isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        for (const entry of fs.readdirSync(src)) {
            copyRecursive(path.join(src, entry), path.join(dest, entry));
        }
        return;
    }

    fs.copyFileSync(src, dest);
}

function prepareDistDir(distDir, manifest) {
    removeIfExists(distDir);
    fs.mkdirSync(distDir, { recursive: true });

    for (const file of SHARED_FILES) {
        copyRecursive(path.join(EXTENSION_DIR, file), path.join(distDir, file));
    }

    for (const dir of SHARED_DIRS) {
        copyRecursive(path.join(EXTENSION_DIR, dir), path.join(distDir, dir));
    }

    fs.writeFileSync(
        path.join(distDir, 'manifest.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf8',
    );
}

function getVersion(manifest) {
    return manifest.version;
}

async function createZipArchive(sourceDir, outputPath) {
    if (archiver) {
        const output = fs.createWriteStream(outputPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        await new Promise((resolve, reject) => {
            output.on('close', resolve);
            archive.on('error', reject);
            archive.pipe(output);
            archive.directory(sourceDir, false);
            archive.finalize();
        });
        return;
    }

    const archiveName = path.basename(outputPath);
    const parentDir = path.dirname(sourceDir);
    const sourceName = path.basename(sourceDir);
    execSync(
        `cd "${parentDir}" && zip -r "${archiveName}" "${sourceName}" -x "*.DS_Store" -x "*.git*"`,
        { stdio: 'inherit' },
    );
    fs.renameSync(path.join(parentDir, archiveName), outputPath);
}

async function createChromeZip(chromeManifest) {
    const version = getVersion(chromeManifest);
    const archivePath = path.join(EXTENSION_DIR, `solokeys-vault-chrome-v${version}.zip`);
    log('\n📦 Creating Chrome ZIP package...', 'cyan');
    await createZipArchive(CHROME_DIST_DIR, archivePath);
    success(`Created ${path.basename(archivePath)}`);
    return archivePath;
}

async function createFirefoxXpi(firefoxManifest) {
    const version = getVersion(firefoxManifest);
    const archivePath = path.join(EXTENSION_DIR, `solokeys-vault-firefox-v${version}.xpi`);
    log('\n🦊 Creating Firefox XPI package...', 'cyan');
    await createZipArchive(FIREFOX_DIST_DIR, archivePath);
    success(`Created ${path.basename(archivePath)}`);
    return archivePath;
}

function createCRX(chromeManifest) {
    log('\n🔐 Creating Chrome CRX package...', 'cyan');
    log('Note: Creating .crx requires Chrome and a PEM key file', 'yellow');

    const version = getVersion(chromeManifest);
    const crxPath = path.join(EXTENSION_DIR, `solokeys-vault-chrome-v${version}.crx`);
    let chromePath;

    if (process.platform === 'darwin') {
        chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
    } else if (process.platform === 'win32') {
        chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    } else {
        chromePath = '/usr/bin/google-chrome';
    }

    if (!fs.existsSync(chromePath)) {
        warn(`Chrome not found at ${chromePath}`);
        warn('Cannot create .crx file automatically');
        return null;
    }

    const pemPath = path.join(EXTENSION_DIR, 'key.pem');
    const hasPEM = fs.existsSync(pemPath);

    if (!hasPEM) {
        warn('No key.pem file found');
        warn('A new key will be generated. Keep key.pem safe for future updates.');
    }

    try {
        const command = hasPEM
            ? `"${chromePath}" --pack-extension="${CHROME_DIST_DIR}" --pack-extension-key="${pemPath}"`
            : `"${chromePath}" --pack-extension="${CHROME_DIST_DIR}"`;
        execSync(command, { stdio: 'inherit' });

        const generatedCRX = path.join(EXTENSION_DIR, 'dist.crx');
        if (fs.existsSync(generatedCRX)) {
            fs.renameSync(generatedCRX, crxPath);
            success(`Created ${path.basename(crxPath)}`);
        }

        if (!hasPEM) {
            const generatedPEM = path.join(EXTENSION_DIR, 'dist.pem');
            if (fs.existsSync(generatedPEM)) {
                fs.renameSync(generatedPEM, pemPath);
                success('Generated key.pem - keep this file safe');
            }
        }

        return crxPath;
    } catch (err) {
        error(`Failed to create .crx file: ${err.message}`);
        return null;
    }
}

function generateInstructions({ chromeManifest, chromeZipPath, firefoxXpiPath, crxPath }) {
    log('\n📝 Generating installation instructions...', 'cyan');

    const version = getVersion(chromeManifest);
    const instructions = `# SoloKeys Vault Extensions v${version}

## Chrome / Chromium

### Packaged install

1. Load \`${path.basename(chromeZipPath || 'solokeys-vault-chrome-vX.X.X.zip')}\` into the Chrome Web Store or unpack it locally.
2. For local testing, open \`chrome://extensions/\`.
3. Enable Developer mode.
4. Click "Load unpacked" and select \`dist/\`.

### Manual CRX

${crxPath ? `- \`${path.basename(crxPath)}\` was built for manual Chromium installs.` : '- Use `node build.js --chrome --crx` to create a CRX package.'}

## Firefox Desktop

### Local testing

1. Open \`about:debugging#/runtime/this-firefox\`.
2. Click "Load Temporary Add-on".
3. Select \`dist-firefox/manifest.json\`.

### XPI artifact

- \`${path.basename(firefoxXpiPath || 'solokeys-vault-firefox-vX.X.X.xpi')}\` is generated for Firefox packaging/signing workflows.
- Release Firefox installs require signing in normal Firefox builds.
- Use \`WEB_EXT_API_KEY=... WEB_EXT_API_SECRET=... npm run sign:firefox\` to download a signed self-distribution XPI.

## Native Messaging

- Chrome/Chromium uses the native host manifest with \`allowed_origins\`.
- Firefox uses the native host manifest with \`allowed_extensions\` and the extension ID \`${FIREFOX_EXTENSION_ID}\`.

## Output Directories

- \`dist/\` → Chrome build
- \`dist-firefox/\` → Firefox build
`;

    const instructionsPath = path.join(EXTENSION_DIR, `INSTALL-v${version}.md`);
    fs.writeFileSync(instructionsPath, instructions, 'utf8');
    success(`Created ${path.basename(instructionsPath)}`);
}

async function build() {
    log('\n🔨 Building SoloKeys Vault browser extensions...', 'magenta');
    log('='.repeat(60), 'magenta');

    validateExtension();

    if (shouldValidateOnly) {
        return;
    }

    if (shouldClean) {
        cleanBuildDirs();
        return;
    }

    const chromeManifest = readBaseManifest();
    const firefoxManifest = createFirefoxManifest(chromeManifest);

    cleanBuildDirs();

    if (buildChrome) {
        log('\n📦 Preparing Chrome build directory...', 'cyan');
        prepareDistDir(CHROME_DIST_DIR, chromeManifest);
        success('Prepared dist/');
    }

    if (buildFirefox) {
        log('\n📦 Preparing Firefox build directory...', 'cyan');
        prepareDistDir(FIREFOX_DIST_DIR, firefoxManifest);
        success('Prepared dist-firefox/');
    }

    let chromeZipPath = null;
    let firefoxXpiPath = null;
    let crxPath = null;

    if (buildChrome) {
        chromeZipPath = await createChromeZip(chromeManifest);
    }

    if (buildFirefox) {
        firefoxXpiPath = await createFirefoxXpi(firefoxManifest);
    }

    if (buildChrome && shouldCreateCRX) {
        crxPath = createCRX(chromeManifest);
    }

    generateInstructions({ chromeManifest, chromeZipPath, firefoxXpiPath, crxPath });

    log('\n' + '='.repeat(60), 'magenta');
    success('Build complete');
    log('\nOutput files:', 'cyan');

    if (buildChrome) {
        log(`  📁 dist/ - Chrome unpacked extension`, 'green');
        if (chromeZipPath && fs.existsSync(chromeZipPath)) {
            const size = (fs.statSync(chromeZipPath).size / 1024).toFixed(2);
            log(`  📦 ${path.basename(chromeZipPath)} (${size} KB)`, 'green');
        }
    }

    if (buildFirefox) {
        log(`  📁 dist-firefox/ - Firefox unpacked extension`, 'green');
        if (firefoxXpiPath && fs.existsSync(firefoxXpiPath)) {
            const size = (fs.statSync(firefoxXpiPath).size / 1024).toFixed(2);
            log(`  🦊 ${path.basename(firefoxXpiPath)} (${size} KB)`, 'green');
        }
    }

    if (crxPath && fs.existsSync(crxPath)) {
        const size = (fs.statSync(crxPath).size / 1024).toFixed(2);
        log(`  🔐 ${path.basename(crxPath)} (${size} KB)`, 'green');
    }

    log('\nNext steps:', 'cyan');
    let stepNumber = 1;
    if (buildChrome) {
        log(`  ${stepNumber}. Load dist/ in Chrome or upload the Chrome ZIP to the Chrome Web Store`, 'blue');
        stepNumber += 1;
    }
    if (buildFirefox) {
        log(`  ${stepNumber}. Load dist-firefox/ temporarily in Firefox or sign the XPI for release use`, 'blue');
        stepNumber += 1;
    }
    if (crxPath) {
        log(`  ${stepNumber}. Distribute the CRX only for Chromium manual installs`, 'blue');
        stepNumber += 1;
    }
    log(`  ${stepNumber}. See INSTALL-*.md for install notes`, 'blue');
}

build().catch((err) => {
    error(`Build failed: ${err.message}`);
    console.error(err);
    process.exit(1);
});
