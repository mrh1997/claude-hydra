// Multi-repository support: No auto-discovery on startup
// Repositories are opened explicitly by the user via "Open Repository..." button
export async function load() {
	return {
		// Return empty - user will open repositories manually
	};
}
