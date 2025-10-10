import * as pty from '@homebridge/node-pty-prebuilt-multiarch';
import { v4 as uuidv4 } from 'uuid';
import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { SessionManager } from '$lib/server/session-manager';
import updateStateTemplate from '../../template/update-state.js?raw';
import { sendReadyStateWithGitStatus } from './websocket-manager';

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
			const paths = output.trim().split('\n');

			// On Windows, prefer .cmd or .exe versions for node-pty compatibility
			if (process.platform === 'win32') {
				const cmdPath = paths.find(p => p.endsWith('.cmd') || p.endsWith('.exe'));
				if (cmdPath) {
					this.claudePath = cmdPath;
					return this.claudePath;
				}
			}

			// Fallback to first match
			this.claudePath = paths[0];
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
		const repoDir = process.env.CLAUDE_HYDRA_REPO_DIR || process.cwd();
		const gitExcludePath = join(repoDir, '.git', 'info', 'exclude');

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

		// Build hook command with absolute path to the script
		// Use forward slashes for cross-platform compatibility (Node.js handles them on Windows too)
		const hookScriptAbsPath = hookScriptPath.replace(/\\/g, '/');
		const runningCommand = `node "${hookScriptAbsPath}" running`;
		const readyCommand = `node "${hookScriptAbsPath}" ready`;

		// Use new hooks format with matchers
		// UserPromptSubmit fires when user submits a prompt = Claude STARTS processing = running
		settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit || [];
		settings.hooks.UserPromptSubmit.push({
			hooks: [{
				type: 'command',
				command: runningCommand
			}]
		});

		// PreToolUse fires before Claude uses a tool = running
		settings.hooks.PreToolUse = settings.hooks.PreToolUse || [];
		settings.hooks.PreToolUse.push({
			hooks: [{
				type: 'command',
				command: runningCommand
			}]
		});

		// Stop fires when Claude finishes processing = ready for input
		settings.hooks.Stop = settings.hooks.Stop || [];
		settings.hooks.Stop.push({
			hooks: [{
				type: 'command',
				command: readyCommand
			}]
		});

		// Notification fires when Claude sends notifications (waiting for input, etc.) = ready
		settings.hooks.Notification = settings.hooks.Notification || [];
		settings.hooks.Notification.push({
			hooks: [{
				type: 'command',
				command: readyCommand
			}]
		});

		// Write settings back
		writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

		// Add to .git/info/exclude
		this.updateGitExclude();
	}

	private updateGitExclude(): void {
		const repoDir = process.env.CLAUDE_HYDRA_REPO_DIR || process.cwd();
		const gitExcludePath = join(repoDir, '.git', 'info', 'exclude');
		const entriesToAdd = [
			'.claude/settings.local.json',
			'.claude/hooks/update-state.js',
			'.claude-hydra.port'
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

	private executeAutoInitScript(worktreePath: string, onData: (data: string) => void): void {
		const mainRepoRoot = process.env.CLAUDE_HYDRA_REPO_DIR || process.cwd();
		const isWindows = process.platform === 'win32';

		// Define script priorities based on platform
		const scriptNames = isWindows
			? ['.claude-hydra.autoinit.ps1', '.claude-hydra.autoinit.cmd', '.claude-hydra.autoinit.sh']
			: ['.claude-hydra.autoinit.sh'];

		// Find first existing script
		let scriptPath: string | null = null;
		let scriptType: 'ps1' | 'cmd' | 'sh' | null = null;

		for (const scriptName of scriptNames) {
			const candidatePath = join(mainRepoRoot, scriptName);
			if (existsSync(candidatePath)) {
				scriptPath = candidatePath;
				scriptType = scriptName.endsWith('.ps1') ? 'ps1' : scriptName.endsWith('.cmd') ? 'cmd' : 'sh';
				break;
			}
		}

		// If no script found, return silently
		if (!scriptPath || !scriptType) {
			return;
		}

		// Execute the script with worktree as cwd
		try {
			let command: string;
			if (scriptType === 'ps1') {
				command = `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`;
			} else if (scriptType === 'cmd') {
				command = `cmd /c "${scriptPath}"`;
			} else {
				command = `bash "${scriptPath}"`;
			}

			console.log(`Executing auto-init script: ${scriptPath} (cwd: ${worktreePath})`);
			onData(`\r\n[Running auto-init script: ${scriptPath}]\r\n`);

			const output = execSync(command, {
				cwd: worktreePath,
				encoding: 'utf8',
				stdio: 'pipe'
			});

			// Send output to terminal (convert LF to CRLF for xterm.js)
			if (output) {
				onData(output.replace(/\r?\n/g, '\r\n'));
			}

			onData(`\r\n[Auto-init script completed]\r\n\r\n`);
			console.log(`Auto-init script completed successfully`);
		} catch (error: any) {
			console.error(`Auto-init script failed:`, error);
			const errorMessage = error.message || String(error);
			const errorOutput = error.stdout || '';
			const errorStderr = error.stderr || '';

			// Send error output to terminal (convert LF to CRLF for xterm.js)
			if (errorOutput) {
				onData(errorOutput.replace(/\r?\n/g, '\r\n'));
			}
			if (errorStderr) {
				onData(errorStderr.replace(/\r?\n/g, '\r\n'));
			}
			onData(`\r\n[Auto-init script failed: ${errorMessage}]\r\n\r\n`);

			// Don't throw - continue with session creation even if script fails
		}
	}

	getBranchName(sessionId: string): string | undefined {
		return this.sessions.get(sessionId)?.branchName;
	}

	async createSession(branchName: string, onData: (sessionId: string, data: string) => void, onExit: (sessionId: string) => void, baseUrl: string, adoptExisting: boolean = false): Promise<string> {
		const sessionId = uuidv4();

		// Create isolated git worktree session
		const sessionInfo = await this.sessionManager.createSession(sessionId, branchName, adoptExisting);

		// Setup Claude hooks
		this.setupClaudeHooks(sessionInfo.worktreePath, branchName);

		// Execute auto-init script only when creating new worktree (not when adopting existing)
		if (!adoptExisting) {
			this.executeAutoInitScript(sessionInfo.worktreePath, (data) => onData(sessionId, data));
		}

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
			// Detect bare ESC key press (not escape sequences like \x1b[O)
			// Bare ESC = exactly '\x1b', not followed by control sequence characters
			if (data === '\x1b') {
				sendReadyStateWithGitStatus(session.branchName);
			}

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
