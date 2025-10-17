// Centralized keyboard shortcuts configuration

export interface KeyboardShortcut {
	key: string;
	altKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	description: string;
}

// Application keyboard shortcuts
export const SHORTCUTS = {
	NEXT_TAB: {
		key: 'x',
		altKey: true,
		ctrlKey: false,
		shiftKey: false,
		description: 'Next tab (Alt-X)'
	} as KeyboardShortcut,
	NEW_TAB: {
		key: 'c',
		altKey: true,
		ctrlKey: false,
		shiftKey: false,
		description: 'New tab (Alt-C)'
	} as KeyboardShortcut,
	CLOSE_TAB: {
		key: 'd',
		altKey: true,
		ctrlKey: false,
		shiftKey: false,
		description: 'Close tab (Alt-D)'
	} as KeyboardShortcut
};

/**
 * Check if a keyboard event matches a shortcut definition
 */
export function matchesShortcut(event: KeyboardEvent, shortcut: KeyboardShortcut): boolean {
	return (
		event.key.toLowerCase() === shortcut.key.toLowerCase() &&
		event.altKey === shortcut.altKey &&
		event.ctrlKey === shortcut.ctrlKey &&
		event.shiftKey === shortcut.shiftKey
	);
}

/**
 * Check if a keyboard event matches any application shortcut that should be blocked from terminal
 */
export function shouldBlockFromTerminal(event: KeyboardEvent): boolean {
	return (
		matchesShortcut(event, SHORTCUTS.NEXT_TAB) ||
		matchesShortcut(event, SHORTCUTS.NEW_TAB) ||
		matchesShortcut(event, SHORTCUTS.CLOSE_TAB)
	);
}
