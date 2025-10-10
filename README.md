# Claude Hydra

A web-based terminal interface for running Claude Code in your browser with full Windows support.

## Features

- Convieniently run multiple Claude Code parallel
- Tight git worktree integration
- Cross-platform

## Prerequisites

- Node.js 18+
- Claude Code CLI installed and available in PATH

## Installation

1. Navigate to the project directory:
```bash
cd claude-hydra
```

2. Dependencies are already installed. If you need to reinstall:
```bash
npm install
```

## Running the Application

1. Start the development server:
```bash
npm run dev
```

2. Open your browser and navigate to:
```
http://localhost:5173
```

The WebSocket server will automatically start on port 3001.

## Usage

### Creating Terminals

- Click the **+** button in the tab bar to create a new terminal
- Each terminal will automatically launch Claude Code

### Managing Tabs

- Click on a tab to switch to it
- Click the **×** button on a tab to close it
- Tabs can be managed independently

### Keyboard Shortcuts

- **Ctrl+Shift+C**: Copy selected text
- **Ctrl+Shift+V**: Paste from clipboard
- All other shortcuts are forwarded to Claude Code

### Copy/Paste

The terminal supports standard terminal copy/paste:
1. Select text with your mouse
2. Press Ctrl+Shift+C to copy
3. Press Ctrl+Shift+V to paste

## Architecture

### Frontend (SvelteKit + xterm.js)
- **Terminal Component**: Uses xterm.js for terminal rendering
- **Tab Management**: Svelte store for managing multiple sessions
- **WebSocket Client**: Real-time communication with backend

### Backend (Node.js)
- **WebSocket Server**: Handles client connections on port 3001
- **PTY Manager**: Spawns and manages pseudo-terminal processes
- **Windows Support**: Uses @homebridge/node-pty-prebuilt-multiarch for ConPTY support

## File Structure

```
claude-hydra/
├── src/
│   ├── lib/
│   │   ├── components/
│   │   │   ├── Terminal.svelte          # Main terminal component
│   │   │   └── TerminalTabs.svelte      # Tab bar UI
│   │   ├── stores/
│   │   │   └── terminals.ts             # Session management
│   │   └── server/
│   │       └── pty-manager.ts           # PTY process management
│   ├── routes/
│   │   ├── +layout.svelte               # App layout
│   │   └── +page.svelte                 # Main page
│   ├── hooks.server.ts                  # WebSocket server
│   ├── app.html                         # HTML template
│   └── app.css                          # Global styles
├── package.json
├── svelte.config.js
├── vite.config.ts
└── tsconfig.json
```

## Configuration Files

Claude Hydra supports several optional configuration files in your repository root to customize its behavior:

### .claude-hydra.port

Specifies a fixed port number for the Claude Hydra server. When this file exists, the server will:
- Use the specified port for HTTP (default: auto-detect starting from 3000)
- Use port+1 for WebSocket communication
- Use port+2 for management connections
- Run in headless mode (no browser auto-opens)

**Format:** Single integer on the first line (e.g., `5000`)

**Example:**
```bash
echo "5000" > .claude-hydra.port
```

### .claude-hydra.autoinit.{cmd,sh,ps1}

Auto-initialization script that runs when creating a new worktree. The server will look for and execute (in order of priority):
- Windows: `.claude-hydra.autoinit.ps1`, `.claude-hydra.autoinit.cmd`, `.claude-hydra.autoinit.sh`
- Unix: `.claude-hydra.autoinit.sh`

Use this to set up the environment in each new worktree (e.g., install dependencies, configure settings).

**Example (.claude-hydra.autoinit.cmd):**
```cmd
@echo off
echo Setting up new worktree...
npm install
```

**Example (.claude-hydra.autoinit.sh):**
```bash
#!/bin/bash
echo "Setting up new worktree..."
npm install
```

### .claude-hydra.localfiles

Defines files that should be automatically synchronized between the main repository and worktrees. Each line is a glob pattern. Files matching these patterns are:
- Copied from main repo to worktree when creating a branch or rebasing
- Copied from worktree back to main repo when merging

Use this for files that shouldn't be committed but need to be shared across branches (e.g., local configuration, environment files).

**Note:** All `**/CLAUDE.local.md` files are automatically synced regardless of this configuration file.

**Format:** One glob pattern per line. Lines starting with `#` are comments.

**Example:**
```
# Sync environment files
.env.local
.env.development

# Sync IDE settings
.vscode/*.json
.idea/*.xml

# Sync local configuration
config/local.json
```

## Troubleshooting

### Claude Code not found
Make sure Claude Code is installed and available in your PATH:
```bash
claude --version
```

### WebSocket connection failed
- Ensure port 3001 is not in use
- Check firewall settings
- Try restarting the dev server

### Terminal not displaying correctly
- Clear browser cache
- Try a different browser
- Check browser console for errors

## Building for Production

```bash
npm run build
npm run preview
```

## Development

### Type checking
```bash
npm run check
```

### Watch mode
```bash
npm run check:watch
```

## License

GPL-2.0 - See [LICENSE](LICENSE) file for details
