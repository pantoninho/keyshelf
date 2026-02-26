# Feature: Automatic Changelog & Version Management

## Overview

Add semantic-release to automate version bumps, changelog generation, git tagging, GitHub releases, and npm publishing — all driven by conventional commits on push to main.

## Agreed Approach

- Use semantic-release with its standard plugin stack
- Replace the existing manual publish job in CI
- Tag current state as `v0.0.1` so semantic-release starts from there
- Initial changelog includes all existing commits
- No pre-release channels — releases only from `main`

## Implementation Roadmap

### Phase 1: Configuration

> Parallel: yes | Sequential dependencies: none

#### Task 1.1: Install semantic-release and plugins

- **Description**: Add semantic-release and all required plugins as devDependencies
- **Files**: `package.json`, `package-lock.json`
- **Details**:
    - Install: `semantic-release`, `@semantic-release/commit-analyzer`, `@semantic-release/release-notes-generator`, `@semantic-release/changelog`, `@semantic-release/npm`, `@semantic-release/github`, `@semantic-release/git`
    - Run `npm install` to update lockfile
- **Commit message**: `chore: install semantic-release and plugins`

#### Task 1.2: Create semantic-release configuration

- **Description**: Add `.releaserc.json` with plugin configuration
- **Files**: `.releaserc.json`
- **Details**:
  Create `.releaserc.json` with:
    ```json
    {
        "branches": ["main"],
        "plugins": [
            "@semantic-release/commit-analyzer",
            "@semantic-release/release-notes-generator",
            [
                "@semantic-release/changelog",
                {
                    "changelogFile": "CHANGELOG.md"
                }
            ],
            "@semantic-release/npm",
            ["@semantic-release/github"],
            [
                "@semantic-release/git",
                {
                    "assets": ["CHANGELOG.md", "package.json", "package-lock.json"],
                    "message": "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}"
                }
            ]
        ]
    }
    ```
    Plugin order matters — changelog must be generated before git commits it.
- **Commit message**: `chore: add semantic-release configuration`

### Phase 2: CI Integration

> Parallel: no | Sequential dependencies: Phase 1

#### Task 2.1: Replace publish job with semantic-release in CI

- **Description**: Replace the existing `publish` job with one that runs `npx semantic-release`
- **Files**: `.github/workflows/ci.yml`
- **Details**:
  Replace the entire `publish` job with:

    ```yaml
    release:
        needs: test
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
        runs-on: ubuntu-latest
        permissions:
            contents: write
            issues: write
            pull-requests: write
            id-token: write

        steps:
            - uses: actions/checkout@v4
              with:
                  fetch-depth: 0

            - uses: actions/setup-node@v4
              with:
                  node-version: 20
                  cache: npm
                  registry-url: https://registry.npmjs.org

            - run: npm ci

            - run: npm run build

            - name: Release
              run: npx semantic-release
              env:
                  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
                  NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
    ```

    Key changes from the old publish job:
    - `fetch-depth: 0` — semantic-release needs full git history to analyze commits
    - `contents: write` — needed to push tags, changelog commits, and create releases
    - `issues: write` + `pull-requests: write` — needed for semantic-release to comment on related issues/PRs
    - Removes the manual version-check logic — semantic-release handles this
    - Uses `GITHUB_TOKEN` (auto-provided) for GitHub operations

- **Commit message**: `ci: replace publish job with semantic-release`

### Phase 3: Initial Tag & Changelog

> Parallel: no | Sequential dependencies: Phase 2

#### Task 3.1: Generate initial CHANGELOG.md from existing commits

- **Description**: Generate a CHANGELOG.md covering all commits up to now, and create the `v0.0.1` git tag
- **Files**: `CHANGELOG.md`
- **Details**:
    - Create the `v0.0.1` tag on the current HEAD of main (will be done when merging — see note below)
    - Generate CHANGELOG.md from existing git history using conventional-changelog-cli:
        ```bash
        npx conventional-changelog -p angular -i CHANGELOG.md -s -r 0
        ```
        Then review and clean up the output.
    - Note: The `v0.0.1` tag must exist on main for semantic-release to know its starting point. This tag should be created on main before merging this branch, or immediately after. We'll handle this during PR/merge.
- **Commit message**: `docs: add initial CHANGELOG.md`

## Testing Strategy

This feature is purely configuration and CI — no application code changes. Testing consists of:

- Verify `.releaserc.json` is valid JSON and has correct plugin order
- Verify CI workflow YAML is valid
- Dry-run semantic-release locally to confirm config works: `npx semantic-release --dry-run`
- After merge: verify the first automated release triggers correctly
