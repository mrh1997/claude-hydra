import * as pty from '@homebridge/node-pty-prebuilt-multiarch';
import { v4 as uuidv4 } from 'uuid';

export interface TerminalSession {
	id: string;
	ptyProcess: pty.IPty;
	onData: (data: string) => void;
	onExit: () => void;
}

export class PtyManager {
	private sessions = new Map<string, TerminalSession>();

	createSession(onData: (sessionId: string, data: string) => void, onExit: (sessionId: string) => void): string {
		const sessionId = uuidv4();

		// Spawn claude directly (node-pty handles .exe extension on Windows automatically)
		const ptyProcess = pty.spawn('claude', [], {
			name: 'xterm-256color',
			cols: 80,
			rows: 30,
			cwd: process.env.HOME || process.env.USERPROFILE || process.cwd(),
			env: process.env as { [key: string]: string }
		});

		const session: TerminalSession = {
			id: sessionId,
			ptyProcess,
			onData: (data: string) => onData(sessionId, data),
			onExit: () => {
				this.sessions.delete(sessionId);
				onExit(sessionId);
			}
		};

		ptyProcess.onData(session.onData);
		ptyProcess.onExit(session.onExit);

		this.sessions.set(sessionId, session);

		return sessionId;
	}

	write(sessionId: string, data: string): void {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.ptyProcess.write(data);
		}
	}

	resize(sessionId: string, cols: number, rows: number): void {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.ptyProcess.resize(cols, rows);
		}
	}

	destroy(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (session) {
			session.ptyProcess.kill();
			this.sessions.delete(sessionId);
		}
	}

	destroyAll(): void {
		for (const [sessionId] of this.sessions) {
			this.destroy(sessionId);
		}
	}
}
