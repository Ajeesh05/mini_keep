# Changelog

## 1.1.1 - 2026-09-17

- Phase 5 and 6: releases, and the Chrome Web Store pipeline
- Make the contract explicit: report a version bump, do not apply it
- Add mobile approval: comment /approve to start a run
- Added a close-keep keyboard shortcut (Alt+Shift+K) that calls the previously-dead closeKeep(), and routed chrome.commands.onCommand by command name so other commands keep opening/focusing Keep as before. (#2)
- Report which step actually failed, and stop echoing full agent output
- Name AI branches after the issue title
- Temporarily surface full Claude output while bootstrapping the loop
- Add the agent contract and the AI implement workflow
- Add CI: lint, manifest, permission gate, secret scan, tests, package
- Add lint ratchet
- Add test suite: 36 unit tests, 5 E2E, lint and packaging
- Add .gitignore covering credentials and test output
- Bug fix - Popup not accesible on low resolution systems - Fixed by getting safebounds based on system display
- Bug fix - popup not opened while another keep tab is open in a tab - Fixed by clearly differentiating my popups with query param
- Chrome extension - open google meet in a resizable popup window
