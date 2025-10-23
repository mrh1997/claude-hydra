import { writable } from 'svelte/store';
import { FocusStack } from '$lib/FocusStack';

export interface CommitInfo {
	hash: string;          // Full abbreviated hash (7-8 chars) for git operations
	displayHash: string;   // Short hash (4 chars) for UI display
	timestamp: number;
	message: string;
	fullMessage: string;
}

export interface GitStatus {
	hasUncommittedChanges: boolean;
	hasUnmergedCommits: boolean;
	isBehindBase: boolean;
}

export interface TerminalTab {
	id: string;
	sessionId: string | null;
	title: string;
	branchName: string;
	repoPath: string; // Repository path this terminal belongs to
	active: boolean;
	state: 'ready' | 'running';
	adoptExisting: boolean;
	gitStatus: GitStatus | null;
	commitLog: CommitInfo[] | null;
	focusStack: FocusStack | null;
	preserveWorktreeOnDestroy?: boolean; // Whether to preserve worktree when tab is destroyed
}

function createTerminalsStore() {
	const { subscribe, set, update} = writable<TerminalTab[]>([]);

	return {
		subscribe,
		addTab: (id: string, repoPath: string, branchName: string, adoptExisting: boolean = false, activate: boolean = true) => {
			update(tabs => {
				if (activate) {
					// Deactivate all tabs when creating an active tab
					tabs.forEach(tab => tab.active = false);
				}
				// Add new tab (start as 'running' until backend detects prompt)
				return [...tabs, { id, sessionId: null, title: branchName, branchName, repoPath, active: activate, state: 'running', adoptExisting, gitStatus: null, commitLog: null, focusStack: null }];
			});
		},
		removeTab: (id: string, preserveWorktree: boolean = true) => {
			// First, set the preserve flag on the tab so Terminal.svelte can read it
			update(tabs => {
				const tab = tabs.find(tab => tab.id === id);
				if (tab) {
					tab.preserveWorktreeOnDestroy = preserveWorktree;
				}
				return tabs;
			});

			// Delay actual removal to let Terminal component's onDestroy read the flag
			setTimeout(() => {
				update(tabs => {
					const filtered = tabs.filter(tab => tab.id !== id);
					// If the removed tab was active and there are remaining tabs, activate the last one
					if (filtered.length > 0 && !filtered.some(tab => tab.active)) {
						filtered[filtered.length - 1].active = true;
					}
					return filtered;
				});
			}, 0);
		},
		setActiveTab: (id: string) => {
			update(tabs => {
				tabs.forEach(tab => {
					tab.active = tab.id === id;
				});
				// Activate the focus stack of the newly active tab
				const activeTab = tabs.find(tab => tab.id === id);
				if (activeTab && activeTab.focusStack) {
					activeTab.focusStack.activate();
				}
				return tabs;
			});
		},
		setSessionId: (id: string, sessionId: string) => {
			update(tabs => {
				const tab = tabs.find(tab => tab.id === id);
				if (tab) {
					tab.sessionId = sessionId;
				}
				return tabs;
			});
		},
		updateTitle: (id: string, title: string) => {
			update(tabs => {
				const tab = tabs.find(tab => tab.id === id);
				if (tab) {
					tab.title = title;
				}
				return tabs;
			});
		},
		updateState: (sessionId: string, state: 'ready' | 'running') => {
			update(tabs => {
				const tab = tabs.find(tab => tab.sessionId === sessionId);
				if (tab) {
					tab.state = state;
				}
				return tabs;
			});
		},
		updateGitStatus: (sessionId: string, gitStatus: GitStatus) => {
			update(tabs => {
				const tab = tabs.find(tab => tab.sessionId === sessionId);
				if (tab) {
					tab.gitStatus = gitStatus;
				}
				return tabs;
			});
		},
		updateCommitLog: (sessionId: string, commitLog: CommitInfo[]) => {
			update(tabs => {
				const tab = tabs.find(tab => tab.sessionId === sessionId);
				if (tab) {
					tab.commitLog = commitLog;
				}
				return tabs;
			});
		},
		setFocusStack: (id: string, focusStack: FocusStack) => {
			update(tabs => {
				const tab = tabs.find(tab => tab.id === id);
				if (tab) {
					tab.focusStack = focusStack;
				}
				return tabs;
			});
		},
		clear: () => set([])
	};
}

export const terminals = createTerminalsStore();
