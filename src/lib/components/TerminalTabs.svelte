<script lang="ts">
	import { terminals } from '$lib/stores/terminals';
	import { v4 as uuidv4 } from 'uuid';
	import BranchNameDialog from './BranchNameDialog.svelte';
	import CloseTabDialog from './CloseTabDialog.svelte';
	import CommitMessageDialog from './CommitMessageDialog.svelte';

	export let onNewTab: (id: string, branchName: string) => void = () => {};

	let showBranchDialog = false;
	let showCloseDialog = false;
	let showCommitDialog = false;
	let dialogError = '';
	let closeError = '';
	let pendingCloseTabId: string | null = null;
	let hasUncommittedChanges = false;
	let hasUnmergedCommits = false;
	let isExitClose = false;
	let isRestarting = false;

	function handleNewTabClick() {
		showBranchDialog = true;
		dialogError = '';
	}

	function handleDialogSubmit(event: CustomEvent<string>) {
		const branchName = event.detail;
		const id = uuidv4();
		terminals.addTab(id, branchName);
		onNewTab(id, branchName);
		showBranchDialog = false;
		dialogError = '';
	}

	function handleDialogCancel() {
		showBranchDialog = false;
		dialogError = '';
	}

	async function closeTab(id: string, event: MouseEvent) {
		event.stopPropagation();
		closeError = '';

		const tab = $terminals.find(t => t.id === id);
		if (!tab || !tab.sessionId) {
			// No session ID yet, just close
			terminals.removeTab(id);
			return;
		}

		pendingCloseTabId = id;
		isExitClose = false; // This is closing via "x" button

		// Check git status before closing
		const status = await getGitStatus(tab.sessionId);
		if (!status) {
			// Error getting status, just close
			terminals.removeTab(id);
			pendingCloseTabId = null;
			return;
		}

		hasUncommittedChanges = status.hasUncommittedChanges;
		hasUnmergedCommits = status.hasUnmergedCommits;

		// If no changes or commits, just close
		if (!hasUncommittedChanges && !hasUnmergedCommits) {
			terminals.removeTab(id);
			pendingCloseTabId = null;
			return;
		}

		// Show dialog to ask user what to do
		showCloseDialog = true;
	}

	async function getGitStatus(sessionId: string): Promise<{ hasUncommittedChanges: boolean; hasUnmergedCommits: boolean } | null> {
		return new Promise((resolve) => {
			const ws = new WebSocket('ws://localhost:3001');
			let timeoutId: number;

			ws.onopen = () => {
				// Send sessionId in message to check existing session
				ws.send(JSON.stringify({ type: 'getGitStatus', sessionId }));
				timeoutId = window.setTimeout(() => {
					ws.close();
					resolve(null);
				}, 5000);
			};

			ws.onmessage = (event) => {
				const message = JSON.parse(event.data);
				if (message.type === 'gitStatus') {
					clearTimeout(timeoutId);
					ws.close();
					resolve(message.status);
				} else if (message.type === 'error') {
					clearTimeout(timeoutId);
					ws.close();
					resolve(null);
				}
			};

			ws.onerror = () => {
				clearTimeout(timeoutId);
				resolve(null);
			};
		});
	}

	async function performMerge(sessionId: string, commitMessage?: string): Promise<{ success: boolean; error?: string }> {
		return new Promise((resolve) => {
			const ws = new WebSocket('ws://localhost:3001');
			let timeoutId: number;

			ws.onopen = () => {
				ws.send(JSON.stringify({ type: 'merge', sessionId, commitMessage }));
				timeoutId = window.setTimeout(() => {
					ws.close();
					resolve({ success: false, error: 'Timeout' });
				}, 10000);
			};

			ws.onmessage = (event) => {
				const message = JSON.parse(event.data);
				if (message.type === 'mergeResult') {
					clearTimeout(timeoutId);
					ws.close();
					resolve(message.result);
				}
			};

			ws.onerror = () => {
				clearTimeout(timeoutId);
				resolve({ success: false, error: 'Connection error' });
			};
		});
	}

	async function performRestart(sessionId: string): Promise<{ success: boolean; error?: string }> {
		return new Promise((resolve) => {
			const ws = new WebSocket('ws://localhost:3001');
			let timeoutId: number;

			ws.onopen = () => {
				ws.send(JSON.stringify({ type: 'restart', sessionId }));
				timeoutId = window.setTimeout(() => {
					ws.close();
					resolve({ success: false, error: 'Timeout' });
				}, 10000);
			};

			ws.onmessage = (event) => {
				const message = JSON.parse(event.data);
				if (message.type === 'restarted') {
					clearTimeout(timeoutId);
					ws.close();
					resolve({ success: true });
				} else if (message.type === 'error') {
					clearTimeout(timeoutId);
					ws.close();
					resolve({ success: false, error: message.error });
				}
			};

			ws.onerror = () => {
				clearTimeout(timeoutId);
				resolve({ success: false, error: 'Connection error' });
			};
		});
	}

	function handleCloseDialogCancel() {
		showCloseDialog = false;
		isExitClose = false; // Reset the flag

		// Just close the dialog - the process is still running
		pendingCloseTabId = null;
	}

	function handleCloseDialogCommitAndMerge() {
		showCloseDialog = false;
		isExitClose = false; // Reset the flag
		showCommitDialog = true;
	}

	async function handleCloseDialogMerge() {
		showCloseDialog = false;
		isExitClose = false; // Reset the flag

		if (!pendingCloseTabId) return;

		const tab = $terminals.find(t => t.id === pendingCloseTabId);
		if (!tab || !tab.sessionId) return;

		const result = await performMerge(tab.sessionId);
		if (result.success) {
			terminals.removeTab(pendingCloseTabId);
			pendingCloseTabId = null;
		} else {
			closeError = result.error || 'Merge failed. Please resolve before closing tab';
			setTimeout(() => closeError = '', 5000);
			pendingCloseTabId = null;
		}
	}

	function handleCloseDialogDiscard() {
		showCloseDialog = false;
		isExitClose = false; // Reset the flag
		if (pendingCloseTabId) {
			terminals.removeTab(pendingCloseTabId);
			pendingCloseTabId = null;
		}
	}

	async function handleCommitDialogSubmit(event: CustomEvent<string>) {
		const commitMessage = event.detail;
		showCommitDialog = false;

		if (!pendingCloseTabId) return;

		const tab = $terminals.find(t => t.id === pendingCloseTabId);
		if (!tab || !tab.sessionId) return;

		const result = await performMerge(tab.sessionId, commitMessage);
		if (result.success) {
			terminals.removeTab(pendingCloseTabId);
			pendingCloseTabId = null;
		} else {
			closeError = result.error || 'Merge failed. Please resolve before closing tab';
			setTimeout(() => closeError = '', 5000);
			pendingCloseTabId = null;
		}
	}

	function handleCommitDialogCancel() {
		showCommitDialog = false;
		pendingCloseTabId = null;
	}

	export async function handleExit(id: string) {
		// Ignore exit events during restart
		if (isRestarting) {
			return;
		}

		closeError = '';

		const tab = $terminals.find(t => t.id === id);
		if (!tab || !tab.sessionId) {
			// No session ID yet, just close
			terminals.removeTab(id);
			return;
		}

		pendingCloseTabId = id;
		isExitClose = true; // This is closing via /exit command

		// Check git status before closing
		const status = await getGitStatus(tab.sessionId);
		if (!status) {
			// Error getting status, just close
			terminals.removeTab(id);
			pendingCloseTabId = null;
			return;
		}

		hasUncommittedChanges = status.hasUncommittedChanges;
		hasUnmergedCommits = status.hasUnmergedCommits;

		// If no changes or commits, just close
		if (!hasUncommittedChanges && !hasUnmergedCommits) {
			terminals.removeTab(id);
			pendingCloseTabId = null;
			return;
		}

		// Show dialog to ask user what to do, with isExit set to true
		showCloseDialog = true;
	}

	function selectTab(id: string) {
		terminals.setActiveTab(id);
	}
