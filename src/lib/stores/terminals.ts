import { writable } from 'svelte/store';

export interface TerminalTab {
	id: string;
	sessionId: string | null;
	title: string;
	branchName: string;
	active: boolean;
	state: 'ready' | 'running';
}

function createTerminalsStore() {
	const { subscribe, set, update} = writable<TerminalTab[]>([]);

	return {
		subscribe,
		addTab: (id: string, branchName: string) => {
			update(tabs => {
				// Deactivate all tabs
				tabs.forEach(tab => tab.active = false);
				// Add new tab
				return [...tabs, { id, sessionId: null, title: branchName, branchName, active: true, state: 'ready' }];
			});
		},
		removeTab: (id: string) => {
			update(tabs => {
				const filtered = tabs.filter(tab => tab.id !== id);
				// If the removed tab was active and there are remaining tabs, activate the last one
				if (filtered.length > 0 && !filtered.some(tab => tab.active)) {
					filtered[filtered.length - 1].active = true;
				}
				return filtered;
			});
		},
		setActiveTab: (id: string) => {
			update(tabs => {
				tabs.forEach(tab => {
					tab.active = tab.id === id;
				});
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
		clear: () => set([])
	};
}

export const terminals = createTerminalsStore();
