**Privacy Policy – SoloKeys Vault**

This extension is designed with a strict local-only security model. It does not collect, store, or transmit personal data to external services.

### Data Collection

* No personal data, browsing data, or authentication data is collected or transmitted by this extension.
* The extension does not include analytics, tracking, or advertising components.

### Credential Storage

* Website credentials (URL, username, password) and TOTP secrets are stored exclusively on the connected SoloKeys hardware device.
* The extension does not persist sensitive credentials in browser storage.
* When a user opens a credential in the popup, the password is briefly held in the popup's in-memory state and is automatically cleared after 30 seconds or when the popup is closed. It is never written to disk or browser storage.

### Credential Name Cache

* To support the tab badge and offline display, credential names (service domains and usernames, never passwords or TOTP secrets) are cached locally in browser storage for up to 7 days.
* This cache is stored in `chrome.storage.local` and never leaves the local machine.
* The cache contains no authentication secrets and is automatically purged after 7 days or when credentials are cleared.

### Data Processing

* Credentials are retrieved from the hardware device only upon explicit user interaction.
* Retrieved data is used transiently to display or autofill login forms. Credential names (but never passwords or secrets) are cached locally as described above.

### Autofill Functionality

* The extension may access the active browser tab to detect login forms and fill credentials.
* Autofill actions are initiated by the user.
* The extension does not monitor or record browsing activity.

### Data Transmission

* No data is transmitted to external servers.
* All communication occurs locally:

  * Browser extension ↔ native messaging host
  * Native messaging host ↔ SoloKeys device

### Native Messaging Host

* The extension relies on a locally installed native messaging host to communicate with the hardware device.
* This communication is restricted to the local system and does not involve network transmission.

### Third Parties

* No third-party services, analytics tools, or external APIs are used.

### Security

* Sensitive operations (credential storage and TOTP generation) are performed on the hardware device.
* The extension acts only as an interface between the user and the device.

### User Responsibility

* Users are responsible for installing and trusting the native messaging host.
* Users should only install software from verified sources.

### Changes

This privacy policy may be updated. The latest version will always be available in the project repository.

### Contact

For questions or concerns, please open an issue on the project's GitHub repository.
