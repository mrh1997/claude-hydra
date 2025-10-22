<script lang="ts">
	import { onMount, onDestroy, createEventDispatcher, getContext } from 'svelte';
	import { terminals } from '$lib/stores/terminals';
	import { GitBackend, type FileInfo } from '$lib/GitBackend';
	import { gitBackends } from '$lib/stores/gitBackends';
	import CommitList from './CommitList.svelte';
	import Splitter from './Splitter.svelte';
	import DiffViewer from './DiffViewer.svelte';
	import WaituserErrorDialog from './WaituserErrorDialog.svelte';
	import { shouldBlockFromTerminal } from '$lib/shortcuts';
	import { FocusStack } from '$lib/FocusStack';

	export let terminalId: string;
	export let active: boolean = false;
	export let branchName: string;
	export let repoPath: string; // Repository path this terminal belongs to
	export let adoptExisting: boolean = false;

	const dispatch = createEventDispatcher();
	const websocketPort = getContext<number>('websocketPort');

	let terminalElement: HTMLDivElement;
	let terminal: any;
	let fitAddon: any;
	let ws: WebSocket;
	let sessionId: string | null = null;
	let gitBackend: GitBackend | null = null;
	let files: FileInfo[] | null = null;
	let commitListWidth = 350; // Default width for commit list panel
	const MIN_COMMIT_LIST_WIDTH = 200;
	const MIN_TERMINAL_WIDTH = 200; // Minimum width for terminal

	// Diff viewer state
	let showDiffViewer = false;
	let diffFileName = '';
	let diffOriginalContent = '';
	let diffModifiedContent = '';
	let diffLanguage = 'plaintext';
	let diffCommitId: string | null = null;
	let requestedDiffFile = ''; // Track requested file until response arrives
	let diffViewerComponent: any; // Reference to DiffViewer component
	let focusStack: FocusStack;
	let blurTimeout: number | null = null; // Timeout for auto-focus restoration
	let forceNextDiffUpdate = false; // Force next diff update (used after discard)
	let preserveWorktree = true; // Whether to preserve worktree on destroy (default: true)

	// File navigation state for F8/Shift+F8
	let modifiedFilesList: string[] = []; // List of modified files
	let currentFileIndex = -1; // Index of currently open file in modifiedFilesList
	let lastDiffViewerState: { fileName: string; position: any } | null = null; // State to restore with Alt+F

	// Waituser state
	let showWaituserBox = false;
	let waituserText = '';
	let waituserCommandline = '';
	let showWaituserErrorDialog = false;
	let waituserErrorOutput = '';

	onMount(async () => {
		// Initialize focus stack and register with store
		focusStack = new FocusStack();
		terminals.setFocusStack(terminalId, focusStack);
		// Dynamic imports to avoid SSR issues
		const [XTermPkg, FitAddonPkg, WebLinksAddonPkg] = await Promise.all([
			import('@xterm/xterm'),
			import('@xterm/addon-fit'),
			import('@xterm/addon-web-links'),
			import('@xterm/xterm/css/xterm.css')
		]);

		const { Terminal } = XTermPkg as any;
		const { FitAddon } = FitAddonPkg as any;
		const { WebLinksAddon } = WebLinksAddonPkg as any;

		// Initialize xterm.js
		terminal = new Terminal({
			cursorBlink: true,
			fontSize: 14,
			fontFamily: 'Consolas, "Courier New", monospace',
			theme: {
				background: '#1e1e1e',
				foreground: '#cccccc',
				cursor: '#ffffff',
				black: '#000000',
				red: '#cd3131',
				green: '#0dbc79',
				yellow: '#e5e510',
				blue: '#2472c8',
				magenta: '#bc3fbc',
				cyan: '#11a8cd',
				white: '#e5e5e5',
				brightBlack: '#666666',
				brightRed: '#f14c4c',
				brightGreen: '#23d18b',
				brightYellow: '#f5f543',
				brightBlue: '#3b8eea',
				brightMagenta: '#d670d6',
				brightCyan: '#29b8db',
				brightWhite: '#ffffff'
			},
			allowProposedApi: true
		});

		// Add addons
		fitAddon = new FitAddon();
		terminal.loadAddon(fitAddon);
		terminal.loadAddon(new WebLinksAddon());

		// Open terminal
		terminal.open(terminalElement);
		fitAddon.fit();

		// Connect to WebSocket server
		connectWebSocket();

		// Handle terminal input
		terminal.onData((data) => {
			if (ws && ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: 'data', data }));
			}
		});

		// Handle copy/paste keyboard shortcuts
		terminal.attachCustomKeyEventHandler((event) => {
			// Block application shortcuts (Alt-X, Alt-C, Alt-D) from terminal
			if (event.type === 'keydown' && shouldBlockFromTerminal(event)) {
				return false; // Prevent terminal from handling it, let it bubble to window
			}

			// Ctrl+C: Copy if text is selected, otherwise send interrupt (SIGINT)
			if (event.ctrlKey && !event.shiftKey && event.key === 'c' && event.type === 'keydown') {
				const selection = terminal.getSelection();
				if (selection) {
					// Text is selected - copy to clipboard
					navigator.clipboard.writeText(selection);
					return false; // Prevent terminal from seeing this event
				}
				// No selection - let Ctrl+C pass through to send SIGINT
				return true;
			}

			// Ctrl+V: Prevent xterm from consuming it (paste event listener handles it)
			if (event.ctrlKey && !event.shiftKey && event.key === 'v' && event.type === 'keydown') {
				// Return false to prevent xterm from handling it
				return false;
			}

			// Allow all other shortcuts to pass through to Claude Code
			return true;
		});

		// Handle paste events (works for both terminal and external clipboard sources)
		terminalElement.addEventListener('paste', (event: ClipboardEvent) => {
			event.preventDefault(); // Prevent default paste behavior
			const text = event.clipboardData?.getData('text');
			if (text && ws && ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: 'data', data: text }));
			}
		});

		// Push terminal focus callback to stack
		focusStack.push(() => {
			if (terminal && !showDiffViewer) {
				terminal.focus();
			}
		});

		// Auto-restore focus to terminal after 500ms when stack depth is 1 (no dialogs/DiffViewer open)
		const handleBlur = (event: FocusEvent) => {
			// Skip if focus moved to a dialog (check for .overlay parent or role="dialog")
			const relatedElement = event.relatedTarget as HTMLElement | null;
			const isDialogElement = relatedElement?.closest('.overlay, [role="dialog"]');

			// Only auto-restore focus when terminal tab is active, stack depth is 1, and not in dialog
			if (active && focusStack && focusStack.depth === 1 && !isDialogElement) {
				// Clear any existing timeout
				if (blurTimeout !== null) {
					clearTimeout(blurTimeout);
				}
				// Set new timeout to restore focus after 500ms
				blurTimeout = window.setTimeout(() => {
					if (focusStack && focusStack.depth === 1) {
						focusStack.activate();
					}
					blurTimeout = null;
				}, 500);
			}
		};
		terminalElement.addEventListener('blur', handleBlur, true);

		// Handle resize
		terminal.onResize(({ cols, rows }) => {
			if (ws && ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: 'resize', cols, rows }));
			}
		});

		// Handle window resize
		const resizeObserver = new ResizeObserver(() => {
			fitAddon.fit();
		});
		resizeObserver.observe(terminalElement);

		// Cleanup
		return () => {
			resizeObserver.disconnect();
			terminalElement.removeEventListener('blur', handleBlur, true);
			if (blurTimeout !== null) {
				clearTimeout(blurTimeout);
			}
		};
	});

	function connectWebSocket() {
		ws = new WebSocket(`ws://localhost:${websocketPort}`);

		ws.onopen = () => {
			console.log('WebSocket connected');
			// Request new terminal session with repository path and branch name
			ws.send(JSON.stringify({ type: 'create', repoPath, branchName, adoptExisting }));
		};

		ws.onmessage = (event) => {
			try {
				const message = JSON.parse(event.data);

				// Try to handle message with GitBackend first
				if (gitBackend && gitBackend.handleMessage(message)) {
					return; // Message was handled by GitBackend
				}

				// Handle non-git messages
				switch (message.type) {
					case 'created':
						sessionId = message.sessionId;
						terminals.setSessionId(terminalId, sessionId);

						// Create GitBackend instance for this session
						gitBackend = new GitBackend(
							sessionId,
							ws,
							(gitStatus, commitLog) => {
								// Callback when git status is updated
								terminals.updateGitStatus(sessionId, gitStatus);
								if (commitLog !== undefined) {
									terminals.updateCommitLog(sessionId, commitLog);
								}
							}
						);
						gitBackend.setFileListCallback((fileList, commitId) => {
							// Callback when file list is updated
							files = fileList;

							// If diff viewer is open for working tree, refresh it (file may have been discarded)
							if (showDiffViewer && diffFileName && diffCommitId === null) {
								// Force next update to bypass guard (file was likely discarded externally)
								forceNextDiffUpdate = true;
								// Re-request the file diff to get updated content
								if (ws && ws.readyState === WebSocket.OPEN && sessionId) {
									requestedDiffFile = diffFileName;
									ws.send(JSON.stringify({
										type: 'getFileDiff',
										sessionId,
										filePath: diffFileName,
										commitId: null
									}));
								}
							}
						});
						gitBackends.register(sessionId, gitBackend);

						// Request initial git status (especially important for adopted sessions)
						ws.send(JSON.stringify({ type: 'getGitStatus', sessionId }));

						// Immediately send the actual terminal size to the PTY
						if (terminal && fitAddon) {
							const dims = fitAddon.proposeDimensions();
							if (dims) {
								ws.send(JSON.stringify({
									type: 'resize',
									cols: dims.cols,
									rows: dims.rows
								}));
							}
						}
						break;

					case 'data':
						terminal.write(message.data);
						break;

					case 'state':
						if (sessionId) {
							terminals.updateState(sessionId, message.state);
						}
						break;

					case 'closeTab':
						dispatch('requestClose', { terminalId });
						break;

					case 'exit':
						dispatch('exit', { terminalId });
						break;

					case 'fileDiff':
						// Handle file diff response - set all props atomically
						diffFileName = requestedDiffFile;
						diffOriginalContent = message.original || '';
						diffModifiedContent = message.modified || '';
						diffLanguage = getLanguageFromFileName(diffFileName);
						showDiffViewer = true;
						break;

					case 'waituser':
						// Show waituser box with text and commandline
						waituserText = message.text;
						waituserCommandline = message.commandline;
						showWaituserBox = true;
						break;

					case 'waituserError':
						// Show error dialog with command output
						waituserErrorOutput = message.output;
						showWaituserErrorDialog = true;
						break;

					case 'error':
						terminal.write(`\r\n\x1b[31mError: ${message.error}\x1b[0m\r\n`);
						// Close the tab after showing error
						setTimeout(() => terminals.removeTab(terminalId), 2000);
						break;
				}
			} catch (error) {
				console.error('WebSocket message error:', error);
			}
		};

		ws.onerror = (error) => {
			console.error('WebSocket error:', error);
			terminal.write('\r\n\r\n[Connection error]\r\n');
		};

		ws.onclose = () => {
			console.log('WebSocket closed');
		};
	}

	onDestroy(() => {
		// Clear any pending blur timeout
		if (blurTimeout !== null) {
			clearTimeout(blurTimeout);
		}
		if (ws) {
			if (sessionId) {
				// Preserve worktree by default - this allows tabs to be restored when repository is reopened
				// Only destroy worktrees when explicitly requested (e.g., user closes individual tab)
				ws.send(JSON.stringify({ type: 'destroy', preserveWorktree }));
				// Unregister GitBackend
				gitBackends.unregister(sessionId);
			}
			ws.close();
		}
		if (terminal) {
			terminal.dispose();
		}
	});

	$: if (terminal && active) {
		// Focus terminal when tab becomes active
		setTimeout(() => {
			terminal.focus();
			fitAddon.fit();
			// Scroll to bottom to prevent viewport reset after fit
			terminal.scrollToBottom();
		}, 0);
	}

	// Get commit log from store for this terminal
	$: tab = $terminals.find(t => t.id === terminalId);
	$: commitLog = tab?.commitLog || null;
	// Update preserveWorktree flag when tab's preserveWorktreeOnDestroy changes
	$: if (tab?.preserveWorktreeOnDestroy !== undefined) {
		preserveWorktree = tab.preserveWorktreeOnDestroy;
	}

	/**
	 * Sort files hierarchically: subdirectories first (a-z), then files (a-z), depth-first
	 */
	function sortFilesHierarchically(fileList: FileInfo[]): string[] {
		// Tree node structure
		interface TreeNode {
			name: string;
			path: string;
			isDirectory: boolean;
			children: TreeNode[];
		}

		// Build tree from flat file list
		const root: TreeNode[] = [];
		const nodeMap = new Map<string, TreeNode>();

		// Filter to only include modified files (exclude directories, unchanged, ignored)
		const modifiedFiles = fileList.filter(
			f => !f.isDirectory && f.status !== 'unchanged' && f.status !== 'ignored'
		);

		for (const file of modifiedFiles) {
			if (!file.path || !file.path.trim()) continue;

			const parts = file.path.split('/').filter(part => part.length > 0);
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
			}
		}

		// Sort: directories first, then alphabetically (recursively)
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

		// Flatten tree to array of file paths (depth-first)
		const result: string[] = [];
		function traverse(nodes: TreeNode[]) {
			for (const node of nodes) {
				if (node.isDirectory) {
					traverse(node.children);
				} else {
					result.push(node.path);
				}
			}
		}
		traverse(root);

		return result;
	}

	// Update modified files list when files change
	$: if (files) {
		modifiedFilesList = sortFilesHierarchically(files);

		// Update current file index when diffFileName changes
		currentFileIndex = modifiedFilesList.indexOf(diffFileName);
	}

	function handleCommitSelect(commitId: string | null) {
		if (gitBackend) {
			gitBackend.requestFileList(commitId);
		}
	}

	function handleSplitterResize(event: CustomEvent<number>) {
		const newWidth = event.detail;
		const containerWidth = terminalElement?.parentElement?.offsetWidth || 0;
		const maxWidth = containerWidth - MIN_TERMINAL_WIDTH - 4; // 4px for splitter

		// Clamp width between min and max
		commitListWidth = Math.max(MIN_COMMIT_LIST_WIDTH, Math.min(newWidth, maxWidth));
	}

	function handleFileClick(event: CustomEvent<{ path: string; status: string; commitId: string | null }>) {
		const { path, commitId } = event.detail;

		// Request file diff from backend
		if (ws && ws.readyState === WebSocket.OPEN && sessionId) {
			requestedDiffFile = path; // Store requested file, don't set diffFileName yet
			diffCommitId = commitId;
			ws.send(JSON.stringify({
				type: 'getFileDiff',
				sessionId,
				filePath: path,
				commitId: commitId
			}));
		}
	}

	function handleSaveFile(event: CustomEvent<{ content: string }>) {
		const { content } = event.detail;

		// Send save file request to backend
		if (ws && ws.readyState === WebSocket.OPEN && sessionId) {
			ws.send(JSON.stringify({
				type: 'saveFile',
				sessionId,
				filePath: diffFileName,
				content: content
			}));
		}
	}

	function handleDiscardFile() {
		// Send discard file request to backend
		// Note: forceNextDiffUpdate will be set by fileListCallback when backend responds
		if (ws && ws.readyState === WebSocket.OPEN && sessionId) {
			ws.send(JSON.stringify({
				type: 'discardFile',
				sessionId,
				filePath: diffFileName
			}));
		}
	}

	function handleCloseDiff() {
		// Save state for Alt+F restore
		if (diffViewerComponent) {
			lastDiffViewerState = {
				fileName: diffFileName,
				position: diffViewerComponent.getCurrentPosition()
			};
		}

		showDiffViewer = false;
		diffFileName = '';
		diffOriginalContent = '';
		diffModifiedContent = '';
		diffCommitId = null;
		currentFileIndex = -1;
	}

	/**
	 * Handle F8: Jump to next change or next file
	 */
	export function handleNextDiff() {
		if (!showDiffViewer) {
			// DiffViewer is closed - open first modified file and jump to first change
			if (modifiedFilesList.length > 0) {
				openFileAndNavigate(modifiedFilesList[0], true);
			}
		} else if (diffViewerComponent) {
			// DiffViewer is open - check if we can navigate to next change
			const hasNext = diffViewerComponent.canNavigateNext();
			if (hasNext) {
				// Navigate to next change in current file
				diffViewerComponent.navigateNext();
			} else if (currentFileIndex < modifiedFilesList.length - 1) {
				// At last change - open next file
				openFileAndNavigate(modifiedFilesList[currentFileIndex + 1], true);
			}
		}
	}

	/**
	 * Handle Shift+F8: Jump to previous change or previous file
	 */
	export function handlePrevDiff() {
		if (!showDiffViewer) {
			// DiffViewer is closed - open last modified file and jump to last change
			if (modifiedFilesList.length > 0) {
				openFileAndNavigate(modifiedFilesList[modifiedFilesList.length - 1], false);
			}
		} else if (diffViewerComponent) {
			// DiffViewer is open - check if we can navigate to previous change
			const hasPrev = diffViewerComponent.canNavigatePrev();
			if (hasPrev) {
				// Navigate to previous change in current file
				diffViewerComponent.navigatePrev();
			} else if (currentFileIndex > 0) {
				// At first change - open previous file
				openFileAndNavigate(modifiedFilesList[currentFileIndex - 1], false);
			}
		}
	}

	/**
	 * Handle Alt+F: Return to diff viewer at last position, or open first file alphabetically
	 */
	export function handleReturnToDiff() {
		if (lastDiffViewerState && lastDiffViewerState.fileName) {
			// Reopen the last viewed file
			openFile(lastDiffViewerState.fileName);

			// Restore position after a short delay to ensure diff is loaded
			setTimeout(() => {
				if (diffViewerComponent && lastDiffViewerState) {
					diffViewerComponent.restorePosition(lastDiffViewerState.position);
				}
			}, 100);
		} else if (files && files.length > 0) {
			// No previous state - open first non-ignored file alphabetically
			const sortedFiles = files
				.filter(f => !f.isDirectory && f.status !== 'ignored')
				.map(f => f.path)
				.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

			if (sortedFiles.length > 0) {
				openFile(sortedFiles[0]);
			}
		}
	}

	/**
	 * Open a file and navigate to first or last change
	 */
	function openFileAndNavigate(filePath: string, navigateToFirst: boolean) {
		// Request file diff
		if (ws && ws.readyState === WebSocket.OPEN && sessionId) {
			requestedDiffFile = filePath;
			diffCommitId = null; // Working tree
			ws.send(JSON.stringify({
				type: 'getFileDiff',
				sessionId,
				filePath: filePath,
				commitId: null
			}));

			// After diff loads, navigate to first/last change
			// This will be handled in the fileDiff message handler
			setTimeout(() => {
				if (diffViewerComponent) {
					if (navigateToFirst) {
						diffViewerComponent.navigateToFirst();
					} else {
						diffViewerComponent.navigateToLast();
					}
				}
			}, 100);
		}
	}

	/**
	 * Open a file without navigation
	 */
	function openFile(filePath: string) {
		if (ws && ws.readyState === WebSocket.OPEN && sessionId) {
			requestedDiffFile = filePath;
			diffCommitId = null;
			ws.send(JSON.stringify({
				type: 'getFileDiff',
				sessionId,
				filePath: filePath,
				commitId: null
			}));
		}
	}

	function getLanguageFromFileName(fileName: string): string {
		const ext = fileName.split('.').pop()?.toLowerCase() || '';
		const languageMap: { [key: string]: string } = {
			'js': 'javascript',
			'ts': 'typescript',
			'jsx': 'javascript',
			'tsx': 'typescript',
			'py': 'python',
			'java': 'java',
			'c': 'c',
			'cpp': 'cpp',
			'cs': 'csharp',
			'go': 'go',
			'rs': 'rust',
			'rb': 'ruby',
			'php': 'php',
			'swift': 'swift',
			'kt': 'kotlin',
			'json': 'json',
			'xml': 'xml',
			'html': 'html',
			'css': 'css',
			'scss': 'scss',
			'md': 'markdown',
			'sql': 'sql',
			'sh': 'shell',
			'yaml': 'yaml',
			'yml': 'yaml'
		};
		return languageMap[ext] || 'plaintext';
	}

	/**
	 * Handle F9 key press - execute waituser command
	 */
	export function handleWaituserExecute() {
		if (!showWaituserBox || !waituserCommandline) {
			return;
		}

		// Hide the waituser box
		showWaituserBox = false;

		// Send execute command to backend
		if (ws && ws.readyState === WebSocket.OPEN && sessionId) {
			ws.send(JSON.stringify({
				type: 'executeWaituser',
				sessionId,
				commandline: waituserCommandline
			}));
		}

		// Clear state
		waituserText = '';
		waituserCommandline = '';
	}
