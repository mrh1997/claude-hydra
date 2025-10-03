import { execSync } from 'child_process';
import { existsSync, mkdirSync, readdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/**
 * SessionManager manages isolated Claude Code sessions using git worktrees.
 *
 * Each terminal tab gets its own:
 * - Git branch (named <parent-branch>-task<N>)
 * - Git worktree (in ~/.claude-hydra/task<N>)
 * - Isolated working directory for Claude to operate in
 *
 * This ensures multiple Claude sessions can work independently without conflicts.
 */
export class SessionManager {
	private baseDir: string;
	private currentBranch: string;
	private repoRoot: string;
	private nextTaskNumber: number = 1;
	private sessions = new Map<string, SessionInfo>();

	constructor() {
		// Verify we're in a git repository
		if (!this.isGitRepository()) {
			throw new Error('Not a git repository. Server must be started from within a git repository.');
		}

		// Get repository root and current branch
		this.repoRoot = this.getRepoRoot();
		this.currentBranch = this.getCurrentBranch();

		// Set up base directory for worktrees
		this.baseDir = join(homedir(), '.claude-hydra');
		if (!existsSync(this.baseDir)) {
			mkdirSync(this.baseDir, { recursive: true });
		}

		// Find next available task number
		this.nextTaskNumber = this.findNextTaskNumber();

		console.log(`SessionManager initialized:`);
		console.log(`  Repository: ${this.repoRoot}`);
		console.log(`  Current branch: ${this.currentBranch}`);
		console.log(`  Base directory: ${this.baseDir}`);
		console.log(`  Next task number: ${this.nextTaskNumber}`);
	}

	/**
	 * Creates a new isolated session with its own git worktree and branch.
	 * @param sessionId - Unique identifier for this session
	 * @returns Session information including the worktree path to use as cwd
	 */
	createSession(sessionId: string): SessionInfo {
		const taskNumber = this.nextTaskNumber++;
		const branchName = `${this.currentBranch}-task${taskNumber}`;
		const worktreePath = join(this.baseDir, `task${taskNumber}`);

		try {
			// Create branch and worktree
			execSync(`git worktree add "${worktreePath}" -b "${branchName}"`, {
				cwd: this.repoRoot,
				stdio: 'pipe'
			});

			const sessionInfo: SessionInfo = {
				sessionId,
				taskNumber,
				branchName,
				worktreePath
			};

			this.sessions.set(sessionId, sessionInfo);
			console.log(`Created session ${sessionId}: branch=${branchName}, path=${worktreePath}`);

			return sessionInfo;
		} catch (error) {
			// If worktree creation fails, restore task number and throw
			this.nextTaskNumber--;
			throw new Error(`Failed to create worktree: ${error}`);
		}
	}

	/**
	 * Destroys a session and cleans up its worktree and branch.
	 * @param sessionId - Session identifier to destroy
	 */
	destroySession(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (!session) {
			console.warn(`Session ${sessionId} not found for cleanup`);
			return;
		}

		try {
			// Remove worktree
			execSync(`git worktree remove "${session.worktreePath}" --force`, {
				cwd: this.repoRoot,
				stdio: 'pipe'
			});

			// Delete branch
			execSync(`git branch -D "${session.branchName}"`, {
				cwd: this.repoRoot,
				stdio: 'pipe'
			});

			this.sessions.delete(sessionId);
			console.log(`Destroyed session ${sessionId}: branch=${session.branchName}`);
		} catch (error) {
			console.error(`Error cleaning up session ${sessionId}:`, error);
		}
	}

	/**
	 * Cleans up all active sessions.
	 */
	destroyAllSessions(): void {
		for (const [sessionId] of this.sessions) {
			this.destroySession(sessionId);
		}
	}

	private isGitRepository(): boolean {
		try {
			execSync('git rev-parse --git-dir', { stdio: 'pipe' });
			return true;
		} catch {
			return false;
		}
	}

	private getRepoRoot(): string {
		try {
			return execSync('git rev-parse --show-toplevel', {
				encoding: 'utf8',
				stdio: 'pipe'
			}).trim();
		} catch (error) {
			throw new Error('Failed to get repository root');
		}
	}

	private getCurrentBranch(): string {
		try {
			return execSync('git branch --show-current', {
				encoding: 'utf8',
				stdio: 'pipe'
			}).trim();
		} catch (error) {
			throw new Error('Failed to get current branch name');
		}
	}

	private findNextTaskNumber(): number {
		if (!existsSync(this.baseDir)) {
			return 1;
		}

		const entries = readdirSync(this.baseDir);
		const taskNumbers = entries
			.filter(name => /^task\d+$/.test(name))
			.map(name => parseInt(name.replace('task', ''), 10))
			.filter(n => !isNaN(n));

		return taskNumbers.length > 0 ? Math.max(...taskNumbers) + 1 : 1;
	}
}

export interface SessionInfo {
	sessionId: string;
	taskNumber: number;
	branchName: string;
	worktreePath: string;
}
