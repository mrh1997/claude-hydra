import { execSync } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';

/**
 * SessionManager manages isolated Claude Code sessions using git worktrees.
 *
 * Each terminal tab gets its own:
 * - Git branch (named by the user)
 * - Git worktree (in <repo>/.claude-hydra/<branch-name>)
 * - Isolated working directory for Claude to operate in
 *
 * This ensures multiple Claude sessions can work independently without conflicts.
 */
export class SessionManager {
	private baseDir: string;
	private repoRoot: string;
	private baseBranch: string;
	private sessions = new Map<string, SessionInfo>();

	constructor() {
		// Verify we're in a git repository
		if (!this.isGitRepository()) {
			throw new Error('Not a git repository. Server must be started from within a git repository.');
		}

		// Get repository root
		this.repoRoot = this.getRepoRoot();

		// Get base branch (the branch we started from)
		this.baseBranch = this.getBaseBranch();

		// Set up base directory for worktrees (project-local)
		this.baseDir = join(this.repoRoot, '.claude-hydra');
		if (!existsSync(this.baseDir)) {
			mkdirSync(this.baseDir, { recursive: true });
		}

		console.log(`SessionManager initialized:`);
		console.log(`  Repository: ${this.repoRoot}`);
		console.log(`  Base branch: ${this.baseBranch}`);
		console.log(`  Base directory: ${this.baseDir}`);
	}

