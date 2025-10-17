/**
 * FocusStack manages a stack of focus callbacks for handling focus restoration
 * in a hierarchical UI (Terminal → DiffViewer → Dialogs).
 *
 * Usage:
 * - push(): Add a new focus context (e.g., opening a dialog) and activate it
 * - pop(): Remove the topmost context (e.g., closing a dialog) and activate the previous one
 * - activate(): Re-activate the current topmost context (e.g., after blur event)
 */
export class FocusStack {
	private stack: Array<() => void> = [];

	/**
	 * Adds a focus callback to the stack and immediately calls it.
	 * This makes the pushed element the active focus target.
	 *
	 * @param callback - Function to call when this level should receive focus
	 */
	push(callback: () => void): void {
		this.stack.push(callback);
		callback();
	}

	/**
	 * Removes the topmost callback from the stack and calls the new topmost callback.
	 * This returns focus to the previous context.
	 * If the stack becomes empty, nothing happens.
	 */
	pop(): void {
		if (this.stack.length > 0) {
			this.stack.pop();
		}
		this.activate();
	}

	/**
	 * Calls the topmost callback without modifying the stack.
	 * Used for restoring focus to the current active context.
	 */
	activate(): void {
		if (this.stack.length > 0) {
			const topCallback = this.stack[this.stack.length - 1];
			topCallback();
		}
	}

	/**
	 * Returns the current stack depth (useful for debugging).
	 */
	get depth(): number {
		return this.stack.length;
	}
}