</script>

<BranchNameDialog
	bind:show={showBranchDialog}
	bind:errorMessage={dialogError}
	on:submit={handleDialogSubmit}
	on:cancel={handleDialogCancel}
/>

<CloseTabDialog
	bind:show={showCloseDialog}
	bind:hasUncommittedChanges
	bind:hasUnmergedCommits
	isExit={isExitClose}
	on:commitAndMerge={handleCloseDialogCommitAndMerge}
	on:merge={handleCloseDialogMerge}
	on:discard={handleCloseDialogDiscard}
	on:cancel={handleCloseDialogCancel}
/>

<CommitMessageDialog
	bind:show={showCommitDialog}
	on:submit={handleCommitDialogSubmit}
	on:cancel={handleCommitDialogCancel}
/>

<div class="tabs-container">
	<div class="tabs">
		{#each $terminals as tab (tab.id)}
			<div
				class="tab"
				class:active={tab.active}
				on:click={() => selectTab(tab.id)}
				role="tab"
				tabindex="0"
				on:keydown={(e) => e.key === 'Enter' && selectTab(tab.id)}
			>
				<span class="state-indicator" class:ready={tab.state === 'ready'} class:running={tab.state === 'running'}></span>
				<span class="tab-title">{tab.title}</span>
				<button
					class="close-btn"
					on:click={(e) => closeTab(tab.id, e)}
					aria-label="Close tab"
				>
					×
				</button>
			</div>
		{/each}
		<button class="new-tab-btn" on:click={handleNewTabClick} aria-label="New terminal">
			+
		</button>
	</div>
	{#if closeError}
		<div class="error-banner">{closeError}</div>
	{/if}
</div>

<style>
	.tabs-container {
		background-color: #2d2d2d;
		border-bottom: 1px solid #1e1e1e;
		display: flex;
		align-items: center;
		height: 40px;
		overflow-x: auto;
		overflow-y: hidden;
	}

	.tabs {
		display: flex;
		gap: 2px;
		padding: 0 8px;
		height: 100%;
	}

	.tab {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 0 12px;
		background-color: #252525;
		border: none;
		cursor: pointer;
		user-select: none;
		white-space: nowrap;
		transition: background-color 0.2s;
		min-width: 120px;
		max-width: 200px;
	}

	.tab:hover {
		background-color: #2d2d2d;
	}

	.tab.active {
		background-color: #1e1e1e;
		border-bottom: 2px solid #007acc;
	}

	.state-indicator {
		width: 0.8em;
		height: 0.8em;
		border-radius: 50%;
		flex-shrink: 0;
		position: relative;
	}

	.state-indicator.ready {
		background-color: #0dbc79;
	}

	.state-indicator.running {
		background-color: #cd3131;
	}

	.state-indicator.running::before {
		content: '';
		position: absolute;
		top: 50%;
		left: 50%;
		width: 100%;
		height: 100%;
		border-radius: 50%;
		background-color: #cd3131;
		transform: translate(-50%, -50%);
		animation: pulse 1.5s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% {
			opacity: 0.3;
			transform: translate(-50%, -50%) scale(1);
		}
		50% {
			opacity: 0.8;
			transform: translate(-50%, -50%) scale(1.25);
		}
	}

	.tab-title {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		color: #cccccc;
		font-size: 13px;
	}

	.close-btn {
		background: none;
		border: none;
		color: #cccccc;
		cursor: pointer;
		font-size: 20px;
		line-height: 1;
		padding: 0;
		width: 20px;
		height: 20px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 3px;
		transition: background-color 0.2s;
	}

	.close-btn:hover {
		background-color: #3e3e3e;
	}

	.new-tab-btn {
		background: none;
		border: none;
		color: #cccccc;
		cursor: pointer;
		font-size: 20px;
		padding: 0 12px;
		height: 100%;
		transition: background-color 0.2s;
	}

	.new-tab-btn:hover {
		background-color: #2d2d2d;
	}

	.error-banner {
		position: absolute;
		top: 40px;
		left: 0;
		right: 0;
		background-color: #5a1d1d;
		border-bottom: 1px solid #be1100;
		color: #f48771;
		padding: 8px 16px;
		font-size: 13px;
		z-index: 999;
	}
</style>
