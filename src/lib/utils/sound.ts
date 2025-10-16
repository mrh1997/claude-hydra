/**
 * Sound notification utility - plays MP3 sounds for state transitions
 */

/**
 * Play an MP3 audio file
 */
function playAudio(url: string): Promise<void> {
	return new Promise((resolve) => {
		try {
			const audio = new Audio(url);
			audio.volume = 0.3; // 30% volume to avoid being too loud

			audio.onended = () => resolve();
			audio.onerror = (error) => {
				console.error('Failed to play audio:', error);
				resolve(); // Don't block on audio errors
			};

			audio.play().catch((error) => {
				console.error('Failed to play audio:', error);
				resolve(); // Don't block on audio errors
			});
		} catch (error) {
			console.error('Failed to play audio:', error);
			resolve(); // Don't block on audio errors
		}
	});
}

/**
 * Play sound for first transition (all-running to mixed)
 */
export async function playSingleBeep(): Promise<void> {
	await playAudio('/finished-1.mp3');
}

/**
 * Play sound for final transition (to all-ready)
 */
export async function playDoubleBeep(): Promise<void> {
	await playAudio('/finished-2.mp3');
}
