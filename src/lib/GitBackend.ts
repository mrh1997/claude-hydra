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
					pending.resolve(message.result);
					break;
				case 'restarted':
					pending.resolve();
					break;
				default:
					pending.resolve(message);
			}
			return true; // Message was handled
		}

		// Handle gitBranchStatus updates (broadcast notifications)
		if (messageType === 'gitBranchStatus') {
			this.onGitStatusUpdate(message.gitStatus, message.commitLog);
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
	 * Commit all changes with a message
	 */
	async commit(message: string): Promise<OperationResult> {
		return this.sendRequest<OperationResult>(
			'commit',
			{ commitMessage: message },
			'commitResult'
		);
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
	 * Merge branch to base, optionally committing changes first
	 */
	async performMerge(commitMessage?: string): Promise<MergeResult> {
		return this.sendRequest<MergeResult>(
			'merge',
			commitMessage ? { commitMessage } : {},
			'mergeResult',
			120000 // 2 minutes timeout for merge (Claude CLI may need time to resolve conflicts)
		);
	}

	/**
	 * Rebase branch onto base
	 */
	async performRebase(): Promise<OperationResult> {
		return this.sendRequest<OperationResult>(
			'rebase',
			{},
			'rebaseResult',
			120000 // 2 minutes timeout for rebase (Claude CLI may need time to resolve conflicts)
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
