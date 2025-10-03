import * as pty from '@homebridge/node-pty-prebuilt-multiarch';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';

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

		// Determine shell and command based on platform
		const isWindows = os.platform() === 'win32';
		const shell = isWindows ? 'powershell.exe' : (process.env.SHELL || '/bin/bash');

		// For Windows, we'll use PowerShell to run claude
		// The user will need to have claude in their PATH
		const ptyProcess = pty.spawn(shell, [], {
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

		// On Windows, automatically start Claude Code if it's in PATH
		if (isWindows) {
			// Wait a bit for PowerShell to initialize, then run claude
			setTimeout(() => {
				this.write(sessionId, 'claude\r');
			}, 500);
		} else {
			// On Unix, try to start claude directly
			setTimeout(() => {
				this.write(sessionId, 'claude\n');
			}, 100);
		}

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
