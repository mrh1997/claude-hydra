# Publishing to NPM

This document describes how to publish claude-hydra to npm using GitHub Actions with npm Trusted Publishing.

## Prerequisites

1. **NPM Account**: You need an npm account with publishing rights for the `claude-hydra` package.

2. **Trusted Publisher Configuration**: Instead of using long-lived tokens, we use npm's trusted publishing feature which uses OpenID Connect (OIDC) for secure, automatic authentication.

## One-Time Setup

### Configure Trusted Publisher on npmjs.com

1. Log in to [npmjs.com](https://www.npmjs.com/)
2. Navigate to your package: `https://www.npmjs.com/package/claude-hydra/access`
3. Scroll to the **"Publishing access"** section
4. Click **"Add trusted publisher"**
5. Select **"GitHub Actions"**
6. Fill in the configuration:
   - **Organization/User**: `mrh1997`
   - **Repository**: `claude-hydra`
   - **Workflow filename**: `publish.yml`
   - **Environment name**: Leave empty (unless using GitHub environments)
7. Click **"Add"**

That's it! No tokens to manage.

### Benefits of Trusted Publishing

- **No token management**: No need to generate, rotate, or store NPM_TOKEN secrets
- **Automatic provenance**: Every published package includes cryptographic attestations showing exactly how it was built
- **Better security**: Uses short-lived tokens that automatically expire after use
- **Supply chain transparency**: Users can verify your package's build process on npmjs.com

## Publishing a New Version

The publishing process is fully automated via GitHub Actions. To publish a new version:

### 1. Create and Push a Version Tag

```bash
# Create a tag for the version you want to publish
git tag v1.0.0

# Push the tag to GitHub
git push origin v1.0.0
```

The tag **must** follow the format `v*.*.*` (e.g., `v1.0.0`, `v2.3.1`, `v0.1.0-beta.1`).

### 2. Monitor the GitHub Action

1. Go to your GitHub repository
2. Click the **Actions** tab
3. You should see a "Publish to NPM" workflow running
4. Click on it to view the progress

### 3. Verify Publication

Once the workflow completes successfully:

1. Visit `https://www.npmjs.com/package/claude-hydra`
2. Verify the new version appears
3. Check the **"Provenance"** badge appears on the package page
4. Test installation: `npx claude-hydra@latest`

## How It Works

### Version Management

- `package.json` always contains version `0.0.0` in the repository
- When you push a tag like `v1.2.3`, the publish workflow:
  1. Extracts the version `1.2.3` from the tag
  2. Temporarily updates `package.json` to version `1.2.3`
  3. Builds and publishes with that version
  4. The version change is **not committed** back to the repository

This keeps the repository clean while allowing semantic versioning in npm.

### Workflows

#### CI Workflow (`.github/workflows/ci.yml`)
- Runs on every push and pull request to `master`/`main`
- Tests against Node.js 18, 20, and 22
- Runs type checking and build
- Helps catch issues before publishing

#### Publish Workflow (`.github/workflows/publish.yml`)
- Triggers only when a tag matching `v*.*.*` is pushed
- Uses OIDC to authenticate with npm (no tokens needed!)
- Builds the project
- Publishes to npm with the version from the tag
- Automatically generates provenance attestations

### Provenance and Supply Chain Security

Each published package includes provenance attestations that show:
- The exact GitHub repository and commit used to build it
- The GitHub Actions workflow that published it
- Cryptographic signatures proving authenticity

Users can view this on npmjs.com or verify it with:
```bash
npm audit signatures
```

## Troubleshooting

### "npm ERR! 403 Forbidden - configured trusted publishing provider does not match"
- Your trusted publisher configuration on npmjs.com doesn't match the workflow
- Verify the organization, repository, and workflow filename are correct
- Remember: npm doesn't validate the configuration when you save it - errors only appear during publish

### "npm ERR! 403 Forbidden - publish denied"
- Ensure you've configured the trusted publisher on npmjs.com
- Verify you have publish rights for the `claude-hydra` package

### "npm ERR! need auth This command requires you to be logged in"
- The workflow is missing the required `permissions` block
- Ensure `.github/workflows/publish.yml` has:
  ```yaml
  permissions:
    contents: read
    id-token: write
  ```

### "Version already published"
- You're trying to publish a version that already exists on npm
- Use a different version tag (npm doesn't allow republishing the same version)

### Build Fails
- Check the Actions tab for detailed error logs
- Ensure the build works locally: `npm run build`
- Ensure type checking passes: `npm run check`

### No Provenance Badge on npm
- Ensure your workflow has the `id-token: write` permission
- Ensure you're using Node.js 20.x with npm >= 11.5.1
- Provenance is only generated for public source repositories

## Manual Testing Before Publishing

To test the package locally before publishing:

```bash
# Build the package
npm run build

# Create a tarball
npm pack

# This creates claude-hydra-<version>.tgz
# Test installation from the tarball
npm install -g ./claude-hydra-0.0.0.tgz

# Test running
claude-hydra
```

## Fallback: Using NPM_TOKEN (Not Recommended)

If you need to use traditional token authentication:

1. Generate a token on npmjs.com (Profile → Access Tokens → Generate New Token → Automation)
2. Add it as `NPM_TOKEN` secret in GitHub Settings → Secrets and variables → Actions
3. Update `.github/workflows/publish.yml`:
   ```yaml
   - name: Publish to NPM
     run: npm publish
     env:
       NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
   ```
4. Remove the trusted publisher configuration from npmjs.com (only one auth method at a time)

However, trusted publishing is more secure and recommended.

## Unpublishing (Emergency Only)

If you need to unpublish a version (not recommended):

```bash
npm unpublish claude-hydra@<version>
```

**Note**: npm allows unpublishing only within 72 hours of publishing, and it's generally discouraged.
