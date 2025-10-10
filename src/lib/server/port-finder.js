import { createServer } from 'net';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Tries to bind to a port and returns whether it's available
 */
export async function isPortAvailable(port) {
	return new Promise((resolve) => {
		const server = createServer();

		server.once('error', () => {
			resolve(false);
		});

		server.once('listening', () => {
			// Immediately close - we're just testing availability
			server.close();
			resolve(true);
		});

		server.listen(port);
	});
}

/**
 * Reads the .claude-hydra.port file from the repository root if it exists
 * @param repoRoot - The git repository root directory
 * @returns The port number from the file, or null if file doesn't exist or is invalid
 */
export function readPortFromFile(repoRoot) {
	try {
		const portFilePath = join(repoRoot, '.claude-hydra.port');
		if (!existsSync(portFilePath)) {
			return null;
		}

		const content = readFileSync(portFilePath, 'utf-8').trim();
		const port = parseInt(content, 10);

		// Validate port number (must leave room for port+1 for WebSocket and port+2 for Management)
		if (isNaN(port) || port < 1 || port > 65533) {
			return null;
		}

		return port;
	} catch (error) {
		// Silently return null on any file read errors
		return null;
	}
}

/**
 * Finds three consecutive available ports (HTTP, WebSocket, Management)
 * Starts at startPort and tests triples: (3000, 3001, 3002), (3003, 3004, 3005), etc.
 * Uses strictPort in Vite config to ensure the port is actually used.
 */
export async function findAvailablePortTriple(startPort = 3000) {
	let httpPort = startPort;

	while (httpPort < 65533) {
		const wsPort = httpPort + 1;
		const mgmtPort = httpPort + 2;

		// Test all three ports
		const [httpAvailable, wsAvailable, mgmtAvailable] = await Promise.all([
			isPortAvailable(httpPort),
			isPortAvailable(wsPort),
			isPortAvailable(mgmtPort)
		]);

		if (httpAvailable && wsAvailable && mgmtAvailable) {
			return { httpPort, wsPort, mgmtPort };
		}

		// Try next triple (increment by 3)
		httpPort += 3;
	}

	throw new Error('No available port triple found');
}
