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

# Preview production build
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

Client to Server:
- `{ type: 'create' }` - Create new terminal session
- `{ type: 'data', data: string }` - Send input to terminal
- `{ type: 'resize', cols: number, rows: number }` - Resize terminal
- `{ type: 'destroy' }` - Destroy session

Server to Client:
- `{ type: 'created', sessionId: string }` - Session created
- `{ type: 'data', data: string }` - Terminal output
- `{ type: 'exit' }` - Process exited

## Important Notes

- Claude Code CLI must be in PATH (spawned directly as `claude`)
- WebSocket server runs on port 3001 (hardcoded in both client and server)
- xterm.js is dynamically imported in `onMount` to avoid SSR issues
- Terminal dimensions are sent to PTY immediately after session creation to ensure proper sizing
- To look at bugs use Playwright. Create testscript in /test/playwright but remove them again when you fixed the bug
- Always use bash to execute commands (not windows cmd.exe or powershell)

## Testing and Committing Workflow

When you believe a bug fix or feature implementation is complete, automatically follow this workflow:

1. **Increment .claude-hydra.devversion before testing:**
   - If .claude-hydra.devversion file doesn't exist, create it with content "1"
   - Otherwise, read the current value and increment by 1
   - This updates the version indicator in the UI to verify HMR is working
   - .claude-hydra.devversion must always be updated at last (after all other changes)
     as it causes the server to restart

2. **Start the development Server in Background if not running yet in background**

3. **Ask the user:** "Is everything working correctly? (yes/no)"

4. **If the user responds "yes":**
   - Reset .claude-hydra.devversion to "1" (overwrite the file with just "1")
   - Explicitly `git add` each source file that was created or modified during this session (track these files throughout the conversation)
   - If any build artifacts were created, add them to .gitignore instead of committing them
   - Create a commit with a descriptive message based on the changes made
   - Include the standard commit footer:
     ```
     🤖 Generated with [Claude Code](https://claude.com/claude-code)

     Co-Authored-By: Claude <noreply@anthropic.com>
     ```

5. **If the user responds "no" or provides instructions:**
   - Follow the user's instructions to fix the issues
   - Go back to step 1 (increment .claude-hydra.devversion again before testing)
   - Do NOT commit anything until the user confirms everything works