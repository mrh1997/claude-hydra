import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync, readFileSync, copyFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, basename, dirname, relative, resolve } from 'path';
import { homedir } from 'os';
import { createHash } from 'crypto';
import { glob } from 'glob';

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
	private sessions: Map<string, SessionInfo>;

	constructor(repoPath: string) {
		// Persist sessions Map across HMR reloads
		if (globalThis.__sessionManagerSessions) {
			this.sessions = globalThis.__sessionManagerSessions;
			console.log(`Reusing existing sessions Map from HMR (${this.sessions.size} active sessions)`);
		} else {
			this.sessions = new Map<string, SessionInfo>();
			globalThis.__sessionManagerSessions = this.sessions;
		}

		// Verify we're in a git repository
		if (!this.isGitRepository(repoPath)) {
			throw new Error(`Not a git repository: ${repoPath}`);
		}

		// Get repository root
		this.repoRoot = this.getRepoRoot(repoPath);

		// Ensure repository has at least one commit and a valid base branch
		this.ensureValidBaseBranch();

		// Get base branch (the branch we started from)
		this.baseBranch = this.getBaseBranch();

		// Set up base directory for worktrees in user home directory
		// Format: ~/.claude-hydra/<repo-name>-<hash>
		const repoName = basename(this.repoRoot);
		const normalizedPath = this.normalizePathForHash(this.repoRoot);
		const repoHash = createHash('md5').update(normalizedPath).digest('hex').substring(0, 8);
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
	 * Normalizes a repository path for hash calculation.
	 * - Resolves . and .. and symbolic links
	 * - Converts to uppercase on Windows for case-insensitive filesystem consistency
	 * - Keeps native path separators
	 * @param repoPath - The repository path to normalize
	 * @returns Normalized path suitable for hash calculation
	 */
	private normalizePathForHash(repoPath: string): string {
		// Resolve . and .. and symlinks
		const resolved = resolve(repoPath);
		// Uppercase on Windows for case-insensitive filesystem consistency
		return process.platform === 'win32' ? resolved.toUpperCase() : resolved;
	}

	/**
	 * Creates a new isolated session with its own git worktree and branch.
	 * @param sessionId - Unique identifier for this session
	 * @param branchName - User-provided branch name
	 * @param adoptExisting - If true, adopt an existing worktree instead of creating a new one
	 * @param baseBranchName - The branch to derive from (defaults to repository's base branch)
	 * @returns Session information including the worktree path to use as cwd
	 */
	async createSession(sessionId: string, branchName: string, adoptExisting: boolean = false, baseBranchName?: string): Promise<SessionInfo> {
		const worktreePath = join(this.baseDir, branchName);

		// Use provided baseBranchName or default to repository's base branch
		const derivedFrom = baseBranchName || this.baseBranch;

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

			// Try to read base branch from git config first
			let actualBaseBranch = this.readBaseBranchConfig(branchName, worktreePath);

			// If not in git config, use provided baseBranchName or detect default
			if (!actualBaseBranch) {
				actualBaseBranch = baseBranchName || this.detectDefaultBaseBranch();
				// Store it for future use
				this.writeBaseBranchConfig(branchName, actualBaseBranch, worktreePath);
			}

			const sessionInfo: SessionInfo = {
				sessionId,
				branchName,
				worktreePath,
				baseBranchName: actualBaseBranch,
				baseBranchCommitId: null
			};

			this.sessions.set(sessionId, sessionInfo);

			// Initialize base branch commit ID
			sessionInfo.baseBranchCommitId = this.getBaseBranchCommitId(sessionId);

			console.log(`Adopted existing session ${sessionId}: branch=${branchName}, path=${worktreePath}, baseBranch=${actualBaseBranch}`);

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
			// Create branch and worktree from base branch
			// Note: git worktree outputs to stderr even on success, so we ignore stderr
			const result = execSync(`git worktree add "${worktreePath}" -b "${branchName}" "${derivedFrom}"`, {
				cwd: this.repoRoot,
				encoding: 'utf8',
				stdio: ['pipe', 'pipe', 'ignore']
			});

			const sessionInfo: SessionInfo = {
				sessionId,
				branchName,
				worktreePath,
				baseBranchName: derivedFrom,
				baseBranchCommitId: null
			};

			// Store base branch in git config for persistence
			this.writeBaseBranchConfig(branchName, derivedFrom, worktreePath);

			this.sessions.set(sessionId, sessionInfo);

			// Initialize base branch commit ID
			sessionInfo.baseBranchCommitId = this.getBaseBranchCommitId(sessionId);

			console.log(`Created session ${sessionId}: branch=${branchName}, path=${worktreePath}, baseBranch=${derivedFrom}`);

			// Sync local files to worktree
			await this.syncLocalFilesToWorktree(worktreePath);

			return sessionInfo;
		} catch (error: any) {
			const errorMessage = error.message || String(error);
			const stdout = error.stdout || '';
			console.error(`Git worktree command failed:`);
			console.error(`  Command: git worktree add "${worktreePath}" -b "${branchName}" "${derivedFrom}"`);
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
		console.log(`[session-manager.destroySession] Starting cleanup for sessionId=${sessionId}`);

		const session = this.sessions.get(sessionId);
		if (!session) {
			console.warn(`[session-manager.destroySession] Session ${sessionId} not found for cleanup`);
			return;
		}

		console.log(`[session-manager.destroySession] Session details: branchName=${session.branchName}, worktreePath=${session.worktreePath}`);

		let worktreeRemoved = false;

		// Step 1: Try git worktree remove --force (single attempt, processes already exited)
		try {
			console.log(`[session-manager.destroySession] Attempting: git worktree remove "${session.worktreePath}" --force`);
			execSync(`git worktree remove "${session.worktreePath}" --force`, {
				cwd: this.repoRoot,
				stdio: 'pipe'
			});
			worktreeRemoved = true;
			console.log(`[session-manager.destroySession] SUCCESS: Removed worktree using git: ${session.worktreePath}`);
		} catch (error) {
			console.warn(`[session-manager.destroySession] git worktree remove failed, attempting manual deletion. Error:`, error);
		}

		// Step 2: If git removal failed, try manual deletion
		if (!worktreeRemoved && existsSync(session.worktreePath)) {
			console.log(`[session-manager.destroySession] Git worktree remove failed, attempting manual deletion`);
			try {
				console.log(`[session-manager.destroySession] Manual deletion: rmSync("${session.worktreePath}")`);
				rmSync(session.worktreePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
				console.log(`[session-manager.destroySession] SUCCESS: Manually deleted worktree directory: ${session.worktreePath}`);

				// Step 3: Prune worktree records after manual deletion
				try {
					console.log(`[session-manager.destroySession] Running git worktree prune`);
					execSync('git worktree prune', {
						cwd: this.repoRoot,
						stdio: 'pipe'
					});
					console.log('[session-manager.destroySession] SUCCESS: Pruned worktree records');
					worktreeRemoved = true;
				} catch (pruneError) {
					console.error(`[session-manager.destroySession] git worktree prune failed:`, pruneError);
					// Still consider worktree removed if manual deletion succeeded
					worktreeRemoved = true;
				}
			} catch (deleteError) {
				console.error(`[session-manager.destroySession] FAILED: Manual deletion failed:`, deleteError);
			}
		}

		// If worktree cleanup failed, throw error (don't delete branch)
		if (!worktreeRemoved) {
			console.error(`[session-manager.destroySession] FATAL: Failed to remove worktree at ${session.worktreePath}`);
			throw new Error(`Failed to remove worktree at ${session.worktreePath}. Please close any programs accessing this directory and try again.`);
		}

		// Only delete branch if worktree was successfully removed
		console.log(`[session-manager.destroySession] Worktree removed successfully, now deleting branch: ${session.branchName}`);
		try {
			console.log(`[session-manager.destroySession] Executing: git branch -D "${session.branchName}"`);
			execSync(`git branch -D "${session.branchName}"`, {
				cwd: this.repoRoot,
				stdio: 'pipe'
			});

			this.sessions.delete(sessionId);
			console.log(`[session-manager.destroySession] SUCCESS: Destroyed session ${sessionId}: branch=${session.branchName}`);
		} catch (error) {
			console.error(`[session-manager.destroySession] FAILED: Error deleting branch ${session.branchName}:`, error);
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
		console.log(`[getSessionIdByBranch] Looking up sessionId for branch="${branchName}"`);
		console.log(`[getSessionIdByBranch] Active sessions count: ${this.sessions.size}`);
		for (const [sessionId, session] of this.sessions) {
			console.log(`[getSessionIdByBranch] Checking session: sessionId="${sessionId}", branchName="${session.branchName}"`);
			if (session.branchName === branchName) {
				console.log(`[getSessionIdByBranch] Found matching sessionId: ${sessionId}`);
				return sessionId;
			}
		}
		console.log(`[getSessionIdByBranch] No matching sessionId found for branch="${branchName}"`);
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

	/**
	 * Reads the .claude-hydra.localfiles file and returns list of glob patterns.
	 * Each line in the file is a glob pattern for files to sync.
	 * Always includes **\/CLAUDE.local.md and **\/.claude/commands/** patterns.
	 * @param fromPath - Optional path to read config from (defaults to repo root)
	 */
	private readLocalFilesConfig(fromPath?: string): string[] {
		const patterns: string[] = [
			'**/CLAUDE.local.md',        // Always include CLAUDE.local.md files
			'**/.claude/commands/**'      // Always include .claude/commands files
		];

		const basePath = fromPath || this.repoRoot;
		const configPath = join(basePath, '.claude-hydra.localfiles');
		if (!existsSync(configPath)) {
			return patterns;
		}

		try {
			const content = readFileSync(configPath, 'utf-8');
			const configPatterns = content
				.split('\n')
				.map(line => line.trim())
				.filter(line => line && !line.startsWith('#')); // Filter empty lines and comments

			patterns.push(...configPatterns);
		} catch (error) {
			console.error('Failed to read .claude-hydra.localfiles:', error);
		}

		return patterns;
	}

	/**
	 * Copies files matching patterns from source to destination.
	 * @param patterns - Glob patterns to match
	 * @param fromDir - Source directory
	 * @param toDir - Destination directory
	 */
	private async copyLocalFiles(patterns: string[], fromDir: string, toDir: string): Promise<void> {
		for (const pattern of patterns) {
			try {
				// Use glob to find matching files
				const matches = await glob(pattern, {
					cwd: fromDir,
					dot: true,
					nodir: false
				});

				for (const match of matches) {
					const sourcePath = join(fromDir, match);
					const destPath = join(toDir, match);

					// Skip if source doesn't exist
					if (!existsSync(sourcePath)) continue;

					// Create destination directory if needed
					const destDir = dirname(destPath);
					if (!existsSync(destDir)) {
						mkdirSync(destDir, { recursive: true });
					}

					// Copy file
					try {
						copyFileSync(sourcePath, destPath);
						console.log(`  Copied: ${match}`);
					} catch (copyError) {
						console.error(`  Failed to copy ${match}:`, copyError);
					}
				}
			} catch (error) {
				console.error(`  Failed to process pattern '${pattern}':`, error);
			}
		}
	}

	/**
	 * Syncs local files from main repo to worktree (on branch creation/rebase).
	 */
	private async syncLocalFilesToWorktree(worktreePath: string): Promise<void> {
		const patterns = this.readLocalFilesConfig();
		if (patterns.length === 0) return;

		console.log(`Syncing local files to worktree...`);
		await this.copyLocalFiles(patterns, this.repoRoot, worktreePath);
	}

	/**
	 * Syncs local files from worktree back to main repo (on merge).
	 * Uses the .claude-hydra.localfiles from the worktree, not the main repo.
	 */
	private async syncLocalFilesFromWorktree(worktreePath: string): Promise<void> {
		// Read config from worktree, not main repo
		const patterns = this.readLocalFilesConfig(worktreePath);
		if (patterns.length === 0) return;

		console.log(`Syncing local files from worktree back to main repo...`);
		await this.copyLocalFiles(patterns, worktreePath, this.repoRoot);
	}

	private ensureValidBaseBranch(): void {
		try {
			// Check if repository has any commits
			try {
				execSync('git rev-parse HEAD', {
					cwd: this.repoRoot,
					stdio: 'pipe'
				});
				// Repository has commits, check if we're on a branch
				try {
					const branch = execSync('git branch --show-current', {
						cwd: this.repoRoot,
						encoding: 'utf8',
						stdio: 'pipe'
					}).trim();

					// If empty string, we're in detached HEAD state
					if (!branch) {
						console.log('Detached HEAD detected, switching to "main" branch...');
						if (!this.branchExists('main')) {
							execSync('git checkout -b main', {
								cwd: this.repoRoot,
								stdio: 'pipe'
							});
						} else {
							execSync('git checkout main', {
								cwd: this.repoRoot,
								stdio: 'pipe'
							});
						}
					}
					// Otherwise we're on a branch already, keep using it
				} catch (error) {
					// Error getting branch, switch to main
					console.log('Could not determine branch, switching to "main" branch...');
					if (!this.branchExists('main')) {
						execSync('git checkout -b main', {
							cwd: this.repoRoot,
							stdio: 'pipe'
						});
					} else {
						execSync('git checkout main', {
							cwd: this.repoRoot,
							stdio: 'pipe'
						});
					}
				}
			} catch (error) {
				// No commits exist, create initial commit and main branch
				console.log('No commits found, creating initial commit and "main" branch...');
				execSync('git commit --allow-empty -m "Initial commit"', {
					cwd: this.repoRoot,
					stdio: 'pipe'
				});
				// Try to rename current branch to main, or create main branch
				try {
					execSync('git branch -M main', {
						cwd: this.repoRoot,
						stdio: 'pipe'
					});
				} catch (renameError) {
					// If rename fails, try checkout -b
					execSync('git checkout -b main', {
						cwd: this.repoRoot,
						stdio: 'pipe'
					});
				}
			}
		} catch (error) {
			console.error('Failed to ensure valid base branch:', error);
			throw new Error('Failed to initialize repository with valid base branch');
		}
	}

	private isGitRepository(cwd: string): boolean {
		try {
			execSync('git rev-parse --git-dir', { cwd, stdio: 'pipe' });
			return true;
		} catch {
			return false;
		}
	}

	private getRepoRoot(cwd: string): string {
		try {
			return execSync('git rev-parse --show-toplevel', {
				cwd,
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
	 * Detects the default base branch for the repository.
	 * Checks for "main" first, then "master", then falls back to current branch.
	 */
	private detectDefaultBaseBranch(): string {
		try {
			// Try to find remote HEAD reference (most reliable)
			const remoteHead = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
				cwd: this.repoRoot,
				encoding: 'utf8',
				stdio: 'pipe'
			}).trim();

			// Extract branch name from "refs/remotes/origin/main"
			const match = remoteHead.match(/refs\/remotes\/origin\/(.+)/);
			if (match) {
				return match[1];
			}
		} catch (error) {
			// Remote HEAD not set or no remote, continue to local checks
		}

		// Check if "main" branch exists locally
		if (this.branchExists('main')) {
			return 'main';
		}

		// Check if "master" branch exists locally
		if (this.branchExists('master')) {
			return 'master';
		}

		// Fall back to current branch
		return this.baseBranch;
	}

	/**
	 * Writes the base branch to git config for a specific branch.
	 */
	private writeBaseBranchConfig(branchName: string, baseBranchName: string, worktreePath: string): void {
		try {
			// Ensure worktree directory exists
			if (!existsSync(worktreePath)) {
				console.error(`[writeBaseBranchConfig] Worktree path does not exist: ${worktreePath}`);
				return;
			}

			console.log(`[writeBaseBranchConfig] Writing config: branch.${branchName}.base = ${baseBranchName}`);
			console.log(`[writeBaseBranchConfig] CWD: ${worktreePath}`);

			// Write the config (quote the key for safety)
			execSync(`git config "branch.${branchName}.base" "${baseBranchName}"`, {
				cwd: worktreePath,
				encoding: 'utf8',
				stdio: ['pipe', 'pipe', 'pipe']
			});

			// Verify it was written
			const verify = execSync(`git config --get "branch.${branchName}.base"`, {
				cwd: worktreePath,
				encoding: 'utf8',
				stdio: ['pipe', 'pipe', 'pipe']
			}).trim();

			if (verify === baseBranchName) {
				console.log(`[writeBaseBranchConfig] SUCCESS: Stored and verified branch.${branchName}.base = ${baseBranchName}`);
			} else {
				console.error(`[writeBaseBranchConfig] VERIFICATION FAILED: Expected "${baseBranchName}", got "${verify}"`);
			}
		} catch (error: any) {
			console.error(`[writeBaseBranchConfig] FAILED for ${branchName}:`);
			console.error(`  Message: ${error.message}`);
			if (error.stderr) console.error(`  Stderr: ${error.stderr.toString()}`);
			if (error.stdout) console.error(`  Stdout: ${error.stdout.toString()}`);
			console.error(`  CWD: ${worktreePath}`);
			// Don't throw - this is not critical
		}
	}

	/**
	 * Reads the base branch from git config for a specific branch.
	 * Returns null if not set.
	 */
	private readBaseBranchConfig(branchName: string, worktreePath: string): string | null {
		try {
			const result = execSync(`git config --get "branch.${branchName}.base"`, {
				cwd: worktreePath,
				encoding: 'utf8',
				stdio: ['pipe', 'pipe', 'pipe']
			}).trim();

			if (result) {
				console.log(`[readBaseBranchConfig] Found: branch.${branchName}.base = ${result}`);
				return result;
			}
		} catch (error) {
			// Config not set - this is normal for branches without stored base
			console.log(`[readBaseBranchConfig] Not found: branch.${branchName}.base (will use default)`);
		}

		return null;
	}

	/**
	 * Lists all local branches in the repository.
	 * @returns Array of branch names
	 */
	listBranches(): string[] {
		try {
			// Get list of remote names to filter them out
			let remoteNames: string[] = [];
			try {
				const remotesOutput = execSync('git remote', {
					cwd: this.repoRoot,
					encoding: 'utf8',
					stdio: 'pipe'
				}).trim();
				if (remotesOutput) {
					remoteNames = remotesOutput.split('\n').map(r => r.trim()).filter(r => r !== '');
				}
			} catch (e) {
				// No remotes configured, continue anyway
			}

			const output = execSync('git branch -a --format=%(refname:short)', {
				cwd: this.repoRoot,
				encoding: 'utf8',
				stdio: 'pipe'
			}).trim();

			if (!output) {
				return [];
			}

			const allBranches = output.split('\n')
				.map(branch => branch.trim())
				.filter(branch => branch !== '')
				// Filter out HEAD references
				.filter(branch => !branch.includes('HEAD ->'))
				// Remove 'remotes/' prefix if present
				.map(branch => branch.replace(/^remotes\//, ''));

			// Separate local and remote branches
			const localBranches = allBranches.filter(branch => !branch.includes('/'))
				// Filter out bare remote names (e.g., "origin")
				.filter(branch => !remoteNames.includes(branch));
			const remoteBranches = allBranches.filter(branch => branch.includes('/'))
				// Filter out bare remote names with trailing slash
				.filter(branch => {
					const parts = branch.split('/');
					return parts.length >= 2 && parts[1] !== '';
				});

			// Sort remote branches alphabetically
			remoteBranches.sort();

			// Return local branches first, then remote branches
			return [...localBranches, ...remoteBranches];
		} catch (error) {
			console.error('Failed to list branches:', error);
			return [];
		}
	}

	/**
	 * Gets the current commit ID of a session's base branch.
	 * @param sessionId - Session identifier
	 * @returns The commit SHA of the session's base branch, or null if unable to retrieve
	 */
	private getBaseBranchCommitId(sessionId: string): string | null {
		const session = this.sessions.get(sessionId);
		if (!session) {
			console.error(`Session ${sessionId} not found`);
			return null;
		}

		try {
			return execSync(`git rev-parse ${session.baseBranchName}`, {
				cwd: session.worktreePath,
				encoding: 'utf8',
				stdio: 'pipe'
			}).trim();
		} catch (error) {
			console.error(`Failed to get base branch commit ID for session ${sessionId}:`, error);
			return null;
		}
	}

	/**
	 * Checks if a session's base branch has changed and updates the stored commit ID.
	 * @param sessionId - Session identifier
	 * @returns True if the session's base branch commit ID has changed, false otherwise
	 */
	checkAndUpdateBaseBranch(sessionId: string): boolean {
		const session = this.sessions.get(sessionId);
		if (!session) {
			console.error(`Session ${sessionId} not found`);
			return false;
		}

		const currentCommitId = this.getBaseBranchCommitId(sessionId);
		if (currentCommitId !== session.baseBranchCommitId) {
			console.log(`Base branch commit ID changed for session ${sessionId} (${session.baseBranchName}): ${session.baseBranchCommitId} -> ${currentCommitId}`);
			session.baseBranchCommitId = currentCommitId;
			return true;
		}
		return false;
	}

	/**
	 * Gets the git status for a session's worktree.
	 * @param sessionId - Session identifier
	 * @returns Status object with uncommitted changes, unmerged commits, and behind base flags
	 */
	getGitStatus(sessionId: string): GitStatus {
		console.log(`[getGitStatus] Called for sessionId="${sessionId}"`);
		const session = this.sessions.get(sessionId);
		if (!session) {
			console.log(`[getGitStatus] Session not found: ${sessionId}`);
			throw new Error(`Session ${sessionId} not found`);
		}

		console.log(`[getGitStatus] Session found: branchName="${session.branchName}", worktreePath="${session.worktreePath}"`);

		try {
			// Check for uncommitted changes (working tree + staged)
			console.log(`[getGitStatus] Running: git status --porcelain in ${session.worktreePath}`);
			const statusOutput = execSync('git status --porcelain', {
				cwd: session.worktreePath,
				encoding: 'utf8',
				stdio: 'pipe'
			});
			console.log(`[getGitStatus] git status output (${statusOutput.length} chars): "${statusOutput}"`);
			const hasUncommittedChanges = statusOutput.trim().length > 0;
			console.log(`[getGitStatus] hasUncommittedChanges: ${hasUncommittedChanges}`);

			// Check for unmerged commits (commits in branch that aren't in base)
			console.log(`[getGitStatus] Running: git log ${session.baseBranchName}..${session.branchName} --oneline`);
			const logOutput = execSync(`git log ${session.baseBranchName}..${session.branchName} --oneline`, {
				cwd: session.worktreePath,
				encoding: 'utf8',
				stdio: 'pipe'
			}).trim();
			console.log(`[getGitStatus] git log output (${logOutput.length} chars)`);
			const hasUnmergedCommits = logOutput.length > 0;
			console.log(`[getGitStatus] hasUnmergedCommits: ${hasUnmergedCommits}`);

			// Check if branch is behind base (base has commits not in branch)
			console.log(`[getGitStatus] Running: git rev-list --count HEAD..${session.baseBranchName}`);
			const behindOutput = execSync(`git rev-list --count HEAD..${session.baseBranchName}`, {
				cwd: session.worktreePath,
				encoding: 'utf8',
				stdio: 'pipe'
			}).trim();
			console.log(`[getGitStatus] git rev-list output: "${behindOutput}"`);
			const isBehindBase = parseInt(behindOutput) > 0;
			console.log(`[getGitStatus] isBehindBase: ${isBehindBase}`);

			const result = {
				hasUncommittedChanges,
				hasUnmergedCommits,
				isBehindBase
			};
			console.log(`[getGitStatus] Returning:`, JSON.stringify(result));
			return result;
		} catch (error: any) {
			console.error(`[getGitStatus] Error getting git status for session ${sessionId}:`, error);
			throw new Error(`Failed to get git status: ${error.message}`);
		}
	}

	/**
	 * Gets the commit log for a session's branch (commits since base branch).
	 * @param sessionId - Session identifier
	 * @returns Array of commit info objects
	 */
	getCommitLog(sessionId: string): CommitInfo[] {
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw new Error(`Session ${sessionId} not found`);
		}

		try {
			// Get commits from base branch to current branch
			// Format: hash|timestamp|subject|fullMessage
			// Using %x00 (null byte) as separator to handle messages with pipes
			const logOutput = execSync(`git log ${session.baseBranchName}..${session.branchName} --format="%h%x00%at%x00%s%x00%B%x00"`, {
				cwd: session.worktreePath,
				encoding: 'utf8',
				stdio: 'pipe'
			}).trim();

			// Parse the output into CommitInfo objects
			if (!logOutput) {
				return [];
			}

			// Split by the pattern: null byte followed by newline
			// Each commit ends with: %B%x00 which produces: body<null><newline>
			const commits: CommitInfo[] = [];
			const entries = logOutput.split('\x00\n');

			for (const entry of entries) {
				if (!entry.trim()) continue;

				const parts = entry.split('\x00');
				if (parts.length < 3) continue;

				const hash = parts[0] || '';
				const timestampStr = parts[1] || '0';
				const message = parts[2] || '';
				const fullMessage = parts[3] || message;

				commits.push({
					hash: hash,                    // Full abbreviated hash (7-8 chars) for git operations
					displayHash: hash.substring(0, 4), // First 4 characters for UI display
					timestamp: parseInt(timestampStr, 10),
					message,
					fullMessage: fullMessage.trim()
				});
			}

			return commits;
		} catch (error: any) {
			console.error(`Error getting commit log for session ${sessionId}:`, error);
			throw new Error(`Failed to get commit log: ${error.message}`);
		}
	}

	/**
	 * Gets the file list for a session's worktree.
	 * @param sessionId - Session identifier
	 * @param commitId - Commit hash (or null for working tree)
	 * @returns Array of file info objects with path and status
	 */
	getFileList(sessionId: string, commitId: string | null): FileInfo[] {
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw new Error(`Session ${sessionId} not found`);
		}

		try {
			if (commitId === null) {
				// Get working tree status
				return this.getWorkingTreeFileList(session);
			} else {
				// Get file list for specific commit
				return this.getCommitFileList(session, commitId);
			}
		} catch (error: any) {
			console.error(`Error getting file list for session ${sessionId}:`, error);
			throw new Error(`Failed to get file list: ${error.message}`);
		}
	}

	/**
	 * Recursively scan filesystem for all directories
	 */
	private scanDirectories(dirPath: string, basePath: string): string[] {
		const directories: string[] = [];

		try {
			const entries = readdirSync(dirPath, { withFileTypes: true });

			for (const entry of entries) {
				if (entry.isDirectory()) {
					// Skip .git directory
					if (entry.name === '.git') continue;

					const fullPath = join(dirPath, entry.name);
					const relativePath = relative(basePath, fullPath).replace(/\\/g, '/');

					directories.push(relativePath);

					// Recursively scan subdirectories
					directories.push(...this.scanDirectories(fullPath, basePath));
				}
			}
		} catch (error) {
			console.error(`Error scanning directory ${dirPath}:`, error);
		}

		return directories;
	}

	/**
	 * Gets file list for working tree with status information.
	 */
	private getWorkingTreeFileList(session: SessionInfo): FileInfo[] {
		// Get all tracked files
		const trackedOutput = execSync('git ls-files', {
			cwd: session.worktreePath,
			encoding: 'utf8',
			stdio: 'pipe',
			maxBuffer: 10 * 1024 * 1024
		}).trim();

		// Get status of modified/added/deleted tracked files
		const statusOutput = execSync('git status --porcelain', {
			cwd: session.worktreePath,
			encoding: 'utf8',
			stdio: 'pipe'
		});

		// Get untracked files individually (not collapsed as directories)
		const untrackedOutput = execSync('git ls-files --others', {
			cwd: session.worktreePath,
			encoding: 'utf8',
			stdio: 'pipe',
			maxBuffer: 10 * 1024 * 1024
		}).trim();

		// Parse status into a map (only for tracked files)
		const statusMap = new Map<string, FileStatus>();
		if (statusOutput.trim()) {
			for (const line of statusOutput.split('\n')) {
				if (!line) continue; // Skip empty lines
				// Format: XY PATH or XY PATH -> ORIGPATH (for renames)
				const xy = line.substring(0, 2);
				let path = line.substring(3).split(' -> ')[0].trim();

				const x = xy[0]; // Index status
				const y = xy[1]; // Working tree status

				// Skip untracked files (we'll handle them separately)
				if (x === '?' && y === '?') {
					continue;
				}

				// Normalize path separators to forward slashes
				path = path.replace(/\\/g, '/');

				// Skip empty paths
				if (!path) continue;

				// Determine file status based on git status codes
				let status: FileStatus = 'unchanged';
				if (x === 'A' || y === 'A') {
					status = 'added';
				} else if (x === 'D' || y === 'D') {
					status = 'deleted';
				} else if (x === 'M' || y === 'M' || x === 'R' || y === 'R') {
					status = 'modified';
				}

				statusMap.set(path, status);
			}
		}

		// Build file list with all tracked files
		const files: FileInfo[] = [];
		if (trackedOutput) {
			for (let path of trackedOutput.split('\n')) {
				path = path.trim();
				// Skip empty paths
				if (!path) continue;

				// Normalize path separators to forward slashes
				path = path.replace(/\\/g, '/');

				files.push({
					path,
					status: statusMap.get(path) || 'unchanged'
				});
			}
		}

		// Get ignored files
		const ignoredOutput = execSync('git status --ignored --porcelain', {
			cwd: session.worktreePath,
			encoding: 'utf8',
			stdio: 'pipe',
			maxBuffer: 10 * 1024 * 1024
		}).trim();

		// Parse ignored files from status output
		// Lines starting with "!! " are ignored files
		const ignoredFiles = new Set<string>();
		if (ignoredOutput) {
			for (const line of ignoredOutput.split('\n')) {
				if (line.startsWith('!! ')) {
					let path = line.substring(3).trim();
					// Normalize path separators to forward slashes
					path = path.replace(/\\/g, '/');
					if (path) {
						ignoredFiles.add(path);
					}
				}
			}
		}

		// Helper function to check if a path is within an ignored directory
		const isPathIgnored = (path: string): boolean => {
			// Check if the path itself is ignored
			if (ignoredFiles.has(path)) {
				return true;
			}
			// Check if any parent directory is ignored
			const parts = path.split('/');
			for (let i = 1; i < parts.length; i++) {
				const parentPath = parts.slice(0, i).join('/') + '/';
				if (ignoredFiles.has(parentPath)) {
					return true;
				}
			}
			return false;
		};

		// Add untracked files (now includes both untracked and ignored)
		if (untrackedOutput) {
			for (let path of untrackedOutput.split('\n')) {
				path = path.trim();
				// Skip empty paths
				if (!path) continue;

				// Normalize path separators to forward slashes
				path = path.replace(/\\/g, '/');

				// Determine if this file is ignored or just untracked
				const status: FileStatus = isPathIgnored(path) ? 'ignored' : 'untracked';
				files.push({ path, status });
			}
		}

		// Scan filesystem for all directories (including empty ones)
		const allDirectories = this.scanDirectories(session.worktreePath, session.worktreePath);

		// Add directories that aren't already in the file list
		const existingPaths = new Set(files.map(f => f.path));
		for (const dirPath of allDirectories) {
			if (!existingPaths.has(dirPath)) {
				// Check if directory is ignored
				const isIgnored = isPathIgnored(dirPath);
				files.push({
					path: dirPath,
					status: isIgnored ? 'ignored' : 'untracked',
					isDirectory: true
				});
			}
		}

		return files;
	}

	/**
	 * Gets file list for a specific commit.
	 */
	private getCommitFileList(session: SessionInfo, commitId: string): FileInfo[] {
		// Get all files in the commit
		const allFilesOutput = execSync(`git ls-tree -r --name-only "${commitId}"`, {
			cwd: session.worktreePath,
			encoding: 'utf8',
			stdio: 'pipe',
			maxBuffer: 10 * 1024 * 1024
		}).trim();

		// Get files that were modified in this commit (compared to parent)
		// Use diff-tree to show changes in this commit
		const diffOutput = execSync(`git diff-tree --no-commit-id --name-status -r "${commitId}"`, {
			cwd: session.worktreePath,
			encoding: 'utf8',
			stdio: 'pipe'
		}).trim();

		// Parse diff output into a map of file -> status
		const changedFiles = new Map<string, FileStatus>();
		if (diffOutput) {
			for (const line of diffOutput.split('\n')) {
				const parts = line.split('\t');
				if (parts.length >= 2) {
					const statusCode = parts[0];
					const filePath = parts[1];

					// Map git status codes to our FileStatus
					let status: FileStatus = 'unchanged';
					if (statusCode === 'A') {
						status = 'added';
					} else if (statusCode === 'M') {
						status = 'modified';
					} else if (statusCode === 'D') {
						status = 'deleted';
					}

					changedFiles.set(filePath, status);
				}
			}
		}

		if (!allFilesOutput) {
			return [];
		}

		// Build file list: all files from commit with their status
		const files: FileInfo[] = allFilesOutput.split('\n').map(path => ({
			path,
			status: changedFiles.get(path) || 'unchanged'
		}));

		// Add deleted files (they won't be in ls-tree output)
		for (const [path, status] of changedFiles) {
			if (status === 'deleted') {
				files.push({ path, status });
			}
		}

		return files;
	}

	/**
	 * Deletes a file or directory in a session's worktree.
	 * @param sessionId - Session identifier
	 * @param relativePath - Path relative to worktree root
	 * @returns Success status and optional error message
	 */
	deleteFileOrDirectory(sessionId: string, relativePath: string): { success: boolean; error?: string } {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return { success: false, error: `Session ${sessionId} not found` };
		}

		try {
			// Construct absolute path
			const absolutePath = join(session.worktreePath, relativePath);

			// Verify the path is within the worktree (prevent path traversal)
			const normalizedAbsolute = absolutePath.replace(/\\/g, '/');
			const normalizedWorktree = session.worktreePath.replace(/\\/g, '/');
			if (!normalizedAbsolute.startsWith(normalizedWorktree)) {
				return { success: false, error: 'Invalid path: outside worktree' };
			}

			// Check if path exists
			if (!existsSync(absolutePath)) {
				return { success: false, error: 'File or directory does not exist' };
			}

			// Delete the file or directory
			const stats = statSync(absolutePath);
			if (stats.isDirectory()) {
				rmSync(absolutePath, { recursive: true, force: true });
				console.log(`Deleted directory: ${relativePath}`);
			} else {
				rmSync(absolutePath, { force: true });
				console.log(`Deleted file: ${relativePath}`);
			}

			return { success: true };
		} catch (error: any) {
			const errorMessage = error.message || String(error);
			console.error(`Delete failed for session ${sessionId}:`, errorMessage);
			return { success: false, error: errorMessage };
		}
	}

	/**
	 * Creates a file or directory in a session's worktree.
	 * @param sessionId - Session identifier
	 * @param relativePath - Path relative to worktree root
	 * @param isDirectory - Whether to create a directory (true) or file (false)
	 * @returns Success status and optional error message
	 */
	createFileOrDirectory(sessionId: string, relativePath: string, isDirectory: boolean): { success: boolean; error?: string } {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return { success: false, error: `Session ${sessionId} not found` };
		}

		try {
			// Construct absolute path
			const absolutePath = join(session.worktreePath, relativePath);

			// Verify the path is within the worktree (prevent path traversal)
			const normalizedAbsolute = absolutePath.replace(/\\/g, '/');
			const normalizedWorktree = session.worktreePath.replace(/\\/g, '/');
			if (!normalizedAbsolute.startsWith(normalizedWorktree)) {
				return { success: false, error: 'Invalid path: outside worktree' };
			}

			// Check if path already exists
			if (existsSync(absolutePath)) {
				return { success: false, error: 'File or directory already exists' };
			}

			// Create the file or directory
			if (isDirectory) {
				mkdirSync(absolutePath, { recursive: true });
				console.log(`Created directory: ${relativePath}`);
			} else {
				// Ensure parent directory exists
				const parentDir = dirname(absolutePath);
				if (!existsSync(parentDir)) {
					mkdirSync(parentDir, { recursive: true });
				}
				// Create empty file
				writeFileSync(absolutePath, '', 'utf8');
				console.log(`Created file: ${relativePath}`);
			}

			return { success: true };
		} catch (error: any) {
			const errorMessage = error.message || String(error);
			console.error(`Create failed for session ${sessionId}:`, errorMessage);
			return { success: false, error: errorMessage };
		}
	}

	/**
	 * Gets the diff for a specific file.
	 * @param sessionId - Session identifier
	 * @param filePath - Path to the file
	 * @param commitId - Commit hash (or null for working tree)
	 * @returns Object with original and modified content
	 */
	getFileDiff(sessionId: string, filePath: string, commitId: string | null): { original: string; modified: string } {
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw new Error(`Session ${sessionId} not found`);
		}

		try {
			let original = '';
			let modified = '';

			if (commitId === null) {
				// Working tree: compare HEAD vs working directory
				try {
					// Get file content from HEAD (using cat-file to preserve line endings)
					original = execSync(`git cat-file blob HEAD:${filePath}`, {
						cwd: session.worktreePath,
						encoding: 'utf8',
						stdio: 'pipe'
					});
				} catch (error) {
					// File might be new (not in HEAD), so original is empty
					original = '';
				}

				// Get file content from working directory
				try {
					const fullPath = join(session.worktreePath, filePath);
					modified = readFileSync(fullPath, 'utf8');
				} catch (error) {
					// File might be deleted, so modified is empty
					modified = '';
				}
			} else {
				// Specific commit: compare commit's parent vs commit
				// Use git rev-list to get parent SHA (avoids ^ which causes issues on Windows cmd)
				try {
					// Get parent commit using rev-list (works cross-platform)
					const parentSha = execSync(`git rev-list --parents -n 1 ${commitId}`, {
						cwd: session.worktreePath,
						encoding: 'utf8',
						stdio: 'pipe'
					}).trim().split(' ')[1]; // Format: "commit_sha parent_sha"

					if (parentSha) {
						try {
							// Get file content from commit's parent
							original = execSync(`git cat-file blob ${parentSha}:${filePath}`, {
								cwd: session.worktreePath,
								encoding: 'utf8',
								stdio: 'pipe'
							});
						} catch (error) {
							// File might be new in this commit, so original is empty
							original = '';
						}
					} else {
						// No parent commit (initial commit)
						original = '';
					}
				} catch (error) {
					// Failed to get parent commit SHA
					original = '';
				}

				try {
					// Get file content from commit
					modified = execSync(`git cat-file blob ${commitId}:${filePath}`, {
						cwd: session.worktreePath,
						encoding: 'utf8',
						stdio: 'pipe'
					});
				} catch (error) {
					// File might be deleted in this commit, so modified is empty
					modified = '';
				}
			}

			return { original, modified };
		} catch (error: any) {
			console.error(`Error getting file diff for session ${sessionId}:`, error);
			throw new Error(`Failed to get file diff: ${error.message}`);
		}
	}

	/**
	 * Saves content to a file in the session's worktree.
	 * @param sessionId - Session identifier
	 * @param filePath - Path to the file relative to worktree
	 * @param content - New file content
	 * @throws Error if session not found or save fails
	 */
	saveFile(sessionId: string, filePath: string, content: string): void {
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw new Error(`Session ${sessionId} not found`);
		}

		try {
			const fullPath = join(session.worktreePath, filePath);
			writeFileSync(fullPath, content, 'utf8');
			console.log(`Saved file: ${filePath} in session ${sessionId}`);
		} catch (error: any) {
			console.error(`Error saving file ${filePath} in session ${sessionId}:`, error);
			throw new Error(`Failed to save file: ${error.message}`);
		}
	}

	/**
	 * Discards changes to a specific file by restoring it to the git branch state.
	 * @param sessionId - Session identifier
	 * @param filePath - Path to the file relative to worktree
	 * @throws Error if session not found or discard fails
	 */
	discardFile(sessionId: string, filePath: string): void {
		const session = this.sessions.get(sessionId);
		if (!session) {
			throw new Error(`Session ${sessionId} not found`);
		}

		try {
			// Use git restore to discard changes (modern git)
			// This works for both tracked files and staged changes
			try {
				execSync(`git restore "${filePath}"`, {
					cwd: session.worktreePath,
					stdio: 'pipe'
				});
				console.log(`Discarded changes to file: ${filePath} in session ${sessionId}`);
			} catch (restoreError) {
				// Fallback to git checkout for older git versions
				execSync(`git checkout -- "${filePath}"`, {
					cwd: session.worktreePath,
					stdio: 'pipe'
				});
				console.log(`Discarded changes to file: ${filePath} in session ${sessionId} (using checkout)`);
			}
		} catch (error: any) {
			console.error(`Error discarding file ${filePath} in session ${sessionId}:`, error);
			throw new Error(`Failed to discard file: ${error.message}`);
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
			// Reset to session's base branch
			execSync(`git reset --hard ${session.baseBranchName}`, {
				cwd: session.worktreePath,
				stdio: 'pipe'
			});

			console.log(`Reset session ${sessionId} to base branch ${session.baseBranchName}`);
			return { success: true };
		} catch (error: any) {
			const errorMessage = error.message || String(error);
			console.error(`Reset to base failed for session ${sessionId}:`, errorMessage);
			return { success: false, error: errorMessage };
		}
	}

	/**
	 * Fetch updates from remote repository
	 * @returns Operation result with success status
	 */
	gitFetch(): { success: boolean; error?: string } {
		try {
			execSync('git fetch --all', {
				cwd: this.repoRoot,
				stdio: 'pipe'
			});

			console.log(`Fetched updates for repository ${this.repoRoot}`);
			return { success: true };
		} catch (error: any) {
			const errorMessage = error.message || String(error);
			console.error(`Git fetch failed for repository ${this.repoRoot}:`, errorMessage);
			return { success: false, error: errorMessage };
		}
	}

}

export interface SessionInfo {
	sessionId: string;
	branchName: string;
	worktreePath: string;
	baseBranchName: string;
	baseBranchCommitId: string | null;
}

export interface CommitInfo {
	hash: string;          // Full abbreviated hash (7-8 chars) for git operations
	displayHash: string;   // Short hash (4 chars) for UI display
	timestamp: number;
	message: string;
	fullMessage: string;
}

export interface GitStatus {
	hasUncommittedChanges: boolean;
	hasUnmergedCommits: boolean;
	isBehindBase: boolean;
}

export interface MergeResult {
	success: boolean;
	error?: string;
	conflictsResolved?: boolean;
}

export type FileStatus = 'modified' | 'added' | 'deleted' | 'untracked' | 'unchanged' | 'ignored';

export interface FileInfo {
	path: string;
	status: FileStatus;
	isDirectory?: boolean;
}
