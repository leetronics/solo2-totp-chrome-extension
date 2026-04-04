# Makefile for SoloKeys Vault Chrome Extension
# Provides convenient shortcuts for building and packaging

.PHONY: all build clean install test validate zip crx

# Default target
all: build

# Build the extension (creates ZIP and validates)
build:
	@echo "🔨 Building SoloKeys Vault Extension..."
	@node build.js --zip

# Build only ZIP for Chrome Web Store
zip:
	@echo "📦 Creating ZIP package..."
	@node build.js --zip

# Build .crx for manual installation
crx:
	@echo "🔐 Creating CRX package..."
	@node build.js --crx

# Build both ZIP and CRX
package: zip crx

# Validate extension structure without building
validate:
	@echo "🔍 Validating extension..."
	@node build.js --validate

# Clean build artifacts
clean:
	@echo "🧹 Cleaning build artifacts..."
	@node build.js --clean
	@rm -f *.zip *.crx *.tar.gz INSTALL-*.md

# Install dependencies
deps:
	@echo "📦 Installing dependencies..."
	@npm install

# Quick install guide
help:
	@echo "SoloKeys Vault Extension - Build Commands"
	@echo "========================================="
	@echo ""
	@echo "  make build      - Build extension (creates ZIP)"
	@echo "  make zip        - Create ZIP for Chrome Web Store"
	@echo "  make crx        - Create CRX for manual install"
	@echo "  make package    - Create both ZIP and CRX"
	@echo "  make validate   - Validate extension structure"
	@echo "  make clean      - Remove all build artifacts"
	@echo "  make deps       - Install npm dependencies"
	@echo "  make help       - Show this help message"
	@echo ""
	@echo "Or use Node directly:"
	@echo "  node build.js --zip    - Create ZIP"
	@echo "  node build.js --crx    - Create CRX"
	@echo "  node build.js          - Build with ZIP"

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
	@echo "Or install the generated .zip/.crx file"
