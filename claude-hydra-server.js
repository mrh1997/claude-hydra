#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { spawn } from 'child_process';
import { findAvailablePortPair } from './src/lib/server/port-finder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Detect mode: --dev flag or check if build directory exists
const isDev = process.argv.includes('--dev') || !existsSync(join(__dirname, 'build'));

// Open browser helper
async function openBrowser(url) {
	const { default: open } = await import('open');
	await open(url);
}

async function startServer() {
	// Find available port pair at runtime
	console.log('Finding available port pair...');
	const { httpPort, wsPort } = await findAvailablePortPair(3000);

	console.log(`[claude-hydra] Using HTTP port: ${httpPort}, WebSocket port: ${wsPort}`);

	// Set environment variables for the server
	process.env.HTTP_PORT = String(httpPort);
	process.env.WS_PORT = String(wsPort);
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

		// Open browser after server is ready
		await openBrowser(url);

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

		// Wait a bit for server to start, then open browser
		setTimeout(async () => {
			const url = `http://localhost:${httpPort}`;
			await openBrowser(url);
		}, 2000);
	}
}

startServer().catch((err) => {
	console.error('Failed to start server:', err);
	process.exit(1);
});
