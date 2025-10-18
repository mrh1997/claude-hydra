<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import DeleteConfirmationDialog from './DeleteConfirmationDialog.svelte';
	import CreateFileDialog from './CreateFileDialog.svelte';
	import type { GitBackend } from '$lib/GitBackend';
	import type { FocusStack } from '$lib/FocusStack';

	export let files: FileInfo[] | null;
	export let active: boolean = false;
	export let isWorktree: boolean = false;
	export let gitBackend: GitBackend | null = null;
	export let focusStack: FocusStack | null = null;
	export let selectedPath: string | null = null;

	const dispatch = createEventDispatcher();

	type FileStatus = 'modified' | 'added' | 'deleted' | 'untracked' | 'unchanged' | 'ignored';

	interface FileInfo {
		path: string;
		status: FileStatus;
		isDirectory?: boolean;
	}

	type FilterMode = 'modified' | 'all' | 'all+ignored';
	let filterMode: FilterMode = 'modified';

	// Dialog state
	let showDeleteDialog = false;
	let showCreateDialog = false;
	let deleteTargetPath = '';
	let deleteTargetIsDirectory = false;
	let createParentPath = '';
	let createErrorMessage = '';

	// Hover state
	let hoveredPath: string | null = null;

	interface TreeNode {
		name: string;
		path: string;
		isDirectory: boolean;
		status: FileStatus;
		children: TreeNode[];
	}

	// Track which directories are expanded (default is collapsed)
	let expandedDirs = new Map<string, boolean>();

	/**
	 * Toggle directory expanded state
	 */
	function toggleDirectory(path: string) {
		expandedDirs.set(path, !expandedDirs.get(path));
		expandedDirs = expandedDirs; // Trigger reactivity
	}

	/**
	 * Check if directory is expanded
	 */
	function isExpanded(path: string): boolean {
		return expandedDirs.get(path) || false;
	}

	/**
	 * Build a tree structure from flat file list
	 */
	function buildTree(fileList: FileInfo[]): TreeNode[] {
		const root: TreeNode[] = [];
		const nodeMap = new Map<string, TreeNode>();

		for (const file of fileList) {
			// Skip files with empty paths
			if (!file.path || !file.path.trim()) continue;

			// If this is explicitly marked as a directory, handle it specially
			if (file.isDirectory) {
				const parts = file.path.split('/').filter(part => part.length > 0);
				if (parts.length === 0) continue;

				let currentPath = '';
				for (let i = 0; i < parts.length; i++) {
					const part = parts[i];
					const parentPath = currentPath;
					currentPath = currentPath ? `${currentPath}/${part}` : part;

					if (!nodeMap.has(currentPath)) {
						const node: TreeNode = {
							name: part,
							path: currentPath,
							isDirectory: true,
							status: i === parts.length - 1 ? file.status : 'unchanged',
							children: []
						};

						nodeMap.set(currentPath, node);

						if (parentPath) {
							const parent = nodeMap.get(parentPath);
							if (parent) {
								parent.children.push(node);
							}
						} else {
							root.push(node);
						}
					} else {
						// Update existing directory node status if needed
						const existingNode = nodeMap.get(currentPath);
						if (existingNode && i === parts.length - 1 && file.status !== 'unchanged') {
							if (existingNode.status === 'unchanged') {
								existingNode.status = file.status;
							}
						}
					}
				}
				continue;
			}

			// Handle regular files
			const parts = file.path.split('/').filter(part => part.length > 0);

			// Skip if no valid path parts (e.g., path was just slashes)
			if (parts.length === 0) continue;

			let currentPath = '';

			for (let i = 0; i < parts.length; i++) {
				const part = parts[i];
				const parentPath = currentPath;
				currentPath = currentPath ? `${currentPath}/${part}` : part;
				const isFile = i === parts.length - 1;

				if (!nodeMap.has(currentPath)) {
					const node: TreeNode = {
						name: part,
						path: currentPath,
						isDirectory: !isFile,
						status: isFile ? file.status : 'unchanged',
						children: []
					};

					nodeMap.set(currentPath, node);

					if (parentPath) {
						const parent = nodeMap.get(parentPath);
						if (parent) {
							parent.children.push(node);
						}
					} else {
						root.push(node);
					}
				}

				// Update directory status if it contains modified files
				if (!isFile) {
					const dirNode = nodeMap.get(currentPath);
					if (dirNode && file.status !== 'unchanged') {
						// Mark directory as modified if it contains any modified files
						if (dirNode.status === 'unchanged') {
							dirNode.status = file.status;
						}
					}
				}
			}
		}

		// Sort: directories first, then alphabetically
		function sortNodes(nodes: TreeNode[]) {
			nodes.sort((a, b) => {
				if (a.isDirectory && !b.isDirectory) return -1;
				if (!a.isDirectory && b.isDirectory) return 1;
				return a.name.localeCompare(b.name);
			});
			nodes.forEach(node => {
				if (node.isDirectory) {
					sortNodes(node.children);
				}
			});
		}
		sortNodes(root);

		return root;
	}

	/**
	 * Check if a directory contains any modified files (recursively)
	 */
	function hasModifiedFiles(node: TreeNode): boolean {
		if (!node.isDirectory) {
			return node.status !== 'unchanged';
		}
		return node.children.some(child => hasModifiedFiles(child));
	}

	/**
	 * Filter tree based on current filter mode
	 */
	function filterTree(nodes: TreeNode[], mode: FilterMode): TreeNode[] {
		if (mode === 'all+ignored') {
			// Show all files including ignored
			return nodes;
		}

		// Filter based on mode
		return nodes
			.map(node => {
				if (node.isDirectory) {
					const filteredChildren = filterTree(node.children, mode);

					// Show directory based on filter mode
					if (mode === 'modified') {
						// In modified mode, only show directories with visible children
						if (filteredChildren.length > 0) {
							return { ...node, children: filteredChildren };
						}
					} else {
						// In all mode, show all directories except ignored (if they have children OR are explicitly visible)
						const dirShouldBeVisible = node.status !== 'ignored';
						if (filteredChildren.length > 0 || dirShouldBeVisible) {
							return { ...node, children: filteredChildren };
						}
					}
					return null;
				} else {
					// File filtering logic
					if (mode === 'all') {
						// Show all files except ignored
						return node.status !== 'ignored' ? node : null;
					} else {
						// mode === 'modified': Show only modified files (exclude unchanged and ignored)
						return (node.status !== 'unchanged' && node.status !== 'ignored') ? node : null;
					}
				}
			})
			.filter((node): node is TreeNode => node !== null);
	}

	/**
	 * Get color class for file status
	 */
	function getStatusColor(status: FileStatus): string {
		switch (status) {
			case 'modified':
				return 'status-modified';
			case 'added':
				return 'status-added';
			case 'deleted':
				return 'status-deleted';
			case 'untracked':
				return 'status-untracked';
			case 'ignored':
				return 'status-ignored';
			default:
				return '';
		}
	}

	/**
	 * Render tree recursively
	 */
	function renderTree(nodes: TreeNode[], depth: number = 0, parentPath: string = ''): Array<{ node: TreeNode; depth: number; isAddEntry?: boolean; addParentPath?: string }> {
		const result: Array<{ node: TreeNode; depth: number; isAddEntry?: boolean; addParentPath?: string }> = [];
		for (const node of nodes) {
			result.push({ node, depth });
			// Only render children if directory is expanded
			if (node.isDirectory && node.children.length > 0 && isExpanded(node.path)) {
				result.push(...renderTree(node.children, depth + 1, node.path));
			}
			// Add "+ (add entry)" item after each directory (if worktree and expanded)
			if (isWorktree && node.isDirectory && isExpanded(node.path)) {
				result.push({
					node: { name: '', path: '', isDirectory: false, status: 'unchanged', children: [] },
					depth: depth + 1,
					isAddEntry: true,
					addParentPath: node.path
				});
			}
		}
		// Add "+ (add entry)" item at root level
		if (depth === 0 && isWorktree) {
			result.push({
				node: { name: '', path: '', isDirectory: false, status: 'unchanged', children: [] },
				depth: 0,
				isAddEntry: true,
				addParentPath: ''
			});
		}
		return result;
	}

	/**
	 * Handle delete button click
	 */
	function handleDeleteClick(node: TreeNode) {
		deleteTargetPath = node.path;
		deleteTargetIsDirectory = node.isDirectory;
		showDeleteDialog = true;
	}

	/**
	 * Handle delete confirmation
	 */
	async function handleDeleteConfirm() {
		if (!gitBackend) return;

		try {
			const result = await gitBackend.deleteFile(deleteTargetPath);
			if (!result.success) {
				alert(`Failed to delete: ${result.error}`);
			}
		} catch (error: any) {
			alert(`Failed to delete: ${error.message}`);
		}

		showDeleteDialog = false;
		deleteTargetPath = '';
	}

	/**
	 * Handle delete cancel
	 */
	function handleDeleteCancel() {
		showDeleteDialog = false;
		deleteTargetPath = '';
	}

	/**
	 * Handle add entry click
	 */
	function handleAddClick(parentPath: string) {
		createParentPath = parentPath;
		createErrorMessage = '';
		showCreateDialog = true;
	}

	/**
	 * Handle create confirmation
	 */
	async function handleCreateSubmit(event: CustomEvent<{ fileName: string; isDirectory: boolean }>) {
		if (!gitBackend) return;

		const { fileName, isDirectory } = event.detail;
		const fullPath = createParentPath ? `${createParentPath}/${fileName}` : fileName;

		try {
			const result = await gitBackend.createFile(fullPath, isDirectory);
			if (!result.success) {
				createErrorMessage = result.error || 'Failed to create file';
				return;
			}

			// Success - close dialog
			showCreateDialog = false;
			createParentPath = '';
			createErrorMessage = '';
		} catch (error: any) {
			createErrorMessage = error.message || 'Failed to create file';
		}
	}

	/**
	 * Handle create cancel
	 */
	function handleCreateCancel() {
		showCreateDialog = false;
		createParentPath = '';
		createErrorMessage = '';
	}

	/**
	 * Handle file click - dispatch event to parent
	 */
	function handleFileClick(node: TreeNode) {
		if (!node.isDirectory) {
			dispatch('fileClick', { path: node.path, status: node.status });
		}
	}

	/**
	 * Handle row click - toggle directory or open file
	 */
	function handleRowClick(node: TreeNode) {
		if (node.isDirectory) {
			toggleDirectory(node.path);
		} else {
			handleFileClick(node);
		}
	}

	$: tree = files ? buildTree(files) : [];
	$: filteredTree = filterTree(tree, filterMode);
	$: flatTree = (expandedDirs, renderTree(filteredTree));