</script>

<div class="terminal-container" class:hidden={!active}>
	<div class="terminal-area" style="width: calc(100% - {commitListWidth + 4}px)">
		<div bind:this={terminalElement} class="terminal" class:hidden={showDiffViewer}></div>
		<DiffViewer
			bind:this={diffViewerComponent}
			originalContent={diffOriginalContent}
			modifiedContent={diffModifiedContent}
			fileName={diffFileName}
			language={diffLanguage}
			active={showDiffViewer && active}
			width={commitListWidth}
			commitId={diffCommitId}
			{focusStack}
			bind:forceUpdate={forceNextDiffUpdate}
			on:close={handleCloseDiff}
			on:save={handleSaveFile}
			on:discard={handleDiscardFile}
			on:nextDiff={handleNextDiff}
			on:prevDiff={handlePrevDiff}
		/>
		{#if showWaituserBox}
			<div class="waituser-box">
				<div class="waituser-text">{waituserText}</div>
				<div class="waituser-hint">Press F9 to start</div>
			</div>
		{/if}
	</div>
	<Splitter currentWidth={commitListWidth} on:resize={handleSplitterResize} />
	<CommitList commits={commitLog} {active} {files} onCommitSelect={handleCommitSelect} on:fileClick={handleFileClick} width={commitListWidth} {gitBackend} {focusStack} selectedPath={showDiffViewer ? diffFileName : null} />
</div>

<WaituserErrorDialog
	show={showWaituserErrorDialog}
	output={waituserErrorOutput}
	{focusStack}
	on:close={() => { showWaituserErrorDialog = false; }}
/>

<style>
	.terminal-container {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: row;
	}

	.terminal-container.hidden {
		visibility: hidden;
		pointer-events: none;
	}

	.terminal-area {
		height: 100%;
		flex-shrink: 0;
		position: relative;
		display: flex;
		flex-direction: column;
	}

	.terminal {
		flex: 1;
		overflow: hidden;
	}

	.waituser-box {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		background-color: #4a148c;
		color: #ffffff;
		padding: 12px 16px;
		box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.3);
		z-index: 100;
	}

	.waituser-text {
		font-size: 14px;
		font-weight: 500;
		margin-bottom: 4px;
	}

	.waituser-hint {
		font-size: 10px;
		color: #e1bee7;
		font-style: italic;
	}
</style>
