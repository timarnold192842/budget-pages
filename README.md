# Forecast

A static, browser-based financial planning workspace, published with GitHub Pages.

## Using the workspace

- **Edit plan** opens the input editor. It becomes a modal drawer on phones and tablets; Escape or the close button returns to the dashboard. On desktop, drag the divider to resize it.
- Accounts, loans, transactions, currencies, price targets, asset sale fees, and scenarios retain their existing calculation behavior.
- **1Y / 3Y / 5Y / 10Y** select calendar ranges starting today. Fine-tune controls adjust the current view. Chart series can be toggled with a mouse, touch, or keyboard. To keep longer views legible, transaction date markers appear only up to two years and quarterly markers up to six years; annual and enabled milestone markers remain.
- Scenario tabs support arrow keys, Home, and End. **Rename current** avoids relying on double-click on touch devices.
- Changes save locally to the current browser. There is no cross-device synchronization. **Export backup** downloads the active plan as JSON; import it through **Backup & data** on another device. Separate scenarios remain in the browser's scenario registry; export each scenario you want to transfer.
- Clearing saved copies requires confirmation. The current plan remains open; another edit saves it again.

## Structure

- [index.html](./index.html): semantic workspace shell and the existing embedded default plan.
- [assets/finance.js](./assets/finance.js): financial calculations, rendering, scenarios, and JSON/local-storage compatibility.
- [assets/base.css](./assets/base.css): existing editor primitives.
- [assets/workspace.css](./assets/workspace.css): workspace design tokens, light/dark themes, responsive layouts, and touch adaptations.
- [assets/workspace.js](./assets/workspace.js): drawer/focus management, desktop resizing, time presets, and save-status UI.
- [tests/finance.test.cjs](./tests/finance.test.cjs): dependency-free Node regression tests.

Keeping the existing calculation engine separate from the new workspace layer limits migration risk. The default embedded data and storage keys are preserved. The snapshot now uses the engine's separate asset/loan maps so accounts and loans with matching names do not inflate displayed debt.

## Development and validation

Serve this directory with any static HTTP server and open it in a browser. No build step is needed. Keep the `assets` directory with the HTML when moving or saving a local copy. Chart.js, its pinned adapters/plugins, and Hammer.js (for touch gestures) load from jsDelivr, so a connection is needed on first load.

Run on Node 18 or later:

```sh
node --test tests/finance.test.cjs
node --check assets/finance.js
node --check assets/workspace.js
```

Browser smoke checks: desktop and narrow/mobile layouts, editor open/close and focus containment, saved-plan reload, account edits, scenario creation/switching, chart ranges/legend/theme, sale dialog, JSON export/import, and no document-level horizontal scrolling.

## Publishing

GitHub Pages publishes the repository root from `main`. Push a validated commit to deploy; there is no generated output to commit. Earlier commits retain the previous version for recovery. Local browser saves are not deployed or overwritten by a code update.
