# Changelog

## 1.1.1 - 2026-09-17

- Added a close-keep keyboard shortcut (Alt+Shift+K), wiring up closeKeep() which had been dead code, and routed chrome.commands.onCommand by command name so existing shortcuts keep opening/focusing Keep.
- Bug fix - popup not accessible on low resolution systems - fixed by clamping to the display's safe bounds.
- Bug fix - popup not opened while another Keep tab is open - fixed by marking our own popups with a query parameter.
