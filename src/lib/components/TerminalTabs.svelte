<script lang="ts">
	import { terminals } from '$lib/stores/terminals';
	import { gitBackends } from '$lib/stores/gitBackends';
	import { v4 as uuidv4 } from 'uuid';
	import { getContext } from 'svelte';
	import BranchNameDialog from './BranchNameDialog.svelte';
	import CloseTabDialog from './CloseTabDialog.svelte';
	import CommitMessageDialog from './CommitMessageDialog.svelte';
	import ConfirmationDialog from './ConfirmationDialog.svelte';

	const version = getContext<string>('version');

	// Helper function to get GitBackend for a sessionId
	function getGitBackend(sessionId: string | null) {
		if (!sessionId) return null;
		let backend = null;
		gitBackends.subscribe(backends => {
			backend = backends.get(sessionId) || null;
		})();
		return backend;
	}

	export let onNewTab: (id: string, branchName: string) => void = () => {};

	let showBranchDialog = false;
	let showCloseDialog = false;
	let showCommitDialog = false;
	let showDiscardConfirmDialog = false;
	let dialogError = '';
	let closeError = '';
	let successMessage = '';
	let pendingCloseTabId: string | null = null;
	let pendingDiscardTab: any = null;
	let isDiscardingCommits = false;
	let hasUncommittedChanges = false;
	let hasUnmergedCommits = false;
	let isExitClose = false;
	let isRestarting = false;
	let mergingTabIds = new Set<string>(); // Track tabs currently being merged

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

	async function checkAndClose(id: string, isExit: boolean) {
		closeError = '';

		const tab = $terminals.find(t => t.id === id);
		if (!tab || !tab.sessionId) {
			// No session ID yet, just close
			terminals.removeTab(id);
			return;
		}

		pendingCloseTabId = id;
		isExitClose = isExit;

		// Use cached git status from tab store (no need to wait for backend)
		const status = tab.gitStatus;
		if (!status) {
			// No status available yet, just close
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

	async function closeTab(id: string, event: MouseEvent) {
		event.stopPropagation();
		await checkAndClose(id, false);
	}


	async function performMerge(sessionId: string, commitMessage?: string): Promise<{ success: boolean; error?: string }> {
		const backend = getGitBackend(sessionId);
		if (!backend) {
			return { success: false, error: 'No backend connection' };
		}

		try {
			return await backend.performMerge(commitMessage);
		} catch (error: any) {
			return { success: false, error: error.message || 'Merge failed' };
		}
	}

	async function performRestart(sessionId: string): Promise<{ success: boolean; error?: string }> {
		const backend = getGitBackend(sessionId);
		if (!backend) {
			return { success: false, error: 'No backend connection' };
		}

		try {
			await backend.restart();
			return { success: true };
		} catch (error: any) {
			return { success: false, error: error.message || 'Restart failed' };
		}
	}

	function handleCloseDialogCancel() {
		showCloseDialog = false;
		// Just close the dialog - the process is still running
		pendingCloseTabId = null;
	}


	async function handleCloseDialogDiscard() {
		showCloseDialog = false;
		if (!pendingCloseTabId) return;

		const tab = $terminals.find(t => t.id === pendingCloseTabId);
		if (tab && tab.sessionId) {
			// Discard both uncommitted changes and unmerged commits
			const ws = new WebSocket('ws://localhost:3001');
			ws.onopen = () => {
				// First discard uncommitted changes
				ws.send(JSON.stringify({ type: 'discardChanges', sessionId: tab.sessionId }));
				// Then reset to base (undo unmerged commits)
				ws.send(JSON.stringify({ type: 'resetToBase', sessionId: tab.sessionId }));
				ws.close();
			};

			// Wait a bit for operations to complete, then close tab
			setTimeout(() => {
				terminals.removeTab(pendingCloseTabId!);
				pendingCloseTabId = null;
			}, 500);
		} else {
			// No session, just close
			terminals.removeTab(pendingCloseTabId);
			pendingCloseTabId = null;
		}
	}

	async function handleCloseDialogRestart() {
		showCloseDialog = false;
		if (!pendingCloseTabId) return;

		const tab = $terminals.find(t => t.id === pendingCloseTabId);
		if (tab && tab.sessionId) {
			// Send restart request
			const ws = new WebSocket('ws://localhost:3001');
			ws.onopen = () => {
				ws.send(JSON.stringify({ type: 'restart', sessionId: tab.sessionId }));
				ws.close();
			};
		}
		pendingCloseTabId = null;
	}

	async function handleCommitDialogSubmit(event: CustomEvent<string>) {
		const commitMessage = event.detail;
		showCommitDialog = false;

		if (!pendingCloseTabId) return;

		const tab = $terminals.find(t => t.id === pendingCloseTabId);
		if (!tab || !tab.sessionId) return;

		const backend = getGitBackend(tab.sessionId);
		if (!backend) {
			closeError = 'No backend connection';
			setTimeout(() => closeError = '', 5000);
			pendingCloseTabId = null;
			return;
		}

		// Always just commit (never merge)
		try {
			const result = await backend.commit(commitMessage);

			if (!result.success) {
				closeError = result.error || 'Commit failed';
				setTimeout(() => closeError = '', 5000);
			} else {
				successMessage = 'Changes committed successfully';
				setTimeout(() => successMessage = '', 4000);
			}
		} catch (error: any) {
			closeError = error.message || 'Commit failed';
			setTimeout(() => closeError = '', 5000);
		}

		pendingCloseTabId = null;
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

		// If this tab is being merged, the exit event is expected (merge kills PTY)
		// Just remove the tab and let the merge flow handle cleanup
		if (mergingTabIds.has(id)) {
			terminals.removeTab(id);
			mergingTabIds.delete(id);
			return;
		}

		await checkAndClose(id, true);
	}

	async function handleCommitBadgeClick(tab: any, event: MouseEvent) {
		event.stopPropagation();
		if (!tab.sessionId) return;
		// Show commit message dialog
		pendingCloseTabId = tab.id;
		showCommitDialog = true;
	}

	async function handleDiscardClick(tab: any, event: MouseEvent) {
		event.stopPropagation();
		if (!tab.sessionId) return;

		// Show confirmation dialog
		pendingDiscardTab = tab;
		isDiscardingCommits = false;
		showDiscardConfirmDialog = true;
	}

	async function handleMergeBadgeClick(tab: any, event: MouseEvent) {
		event.stopPropagation();
		if (!tab.sessionId) return;

		// Directly merge (without committing uncommitted changes)
		const result = await performMerge(tab.sessionId);
		if (result.success) {
			successMessage = 'Branch merged successfully';
			setTimeout(() => successMessage = '', 4000);
		} else {
			closeError = result.error || 'Merge failed';
			setTimeout(() => closeError = '', 5000);
		}
	}

	async function handleResetToBaseClick(tab: any, event: MouseEvent) {
		event.stopPropagation();
		if (!tab.sessionId) return;

		// Show confirmation dialog
		pendingDiscardTab = tab;
		isDiscardingCommits = true;
		showDiscardConfirmDialog = true;
	}

	async function handleRebaseBadgeClick(tab: any, event: MouseEvent) {
		event.stopPropagation();
		if (!tab.sessionId) return;

		const backend = getGitBackend(tab.sessionId);
		if (!backend) {
			closeError = 'No backend connection';
			setTimeout(() => closeError = '', 5000);
			return;
		}

		try {
			const result = await backend.performRebase();
			if (!result.success) {
				closeError = result.error || 'Rebase failed';
				setTimeout(() => closeError = '', 5000);
			} else {
				successMessage = 'Branch rebased successfully';
				setTimeout(() => successMessage = '', 4000);
			}
		} catch (error: any) {
			closeError = error.message || 'Rebase failed';
			setTimeout(() => closeError = '', 5000);
		}
	}

	async function handleDiscardConfirm() {
		showDiscardConfirmDialog = false;
		if (!pendingDiscardTab || !pendingDiscardTab.sessionId) return;

		const backend = getGitBackend(pendingDiscardTab.sessionId);
		if (!backend) {
			closeError = 'No backend connection';
			setTimeout(() => closeError = '', 5000);
			pendingDiscardTab = null;
			return;
		}

		try {
			const result = isDiscardingCommits
				? await backend.resetToBase()
				: await backend.discardChanges();

			if (!result.success) {
				closeError = result.error || 'Operation failed';
				setTimeout(() => closeError = '', 5000);
			}
		} catch (error: any) {
			closeError = error.message || 'Operation failed';
			setTimeout(() => closeError = '', 5000);
		}

		pendingDiscardTab = null;
	}

	function handleDiscardCancel() {
		showDiscardConfirmDialog = false;
		pendingDiscardTab = null;
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
	on:discard={handleCloseDialogDiscard}
	on:restart={handleCloseDialogRestart}
	on:cancel={handleCloseDialogCancel}
/>

<CommitMessageDialog
	bind:show={showCommitDialog}
	on:submit={handleCommitDialogSubmit}
	on:cancel={handleCommitDialogCancel}
/>

<ConfirmationDialog
	bind:show={showDiscardConfirmDialog}
	title="Confirm Discard"
	message={isDiscardingCommits
		? "Are you sure you want to discard all pending commits?"
		: "Are you sure you want to discard all uncommitted local changes?"}
	confirmText="Discard"
	on:confirm={handleDiscardConfirm}
	on:cancel={handleDiscardCancel}
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
				<div class="tab-content">
					<div class="tab-header">
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
					{#if tab.gitStatus}
						<div class="badges">
							{#if tab.gitStatus.hasUncommittedChanges}
								<div class="badge commit-badge" title="The working directory contains modified files that are not committed yet. Click to commit them.">
									<span class="badge-text" on:click={(e) => handleCommitBadgeClick(tab, e)}>Modified</span>
									<button class="badge-x" on:click={(e) => handleDiscardClick(tab, e)}>×</button>
								</div>
							{/if}
							{#if tab.gitStatus.hasUnmergedCommits}
								<div class="badge merge-badge" title="The branch contains pending commits that are not merged yet. Click to merge them.">
									<span class="badge-text" on:click={(e) => handleMergeBadgeClick(tab, e)}>Unmerged</span>
									<button class="badge-x" on:click={(e) => handleResetToBaseClick(tab, e)}>×</button>
								</div>
							{/if}
							{#if tab.gitStatus.isBehindBase}
								<div class="badge rebase-badge" on:click={(e) => handleRebaseBadgeClick(tab, e)} title="Current branch is behind the base branch. Click to rebase">
									<span class="badge-text">Outdated</span>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		{/each}
		<button class="new-tab-btn" on:click={handleNewTabClick} aria-label="New terminal">
			<span class="new-tab-icon">+</span>
			<span class="new-tab-label">(add working tree)</span>
		</button>
	</div>
	{#if version}
		<div class="version-indicator">{version}</div>
	{/if}
	{#if closeError}
		<div class="error-banner">{closeError}</div>
	{/if}
	{#if successMessage}
		<div class="success-banner">{successMessage}</div>
	{/if}
</div>

<style>
	.tabs-container {
		background-color: #2d2d2d;
		border-right: 1px solid #1e1e1e;
		display: flex;
		flex-direction: column;
		align-items: stretch;
		width: min(270px, 30vw);
		overflow-y: auto;
		overflow-x: hidden;
	}

	.tabs {
		display: flex;
		flex-direction: column;
		gap: 0;
		padding: 8px 0;
		width: 100%;
	}

	.tab {
		display: flex;
		flex-direction: column;
		justify-content: center;
		padding: 8px 12px;
		background-color: #2d2d2d;
		border: none;
		cursor: pointer;
		user-select: none;
		transition: background-color 0.2s;
		min-height: 80px;
		width: 100%;
		position: relative;
	}

	.tab-content {
		display: flex;
		flex-direction: column;
		gap: 4px;
		width: 100%;
	}

	.tab-header {
		display: flex;
		align-items: center;
		gap: 8px;
		white-space: nowrap;
	}

	.tab::after {
		content: '';
		position: absolute;
		bottom: 0;
		left: 12px;
		right: 12px;
		border-bottom: 0.5px dashed #666666;
	}

	.tab:hover {
		background-color: #252525;
	}

	.tab.active {
		background-color: #1e1e1e;
		border-right: 2px solid #007acc;
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

	.badges {
		display: flex;
		gap: 4px;
		flex-wrap: wrap;
		margin-left: 20px;
	}

	.badge {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 2px 6px;
		font-size: 10px;
		border-radius: 3px;
		cursor: pointer;
		transition: opacity 0.2s;
	}

	.badge:hover {
		opacity: 0.8;
	}

	.badge-text {
		cursor: pointer;
	}

	.badge-x {
		background: none;
		border: none;
		color: inherit;
		cursor: pointer;
		font-size: 12px;
		line-height: 1;
		padding: 0 2px;
		margin-left: 2px;
	}

	.badge-x:hover {
		opacity: 0.7;
	}

	.commit-badge {
		background-color: transparent;
		border: 2px dotted #e5e510;
		color: #e5e510;
	}

	.merge-badge {
		background-color: #e5e510;
		color: #1e1e1e;
	}

	.rebase-badge {
		background-color: #ff8c00;
		color: #1e1e1e;
	}

	.new-tab-btn {
		background: none;
		border: none;
		color: #cccccc;
		cursor: pointer;
		padding: 0;
		height: 80px;
		width: 100%;
		flex-shrink: 0;
		transition: background-color 0.2s;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 4px;
	}

	.new-tab-btn:hover {
		background-color: #2d2d2d;
	}

	.new-tab-icon {
		font-size: 20px;
	}

	.new-tab-label {
		font-size: 11px;
		color: #999999;
	}

	.error-banner {
		position: absolute;
		top: 0;
		left: min(270px, 30vw);
		right: 0;
		background-color: #5a1d1d;
		border-bottom: 1px solid #be1100;
		color: #f48771;
		padding: 8px 16px;
		font-size: 13px;
		z-index: 999;
	}

	.success-banner {
		position: absolute;
		top: 0;
		left: min(270px, 30vw);
		right: 0;
		background-color: #1d5a1d;
		border-bottom: 1px solid #00be11;
		color: #71f487;
		padding: 8px 16px;
		font-size: 13px;
		z-index: 999;
	}

	.version-indicator {
		position: absolute;
		bottom: 8px;
		left: 8px;
		font-size: 12px;
		color: rgba(255, 255, 255, 0.3);
		font-family: monospace;
		user-select: none;
		pointer-events: none;
		z-index: 1000;
	}
</style>
