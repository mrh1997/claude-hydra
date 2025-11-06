# Open URL or File

Open a URL or file path in an iframe within the current terminal tab.

This command expects two required arguments and one optional argument:
1. URL or file path to open (required)
2. Instructions text to display to the user (required)
3. "hidden" flag - if set, the iframe loads but stays hidden until toggled (optional)

Usage: `/ch-open "url" "instructions" [hidden]`

## Path/URL Detection Rules

- **URL**: Starts with `http:` or `https:` → passed through unchanged
- **Relative file path**: Starts with `@` → stripped and resolved from worktree root
  - Example: `@src/index.html` → resolves to `{worktree}/src/index.html`
- **File path**: Starts with `file:` → stripped and resolved as file path
- **Auto-detect**: Otherwise, checks if file exists; if yes, treats as file; if no, treats as URL

## Examples

- `/ch-open "https://example.com" "Review this documentation"`
- `/ch-open "@index.html" "View homepage"` - Relative to worktree root
- `/ch-open "@src/components/Button.tsx" "Review component"` - Nested path
- `/ch-open "file:///C:/path/to/report.html" "Check the test results"`
- `/ch-open "README.md" "View readme"` - Auto-detected as file if exists
- `/ch-open "https://example.com" "Reference while coding" hidden` - Loads hidden, toggle with F10

The iframe can be toggled with F10 or by clicking the blue instruction bar. Press the × button to close the iframe view.

Please call `.claude/hooks/update-state.js openurl` with the provided arguments.
