#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const FIREFOX_DIST_DIR = path.join(ROOT_DIR, 'dist-firefox');
const SIGNING_ARTIFACTS_DIR = path.join(ROOT_DIR, 'web-ext-artifacts');

function fail(message) {
    console.error(`ERROR: ${message}`);
    process.exit(1);
}

function readJSON(filePath) {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function findWebExtBinary() {
    const binName = process.platform === 'win32' ? 'web-ext.cmd' : 'web-ext';
    const localBin = path.join(ROOT_DIR, 'node_modules', '.bin', binName);
    if (fs.existsSync(localBin)) {
        return localBin;
    }
    return null;
}

function latestSignedArtifact(dirPath) {
    const candidates = fs.readdirSync(dirPath)
        .filter((entry) => entry.endsWith('.xpi'))
        .map((entry) => {
            const absolutePath = path.join(dirPath, entry);
            return {
                path: absolutePath,
                mtime: fs.statSync(absolutePath).mtimeMs,
            };
        })
        .sort((left, right) => right.mtime - left.mtime);

    return candidates.length ? candidates[0].path : null;
}

function main() {
    const apiKey = process.env.WEB_EXT_API_KEY || process.env.FIREFOX_AMO_API_KEY;
    const apiSecret = process.env.WEB_EXT_API_SECRET || process.env.FIREFOX_AMO_API_SECRET;
    const channel = process.env.FIREFOX_SIGN_CHANNEL || 'unlisted';

    if (!fs.existsSync(FIREFOX_DIST_DIR)) {
        fail('dist-firefox/ is missing. Run `npm run build:firefox` or `node build.js --firefox` first.');
    }

    if (!apiKey || !apiSecret) {
        fail(
            'Missing Firefox signing credentials. Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET ' +
            '(or FIREFOX_AMO_API_KEY and FIREFOX_AMO_API_SECRET).',
        );
    }

    const manifestPath = path.join(FIREFOX_DIST_DIR, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
        fail('dist-firefox/manifest.json is missing.');
    }

    const manifest = readJSON(manifestPath);
    const version = manifest.version;
    const firefoxId = manifest.browser_specific_settings?.gecko?.id;
    if (!firefoxId) {
        fail('Firefox manifest is missing browser_specific_settings.gecko.id.');
    }

    const webExtBin = findWebExtBinary();
    if (!webExtBin) {
        fail('web-ext is not installed. Run `npm install` first.');
    }

    fs.rmSync(SIGNING_ARTIFACTS_DIR, { recursive: true, force: true });
    fs.mkdirSync(SIGNING_ARTIFACTS_DIR, { recursive: true });

    const commandArgs = [
        'sign',
        '--source-dir',
        FIREFOX_DIST_DIR,
        '--artifacts-dir',
        SIGNING_ARTIFACTS_DIR,
        '--api-key',
        apiKey,
        '--api-secret',
        apiSecret,
        '--channel',
        channel,
    ];

    console.log(`Signing Firefox add-on ${firefoxId} (${version}) via web-ext...`);
    const result = spawnSync(webExtBin, commandArgs, {
        cwd: ROOT_DIR,
        stdio: 'inherit',
        env: process.env,
    });

    if (result.status !== 0) {
        fail(`web-ext sign failed with exit code ${result.status ?? 'unknown'}.`);
    }

    const signedArtifact = latestSignedArtifact(SIGNING_ARTIFACTS_DIR);
    if (!signedArtifact) {
        fail('web-ext completed but no signed .xpi was produced.');
    }

    const outputPath = path.join(ROOT_DIR, `solokeys-vault-firefox-v${version}-signed.xpi`);
    fs.copyFileSync(signedArtifact, outputPath);

    console.log(`Signed Firefox package: ${path.basename(outputPath)}`);
    console.log(`Downloaded artifact: ${signedArtifact}`);
}

main();
