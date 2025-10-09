#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { spawn, execSync } from 'child_process';
import { findAvailablePortTriple, readPortFromFile, isPortAvailable } from './src/lib/server/port-finder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
	let repoRoot = null;
	try {
		repoRoot = execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: 'pipe' }).trim();
	} catch (error) {
		// Not in a git repository or git not available - will use auto-detection
	}

	// Check for CLAUDE-HYDRA-PORT file if we're in a git repository
	if (repoRoot) {
		const fixedPort = readPortFromFile(repoRoot);
		if (fixedPort !== null) {
			// CLAUDE-HYDRA-PORT file exists - validate and use it
			httpPort = fixedPort;
			wsPort = fixedPort + 1;
			mgmtPort = fixedPort + 2;
			portSource = 'CLAUDE-HYDRA-PORT';

			// Default to headless mode when using fixed port
			if (!process.argv.includes('--headless') && !process.argv.includes('-hl')) {
				isHeadless = true;
			}

			console.log(`[claude-hydra] Found CLAUDE-HYDRA-PORT file, using fixed ports...`);

			// Validate port availability
			const [httpAvailable, wsAvailable, mgmtAvailable] = await Promise.all([
				isPortAvailable(httpPort),
				isPortAvailable(wsPort),
				isPortAvailable(mgmtPort)
			]);

			if (!httpAvailable || !wsAvailable || !mgmtAvailable) {
				const busyPort = !httpAvailable ? httpPort : (!wsAvailable ? wsPort : mgmtPort);
				console.error(`Error: Port ${busyPort} from CLAUDE-HYDRA-PORT is already in use.`);
				console.error('Please free the port or update the CLAUDE-HYDRA-PORT file.');
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
