import { execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync, readFileSync, copyFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, basename, dirname, relative } from 'path';
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
	async createSession(sessionId: string, branchName: string, adoptExisting: boolean = false): Promise<SessionInfo> {
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

			// Sync local files to worktree
			await this.syncLocalFilesToWorktree(worktreePath);

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
	 * Always includes **\/CLAUDE.local.md pattern.
	 * @param fromPath - Optional path to read config from (defaults to repo root)
	 */
	private readLocalFilesConfig(fromPath?: string): string[] {
		const patterns: string[] = ['**/CLAUDE.local.md']; // Always include CLAUDE.local.md files

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
						console.log('Detached HEAD detected, creating "main" branch...');
						execSync('git checkout -b main', {
							cwd: this.repoRoot,
							stdio: 'pipe'
						});
					}
					// Otherwise we're on a branch already, keep using it
				} catch (error) {
					// Error getting branch, create main
					console.log('Could not determine branch, creating "main" branch...');
					execSync('git checkout -b main', {
						cwd: this.repoRoot,
						stdio: 'pipe'
					});
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
			console.log(`[getGitStatus] Running: git log ${this.baseBranch}..${session.branchName} --oneline`);
			const logOutput = execSync(`git log ${this.baseBranch}..${session.branchName} --oneline`, {
				cwd: session.worktreePath,
				encoding: 'utf8',
				stdio: 'pipe'
			}).trim();
			console.log(`[getGitStatus] git log output (${logOutput.length} chars)`);
			const hasUnmergedCommits = logOutput.length > 0;
			console.log(`[getGitStatus] hasUnmergedCommits: ${hasUnmergedCommits}`);

			// Check if branch is behind base (base has commits not in branch)
			console.log(`[getGitStatus] Running: git rev-list --count HEAD..${this.baseBranch}`);
			const behindOutput = execSync(`git rev-list --count HEAD..${this.baseBranch}`, {
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
			const logOutput = execSync(`git log ${this.baseBranch}..${session.branchName} --format="%h%x00%at%x00%s%x00%B%x00"`, {
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
					hash: hash.substring(0, 4), // First 4 characters of hash
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
			stdio: 'pipe'
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
			stdio: 'pipe'
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
			stdio: 'pipe'
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
			stdio: 'pipe'
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
				// Specific commit: compare commit^ vs commit
				try {
					// Get file content from commit's parent (using cat-file to preserve line endings)
					original = execSync(`git cat-file blob ${commitId}^:${filePath}`, {
						cwd: session.worktreePath,
						encoding: 'utf8',
						stdio: 'pipe'
					});
				} catch (error) {
					// File might be new in this commit, so original is empty
					original = '';
				}

				try {
					// Get file content from commit (using cat-file to preserve line endings)
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
	 * Resolves rebase conflicts using Claude CLI.
	 * @param worktreePath - Path to the worktree with conflicts
	 * @returns True if conflicts were resolved, false otherwise
	 */
	private async resolveRebaseConflictsWithClaude(worktreePath: string): Promise<boolean> {
		try {
			console.log('[CONFLICT-RESOLUTION] Starting conflict resolution check...');
			console.log(`[CONFLICT-RESOLUTION] Worktree path: ${worktreePath}`);

			// Check if we're in a conflict state
			console.log('[CONFLICT-RESOLUTION] Running git status to check for conflicts...');
			const statusOutput = execSync('git status --porcelain', {
				cwd: worktreePath,
				encoding: 'utf8',
				stdio: 'pipe'
			});
			console.log(`[CONFLICT-RESOLUTION] Git status output:\n${statusOutput}`);

			// Look for conflict markers (UU = both modified, AA = both added, etc.)
			const hasConflicts = statusOutput.split('\n').some(line =>
				line.startsWith('UU ') || line.startsWith('AA ') || line.startsWith('DD ')
			);

			if (!hasConflicts) {
				console.log('[CONFLICT-RESOLUTION] No conflicts detected, skipping Claude resolution');
				return false;
			}

			console.log('[CONFLICT-RESOLUTION] Conflicts detected, preparing to call Claude CLI...');
			console.log(`[CONFLICT-RESOLUTION] Resolving rebase conflicts with Claude CLI in ${worktreePath}`);

			// Spawn Claude CLI with non-interactive prompt
			const prompt = 'You are an expert at resolving git rebase conflicts. Read all commit messages using git log and read all diffs to understand the intention of each commit before you start merging. Then resolve all conflicts in the working directory. When you are finished resolving conflicts, quit.';
			const command = `claude --dangerously-skip-permissions -p "${prompt.replace(/"/g, '\\"')}"`;

			console.log('[CONFLICT-RESOLUTION] About to execute Claude CLI...');
			console.log(`[CONFLICT-RESOLUTION] Command: ${command}`);
			console.log('[CONFLICT-RESOLUTION] Waiting for Claude to complete (max 2 minutes)...');

			const startTime = Date.now();
			execSync(command, {
				cwd: worktreePath,
				encoding: 'utf8',
				stdio: 'inherit', // Show Claude's output in server logs
				timeout: 120000 // 2 minutes timeout
			});
			const duration = Date.now() - startTime;

			console.log(`[CONFLICT-RESOLUTION] Claude CLI completed in ${duration}ms`);
			console.log('[CONFLICT-RESOLUTION] Checking rebase status...');

			// Check if rebase is still in progress
			const rebaseInProgress = existsSync(join(worktreePath, '.git', 'rebase-merge')) ||
			                         existsSync(join(worktreePath, '.git', 'rebase-apply'));

			if (!rebaseInProgress) {
				console.log('[CONFLICT-RESOLUTION] Claude CLI completed the rebase automatically');
				return true; // Rebase was completed by Claude
			}

			console.log('[CONFLICT-RESOLUTION] Rebase still in progress, verifying conflicts are resolved...');

			// Verify conflicts are resolved
			const postStatusOutput = execSync('git status --porcelain', {
				cwd: worktreePath,
				encoding: 'utf8',
				stdio: 'pipe'
			});
			console.log(`[CONFLICT-RESOLUTION] Post-resolution git status:\n${postStatusOutput}`);

			const stillHasConflicts = postStatusOutput.split('\n').some(line =>
				line.startsWith('UU ') || line.startsWith('AA ') || line.startsWith('DD ')
			);

			if (stillHasConflicts) {
				console.error('[CONFLICT-RESOLUTION] ERROR: Claude failed to resolve all conflicts');
				return false;
			}

			console.log('[CONFLICT-RESOLUTION] SUCCESS: Claude successfully resolved rebase conflicts');
			return true;
		} catch (error: any) {
			console.error(`[CONFLICT-RESOLUTION] ERROR: Exception during Claude conflict resolution:`, error);
			console.error(`[CONFLICT-RESOLUTION] Error message: ${error.message}`);
			console.error(`[CONFLICT-RESOLUTION] Error stack: ${error.stack}`);
			return false;
		}
	}

	/**
	 * Rebases a session's branch onto the base branch.
	 * @param sessionId - Session identifier
	 * @returns Success status and optional error message
	 */
	async rebase(sessionId: string): Promise<{ success: boolean; error?: string; conflictsResolved?: boolean }> {
		console.log(`[REBASE] Starting rebase for session ${sessionId}`);
		const session = this.sessions.get(sessionId);
		if (!session) {
			console.error(`[REBASE] Session ${sessionId} not found`);
			return { success: false, error: `Session ${sessionId} not found` };
		}

		console.log(`[REBASE] Session found: ${session.branchName} at ${session.worktreePath}`);

		try {
			console.log(`[REBASE] Attempting to rebase ${session.branchName} onto ${this.baseBranch}...`);
			// Rebase onto base branch
			execSync(`git rebase ${this.baseBranch}`, {
				cwd: session.worktreePath,
				encoding: 'utf8',
				stdio: 'pipe'
			});

			console.log(`[REBASE] SUCCESS: Rebased session ${sessionId} onto ${this.baseBranch} without conflicts`);

			// Sync local files to worktree after rebase
			console.log(`[REBASE] Syncing local files to worktree...`);
			await this.syncLocalFilesToWorktree(session.worktreePath);

			console.log(`[REBASE] Rebase completed successfully`);
			return { success: true };
		} catch (error: any) {
			// Rebase failed - check if it's due to conflicts
			console.log(`[REBASE] Rebase failed for session ${sessionId}, attempting to resolve conflicts with Claude...`);

			// Try to resolve conflicts with Claude
			const conflictsResolved = await this.resolveRebaseConflictsWithClaude(session.worktreePath);

			if (conflictsResolved) {
				console.log(`[REBASE] Conflicts resolved, checking if rebase needs continuation...`);

				// Check if rebase is still in progress (Claude may have completed it)
				const rebaseInProgress = existsSync(join(session.worktreePath, '.git', 'rebase-merge')) ||
				                         existsSync(join(session.worktreePath, '.git', 'rebase-apply'));

				if (!rebaseInProgress) {
					console.log(`[REBASE] Claude CLI completed the rebase automatically`);

					// Sync local files to worktree after rebase
					console.log(`[REBASE] Syncing local files to worktree...`);
					await this.syncLocalFilesToWorktree(session.worktreePath);

					console.log(`[REBASE] Rebase with conflict resolution completed successfully`);
					return { success: true, conflictsResolved: true };
				}

				// Continue the rebase
				try {
					console.log(`[REBASE] Continuing rebase...`);
					execSync('git rebase --continue', {
						cwd: session.worktreePath,
						encoding: 'utf8',
						stdio: 'pipe'
					});

					console.log(`[REBASE] SUCCESS: Rebased session ${sessionId} onto ${this.baseBranch} after resolving conflicts`);

					// Sync local files to worktree after rebase
					console.log(`[REBASE] Syncing local files to worktree...`);
					await this.syncLocalFilesToWorktree(session.worktreePath);

					console.log(`[REBASE] Rebase with conflict resolution completed successfully`);
					return { success: true, conflictsResolved: true };
				} catch (continueError: any) {
					console.error(`[REBASE] ERROR: Failed to continue rebase after conflict resolution:`, continueError);
					// Abort the rebase
					try {
						console.log(`[REBASE] Aborting rebase...`);
						execSync('git rebase --abort', {
							cwd: session.worktreePath,
							stdio: 'pipe'
						});
						console.log(`[REBASE] Rebase aborted`);
					} catch (abortError) {
						console.error(`[REBASE] ERROR: Failed to abort rebase for session ${sessionId}:`, abortError);
					}
					return { success: false, error: 'Rebase continuation failed after conflict resolution.' };
				}
			}

			// Claude couldn't resolve conflicts, abort the rebase
			console.log(`[REBASE] Claude could not resolve conflicts, aborting rebase...`);
			try {
				execSync('git rebase --abort', {
					cwd: session.worktreePath,
					stdio: 'pipe'
				});
				console.log(`[REBASE] Rebase aborted`);
			} catch (abortError) {
				console.error(`[REBASE] ERROR: Failed to abort rebase for session ${sessionId}:`, abortError);
			}

			const errorMessage = error.message || String(error);
			console.error(`[REBASE] ERROR: Rebase failed for session ${sessionId}:`, errorMessage);
			return { success: false, error: 'Rebase failed. Conflicts could not be resolved automatically.' };
		}
	}

	/**
	 * Rebases a session's branch onto the base branch, then fast-forwards the base branch.
	 * @param sessionId - Session identifier
	 * @param commitMessage - Optional commit message. If provided, uncommitted changes will be committed first.
	 * @returns Merge result with success status and optional error message
	 */
	async merge(sessionId: string, commitMessage?: string): Promise<MergeResult> {
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
			console.log(`[MERGE] Rebasing ${session.branchName} onto ${this.baseBranch} before merge...`);
			let conflictsResolvedDuringRebase = false;
			try {
				execSync(`git rebase "${this.baseBranch}"`, {
					cwd: session.worktreePath,
					encoding: 'utf8',
					stdio: 'pipe'
				});

				console.log(`[MERGE] Rebased session ${sessionId} (${session.branchName}) onto ${this.baseBranch} without conflicts`);

				// Sync local files to worktree after rebase
				console.log(`[MERGE] Syncing local files to worktree after rebase...`);
				await this.syncLocalFilesToWorktree(session.worktreePath);
			} catch (rebaseError: any) {
				// Rebase failed - try to resolve conflicts with Claude
				console.log(`[MERGE] Rebase failed for session ${sessionId} during merge, attempting to resolve conflicts with Claude...`);

				const conflictsResolved = await this.resolveRebaseConflictsWithClaude(session.worktreePath);

				if (conflictsResolved) {
					console.log(`[MERGE] Conflicts resolved, checking if rebase needs continuation...`);

					// Check if rebase is still in progress (Claude may have completed it)
					const rebaseInProgress = existsSync(join(session.worktreePath, '.git', 'rebase-merge')) ||
					                         existsSync(join(session.worktreePath, '.git', 'rebase-apply'));

					if (!rebaseInProgress) {
						console.log(`[MERGE] Claude CLI completed the rebase automatically`);

						// Sync local files to worktree after rebase
						console.log(`[MERGE] Syncing local files to worktree...`);
						await this.syncLocalFilesToWorktree(session.worktreePath);

						conflictsResolvedDuringRebase = true;
					} else {
						// Continue the rebase
						try {
							console.log(`[MERGE] Continuing rebase...`);
							execSync('git rebase --continue', {
								cwd: session.worktreePath,
								encoding: 'utf8',
								stdio: 'pipe'
							});

							console.log(`[MERGE] Rebased session ${sessionId} (${session.branchName}) onto ${this.baseBranch} after resolving conflicts`);

							// Sync local files to worktree after rebase
							console.log(`[MERGE] Syncing local files to worktree...`);
							await this.syncLocalFilesToWorktree(session.worktreePath);

							conflictsResolvedDuringRebase = true;
						} catch (continueError: any) {
							console.error(`[MERGE] ERROR: Failed to continue rebase after conflict resolution:`, continueError);
							// Abort the rebase
							try {
								console.log(`[MERGE] Aborting rebase...`);
								execSync('git rebase --abort', {
									cwd: session.worktreePath,
									stdio: 'pipe'
								});
								console.log(`[MERGE] Rebase aborted`);
							} catch (abortError) {
								console.error(`[MERGE] ERROR: Failed to abort rebase for session ${sessionId}:`, abortError);
							}
							return { success: false, error: 'Rebase continuation failed after conflict resolution.' };
						}
					}
				} else {
					// Claude couldn't resolve conflicts, abort the rebase
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
					return { success: false, error: `Rebase failed. Conflicts could not be resolved automatically.` };
				}
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

			// Sync local files from worktree back to main repo
			await this.syncLocalFilesFromWorktree(session.worktreePath);

			// Keep the session alive - no cleanup needed
			// Tab remains open and worktree/branch are preserved

			return { success: true, conflictsResolved: conflictsResolvedDuringRebase };
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

export interface CommitInfo {
	hash: string;
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
