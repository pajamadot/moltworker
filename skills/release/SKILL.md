---
name: release
description: Release a new version of the story CLI. Bumps version, tags, pushes to trigger CI builds for all 5 platforms, uploads to R2 CDN, and publishes to npm.
tags: [release, cli, npm, r2, ci, deploy]
---

# CLI Release Skill

Release a new version of `@pajamadot/story-cli` to all platforms.

## Architecture

```
release.ps1 -Bump <level>
  -> bumps Cargo.toml + npm/package.json
  -> git commit + tag cli/vX.Y.Z + push
  -> GitHub Actions (.github/workflows/cli-release.yml)
       -> 3 parallel build jobs (Linux, macOS, Windows) = 5 binaries
       -> release job: checksums + R2 upload
  -> manual: npm publish
```

**Binaries hosted at**: `https://releases.pajamadot.com/cli/vX.Y.Z/`
**npm package**: `@pajamadot/story-cli` (postinstall downloads from CDN)
**Self-update**: `story update` (checks `cli/latest.json`)

## Release Flow

### 1. Bump + Tag (triggers CI)

```powershell
cd story-cli
.\scripts\release.ps1 -Bump patch   # 0.2.0 -> 0.2.1
.\scripts\release.ps1 -Bump minor   # 0.2.0 -> 0.3.0
.\scripts\release.ps1 -Bump major   # 0.2.0 -> 1.0.0
```

This automatically:
- Parses current version from `Cargo.toml`
- Bumps semver in `Cargo.toml` and `npm/package.json`
- Runs `cargo check` to sync `Cargo.lock`
- Creates git commit: `chore: bump CLI to vX.Y.Z`
- Creates git tag: `cli/vX.Y.Z`
- Pushes commit + tag to origin

### 2. Wait for CI

The tag push triggers `.github/workflows/cli-release.yml` which:
- Builds 5 binaries in parallel across 3 OS runners
- Generates `checksums.sha256`
- Generates `cli/latest.json`
- Uploads everything to R2 (`pajamadot-releases` bucket)

Monitor CI:
```powershell
gh run list --workflow=cli-release.yml --limit 3
gh run watch    # live tail the latest run
```

### 3. Verify R2

```powershell
curl https://releases.pajamadot.com/cli/latest.json
# Should show: {"version":"X.Y.Z","released":"..."}

curl -I https://releases.pajamadot.com/cli/vX.Y.Z/story-x86_64-pc-windows-msvc.exe
# Should return 200
```

### 4. Publish to npm

```powershell
cd story-cli/npm
npm publish --access public
```

### 5. Verify Install

```powershell
npm install -g @pajamadot/story-cli
story --version    # should show new version
story health       # should pass
```

## Manual Local Build + Upload (no CI)

For hotfixes or when CI is unavailable:

```powershell
# Windows-only build + upload all from dist/
cd story-cli
.\scripts\release.ps1

# Upload pre-built dist/ only (no build)
.\scripts\release.ps1 -UploadOnly
```

```bash
# All platforms (Linux/macOS, needs cross or native targets)
cd story-cli
./scripts/release.sh

# Upload only
./scripts/release.sh --upload-only
```

## Platform Targets

| Platform | Target | Binary Name |
|----------|--------|-------------|
| Windows x64 | `x86_64-pc-windows-msvc` | `story-x86_64-pc-windows-msvc.exe` |
| Linux x64 | `x86_64-unknown-linux-gnu` | `story-x86_64-unknown-linux-gnu` |
| Linux arm64 | `aarch64-unknown-linux-gnu` | `story-aarch64-unknown-linux-gnu` |
| macOS x64 | `x86_64-apple-darwin` | `story-x86_64-apple-darwin` |
| macOS arm64 | `aarch64-apple-darwin` | `story-aarch64-apple-darwin` |

## CDN Layout (R2)

```
pajamadot-releases/
  cli/
    latest.json                              # {"version":"X.Y.Z","released":"..."}
    v0.2.1/
      story-x86_64-pc-windows-msvc.exe
      story-x86_64-unknown-linux-gnu
      story-aarch64-unknown-linux-gnu
      story-x86_64-apple-darwin
      story-aarch64-apple-darwin
      checksums.sha256
```

Public URL: `https://releases.pajamadot.com/cli/vX.Y.Z/{filename}`

## Required Secrets

| Secret | Where | Purpose |
|--------|-------|---------|
| `CLOUDFLARE_API_TOKEN` | GitHub Actions | R2 upload via wrangler |
| `CLOUDFLARE_ACCOUNT_ID` | GitHub Actions | Cloudflare account |

npm publish is done locally (uses your local `npm login` session).

## Troubleshooting

**CI build fails**: Check the GitHub Actions run logs. Common issues:
- Rust compilation errors (fix code, re-tag)
- Missing GitHub secrets (add in repo Settings > Secrets)
- cross Docker issues on Linux (retry usually fixes)

**R2 upload fails**: Verify `CLOUDFLARE_API_TOKEN` has R2 write permissions.

**npm postinstall fails**: The binary download is best-effort. If CDN is down, users see a warning but `npm install` still succeeds. They can retry with `npm rebuild @pajamadot/story-cli`.

**Self-update fails**: `story update` downloads from `releases.pajamadot.com`. On Windows it renames the running .exe before replacing. If interrupted, the `.exe.old` file is cleaned up on next update.
