<script lang="ts">
	import { onMount, onDestroy, createEventDispatcher, getContext } from 'svelte';
	import { terminals } from '$lib/stores/terminals';
	import { GitBackend } from '$lib/GitBackend';
	import { gitBackends } from '$lib/stores/gitBackends';

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
							(gitStatus) => {
								// Callback when git status is updated
								terminals.updateGitStatus(sessionId, gitStatus);
							}
						);
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
</script>

<div class="terminal-container" class:hidden={!active}>
	<div bind:this={terminalElement} class="terminal"></div>
</div>

<style>
	.terminal-container {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 100%;
		display: flex;
		flex-direction: column;
	}

	.terminal-container.hidden {
		visibility: hidden;
		pointer-events: none;
	}

	.terminal {
		flex: 1;
		width: 100%;
		height: 100%;
	}
</style>
