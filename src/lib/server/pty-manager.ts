import * as pty from '@homebridge/node-pty-prebuilt-multiarch';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';
import type { SessionManager } from '$lib/server/session-manager';

export interface TerminalSession {
	id: string;
	ptyProcess: pty.IPty;
	onData: (data: string) => void;
	onExit: () => void;
}

export class PtyManager {
	private sessions = new Map<string, TerminalSession>();
	private claudePath: string | null = null;
	private sessionManager: SessionManager;

	constructor(sessionManager: SessionManager) {
		this.sessionManager = sessionManager;
	}

	private getClaudePath(): string {
		if (this.claudePath) {
			return this.claudePath;
		}

		try {
			// On Windows, use 'where' to find the executable
			const command = process.platform === 'win32' ? 'where claude' : 'which claude';
			const output = execSync(command, { encoding: 'utf8' });
			this.claudePath = output.trim().split('\n')[0]; // Get first match
			return this.claudePath;
		} catch (error) {
			throw new Error('Claude executable not found in PATH. Please ensure Claude Code is installed.');
		}
	}

	createSession(onData: (sessionId: string, data: string) => void, onExit: (sessionId: string) => void): string {
		const sessionId = uuidv4();

		// Create isolated git worktree session
		const sessionInfo = this.sessionManager.createSession(sessionId);

		// Get the full path to claude executable
		const claudePath = this.getClaudePath();

		// Spawn claude directly with full path, using worktree as cwd
		const ptyProcess = pty.spawn(claudePath, [], {
			name: 'xterm-256color',
			cols: 80,
			rows: 30,
			cwd: sessionInfo.worktreePath,
			env: process.env as { [key: string]: string }
		});

		const session: TerminalSession = {
			id: sessionId,
			ptyProcess,
			onData: (data: string) => onData(sessionId, data),
			onExit: () => {
				this.sessions.delete(sessionId);
				onExit(sessionId);
				// Clean up worktree after process has fully exited
				this.sessionManager.destroySession(sessionId);
			}
		};

		ptyProcess.onData(session.onData);
		ptyProcess.onExit(session.onExit);

		this.sessions.set(sessionId, session);

		// Send initial newline to trigger Claude to start and display welcome message
		ptyProcess.write('\r');

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
		// Worktree cleanup happens in onExit handler after process fully exits
	}

	destroyAll(): void {
		for (const [sessionId] of this.sessions) {
			this.destroy(sessionId);
		}
		// Clean up any remaining sessions
		this.sessionManager.destroyAllSessions();
	}
}
