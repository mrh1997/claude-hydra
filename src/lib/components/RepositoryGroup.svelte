<script lang="ts">
	import type { TerminalTab } from '$lib/stores/terminals';
	import { createEventDispatcher } from 'svelte';

	export let repoName: string;
	export let repoPath: string;
	export let tabs: TerminalTab[];
	export let onTabClick: (id: string) => void;
	export let onTabClose: (id: string, event: MouseEvent) => void;
	export let onAddWorktree: (repoPath: string) => void;
	export let onCommitBadgeClick: (tab: TerminalTab, event: MouseEvent) => void;
	export let onDiscardClick: (tab: TerminalTab, event: MouseEvent) => void;
	export let onMergeBadgeClick: (tab: TerminalTab, event: MouseEvent) => void;
	export let onResetToBaseClick: (tab: TerminalTab, event: MouseEvent) => void;
	export let onRebaseBadgeClick: (tab: TerminalTab, event: MouseEvent) => void;
	export let operationInProgress: Set<string>;

	const dispatch = createEventDispatcher();

	function handleCloseRepository() {
		dispatch('closeRepository', repoPath);
	}

	function handleAddWorktree() {
		onAddWorktree(repoPath);
	}
</script>

<div class="repository-group">
	<div class="repo-header">
		<span class="repo-name">{repoName}</span>
		<button class="close-repo-btn" on:click={handleCloseRepository} title="Close repository">×</button>
	</div>

	<div class="tabs-container">
		{#each tabs as tab (tab.id)}
			<div
				class="tab"
				class:active={tab.active}
				on:click={() => onTabClick(tab.id)}
				role="tab"
				tabindex="0"
				on:keydown={(e) => e.key === 'Enter' && onTabClick(tab.id)}
			>
				<div class="tab-content">
					<div class="tab-header">
						<span class="state-indicator" class:ready={tab.state === 'ready'} class:running={tab.state === 'running'}></span>
						<span class="tab-title">{tab.title}</span>
						<button
							class="close-btn"
							on:click={(e) => onTabClose(tab.id, e)}
							aria-label="Close tab"
							title="Close tab (Alt-D)"
						>
							×
						</button>
					</div>
					{#if tab.gitStatus}
						<div class="badges">
							{#if tab.gitStatus.hasUncommittedChanges}
								<div class="badge commit-badge" title="The working directory contains modified files that are not committed yet. Click to commit them.">
									<span class="badge-text" on:click={(e) => onCommitBadgeClick(tab, e)}>Modified</span>
									<button class="badge-x" on:click={(e) => onDiscardClick(tab, e)}>×</button>
								</div>
							{/if}
							{#if tab.gitStatus.hasUnmergedCommits}
								<div class="badge merge-badge" title="The branch contains pending commits that are not merged yet. Click to merge them.">
									{#if operationInProgress.has(tab.id)}
										<span class="spinner"></span>
									{/if}
									<span class="badge-text" on:click={(e) => onMergeBadgeClick(tab, e)}>Unmerged</span>
									<button class="badge-x" on:click={(e) => onResetToBaseClick(tab, e)}>×</button>
								</div>
							{/if}
							{#if tab.gitStatus.isBehindBase}
								<div class="badge rebase-badge" on:click={(e) => onRebaseBadgeClick(tab, e)} title="Current branch is behind the base branch. Click to rebase">
									{#if operationInProgress.has(tab.id)}
										<span class="spinner"></span>
									{/if}
									<span class="badge-text">Outdated</span>
								</div>
							{/if}
						</div>
					{/if}
				</div>
			</div>
		{/each}

		<button class="add-worktree-btn" on:click={handleAddWorktree}>
			<span class="new-tab-icon">+</span>
			<span class="new-tab-label">(add working tree)</span>
		</button>
	</div>
</div>

<style>
	.repository-group {
		/* No margin - let parent handle spacing */
	}

	.repo-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 12px;
		background-color: #2d2d2d;
		border-bottom: 0.5px dashed #666666;
		font-weight: 600;
		font-size: 13px;
	}

	.repo-header:hover .close-repo-btn {
		opacity: 0.7;
	}

	.repo-name {
		color: #cccccc;
	}

	.close-repo-btn {
		background: none;
		border: none;
		color: #cccccc;
		cursor: pointer;
		font-size: 18px;
		line-height: 1;
		padding: 4px;
		opacity: 0;
		transition: opacity 0.2s;
	}

	.close-repo-btn:hover {
		opacity: 1 !important;
	}

	.tabs-container {
		padding-left: 12px; /* Indent tabs */
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
		border-left: 2px solid #007acc;
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
		transform: translate(-50%, -50%);
		width: 150%;
		height: 150%;
		border-radius: 50%;
		background-color: #cd3131;
		opacity: 0.5;
		animation: pulse 1.5s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% {
			opacity: 0.5;
			transform: translate(-50%, -50%) scale(1);
		}
		50% {
			opacity: 0;
			transform: translate(-50%, -50%) scale(1.5);
		}
	}

	.tab-title {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: #cccccc;
		font-size: 13px;
	}

	.close-btn {
		background: none;
		border: none;
		color: #cccccc;
		cursor: pointer;
		font-size: 18px;
		line-height: 1;
		padding: 4px;
		margin-left: auto;
		opacity: 0;
		transition: opacity 0.2s;
	}

	.tab:hover .close-btn {
		opacity: 0.7;
	}

	.close-btn:hover {
		opacity: 1 !important;
	}

	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 2px;
	}

	.badge {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		padding: 1.6px 6px;
		border-radius: 5px;
		font-size: 10px;
		cursor: pointer;
		transition: opacity 0.2s;
	}

	.badge:hover {
		opacity: 0.8;
	}

	.badge-text {
		user-select: none;
	}

	.badge-x {
		background: none;
		border: none;
		color: inherit;
		cursor: pointer;
		font-size: 14px;
		line-height: 1;
		padding: 0;
		margin-left: 2px;
	}

	.badge-x:hover {
		filter: brightness(1.3);
	}

	.commit-badge {
		background-color: transparent;
		border: 1px solid #5cacf5;
		color: #5cacf5;
	}

	.merge-badge {
		background-color: #5cacf5;
		color: #1e1e1e;
	}

	.rebase-badge {
		background-color: #0066cc;
		color: #ffffff;
	}

	.add-worktree-btn {
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

	.add-worktree-btn:hover {
		background-color: #2d2d2d;
	}

	.new-tab-icon {
		font-size: 20px;
	}

	.new-tab-label {
		font-size: 11px;
		color: #999999;
	}

	.spinner {
		display: inline-block;
		width: 10px;
		height: 10px;
		border: 2px solid rgba(0, 0, 0, 0.3);
		border-top-color: currentColor;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
