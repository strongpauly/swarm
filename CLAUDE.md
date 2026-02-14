# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Swarm is a Foundry Virtual Tabletop (VTT) module that renders animated swarms of sprites in place of a single token or tile. It uses PIXI.js v7 for rendering and integrates with Foundry's hooks, settings, and canvas systems.

- **Foundry VTT v13 API**: https://foundryvtt.com/api/
- **PIXI.js v7 API**: https://pixijs.download/v7.x/docs/index.html
- Files under `./foundry/` contain Foundry's client-side JS for reference.

## Development

There is no build step, test suite, or package manager. The module runs directly as ES6 modules (.mjs) inside Foundry VTT's browser environment. To test changes, load the module in a running Foundry VTT instance.

Releases are automated via GitHub Actions (`.github/workflows/main.yml`): on tag push, version is substituted into `module.json` and a zip is published.

## Code Formatting

Prettier with: tabs, 120 char width, no trailing commas. VS Code is configured for format-on-save.

## Architecture

### Entry Points (`module.json`)

Two ES modules are loaded by Foundry:
- `scripts/swarm.mjs` — core swarm engine
- `scripts/ui.mjs` — token/tile configuration UI

### Module Dependencies

- **socketlib** — socket-based communication for GM authority synchronization
- **lib-wrapper** — safe method wrapping of Foundry internals

### scripts/swarm.mjs (~1050 lines)

The core engine. Key classes:

- **SwarmMesh** — custom `PrimarySpriteMesh` that overrides rotation and manages the sprite container. Replaces Foundry's standard mesh when swarm is enabled; original mesh is stored and restored on disable.
- **Swarm** — orchestrates sprite creation, animation, HP-based visibility, and cleanup. Uses `PIXI.Ticker` for ~60fps animation. Each sprite has independent destination/speed with ±50% velocity variation.

On `init` hook, wraps `PrimaryCanvasGroup.prototype.addToken` and `addTile` via lib-wrapper to intercept token/tile creation and attach swarms.

**Animation types**: `circular`, `randSquare`, `spiral`, `skitter`, `move_stop_move`, `formation` — each sets sprite destinations differently.

**HP integration**: Reduces visible sprite count proportionally to HP loss. Supports D&D 5e, PF1e/2e, D&D 3.5e, WFRP 4e, SWADE, and custom attribute paths via world settings.

### scripts/ui.mjs

Injects swarm configuration controls (enabled, count, speed, animation type) into Foundry's token, prototype token, and tile config sheets. Uses Foundry's Application V2 API (`foundry.applications.fields`). Supports detached windows (v14+).

### scripts/constants.mjs

Flag names (`swarm.isSwarm`, `swarm.swarmSize`, `swarm.swarmSpeed`, `swarm.animation`), animation type enum, math constants (THETA, SIGMA, GAMMA), defaults, and settings keys.

### scripts/utils.mjs

2D vector math (Vector class and standalone functions) and array utilities.

### Data Storage

Swarm configuration is stored as Foundry document flags on tokens/tiles, namespaced under `swarm`.

### World Settings

GM-configurable via Foundry's settings API: `reduceSwarmWithHP`, `attributeHpValue`, `attributeHpMax`, `fadeTime`, `stopTime`.
