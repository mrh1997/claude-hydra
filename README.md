# Claude Code Terminal Web

A web-based terminal interface for running Claude Code in your browser with full Windows support.

## Features

- 🖥️ Run Claude Code in your browser
- 📑 Multiple terminal tabs/sessions
- 📋 Copy/paste support (Ctrl+Shift+C / Ctrl+Shift+V)
- ⌨️ Full keyboard shortcut forwarding
- 🪟 Windows compatible (uses ConPTY)
- 🎨 VS Code-like dark theme

## Prerequisites

- Node.js 18+
- Claude Code CLI installed and available in PATH
- Windows 10+ (for Windows ConPTY support)

## Installation

1. Navigate to the project directory:
```bash
cd claude-terminal-web
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
claude-terminal-web/
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

MIT
