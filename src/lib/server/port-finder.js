import { createServer } from 'net';

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
