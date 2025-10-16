#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join, resolve, isAbsolute } from 'path';
import { existsSync } from 'fs';
import { spawn, execSync } from 'child_process';
import { findAvailablePortTriple, readPortFromFile, isPortAvailable } from './src/lib/server/port-finder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse -d/--dir parameter to change working directory
function parseDirectoryArg() {
	const args = process.argv.slice(2);

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		// Handle -d <path> or --dir <path>
		if ((arg === '-d' || arg === '--dir') && i + 1 < args.length) {
			return args[i + 1];
		}

		// Handle -d=<path> or --dir=<path>
		if (arg.startsWith('-d=')) {
			return arg.substring(3);
		}
		if (arg.startsWith('--dir=')) {
			return arg.substring(6);
		}
	}

	return null;
}

// Set repository directory if -d/--dir parameter is provided
const specifiedDir = parseDirectoryArg();
if (specifiedDir) {
	// Convert to absolute path
	const targetDir = isAbsolute(specifiedDir) ? specifiedDir : resolve(process.cwd(), specifiedDir);

	// Validate directory exists
	if (!existsSync(targetDir)) {
		console.error(`Error: Directory does not exist: ${targetDir}`);
		process.exit(1);
	}

	// Validate it's a git repository
	try {
		execSync('git rev-parse --git-dir', { cwd: targetDir, stdio: 'pipe' });
	} catch (error) {
		console.error(`Error: Not a git repository: ${targetDir}`);
		process.exit(1);
	}

	// Store in environment variable for SessionManager and other components
	process.env.CLAUDE_HYDRA_REPO_DIR = targetDir;
	console.log(`[claude-hydra] Using repository directory: ${targetDir}`);
} else {
	// When --dir is not specified, use current working directory as project directory
	// This ensures autoinit scripts are loaded from the project directory, not claude-hydra's installation directory
	process.env.CLAUDE_HYDRA_REPO_DIR = process.cwd();
	console.log(`[claude-hydra] Using current directory: ${process.cwd()}`);
}

// Detect mode: --dev flag or check if build directory exists
const isDev = process.argv.includes('--dev') || !existsSync(join(__dirname, 'build'));
let isHeadless = process.argv.includes('--headless') || process.argv.includes('-hl');

// Open browser helper
async function openBrowser(url) {
	const { default: open } = await import('open');
	await open(url);
}

async function startServer() {
	let httpPort, wsPort, mgmtPort;
	let portSource = 'auto-detected';

	// Try to detect git repository root
	// Use CLAUDE_HYDRA_REPO_DIR if set (from --dir parameter), otherwise use current directory
	let repoRoot = null;
	try {
		const gitCwd = process.env.CLAUDE_HYDRA_REPO_DIR || process.cwd();
		repoRoot = execSync('git rev-parse --show-toplevel', { cwd: gitCwd, encoding: 'utf8', stdio: 'pipe' }).trim();
	} catch (error) {
		// Not in a git repository or git not available - will use auto-detection
	}

	// Check for .claude-hydra.port file if we're in a git repository
	if (repoRoot) {
		const fixedPort = readPortFromFile(repoRoot);
		if (fixedPort !== null) {
			// .claude-hydra.port file exists - validate and use it
			httpPort = fixedPort;
			wsPort = fixedPort + 1;
			mgmtPort = fixedPort + 2;
			portSource = '.claude-hydra.port';

			// Default to headless mode when using fixed port
			if (!process.argv.includes('--headless') && !process.argv.includes('-hl')) {
				isHeadless = true;
			}

			console.log(`[claude-hydra] Found .claude-hydra.port file, using fixed ports...`);

			// Validate port availability
			const [httpAvailable, wsAvailable, mgmtAvailable] = await Promise.all([
				isPortAvailable(httpPort),
				isPortAvailable(wsPort),
				isPortAvailable(mgmtPort)
			]);

			if (!httpAvailable || !wsAvailable || !mgmtAvailable) {
				const busyPort = !httpAvailable ? httpPort : (!wsAvailable ? wsPort : mgmtPort);
				console.error(`Error: Port ${busyPort} from .claude-hydra.port is already in use.`);
				console.error('Please free the port or update the .claude-hydra.port file.');
				process.exit(1);
			}
		}
	}

	// If no fixed port, auto-detect
	if (!httpPort) {
		console.log('Finding available port triple...');
		const ports = await findAvailablePortTriple(3000);
		httpPort = ports.httpPort;
		wsPort = ports.wsPort;
		mgmtPort = ports.mgmtPort;
	}

	console.log(`[claude-hydra] Using HTTP port: ${httpPort}, WebSocket port: ${wsPort}, Management port: ${mgmtPort} (${portSource})`);
	if (isHeadless) {
		console.log('[claude-hydra] Running in headless mode (browser will not open automatically)');
	}

	// Set environment variables for the server
	process.env.IS_HEADLESS = String(isHeadless);
	process.env.HTTP_PORT = String(httpPort);
	process.env.WS_PORT = String(wsPort);
	process.env.MGMT_PORT = String(mgmtPort);
	process.env.PORT = String(httpPort); // For production build/index.js

	if (isDev) {
		// Development mode: Start Vite dev server
		console.log('Starting development server...');

		const { createServer } = await import('vite');
		const server = await createServer({
			server: {
				port: httpPort,
				strictPort: true
			}
		});

		await server.listen();

		const url = `http://localhost:${httpPort}`;
		console.log(`\n  ➜ Local: ${url}\n`);

		// Open browser after server is ready (unless headless)
		if (!isHeadless) {
			await openBrowser(url);
		}

		// Setup signal handlers for graceful shutdown
		const shutdown = async (signal) => {
			console.log(`\n[claude-hydra] Received ${signal}, shutting down gracefully...`);
			try {
				await server.close();
				console.log('[claude-hydra] Server closed successfully');
				process.exit(0);
			} catch (err) {
				console.error('[claude-hydra] Error during shutdown:', err);
				process.exit(1);
			}
		};

		process.on('SIGTERM', () => shutdown('SIGTERM'));
		process.on('SIGINT', () => shutdown('SIGINT'));
		process.on('SIGHUP', () => shutdown('SIGHUP'));

		// Windows doesn't support POSIX signals well, so also handle uncaughtException
		process.on('uncaughtException', (err) => {
			if (err.code === 'ERR_IPC_CHANNEL_CLOSED' || err.code === 'EPIPE') {
				console.log('[claude-hydra] Parent process disconnected, shutting down...');
				shutdown('PARENT_DISCONNECT');
			} else {
				throw err;
			}
		});

	} else {
		// Production mode: Run build/index.js
		console.log('Starting production server...');

		const buildIndexPath = join(__dirname, 'build', 'index.js');

		if (!existsSync(buildIndexPath)) {
			console.error('Error: build/index.js not found. Run "npm run build" first.');
			process.exit(1);
		}

		const child = spawn('node', [buildIndexPath], {
			stdio: 'inherit',
			env: { ...process.env }
		});

		child.on('error', (err) => {
			console.error('Failed to start server:', err);
			process.exit(1);
		});

		child.on('exit', (code) => {
			process.exit(code || 0);
		});

		// Wait a bit for server to start, then open browser (unless headless)
		if (!isHeadless) {
			setTimeout(async () => {
				const url = `http://localhost:${httpPort}`;
				await openBrowser(url);
			}, 2000);
		}
	}
}

startServer().catch((err) => {
	console.error('Failed to start server:', err);
	process.exit(1);
});
