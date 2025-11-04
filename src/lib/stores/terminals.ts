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
	derivedFromBranch?: string; // The base branch this worktree was derived from (undefined when backend reads from git config)
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
		addTab: (id: string, repoPath: string, branchName: string, adoptExisting: boolean = false, activate: boolean = true, derivedFromBranch?: string) => {
			update(tabs => {
				if (activate) {
					// Deactivate all tabs when creating an active tab
					tabs.forEach(tab => tab.active = false);
				}
				// Strip remote prefix for display title (e.g., "origin/feature-xyz" -> "feature-xyz")
				const displayTitle = branchName.includes('/')
					? branchName.split('/').slice(1).join('/')
					: branchName;
				// Add new tab (start as 'running' until backend detects prompt)
				return [...tabs, { id, sessionId: null, title: displayTitle, branchName, repoPath, derivedFromBranch, active: activate, state: 'running', adoptExisting, gitStatus: null, commitLog: null, focusStack: null }];
			});
		},
		removeTab: (id: string, preserveWorktree: boolean = true) => {
			console.log(`[terminals.removeTab] Called for tab ${id}, preserveWorktree=${preserveWorktree}, timestamp=${Date.now()}`);

			// First, set the preserve flag on the tab so Terminal.svelte can read it
			update(tabs => {
				const tab = tabs.find(tab => tab.id === id);
				if (tab) {
					tab.preserveWorktreeOnDestroy = preserveWorktree;
					console.log(`[terminals.removeTab] Set preserveWorktreeOnDestroy=${preserveWorktree} on tab ${id} (sessionId: ${tab.sessionId})`);
				} else {
					console.warn(`[terminals.removeTab] Tab ${id} not found when setting preserve flag`);
				}
				return tabs;
			});

			// Delay actual removal to let Terminal component's onDestroy read the flag
			setTimeout(() => {
				console.log(`[terminals.removeTab] setTimeout callback executing for tab ${id}, timestamp=${Date.now()}`);
				update(tabs => {
					const filtered = tabs.filter(tab => tab.id !== id);
					// If the removed tab was active and there are remaining tabs, activate the last one
					if (filtered.length > 0 && !filtered.some(tab => tab.active)) {
						filtered[filtered.length - 1].active = true;
					}
					console.log(`[terminals.removeTab] Tab ${id} removed from store`);
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
	updateDerivedFromBranch: (id: string, derivedFromBranch: string) => {
		update(tabs => {
			const tab = tabs.find(tab => tab.id === id);
			if (tab) {
				tab.derivedFromBranch = derivedFromBranch;
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
