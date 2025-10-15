<script lang="ts">
	export let files: FileInfo[] | null;
	export let active: boolean = false;

	type FileStatus = 'modified' | 'added' | 'deleted' | 'untracked' | 'unchanged';

	interface FileInfo {
		path: string;
		status: FileStatus;
	}

	type FilterMode = 'modified' | 'all' | 'all+ignored';
	let filterMode: FilterMode = 'modified';

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
		if (mode === 'all' || mode === 'all+ignored') {
			// For now, treat both the same (we'll add ignored files support later)
			return nodes;
		}

		// Modified only: filter out unchanged files and empty directories
		return nodes
			.map(node => {
				if (node.isDirectory) {
					const filteredChildren = filterTree(node.children, mode);
					if (filteredChildren.length > 0 || hasModifiedFiles(node)) {
						return { ...node, children: filteredChildren };
					}
					return null;
				} else {
					return node.status !== 'unchanged' ? node : null;
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
			default:
				return '';
		}
	}

	/**
	 * Render tree recursively
	 */
	function renderTree(nodes: TreeNode[], depth: number = 0): { node: TreeNode; depth: number }[] {
		const result: { node: TreeNode; depth: number }[] = [];
		for (const node of nodes) {
			result.push({ node, depth });
			// Only render children if directory is expanded
			if (node.isDirectory && node.children.length > 0 && isExpanded(node.path)) {
				result.push(...renderTree(node.children, depth + 1));
			}
		}
		return result;
	}

	$: tree = files ? buildTree(files) : [];
	$: filteredTree = filterTree(tree, filterMode);
	$: flatTree = (expandedDirs, renderTree(filteredTree));
</script>

<div class="file-tree" class:hidden={!active}>
	<div class="file-list">
		{#if flatTree.length > 0}
			{#each flatTree as { node, depth }}
				<div
					class="file-row {getStatusColor(node.status)}"
					class:directory={node.isDirectory}
					style="padding-left: {depth * 16 + 8}px"
					on:click={() => node.isDirectory && toggleDirectory(node.path)}
				>
					{#if node.isDirectory}
						<span class="arrow" class:expanded={isExpanded(node.path)}>▶</span>
					{:else}
						<span class="arrow-spacer"></span>
					{/if}
					<span class="file-name">{node.name}</span>
				</div>
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
	}

	.file-row.directory {
		cursor: pointer;
	}

	.file-row:hover {
		background-color: #2a2a2a;
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
