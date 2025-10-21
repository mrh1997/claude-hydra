#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join, resolve, isAbsolute } from 'path';
import { existsSync, accessSync, statSync, constants } from 'fs';
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

// Parse positional arguments (repository paths)
function parseRepositoryArgs() {
	const args = process.argv.slice(2);
	const repoPaths = [];

	// Named flags that consume the next argument
	const flagsWithValues = ['-p', '--port'];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		// Skip named flags and their values
		if (flagsWithValues.includes(arg)) {
			i++; // Skip next argument (the value)
			continue;
		}

		// Skip flags with = syntax or standalone flags
		if (arg.startsWith('--') || arg.startsWith('-')) {
			continue;
		}

		// This is a positional argument - treat as repository path
		repoPaths.push(arg);
	}

	return repoPaths;
}

// Validate a repository path
function validateRepository(repoPath) {
	try {
		// Resolve to absolute path
		const absolutePath = isAbsolute(repoPath) ? repoPath : resolve(process.cwd(), repoPath);

		// Check if path exists and is accessible
		accessSync(absolutePath, constants.R_OK);

		// Check if path is a directory
		const stats = statSync(absolutePath);
		if (!stats.isDirectory()) {
			return { valid: false, error: `Not a directory: ${repoPath}` };
		}

		// Check if it's a git repository
		try {
			execSync('git rev-parse --git-dir', {
				cwd: absolutePath,
				stdio: 'pipe',
				encoding: 'utf8'
			});
		} catch (gitError) {
			return { valid: false, error: `Not a git repository: ${repoPath}` };
		}

		return { valid: true, path: absolutePath };
	} catch (error) {
		return { valid: false, error: `Cannot access path: ${repoPath} (${error.message})` };
	}
}

// Detect mode: --dev flag or check if build directory exists
const isDev = process.argv.includes('--dev') || !existsSync(join(__dirname, 'build'));
let isHeadless = process.argv.includes('--headless') || process.argv.includes('-hl');

// Parse and validate CLI repository arguments
const cliRepoPaths = parseRepositoryArgs();
const validatedRepos = [];

if (cliRepoPaths.length > 0) {
	console.log(`[claude-hydra] Validating ${cliRepoPaths.length} repository path(s) from command line...`);

	for (const repoPath of cliRepoPaths) {
		const validation = validateRepository(repoPath);
		if (validation.valid) {
			validatedRepos.push(validation.path);
			console.log(`[claude-hydra] ✓ Valid repository: ${validation.path}`);
		} else {
			console.warn(`[claude-hydra] ✗ Invalid repository: ${validation.error}`);
		}
	}

	if (validatedRepos.length > 0) {
		console.log(`[claude-hydra] Will open ${validatedRepos.length} repository/repositories from command line`);
	} else {
		console.warn(`[claude-hydra] No valid repositories found in command line arguments`);
	}
}

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
	process.env.CLI_REPOSITORIES = validatedRepos.length > 0 ? JSON.stringify(validatedRepos) : '';

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
