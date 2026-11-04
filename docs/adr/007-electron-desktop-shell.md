# ADR 007 — Electron packages the desktop POS

## Status

Accepted, implementation deferred to Phase 9

## Context

The POS must run in a browser and as an installed desktop app, and it must talk to receipt printers and cash drawers. Tauri produces a smaller binary. The ESC/POS and serial-port libraries that retail POS hardware uses are mature in Node and uneven in Tauri.

The product also has to ship Phases 2–8 without a desktop shell blocking catalog and billing work.

## Decision

`pos-desktop` is a Vite React application. It runs as a PWA in the browser and, in Phase 9, inside Electron. Electron's main process owns SQLite, printer access, and auto-update. The renderer talks to the local shell through a narrow preload bridge and to `pos-backend` only over HTTPS.

Tauri is not the packaging tool.

Phases 1–8 do not add Electron dependencies. The renderer must not import Node or Electron APIs directly, so the same UI runs in a browser.

## Consequences

- Installers are larger than a Tauri build. That size is accepted for hardware support.
- Browser mode uses IndexedDB for the outbox. Electron mode uses SQLite. The sync protocol is the same; only the local driver differs.
- Auto-update is an Electron concern and is specified in Phase 9, not in the web deployment.
