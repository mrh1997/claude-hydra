import * as pty from '@homebridge/node-pty-prebuilt-multiarch';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { SessionManager } from '$lib/server/session-manager';
import updateStateTemplate from '../../template/update-state.js?raw';

export interface TerminalSession {
	id: string;
	branchName: string;
	ptyProcess: pty.IPty;
	onData: (data: string) => void;
	onExit: () => void;
}

export class PtyManager {
	private sessions = new Map<string, TerminalSession>();
	private claudePath: string | null = null;
	private sessionManager: SessionManager;
	private mergingSessions = new Set<string>(); // Track sessions being merged

	constructor(sessionManager: SessionManager) {
		this.sessionManager = sessionManager;
		// Ensure .git/info/exclude is updated at startup
		this.updateGitExclude();
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

	private setupClaudeHooks(worktreePath: string, branchName: string): void {
		const claudeDir = join(worktreePath, '.claude');
		const hooksDir = join(claudeDir, 'hooks');
		const settingsPath = join(claudeDir, 'settings.local.json');
		const hookScriptPath = join(hooksDir, 'update-state.js');
		// Use main repo's git directory, not worktree's
		const gitExcludePath = join(process.cwd(), '.git', 'info', 'exclude');

		// Create .claude/hooks directory if it doesn't exist
		if (!existsSync(hooksDir)) {
			mkdirSync(hooksDir, { recursive: true });
		}

		// Write hook script from bundled template
		writeFileSync(hookScriptPath, updateStateTemplate);

		// Setup settings.local.json
		let settings: any = {};
		if (existsSync(settingsPath)) {
			// Read existing settings
			const content = readFileSync(settingsPath, 'utf-8');
			settings = JSON.parse(content);
		}

		// Ensure hooks object exists and merge in our hooks
		if (!settings.hooks) {
			settings.hooks = {};
		}

		// Use new hooks format with matchers
		// UserPromptSubmit fires when user submits a prompt = Claude STARTS processing = running
		settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit || [];
		settings.hooks.UserPromptSubmit.push({
			hooks: [{
				type: 'command',
				command: 'node .claude/hooks/update-state.js running'
			}]
		});

		// PreToolUse fires before Claude uses a tool = running
		settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];
		settings.hooks.PreToolUse.push({
			hooks: [{
				type: 'command',
				command: 'node .claude/hooks/update-state.js running'
			}]
		});

		// Stop fires when Claude finishes processing = ready for input
		settings.hooks.Stop = settings.hooks.Stop || [];
		settings.hooks.Stop.push({
			hooks: [{
				type: 'command',
				command: 'node .claude/hooks/update-state.js ready'
			}]
		});

		// Notification fires when Claude sends notifications (waiting for input, etc.) = ready
		settings.hooks.Notification = settings.hooks.Notification || [];
		settings.hooks.Notification.push({
			hooks: [{
				type: 'command',
				command: 'node .claude/hooks/update-state.js ready'
			}]
		});

		// Write settings back
		writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

		// Add to .git/info/exclude
		this.updateGitExclude();
	}

	private updateGitExclude(): void {
		const gitExcludePath = join(process.cwd(), '.git', 'info', 'exclude');
		const entriesToAdd = [
			'.claude/settings.local.json',
			'.claude/hooks/update-state.js',
			'.claude-hydra/',
			'CLAUDE-HYDRA-PORT'
		];

		try {
			let currentExclude = '';
			if (existsSync(gitExcludePath)) {
				currentExclude = readFileSync(gitExcludePath, 'utf-8');
			}

			// Check and add each entry individually if not present
			for (const entry of entriesToAdd) {
				if (!currentExclude.includes(entry)) {
					appendFileSync(gitExcludePath, `\n${entry}`);
					currentExclude += `\n${entry}`;
				}
			}
		} catch (error) {
			// Silently ignore errors
		}
	}

	getBranchName(sessionId: string): string | undefined {
		return this.sessions.get(sessionId)?.branchName;
	}

	createSession(branchName: string, onData: (sessionId: string, data: string) => void, onExit: (sessionId: string) => void, baseUrl: string): string {
		const sessionId = uuidv4();

		// Create isolated git worktree session
		const sessionInfo = this.sessionManager.createSession(sessionId, branchName);

		// Setup Claude hooks
		this.setupClaudeHooks(sessionInfo.worktreePath, branchName);

		// Get the full path to claude executable
		const claudePath = this.getClaudePath();

		// Prepare environment with CLAUDE_HYDRA_BASEURL
		const env = {
			...process.env,
			CLAUDE_HYDRA_BASEURL: baseUrl
		} as { [key: string]: string };

		// Spawn claude directly with full path, using worktree as cwd
		const ptyProcess = pty.spawn(claudePath, ['--dangerously-skip-permissions'], {
			name: 'xterm-256color',
			cols: 80,
			rows: 30,
			cwd: sessionInfo.worktreePath,
			env
		});

		const session: TerminalSession = {
			id: sessionId,
			branchName,
			ptyProcess,
			onData: (data: string) => onData(sessionId, data),
			onExit: () => {
				this.sessions.delete(sessionId);
				onExit(sessionId);
				// Don't auto-destroy session - let frontend handle cleanup
				// Session will be destroyed via:
				// - merge flow (merge destroys session after commit/rebase)
				// - discard flow (tab removal sends 'destroy' message)
				// - WebSocket close (guaranteed cleanup for crashes/disconnects)
				// Clean up mergingSessions tracking if this was a merge operation
				if (this.mergingSessions.has(sessionId)) {
					this.mergingSessions.delete(sessionId);
				}
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

	destroy(sessionId: string, skipWorktreeCleanup: boolean = false): void {
		const session = this.sessions.get(sessionId);
		if (session) {
			// If skipWorktreeCleanup is true, mark this session as being merged
			// The onExit handler will skip cleanup for merging sessions
			if (skipWorktreeCleanup) {
				this.mergingSessions.add(sessionId);
			}
			session.ptyProcess.kill();
			this.sessions.delete(sessionId);

			// When NOT in merge flow, clean up the worktree/branch
			// This handles: WebSocket disconnect, explicit destroy message, discards
			if (!skipWorktreeCleanup) {
				// Add delay on Windows to ensure PTY process fully exits and file handles are released
				const cleanupDelay = process.platform === 'win32' ? 1000 : 100;
				setTimeout(() => {
					try {
						this.sessionManager.destroySession(sessionId);
					} catch (error) {
						console.error(`Failed to cleanup session ${sessionId}:`, error);
					}
				}, cleanupDelay);
			}
		}
	}

	destroyAll(): void {
		for (const [sessionId] of this.sessions) {
			this.destroy(sessionId);
		}
		// Clean up any remaining sessions
		this.sessionManager.destroyAllSessions();
	}
}
