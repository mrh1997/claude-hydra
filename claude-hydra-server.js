#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join, resolve, isAbsolute } from 'path';
import { existsSync } from 'fs';
import { spawn, execSync } from 'child_process';
import { findAvailablePortTriple, isPortAvailable } from './src/lib/server/port-finder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse --port/-p parameter
function parsePortArg() {
	const args = process.argv.slice(2);

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		// Handle -p <port> or --port <port>
		if ((arg === '-p' || arg === '--port') && i + 1 < args.length) {
			return parseInt(args[i + 1], 10);
		}

		// Handle -p=<port> or --port=<port>
		if (arg.startsWith('-p=')) {
			return parseInt(arg.substring(3), 10);
		}
		if (arg.startsWith('--port=')) {
			return parseInt(arg.substring(7), 10);
		}
	}

	return null;
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

	// Check for --port/-p parameter
	const specifiedPort = parsePortArg();
	if (specifiedPort !== null) {
		// Validate port number (must leave room for port+1 and port+2)
		if (isNaN(specifiedPort) || specifiedPort < 1 || specifiedPort > 65533) {
			console.error(`Error: Invalid port number: ${specifiedPort}`);
			console.error('Port must be between 1 and 65533 (to allow space for WebSocket and Management ports)');
			process.exit(1);
		}

		httpPort = specifiedPort;
		wsPort = specifiedPort + 1;
		mgmtPort = specifiedPort + 2;
		portSource = '--port parameter';

		console.log(`[claude-hydra] Using specified port ${specifiedPort}...`);

		// Validate port availability
		const [httpAvailable, wsAvailable, mgmtAvailable] = await Promise.all([
			isPortAvailable(httpPort),
			isPortAvailable(wsPort),
			isPortAvailable(mgmtPort)
		]);

		if (!httpAvailable || !wsAvailable || !mgmtAvailable) {
			const busyPort = !httpAvailable ? httpPort : (!wsAvailable ? wsPort : mgmtPort);
			console.error(`Error: Port ${busyPort} is already in use.`);
			console.error('Please free the port or specify a different port with --port.');
			process.exit(1);
		}
	} else {
		// No port specified, auto-detect
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
