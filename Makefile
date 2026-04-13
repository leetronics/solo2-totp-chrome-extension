# Makefile for SoloKeys Vault browser extensions
# Provides convenient shortcuts for building and packaging

.PHONY: all build clean install test validate zip crx firefox sign-firefox package help deps

# Default target
all: build

# Build Chrome + Firefox packages
build:
	@echo "🔨 Building SoloKeys Vault browser extensions..."
	@node build.js

# Build only Chrome package
zip:
	@echo "📦 Creating Chrome package..."
	@node build.js --chrome

# Build only Firefox package
firefox:
	@echo "🦊 Creating Firefox package..."
	@node build.js --firefox

# Sign Firefox package for self-distribution
sign-firefox:
	@echo "✍️ Signing Firefox package..."
	@node scripts/sign-firefox.js

# Build .crx for manual installation
crx:
	@echo "🔐 Creating CRX package..."
	@node build.js --chrome --crx

# Build both ZIP and CRX
package: build crx

# Validate extension structure without building
validate:
	@echo "🔍 Validating extension..."
	@node build.js --validate

# Clean build artifacts
clean:
	@echo "🧹 Cleaning build artifacts..."
	@node build.js --clean
	@rm -rf web-ext-artifacts
	@rm -f *.zip *.xpi *.crx *.tar.gz INSTALL-*.md

# Install dependencies
deps:
	@echo "📦 Installing dependencies..."
	@npm install

# Quick install guide
help:
	@echo "SoloKeys Vault Extensions - Build Commands"
	@echo "========================================="
	@echo ""
	@echo "  make build      - Build Chrome + Firefox packages"
	@echo "  make zip        - Build Chrome package only"
	@echo "  make firefox    - Build Firefox package only"
	@echo "  make sign-firefox - Sign Firefox package with AMO credentials"
	@echo "  make crx        - Create CRX for manual install"
	@echo "  make package    - Build both browsers and a Chrome CRX"
	@echo "  make validate   - Validate extension structure"
	@echo "  make clean      - Remove all build artifacts"
	@echo "  make deps       - Install npm dependencies"
	@echo "  make help       - Show this help message"
	@echo ""
	@echo "Or use Node directly:"
	@echo "  node build.js --chrome   - Build Chrome only"
	@echo "  node build.js --firefox  - Build Firefox only"
	@echo "  node build.js --crx      - Build Chrome + Firefox and a Chrome CRX"
	@echo "  node build.js            - Build both browser packages"
	@echo "  node scripts/sign-firefox.js - Sign the Firefox XPI"

# Quick start for developers
install: deps build
	@echo ""
	@echo "✓ Extension built successfully!"
	@echo ""
	@echo "To install in Chrome:"
	@echo "  1. Open Chrome and go to chrome://extensions/"
	@echo "  2. Enable 'Developer mode'"
	@echo "  3. Click 'Load unpacked'"
	@echo "  4. Select the dist/ folder"
	@echo ""
	@echo "Firefox release signing:"
	@echo "  WEB_EXT_API_KEY=... WEB_EXT_API_SECRET=... make sign-firefox"