</script>

<div class="file-tree" class:hidden={!active}>
	<div class="file-list">
		{#if flatTree.length > 0}
			{#each flatTree as item}
				{#if item.isAddEntry}
					<!-- Add entry button -->
					<div
						class="file-row add-entry"
						style="padding-left: {item.depth * 16 + 8}px"
						on:click={() => handleAddClick(item.addParentPath || '')}
						role="button"
						tabindex="0"
					>
						<span class="arrow-spacer"></span>
						<span class="add-entry-text">+ (add entry)</span>
					</div>
				{:else}
					<!-- Regular file/directory row -->
					<div
						class="file-row {getStatusColor(item.node.status)}"
						class:directory={item.node.isDirectory}
						class:file={!item.node.isDirectory}
						class:selected={!item.node.isDirectory && item.node.path === selectedPath}
						style="padding-left: {item.depth * 16 + 8}px"
						on:click={() => handleRowClick(item.node)}
						on:mouseenter={() => hoveredPath = item.node.path}
						on:mouseleave={() => hoveredPath = null}
						role="button"
						tabindex="0"
					>
						{#if item.node.isDirectory}
							<span class="arrow" class:expanded={isExpanded(item.node.path)}>▶</span>
						{:else}
							<span class="arrow-spacer"></span>
						{/if}
						<span class="file-name">{item.node.name}</span>
						{#if isWorktree && hoveredPath === item.node.path}
							<button
								class="delete-button"
								on:click|stopPropagation={() => handleDeleteClick(item.node)}
								title="Delete"
							>
								🗑️
							</button>
						{/if}
					</div>
				{/if}
			{/each}
		{:else}
			<div class="empty-message">No files to display</div>
		{/if}
	</div>

	<div class="filter-buttons">
		<button
			class:active={filterMode === 'modified'}
			on:click={() => (filterMode = 'modified')}
		>
			Modified
		</button>
		<button
			class:active={filterMode === 'all'}
			on:click={() => (filterMode = 'all')}
		>
			All
		</button>
		<button
			class:active={filterMode === 'all+ignored'}
			on:click={() => (filterMode = 'all+ignored')}
		>
			All+Ignored
		</button>
	</div>
</div>

<!-- Dialogs -->
<DeleteConfirmationDialog
	bind:show={showDeleteDialog}
	path={deleteTargetPath}
	isDirectory={deleteTargetIsDirectory}
	focusStack={focusStack}
	on:confirm={handleDeleteConfirm}
	on:cancel={handleDeleteCancel}
/>

<CreateFileDialog
	bind:show={showCreateDialog}
	parentPath={createParentPath}
	bind:errorMessage={createErrorMessage}
	focusStack={focusStack}
	on:submit={handleCreateSubmit}
	on:cancel={handleCreateCancel}
/>

<style>
	.file-tree {
		display: flex;
		flex-direction: column;
		height: 100%;
		background-color: #1e1e1e;
		color: #cccccc;
		font-family: 'Consolas', 'Courier New', monospace;
		font-size: 12px;
	}

	.file-tree.hidden {
		visibility: hidden;
		pointer-events: none;
	}

	.file-list {
		flex: 1;
		overflow-y: auto;
		overflow-x: hidden;
		padding: 8px 0;
	}

	.file-row {
		display: flex;
		align-items: center;
		padding: 2px 8px;
		line-height: 1.6;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		position: relative;
	}

	.file-row.directory,
	.file-row.file {
		cursor: pointer;
	}

	.file-row:hover {
		background-color: #2a2a2a;
	}

	.file-row.selected {
		background-color: #094771;
	}

	.file-row.add-entry {
		color: #888888;
		cursor: pointer;
		font-style: italic;
	}

	.file-row.add-entry:hover {
		color: #0dbc79;
		background-color: #2a2a2a;
	}

	.add-entry-text {
		user-select: none;
	}

	.delete-button {
		margin-left: auto;
		background: none;
		border: none;
		cursor: pointer;
		padding: 0 4px;
		font-size: 14px;
		opacity: 0.7;
		transition: opacity 0.2s;
		flex-shrink: 0;
	}

	.delete-button:hover {
		opacity: 1;
	}

	.arrow {
		display: inline-block;
		width: 14px;
		margin-right: 4px;
		font-size: 10px;
		transition: transform 0.2s ease;
		transform-origin: center;
	}

	.arrow.expanded {
		transform: rotate(90deg);
	}

	.arrow-spacer {
		display: inline-block;
		width: 14px;
		margin-right: 4px;
	}

	.file-name {
		overflow: hidden;
		text-overflow: ellipsis;
	}

	/* Status colors */
	.status-modified {
		color: #569cd6; /* Blue for modified */
	}

	.status-added {
		color: #0dbc79; /* Green for added */
	}

	.status-deleted {
		color: #cd3131; /* Red for deleted */
	}

	.status-untracked {
		color: #0dbc79; /* Green for untracked (same as added) */
	}

	.status-ignored {
		color: #808080; /* Gray for ignored files */
	}

	.empty-message {
		padding: 16px;
		color: #888888;
		text-align: center;
		font-style: italic;
	}

	.filter-buttons {
		display: flex;
		border-top: 1px solid #333333;
		padding: 4px;
		gap: 4px;
		background-color: #252525;
	}

	.filter-buttons button {
		flex: 1;
		padding: 4px 8px;
		background-color: #333333;
		color: #cccccc;
		border: 1px solid #444444;
		border-radius: 3px;
		cursor: pointer;
		font-family: 'Consolas', 'Courier New', monospace;
		font-size: 11px;
		transition: all 0.2s;
	}

	.filter-buttons button:hover {
		background-color: #404040;
	}

	.filter-buttons button.active {
		background-color: #007acc;
		border-color: #007acc;
		color: #ffffff;
	}
</style>
