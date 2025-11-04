# Open URL or File

Open a URL or file path in an iframe within the current terminal tab.

This command expects two required arguments and one optional argument:
1. URL or file path to open (required)
2. Instructions text to display to the user (required)
3. "hidden" flag - if set, the iframe loads but stays hidden until toggled (optional)

Usage: `/ch-open "url" "instructions" [hidden]`

Examples:
- `/ch-open "https://example.com" "Review this documentation"`
- `/ch-open "file:///C:/path/to/report.html" "Check the test results"`
- `/ch-open "https://example.com" "Reference while coding" hidden` - Loads hidden, toggle with F10

The iframe can be toggled with F10 or by clicking the blue instruction bar. Press the × button to close the iframe view.

Please call `.claude/hooks/update-state.js openurl` with the provided arguments.
