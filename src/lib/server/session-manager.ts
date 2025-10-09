import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';

/**
 * Synchronous sleep function that works cross-platform without shell commands.
 * @param seconds - Number of seconds to sleep
 */
function sleepSync(seconds: number): void {
	const start = Date.now();
	const end = start + (seconds * 1000);
	while (Date.now() < end) {
		// Busy-wait
	}
}

/**
 * SessionManager manages isolated Claude Code sessions using git worktrees.
 *
 * Each terminal tab gets its own:
 * - Git branch (named by the user)
 * - Git worktree (in ~/.claude-hydra/<repo-name-hash>/<branch-name>)
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

		// Set up base directory for worktrees in user home directory
		// Format: ~/.claude-hydra/<repo-name>-<hash>
		const repoName = basename(this.repoRoot);
		const repoHash = createHash('md5').update(this.repoRoot).digest('hex').substring(0, 8);
		this.baseDir = join(homedir(), '.claude-hydra', `${repoName}-${repoHash}`);
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
	 * @param adoptExisting - If true, adopt an existing worktree instead of creating a new one
	 * @returns Session information including the worktree path to use as cwd
	 */
	createSession(sessionId: string, branchName: string, adoptExisting: boolean = false): SessionInfo {
		const worktreePath = join(this.baseDir, branchName);

		// If adopting existing worktree
		if (adoptExisting) {
			// Verify branch exists
			if (!this.branchExists(branchName)) {
				throw new Error(`Cannot adopt: Branch '${branchName}' does not exist`);
			}

			// Verify worktree path exists
			if (!existsSync(worktreePath)) {
				throw new Error(`Cannot adopt: Worktree directory '${branchName}' does not exist`);
			}

			const sessionInfo: SessionInfo = {
				sessionId,
				branchName,
				worktreePath
			};

			this.sessions.set(sessionId, sessionInfo);
			console.log(`Adopted existing session ${sessionId}: branch=${branchName}, path=${worktreePath}`);

			return sessionInfo;
		}

		// Normal flow: create new worktree and branch
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
	 * @throws Error if worktree cleanup fails
	 */
	destroySession(sessionId: string): void {
		const session = this.sessions.get(sessionId);
		if (!session) {
			console.warn(`Session ${sessionId} not found for cleanup`);
			return;
		}

		let worktreeRemoved = false;

		// Step 1: Try git worktree remove --force with retries
		const maxAttempts = process.platform === 'win32' ? 5 : 3;
		const retryDelay = process.platform === 'win32' ? 2 : 1;

		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			try {
				execSync(`git worktree remove "${session.worktreePath}" --force`, {
					cwd: this.repoRoot,
					stdio: 'pipe'
				});
				worktreeRemoved = true;
				console.log(`Removed worktree using git: ${session.worktreePath}`);
				break;
			} catch (error) {
				if (attempt < maxAttempts - 1) {
					console.warn(`git worktree remove attempt ${attempt + 1} failed, retrying...`);
					// Wait a bit for file handles to be released (longer on Windows)
					sleepSync(retryDelay);
				} else {
					console.warn(`git worktree remove failed after ${maxAttempts} attempts, attempting manual deletion: ${error}`);
				}
			}
		}

		// Step 2: If git removal failed, try manual deletion with retries
		if (!worktreeRemoved && existsSync(session.worktreePath)) {
			const manualAttempts = process.platform === 'win32' ? 5 : 3;
			const manualRetryDelay = process.platform === 'win32' ? 2 : 1;

			for (let attempt = 0; attempt < manualAttempts; attempt++) {
				try {
					rmSync(session.worktreePath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
					console.log(`Manually deleted worktree directory: ${session.worktreePath}`);

					// Step 3: Prune worktree records after manual deletion
					try {
						execSync('git worktree prune', {
							cwd: this.repoRoot,
							stdio: 'pipe'
						});
						console.log('Pruned worktree records');
						worktreeRemoved = true;
						break;
					} catch (pruneError) {
						console.error(`git worktree prune failed: ${pruneError}`);
					}
				} catch (deleteError) {
					if (attempt < manualAttempts - 1) {
						console.warn(`Manual deletion attempt ${attempt + 1} failed, retrying...`);
						// Wait for file handles to be released
						sleepSync(manualRetryDelay);
					} else {
						console.error(`Manual deletion failed after ${manualAttempts} attempts: ${deleteError}`);
					}
				}
			}
		}

		// If worktree cleanup failed, throw error (don't delete branch)
		if (!worktreeRemoved) {
			throw new Error(`Failed to remove worktree at ${session.worktreePath}. Please close any programs accessing this directory and try again.`);
		}

		// Only delete branch if worktree was successfully removed
		try {
			execSync(`git branch -D "${session.branchName}"`, {
				cwd: this.repoRoot,
				stdio: 'pipe'
			});

			this.sessions.delete(sessionId);
			console.log(`Destroyed session ${sessionId}: branch=${session.branchName}`);
		} catch (error) {
			console.error(`Error deleting branch ${session.branchName}:`, error);
			throw new Error(`Worktree removed but failed to delete branch ${session.branchName}`);
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

	/**
	 * Gets a session ID by branch name.
	 * @param branchName - Branch name to look up
	 * @returns Session ID if found, undefined otherwise
	 */
	getSessionIdByBranch(branchName: string): string | undefined {
		for (const [sessionId, session] of this.sessions) {
			if (session.branchName === branchName) {
				return sessionId;
			}
		}
		return undefined;
	}

	/**
	 * Gets all active sessions.
	 * @returns Map of session IDs to session info
	 */
	getAllSessions(): Map<string, SessionInfo> {
		return new Map(this.sessions);
	}

	/**
	 * Discovers existing claude-hydra worktrees from previous sessions.
	 * @returns Array of worktrees in .claude-hydra/ that match the pattern
	 */
	discoverExistingWorktrees(): Array<{ branchName: string; worktreePath: string }> {
		try {
			// Get all worktrees in porcelain format
			const output = execSync('git worktree list --porcelain', {
				cwd: this.repoRoot,
				encoding: 'utf8',
				stdio: 'pipe'
			});

			const worktrees: Array<{ branchName: string; worktreePath: string }> = [];
			const lines = output.split('\n');

			let currentWorktree: { path?: string; branch?: string } = {};

			for (const line of lines) {
				if (line.startsWith('worktree ')) {
					// Start of new worktree entry
					if (currentWorktree.path && currentWorktree.branch) {
						// Process previous worktree
						this.processWorktree(currentWorktree, worktrees);
					}
					currentWorktree = { path: line.substring('worktree '.length).trim() };
				} else if (line.startsWith('branch ')) {
					// Branch reference
					const branchRef = line.substring('branch '.length).trim();
					// Extract branch name from refs/heads/branch-name
					if (branchRef.startsWith('refs/heads/')) {
						currentWorktree.branch = branchRef.substring('refs/heads/'.length);
					}
				}
			}

			// Process last worktree
			if (currentWorktree.path && currentWorktree.branch) {
				this.processWorktree(currentWorktree, worktrees);
			}

			console.log(`Discovered ${worktrees.length} existing claude-hydra worktree(s)`);
			return worktrees;
		} catch (error: any) {
			console.error('Failed to discover existing worktrees:', error);
			return [];
		}
	}

	private processWorktree(
		worktree: { path?: string; branch?: string },
		results: Array<{ branchName: string; worktreePath: string }>
	): void {
		if (!worktree.path || !worktree.branch) return;

		// Normalize paths to use forward slashes for consistent comparison
		const normalizedWorktreePath = worktree.path.replace(/\\/g, '/');
		const normalizedBaseDir = this.baseDir.replace(/\\/g, '/');

		// Check if this worktree is in our claude-hydra directory
		if (!normalizedWorktreePath.startsWith(normalizedBaseDir)) return;

		// Extract expected branch name from path: ~/.claude-hydra/<repo-name-hash>/<branch-name>
		const relativePath = normalizedWorktreePath.substring(normalizedBaseDir.length + 1);
		const expectedBranchName = relativePath.split('/')[0];

		// Verify branch name matches
		if (worktree.branch === expectedBranchName) {
			results.push({
				branchName: worktree.branch,
				worktreePath: worktree.path  // Use original path for consistency
			});
			console.log(`  Found: ${worktree.branch} at ${worktree.path}`);
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
	 * @returns Status object with uncommitted changes, unmerged commits, and behind base flags
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

			// Check if branch is behind base (base has commits not in branch)
			const behindOutput = execSync(`git rev-list --count HEAD..${this.baseBranch}`, {
				cwd: session.worktreePath,
				encoding: 'utf8',
				stdio: 'pipe'
			}).trim();
			const isBehindBase = parseInt(behindOutput) > 0;

			return {
				hasUncommittedChanges,
				hasUnmergedCommits,
				isBehindBase
			};
		} catch (error: any) {
			console.error(`Error getting git status for session ${sessionId}:`, error);
			throw new Error(`Failed to get git status: ${error.message}`);
		}
	}

	/**
	 * Commits all changes in a session's worktree.
	 * @param sessionId - Session identifier
	 * @param message - Commit message
	 * @returns Success status and optional error message
	 */
	commit(sessionId: string, message: string): { success: boolean; error?: string } {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return { success: false, error: `Session ${sessionId} not found` };
		}

		try {
			// Stage all changes
			execSync('git add -A', {
				cwd: session.worktreePath,
				stdio: 'pipe'
			});

			// Commit with message
			execSync(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
				cwd: session.worktreePath,
				stdio: 'pipe'
			});

			console.log(`Committed changes in session ${sessionId}: ${message}`);
			return { success: true };
		} catch (error: any) {
			const errorMessage = error.message || String(error);
			console.error(`Commit failed for session ${sessionId}:`, errorMessage);
			return { success: false, error: errorMessage };
		}
	}

	/**
	 * Discards all uncommitted changes in a session's worktree.
	 * @param sessionId - Session identifier
	 * @returns Success status and optional error message
	 */
	discardChanges(sessionId: string): { success: boolean; error?: string } {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return { success: false, error: `Session ${sessionId} not found` };
		}

		try {
			// Reset to HEAD and clean untracked files
			execSync('git reset --hard HEAD', {
				cwd: session.worktreePath,
				stdio: 'pipe'
			});

			execSync('git clean -fd', {
				cwd: session.worktreePath,
				stdio: 'pipe'
			});

			console.log(`Discarded changes in session ${sessionId}`);
			return { success: true };
		} catch (error: any) {
			const errorMessage = error.message || String(error);
			console.error(`Discard changes failed for session ${sessionId}:`, errorMessage);
			return { success: false, error: errorMessage };
		}
	}

	/**
	 * Resets a session's branch to the base branch (undo unmerged commits).
	 * @param sessionId - Session identifier
	 * @returns Success status and optional error message
	 */
	resetToBase(sessionId: string): { success: boolean; error?: string } {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return { success: false, error: `Session ${sessionId} not found` };
		}

		try {
			// Reset to base branch
			execSync(`git reset --hard ${this.baseBranch}`, {
				cwd: session.worktreePath,
				stdio: 'pipe'
			});

			console.log(`Reset session ${sessionId} to base branch ${this.baseBranch}`);
			return { success: true };
		} catch (error: any) {
			const errorMessage = error.message || String(error);
			console.error(`Reset to base failed for session ${sessionId}:`, errorMessage);
			return { success: false, error: errorMessage };
		}
	}

	/**
	 * Rebases a session's branch onto the base branch.
	 * @param sessionId - Session identifier
	 * @returns Success status and optional error message
	 */
	rebase(sessionId: string): { success: boolean; error?: string } {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return { success: false, error: `Session ${sessionId} not found` };
		}

		try {
			// Rebase onto base branch
			execSync(`git rebase ${this.baseBranch}`, {
				cwd: session.worktreePath,
				encoding: 'utf8',
				stdio: 'pipe'
			});

			console.log(`Rebased session ${sessionId} onto ${this.baseBranch}`);
			return { success: true };
		} catch (error: any) {
			// Rebase failed - abort it
			try {
				execSync('git rebase --abort', {
					cwd: session.worktreePath,
					stdio: 'pipe'
				});
			} catch (abortError) {
				console.error(`Failed to abort rebase for session ${sessionId}:`, abortError);
			}

			const errorMessage = error.message || String(error);
			console.error(`Rebase failed for session ${sessionId}:`, errorMessage);
			return { success: false, error: 'Rebase failed. Please resolve conflicts manually.' };
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

			// Keep the session alive - no cleanup needed
			// Tab remains open and worktree/branch are preserved

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
	isBehindBase: boolean;
}

export interface MergeResult {
	success: boolean;
	error?: string;
}
