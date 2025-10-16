<script lang="ts">
	import { onMount, onDestroy, createEventDispatcher, getContext } from 'svelte';
	import { terminals } from '$lib/stores/terminals';
	import { GitBackend, type FileInfo } from '$lib/GitBackend';
	import { gitBackends } from '$lib/stores/gitBackends';
	import CommitList from './CommitList.svelte';
	import Splitter from './Splitter.svelte';
	import DiffViewer from './DiffViewer.svelte';

	export let terminalId: string;
	export let active: boolean = false;
	export let branchName: string;
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

	onMount(async () => {
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
			// F9: Switch to next ready terminal (handled by window event handler)
			if (event.key === 'F9' && event.type === 'keydown') {
				return false; // Prevent terminal from handling it, let it bubble to window
			}

			// Ctrl+Shift+C: Copy
			if (event.ctrlKey && event.shiftKey && event.key === 'C' && event.type === 'keydown') {
				const selection = terminal.getSelection();
				if (selection) {
					navigator.clipboard.writeText(selection);
					return false;
				}
			}

			// Ctrl+Shift+V: Paste
			if (event.ctrlKey && event.shiftKey && event.key === 'V' && event.type === 'keydown') {
				navigator.clipboard.readText().then(text => {
					if (ws && ws.readyState === WebSocket.OPEN) {
						ws.send(JSON.stringify({ type: 'data', data: text }));
					}
				});
				return false;
			}

			// Allow all other shortcuts to pass through to Claude Code
			return true;
		});

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
		};
	});

	function connectWebSocket() {
		ws = new WebSocket(`ws://localhost:${websocketPort}`);

		ws.onopen = () => {
			console.log('WebSocket connected');
			// Request new terminal session with branch name
			ws.send(JSON.stringify({ type: 'create', branchName, adoptExisting }));
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
		if (ws) {
			if (sessionId) {
				ws.send(JSON.stringify({ type: 'destroy' }));
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
		}, 0);
	}

	// Get commit log from store for this terminal
	$: tab = $terminals.find(t => t.id === terminalId);
	$: commitLog = tab?.commitLog || null;

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
		if (ws && ws.readyState === WebSocket.OPEN && sessionId) {
			ws.send(JSON.stringify({
				type: 'discardFile',
				sessionId,
				filePath: diffFileName
			}));
		}
	}

	function handleCloseDiff() {
		showDiffViewer = false;
		diffFileName = '';
		diffOriginalContent = '';
		diffModifiedContent = '';
		diffCommitId = null;
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
</script>

<div class="terminal-container" class:hidden={!active}>
	<div bind:this={terminalElement} class="terminal" style="width: calc(100% - {commitListWidth + 4}px)" class:hidden={showDiffViewer}></div>
	<DiffViewer
		originalContent={diffOriginalContent}
		modifiedContent={diffModifiedContent}
		fileName={diffFileName}
		language={diffLanguage}
		active={showDiffViewer && active}
		width={commitListWidth}
		commitId={diffCommitId}
		on:close={handleCloseDiff}
		on:save={handleSaveFile}
		on:discard={handleDiscardFile}
	/>
	<Splitter currentWidth={commitListWidth} on:resize={handleSplitterResize} />
	<CommitList commits={commitLog} {active} {files} onCommitSelect={handleCommitSelect} on:fileClick={handleFileClick} width={commitListWidth} {gitBackend} />
</div>

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

	.terminal {
		height: 100%;
		flex-shrink: 0;
	}
</style>
