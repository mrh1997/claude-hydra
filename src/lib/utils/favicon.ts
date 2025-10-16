/**
 * Favicon utility - generates dynamic SVG favicon based on terminal states
 */

export type FaviconState = 'all-running' | 'all-ready' | 'mixed';

/**
 * Generate SVG favicon based on state
 */
export function generateFaviconSVG(state: FaviconState): string {
	if (state === 'all-running') {
		// Red circle with white border and "ch" text
		return `
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
				<circle cx="50" cy="50" r="48" fill="#dc2626" stroke="white" stroke-width="2"/>
				<text x="50" y="68" text-anchor="middle" font-family="Arial, sans-serif" font-size="48" font-weight="bold" fill="white">ch</text>
			</svg>
		`.trim();
	} else if (state === 'all-ready') {
		// Green circle with white border and "ch" text
		return `
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
				<circle cx="50" cy="50" r="48" fill="#16a34a" stroke="white" stroke-width="2"/>
				<text x="50" y="68" text-anchor="middle" font-family="Arial, sans-serif" font-size="48" font-weight="bold" fill="white">ch</text>
			</svg>
		`.trim();
	} else {
		// Mixed state: split circle with gap
		// Left half (red) with "c", right half (green) with "h"
		return `
			<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
				<defs>
					<!-- Define clip paths for left and right halves with gap -->
					<clipPath id="leftHalf">
						<rect x="0" y="0" width="48" height="100"/>
					</clipPath>
					<clipPath id="rightHalf">
						<rect x="52" y="0" width="48" height="100"/>
					</clipPath>
				</defs>

				<!-- Left half circle (red) -->
				<circle cx="50" cy="50" r="48" fill="#dc2626" stroke="white" stroke-width="2" clip-path="url(#leftHalf)"/>

				<!-- Right half circle (green) -->
				<circle cx="50" cy="50" r="48" fill="#16a34a" stroke="white" stroke-width="2" clip-path="url(#rightHalf)"/>

				<!-- "c" in left half -->
				<text x="28" y="68" text-anchor="middle" font-family="Arial, sans-serif" font-size="48" font-weight="bold" fill="white">c</text>

				<!-- "h" in right half -->
				<text x="72" y="68" text-anchor="middle" font-family="Arial, sans-serif" font-size="48" font-weight="bold" fill="white">h</text>
			</svg>
		`.trim();
	}
}

/**
 * Update the favicon in the document
 */
export function updateFavicon(state: FaviconState): void {
	const svg = generateFaviconSVG(state);
	const encoded = `data:image/svg+xml,${encodeURIComponent(svg)}`;

	// Find or create the favicon link element
	let link = document.querySelector("link[rel*='icon']") as HTMLLinkElement | null;

	if (!link) {
		link = document.createElement('link');
		link.rel = 'icon';
		link.type = 'image/svg+xml';
		document.head.appendChild(link);
	}

	link.type = 'image/svg+xml';
	link.href = encoded;
}
