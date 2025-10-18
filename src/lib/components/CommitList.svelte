<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { CommitInfo } from '$lib/stores/terminals';
	import FileTree from './FileTree.svelte';
	import type { FileInfo } from '$lib/server/session-manager';
	import type { GitBackend } from '$lib/GitBackend';
	import type { FocusStack } from '$lib/FocusStack';

	export let commits: CommitInfo[] | null;
	export let active: boolean = false;
	export let files: FileInfo[] | null = null;
	export let onCommitSelect: (commitId: string | null) => void;
	export let width: number = 350;
	export let gitBackend: GitBackend | null = null;
	export let focusStack: FocusStack | null = null;
	export let selectedPath: string | null = null;

	const dispatch = createEventDispatcher();

	// Track selected commit (null = working tree)
	let selectedCommitId: string | null = null;

	// Tooltip state
	let hoveredCommitHash: string | null = null;
	let showTooltip: boolean = false;
	let tooltipTimer: ReturnType<typeof setTimeout> | null = null;
	let tooltipRight: number = 0;
	let tooltipY: number = 0;
	let commitPanelElement: HTMLDivElement;

	/**
	 * Format timestamp for display.
	 * Last 7 days: "Mo 12:03" format
	 * Older: "yy-mm-dd" format
	 */
	function formatTimestamp(timestamp: number): string {
		const date = new Date(timestamp * 1000); // Convert Unix timestamp to milliseconds
		const now = new Date();
		const daysDiff = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

		if (daysDiff < 7) {
			// Within last 7 days: show weekday abbreviation + time
			const weekdays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
			const weekday = weekdays[date.getDay()];
			const hours = String(date.getHours()).padStart(2, '0');
			const minutes = String(date.getMinutes()).padStart(2, '0');
			return `${weekday} ${hours}:${minutes}`;
		} else {
			// Older than 7 days: show yy-mm-dd
			const year = String(date.getFullYear()).slice(-2);
			const month = String(date.getMonth() + 1).padStart(2, '0');
			const day = String(date.getDate()).padStart(2, '0');
			return `${year}-${month}-${day}`;
		}
	}

	function selectCommit(commitId: string | null) {
		selectedCommitId = commitId;
		onCommitSelect(commitId);
	}

	function handleMouseEnter(event: MouseEvent, commit: CommitInfo) {
		// Clear any existing timer
		if (tooltipTimer) {
			clearTimeout(tooltipTimer);
		}

		// Capture the target element NOW, before setTimeout
		// event.currentTarget becomes null after the event handler completes
		const target = event.currentTarget as HTMLElement;

		// Start 1-second timer
		tooltipTimer = setTimeout(() => {
			if (!commitPanelElement || !target) return;

			hoveredCommitHash = commit.hash;

			// Position tooltip below the commit row, right-aligned with the panel
			const targetRect = target.getBoundingClientRect();
			const panelRect = commitPanelElement.getBoundingClientRect();

			// Calculate distance from right edge of viewport to align tooltip's right edge with panel's right edge
			tooltipRight = window.innerWidth - panelRect.right;
			// Position tooltip directly below the hovered row
			tooltipY = targetRect.bottom + 4;

			// Show tooltip after position is calculated
			showTooltip = true;
		}, 1000);
	}

	function handleMouseLeave() {
		// Clear timer and hide tooltip
		if (tooltipTimer) {
			clearTimeout(tooltipTimer);
			tooltipTimer = null;
		}
		showTooltip = false;
		hoveredCommitHash = null;
	}

	function handleFileClick(event: CustomEvent<{ path: string; status: string }>) {
		// Forward the fileClick event to parent, along with the currently selected commit
		dispatch('fileClick', {
			path: event.detail.path,
			status: event.detail.status,
			commitId: selectedCommitId
		});
	}
</script>

<div class="commit-panel" class:hidden={!active} style="width: {width}px" bind:this={commitPanelElement}>
	<div class="commit-list-section">
		<div
			class="commit-row commit-header"
			class:selected={selectedCommitId === null}
			on:click={() => selectCommit(null)}
			on:keydown={(e) => e.key === 'Enter' && selectCommit(null)}
			role="button"
			tabindex="0"
		>
			<span class="commit-hash"></span>
			<span class="commit-time"></span>
			<span class="commit-message">&lt;current working tree&gt;</span>
		</div>
		{#if commits && commits.length > 0}
			{#each commits as commit}
				<div
					class="commit-row"
					class:selected={selectedCommitId === commit.hash}
					on:click={() => selectCommit(commit.hash)}
					on:keydown={(e) => e.key === 'Enter' && selectCommit(commit.hash)}
					on:mouseenter={(e) => handleMouseEnter(e, commit)}
					on:mouseleave={handleMouseLeave}
					role="button"
					tabindex="0"
				>
					<span class="commit-hash">{commit.hash}</span>
					<span class="commit-time">{formatTimestamp(commit.timestamp)}</span>
					<span class="commit-message">{commit.message}</span>
				</div>
			{/each}
		{/if}
	</div>

	<div class="file-tree-section">
		<FileTree {files} {active} isWorktree={selectedCommitId === null} {gitBackend} {focusStack} {selectedPath} on:fileClick={handleFileClick} />
	</div>
</div>

{#if showTooltip && hoveredCommitHash}
	{@const hoveredCommit = commits?.find(c => c.hash === hoveredCommitHash)}
	{#if hoveredCommit}
		<div
			class="tooltip"
			style="right: {tooltipRight}px; top: {tooltipY}px;"
		>
			{hoveredCommit.fullMessage}
		</div>
	{/if}
{/if}

<style>
	.commit-panel {
		background-color: #1e1e1e;
		border-left: 1px solid #333333;
		color: #cccccc;
		font-family: 'Consolas', 'Courier New', monospace;
		font-size: 12px;
		display: flex;
		flex-direction: column;
		height: 100%;
		flex-shrink: 0;
	}

	.commit-panel.hidden {
		visibility: hidden;
		pointer-events: none;
	}

	.commit-list-section {
		height: 20%;
		overflow-y: auto;
		overflow-x: hidden;
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		border-bottom: 1px solid #333333;
	}

	.file-tree-section {
		height: 80%;
		overflow: hidden;
	}

	.commit-header {
		color: #888888;
		font-style: italic;
	}

	.commit-row {
		display: flex;
		gap: 8px;
		padding: 2px 4px;
		line-height: 1.4;
		cursor: pointer;
		border-radius: 2px;
	}

	.commit-row:hover {
		background-color: #2a2a2a;
	}

	.commit-row.selected {
		background-color: #094771;
	}

	.commit-row:focus {
		outline: 1px solid #007acc;
		outline-offset: -1px;
	}

	.commit-hash {
		color: #569cd6;
		flex-shrink: 0;
		width: 32px; /* 4 characters in monospace */
	}

	.commit-time {
		color: #b5cea8;
		flex-shrink: 0;
		width: 72px; /* "Mo 12:03" or "25-12-10" in monospace */
	}

	.commit-message {
		color: #cccccc;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.tooltip {
		position: fixed;
		background-color: #2d2d2d;
		border: 1px solid #3e3e3e;
		border-radius: 3px;
		padding: 8px 12px;
		color: #cccccc;
		font-family: 'Consolas', 'Courier New', monospace;
		font-size: 12px;
		max-width: 500px;
		white-space: pre-wrap;
		word-wrap: break-word;
		z-index: 1000;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
		pointer-events: none;
	}
</style>
