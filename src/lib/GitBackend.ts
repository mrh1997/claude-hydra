export interface CommitInfo {
	hash: string;
	timestamp: number;
	message: string;
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

export interface OperationResult {
	success: boolean;
	error?: string;
}

export type FileStatus = 'modified' | 'added' | 'deleted' | 'untracked' | 'unchanged';

export interface FileInfo {
	path: string;
	status: FileStatus;
}

type PendingRequest = {
	resolve: (value: any) => void;
	reject: (error: Error) => void;
	timeoutId: number;
};

/**
 * GitBackend provides a clean API for git operations over WebSocket.
 * Encapsulates WebSocket communication and provides async/await interface.
 */
export class GitBackend {
	private sessionId: string;
	private ws: WebSocket;
	private onGitStatusUpdate: (status: GitStatus, commitLog?: CommitInfo[]) => void;
	private onFileListUpdate: ((files: FileInfo[], commitId: string | null) => void) | null = null;
	private pendingRequests = new Map<string, PendingRequest>();

	constructor(
		sessionId: string,
		ws: WebSocket,
		onGitStatusUpdate: (status: GitStatus, commitLog?: CommitInfo[]) => void
	) {
		this.sessionId = sessionId;
		this.ws = ws;
		this.onGitStatusUpdate = onGitStatusUpdate;
	}

	/**
	 * Set callback for file list updates
	 */
	setFileListCallback(callback: (files: FileInfo[], commitId: string | null) => void) {
		this.onFileListUpdate = callback;
	}

	/**
	 * Handle incoming WebSocket messages and route to pending requests
	 */
	handleMessage(message: any): boolean {
		// Check if this message is a response to a pending request
		const messageType = message.type;
		const pending = this.pendingRequests.get(messageType);

		if (pending) {
			clearTimeout(pending.timeoutId);
			this.pendingRequests.delete(messageType);

			// Resolve with the appropriate data
			switch (messageType) {
				case 'commitResult':
				case 'discardResult':
				case 'resetResult':
				case 'rebaseResult':
				case 'mergeResult':
				case 'deleteFileResult':
				case 'createFileResult':
					pending.resolve(message.result);
					break;
				case 'restarted':
					pending.resolve(undefined);
					break;
				default:
					pending.resolve(message);
			}
			return true; // Message was handled
		}

		// Handle gitBranchStatus updates (broadcast notifications)
		if (messageType === 'gitBranchStatus') {
			this.onGitStatusUpdate(message.gitStatus, message.commitLog);
			// Also request file list for working tree when git status updates
			this.requestFileList(null);
			return true;
		}

		// Handle fileList updates
		if (messageType === 'fileList') {
			if (this.onFileListUpdate) {
				this.onFileListUpdate(message.files, message.commitId);
			}
			return true;
		}

		return false; // Message not handled by GitBackend
	}

	/**
	 * Send a request and wait for response
	 */
	private sendRequest<T>(
		type: string,
		data: any = {},
		expectedResponseType: string,
		timeout: number = 5000
	): Promise<T> {
		return new Promise((resolve, reject) => {
			// Check if WebSocket is open
			if (this.ws.readyState !== WebSocket.OPEN) {
				reject(new Error('WebSocket is not connected'));
				return;
			}

			// Set up timeout
			const timeoutId = window.setTimeout(() => {
				this.pendingRequests.delete(expectedResponseType);
				reject(new Error(`Request timeout: ${type}`));
			}, timeout);

			// Store pending request
			this.pendingRequests.set(expectedResponseType, {
				resolve,
				reject,
				timeoutId
			});

			// Send request
			this.ws.send(JSON.stringify({
				type,
				sessionId: this.sessionId,
				...data
			}));
		});
	}

	/**
	 * Discard all uncommitted changes
	 */
	async discardChanges(): Promise<OperationResult> {
		return this.sendRequest<OperationResult>(
			'discardChanges',
			{},
			'discardResult'
		);
	}

	/**
	 * Reset branch to base (discard pending commits)
	 */
	async resetToBase(): Promise<OperationResult> {
		return this.sendRequest<OperationResult>(
			'resetToBase',
			{},
			'resetResult'
		);
	}

	/**
	 * Restart the Claude process for this session
	 */
	async restart(): Promise<void> {
		return this.sendRequest<void>(
			'restart',
			{},
			'restarted',
			10000 // Longer timeout for restart
		);
	}

	/**
	 * Request file list for a specific commit or working tree
	 * @param commitId - Commit hash (or null for working tree)
	 */
	requestFileList(commitId: string | null): void {
		if (this.ws.readyState !== WebSocket.OPEN) {
			console.warn('WebSocket not open, cannot request file list');
			return;
		}

		this.ws.send(JSON.stringify({
			type: 'requestFileList',
			sessionId: this.sessionId,
			commitId
		}));
	}

	/**
	 * Delete a file or directory in the worktree
	 * @param path - Path relative to worktree root
	 */
	async deleteFile(path: string): Promise<OperationResult> {
		return this.sendRequest<OperationResult>(
			'deleteFile',
			{ path },
			'deleteFileResult'
		);
	}

	/**
	 * Create a file or directory in the worktree
	 * @param path - Path relative to worktree root
	 * @param isDirectory - Whether to create a directory (true) or file (false)
	 */
	async createFile(path: string, isDirectory: boolean): Promise<OperationResult> {
		return this.sendRequest<OperationResult>(
			'createFile',
			{ path, isDirectory },
			'createFileResult'
		);
	}

	/**
	 * Cleanup - cancel all pending requests
	 */
	dispose(): void {
		for (const [type, pending] of this.pendingRequests) {
			clearTimeout(pending.timeoutId);
			pending.reject(new Error('GitBackend disposed'));
		}
		this.pendingRequests.clear();
	}
}
