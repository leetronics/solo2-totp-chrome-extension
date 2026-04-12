**SoloKeys Vault**

Securely manage passwords and generate TOTP codes using your SoloKeys hardware device.

SoloKeys Vault is a hardware-backed password manager and authenticator. It stores credentials on your SoloKeys device and retrieves them on demand via a local native messaging host. Sensitive data never leaves your system or gets transmitted to external servers.

### Features

* Hardware-backed password storage (URL, username, password)
* TOTP generation directly on the SoloKeys device
* Autofill credentials on supported websites
* No cloud sync or external services
* Open source

### How it works

The extension communicates with a locally installed native messaging host, which interfaces with your SoloKeys device. Credentials and TOTP codes are securely stored and generated on the hardware device and only provided to the extension when needed.

### Autofill

The extension can fill login forms (username/password) on websites. This requires access to the active tab to detect and populate login fields. Autofill is only triggered by user interaction.

### Privacy & Security

* No data is transmitted to external servers
* No tracking or analytics
* No collection of personal data
* Passwords and TOTP secrets are never stored in the browser — they remain on the hardware device at all times
* Communication is limited to the local machine (extension ↔ native host ↔ device)
* Host access is limited to https and http web pages; it is used solely for autofill detection and QR code scanning

### Requirements

* A compatible SoloKeys device
* Installed native messaging host (see project documentation)

### Open Source

Source code is available on GitHub.

### Disclaimer

This project is not affiliated with Google. Only install the native messaging host from trusted sources, as it has access to communicate with your hardware device.
