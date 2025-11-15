# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A web-based terminal interface that runs Claude Code in the browser with full Windows support. Built with SvelteKit on the frontend and a Node.js WebSocket server on the backend.

## Development Commands

```bash
# Start development server (Vite dev server + WebSocket server on port 3001)
npm run dev

# Type checking
npm run check

# Type checking in watch mode
npm run check:watch

# Build for production
npm run build

# Build and Preview production build
npm run preview
```

## Architecture

### Frontend (SvelteKit + xterm.js)
- **Terminal Component** (`src/lib/components/Terminal.svelte`): Uses xterm.js with FitAddon and WebLinksAddon. Handles WebSocket connection, keyboard shortcuts (Ctrl+Shift+C/V), and terminal resizing.
- **Tab Management** (`src/lib/stores/terminals.ts`): Svelte writable store managing multiple terminal tabs (id, sessionId, title, active state).
- **WebSocket Client**: Connects to `ws://localhost:3001`, sends messages for `create`, `data`, `resize`, `destroy`.

### Backend (Node.js)
- **WebSocket Server** (`src/hooks.server.ts`): Initializes on port 3001 in the SvelteKit server hook. Handles client connections and routes messages to PtyManager.
- **PTY Manager** (`src/lib/server/pty-manager.ts`): Manages pseudo-terminal sessions using `@homebridge/node-pty-prebuilt-multiarch` for Windows ConPTY support. Spawns `claude` directly as the PTY process.

### Key Flows
1. **Session Creation**: Frontend sends `create` → Backend spawns `claude` directly as PTY process → Returns sessionId
2. **Data Flow**: User input → WebSocket `data` message → PTY write → PTY output → WebSocket `data` message → xterm.js display
3. **Resize**: xterm.js resize event → WebSocket `resize` message → PTY resize

## Platform Support

- **Cross-platform**: Spawns `claude` directly (node-pty automatically handles `.exe` extension on Windows)
- Relies on ConPTY support (Windows) or standard PTY (Unix) via node-pty-prebuilt-multiarch

## WebSocket Message Protocol

Apart from the Webserver that delivers the SPA claude-hydra has two Websocket ports:
- one that manages sessions (each connection corresponds to a single terminal tab).
  This socket forwards keyboard entry/terminal output between claude code and the xterm.js).
  Furthermore it manages the filesystem of the corresponding worktree.
- one that manages the claude-hydra instance.
  It creates new sessions and detects when the window is closed.

## Important Notes

- Claude Code CLI must be in PATH (spawned directly as `claude`)
- WebSocket server runs on port 3001 (hardcoded in both client and server)
- xterm.js is dynamically imported in `onMount` to avoid SSR issues
- Terminal dimensions are sent to PTY immediately after session creation to ensure proper sizing
- To look at bugs use Playwright. Create testscript in /test/playwright but remove them again when you fixed the bug
- Always use bash to execute commands (not windows cmd.exe or powershell)

## README.md Maintenance

When adding new user-facing features to claude-hydra, **always update README.md** to document the feature for end users.

**Guidelines:**
- **Target Audience**: README.md is for users of claude-hydra, not developers working on claude-hydra itself
- **User-Focused Content**: Include installation instructions, usage guides, feature documentation, configuration options, and keyboard shortcuts
- **Exclude Developer Content**: Keep internal implementation details, architecture, development commands, and troubleshooting in CLAUDE.md only
- **Update Promptly**: Document new features in README.md as part of the same change that introduces them
