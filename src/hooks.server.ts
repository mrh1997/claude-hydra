import type { Handle } from '@sveltejs/kit';
import { WebSocketServer } from 'ws';
import { PtyManager } from '$lib/server/pty-manager';

let wss: WebSocketServer | null = null;
const ptyManager = new PtyManager();

// Initialize WebSocket server
function initWebSocketServer() {
	if (wss) return;

	wss = new WebSocketServer({ port: 3001 });

	wss.on('connection', (ws) => {
		console.log('WebSocket client connected');
		let sessionId: string | null = null;

		ws.on('message', (message) => {
			try {
				const data = JSON.parse(message.toString());

				switch (data.type) {
					case 'create':
						// Create a new terminal session
						sessionId = ptyManager.createSession(
							(sid, output) => {
								// Send terminal output to client
								if (ws.readyState === ws.OPEN) {
									ws.send(JSON.stringify({ type: 'data', data: output }));
								}
							},
							(sid) => {
								// Handle terminal exit
								if (ws.readyState === ws.OPEN) {
									ws.send(JSON.stringify({ type: 'exit' }));
								}
							}
						);
						ws.send(JSON.stringify({ type: 'created', sessionId }));
						break;

					case 'data':
						// Send input to terminal
						if (sessionId) {
							ptyManager.write(sessionId, data.data);
						}
						break;

					case 'resize':
						// Resize terminal
						if (sessionId) {
							ptyManager.resize(sessionId, data.cols, data.rows);
						}
						break;

					case 'destroy':
						// Destroy terminal session
						if (sessionId) {
							ptyManager.destroy(sessionId);
							sessionId = null;
						}
						break;
				}
			} catch (error) {
				console.error('WebSocket message error:', error);
			}
		});

		ws.on('close', () => {
			console.log('WebSocket client disconnected');
			if (sessionId) {
				ptyManager.destroy(sessionId);
			}
		});

		ws.on('error', (error) => {
			console.error('WebSocket error:', error);
		});
	});

	console.log('WebSocket server started on port 3001');
}

// Start WebSocket server
initWebSocketServer();

export const handle: Handle = async ({ event, resolve }) => {
	return resolve(event);
};