	/**
	 * Creates a new isolated session with its own git worktree and branch.
	 * @param sessionId - Unique identifier for this session
	 * @param branchName - User-provided branch name
	 * @returns Session information including the worktree path to use as cwd
	 */
	createSession(sessionId: string, branchName: string): SessionInfo {
		const worktreePath = join(this.baseDir, branchName);

		// Check if branch already exists
		if (this.branchExists(branchName)) {
			throw new Error(`Branch '${branchName}' already exists`);
		}

		// Check if worktree path already exists
		if (existsSync(worktreePath)) {
			throw new Error(`Worktree directory '${branchName}' already exists`);
		}

		try {
			// Create branch and worktree
			// Note: git worktree outputs to stderr even on success, so we ignore stderr
			const result = execSync(`git worktree add "${worktreePath}" -b "${branchName}"`, {
				cwd: this.repoRoot,
				encoding: 'utf8',
				stdio: ['pipe', 'pipe', 'ignore']
			});

			const sessionInfo: SessionInfo = {
				sessionId,
				branchName,
				worktreePath
			};

			this.sessions.set(sessionId, sessionInfo);
			console.log(`Created session ${sessionId}: branch=${branchName}, path=${worktreePath}`);

			return sessionInfo;
		} catch (error: any) {
			const errorMessage = error.message || String(error);
			const stdout = error.stdout || '';
			console.error(`Git worktree command failed:`);
			console.error(`  Command: git worktree add "${worktreePath}" -b "${branchName}"`);
			console.error(`  CWD: ${this.repoRoot}`);
			console.error(`  Error: ${errorMessage}`);
			if (stdout) {
				console.error(`  Stdout: ${stdout}`);
			}
			throw new Error(`Failed to create worktree: ${errorMessage}`);
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

	private getBaseBranch(): string {
		try {
			return execSync('git branch --show-current', {
				cwd: this.repoRoot,
				encoding: 'utf8',
				stdio: 'pipe'
			}).trim();
		} catch (error) {
			throw new Error('Failed to get current branch');
		}
	}

	private branchExists(branchName: string): boolean {
		try {
			execSync(`git rev-parse --verify "${branchName}"`, {
				cwd: this.repoRoot,
				stdio: 'pipe'
			});
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Gets the git status for a session's worktree.
	 * @param sessionId - Session identifier
	 * @returns Status object with uncommitted changes and unmerged commits flags
	 */
	getGitStatus(sessionId: string): GitStatus {
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw new Error(`Session ${sessionId} not found`);
		}

		try {
			// Check for uncommitted changes (working tree + staged)
			const statusOutput = execSync('git status --porcelain', {
				cwd: session.worktreePath,
				encoding: 'utf8',
				stdio: 'pipe'
			}).trim();
			const hasUncommittedChanges = statusOutput.length > 0;

			// Check for unmerged commits (commits in branch that aren't in base)
			const logOutput = execSync(`git log ${this.baseBranch}..${session.branchName} --oneline`, {
				cwd: session.worktreePath,
				encoding: 'utf8',
				stdio: 'pipe'
			}).trim();
			const hasUnmergedCommits = logOutput.length > 0;

			return {
				hasUncommittedChanges,
				hasUnmergedCommits
			};
		} catch (error: any) {
			console.error(`Error getting git status for session ${sessionId}:`, error);
			throw new Error(`Failed to get git status: ${error.message}`);
		}
	}

	/**
	 * Rebases a session's branch onto the base branch, then fast-forwards the base branch.
	 * @param sessionId - Session identifier
	 * @param commitMessage - Optional commit message. If provided, uncommitted changes will be committed first.
	 * @returns Merge result with success status and optional error message
	 */
	merge(sessionId: string, commitMessage?: string): MergeResult {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return { success: false, error: `Session ${sessionId} not found` };
		}

		try {
			// If commit message provided, commit uncommitted changes first
			if (commitMessage) {
				try {
					// Stage all changes
					execSync('git add -A', {
						cwd: session.worktreePath,
						stdio: 'pipe'
					});

					// Commit with message
					execSync(`git commit -m "${commitMessage.replace(/"/g, '\\"')}"`, {
						cwd: session.worktreePath,
						stdio: 'pipe'
					});

					console.log(`Committed changes in session ${sessionId}: ${commitMessage}`);
				} catch (error: any) {
					// If commit fails (e.g., nothing to commit), continue with rebase
					console.log(`Commit skipped for session ${sessionId}: ${error.message}`);
				}
			}

			// Rebase the session branch onto the base branch
			try {
				execSync(`git rebase "${this.baseBranch}"`, {
					cwd: session.worktreePath,
					encoding: 'utf8',
					stdio: 'pipe'
				});

				console.log(`Rebased session ${sessionId} (${session.branchName}) onto ${this.baseBranch}`);
			} catch (rebaseError: any) {
				// Rebase failed - abort it
				try {
					execSync('git rebase --abort', {
						cwd: session.worktreePath,
						stdio: 'pipe'
					});
				} catch (abortError) {
					console.error(`Failed to abort rebase for session ${sessionId}:`, abortError);
				}

				const errorMessage = rebaseError.message || String(rebaseError);
				console.error(`Rebase failed for session ${sessionId}:`, errorMessage);
				return { success: false, error: `Rebase failed. Please resolve before closing tab` };
			}

			// Switch to base branch in main repo
			execSync(`git checkout "${this.baseBranch}"`, {
				cwd: this.repoRoot,
				stdio: 'pipe'
			});

			// Fast-forward merge the session branch into base branch
			execSync(`git merge --ff-only "${session.branchName}"`, {
				cwd: this.repoRoot,
				encoding: 'utf8',
				stdio: 'pipe'
			});

			console.log(`Fast-forwarded ${this.baseBranch} to ${session.branchName}`);

			// Clean up the session (worktree and branch)
			this.destroySession(sessionId);

			return { success: true };
		} catch (error: any) {
			const errorMessage = error.message || String(error);
			console.error(`Merge failed for session ${sessionId}:`, errorMessage);
			return { success: false, error: errorMessage };
		}
	}
}

export interface SessionInfo {
	sessionId: string;
	branchName: string;
	worktreePath: string;
}

export interface GitStatus {
	hasUncommittedChanges: boolean;
	hasUnmergedCommits: boolean;
}

export interface MergeResult {
	success: boolean;
	error?: string;
}
