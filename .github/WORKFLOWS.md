# GitHub Workflows Documentation

This document explains the CI/CD workflows configured for the S3CoreDB project.

## 🔄 Active Workflows

### 1. CI (Continuous Integration) - `ci.yml`

**Triggers:**
- Push to `main` branch
- Pull requests to `main` branch

**What it does:**
- Tests the project on Node.js 18.x and 20.x (matrix build)
- Runs linting and TypeScript checks
- Generates test coverage reports
- Uploads coverage artifacts (retained for 30 days)

**Key Features:**
- ✅ Multi-version Node.js testing
- ✅ npm caching for faster builds
- ✅ Separate lint job for code quality
- ✅ Coverage reporting

---

### 2. NPM Publish - `npm-publish.yml`

**Triggers:**
- GitHub release is published
- Manual workflow dispatch

**What it does:**
- Runs full test suite before publishing
- Builds the project
- Publishes to NPM registry
- Comments on the release with version info

**Security:**
- Requires `NPM_TOKEN` secret to be configured
- Only publishes after tests pass
- Uses `npm ci` for reproducible builds

**Setup Required:**
1. Create NPM token: https://www.npmjs.com/settings/[your-username]/tokens
2. Add token to GitHub Secrets as `NPM_TOKEN`
3. Ensure package.json has correct name and version

---

### 3. Performance Benchmark - `benchmark.yml`

**Triggers:**
- Manual workflow dispatch
- Push to `main` branch (when src/ or benchmark file changes)
- Pull requests (when src/ or benchmark file changes)

**What it does:**
- Runs performance benchmarks
- Compares PR performance with main branch
- Posts comparison results as PR comment
- Stores benchmark data as artifacts (90 days retention)

**Features:**
- ✅ Automatic benchmark comparison on PRs
- ✅ Historical benchmark data storage
- ✅ Performance regression detection

---

### 4. Dependency Review - `dependency-review.yml`

**Triggers:**
- Pull requests to `main` branch

**What it does:**
- Reviews dependency changes in PRs
- Checks for security vulnerabilities
- Fails on moderate+ severity issues
- Posts summary comment on PRs

**Security Features:**
- ✅ Automatic vulnerability scanning
- ✅ License compliance checking
- ✅ Breaking change detection

---

## 🗑️ Removed Workflows

### Auto Update Packages (REMOVED)

**Why removed:**
- Automatically updating packages is risky
- Could introduce breaking changes without review
- No tests run before committing
- Better to manually update with proper testing

**Alternative:**
Run dependency updates manually:
```bash
# Check for outdated packages
npm outdated

# Update packages
npm update

# Or update to latest versions
npx npm-check-updates -u
npm install

# Always test after updates
npm test
```

---

## 📋 Workflow Best Practices

### For Contributors

1. **Before submitting PR:**
   - Run `npm test` locally
   - Run `npm run build` to ensure it compiles
   - Check `npx tsc --noEmit` for TypeScript errors

2. **PR Requirements:**
   - All CI checks must pass
   - Test coverage should not decrease
   - Dependency review must pass (no critical vulnerabilities)

3. **Benchmark Results:**
   - Review benchmark comments on PRs
   - Significant performance regressions should be investigated

### For Maintainers

1. **Publishing a Release:**
   ```bash
   # Update version in package.json
   npm version patch  # or minor/major
   
   # Push the tag
   git push --tags
   
   # Create GitHub release (triggers npm-publish workflow)
   ```

2. **Monitoring:**
   - Check Actions tab for failed workflows
   - Review dependency alerts regularly
   - Keep an eye on benchmark trends

3. **Secrets Management:**
   - `NPM_TOKEN` - Required for publishing to NPM
     - Location: Settings > Secrets and variables > Actions
     - Type: Repository secret
     - Expiration: Check and rotate annually

---

## 🔧 Troubleshooting

### CI Failures

**Tests fail on CI but pass locally:**
- Ensure you're using the same Node.js version
- Check if there are OS-specific issues (CI uses Ubuntu)
- Verify environment variables are set correctly

**Build fails:**
- Check TypeScript compilation: `npx tsc --noEmit`
- Ensure all dependencies are in package.json
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`

### NPM Publish Issues

**Authentication fails:**
- Verify `NPM_TOKEN` secret is set correctly
- Check token hasn't expired
- Ensure token has publish permissions

**Version already exists:**
- Update version in package.json
- Create a new git tag
- Ensure you're not trying to republish same version

### Benchmark Failures

**Benchmark times out:**
- Check if benchmark script is hanging
- Increase timeout in workflow if needed
- Verify benchmark data directory is accessible

---

## 📊 Metrics & Monitoring

### Test Coverage
- Coverage reports are generated on every CI run
- Download from Actions > CI > Artifacts
- Goal: Maintain >90% coverage

### Benchmark Data
- Historical data stored as artifacts
- Retention: 90 days
- Location: Actions > Performance Benchmark > Artifacts

### Dependency Health
- Reviewed automatically on every PR
- Check: Settings > Security > Dependabot alerts
- Update strategy: Manual with testing

---

## 🔒 Security

### Secrets Used
| Secret | Purpose | Required For |
|--------|---------|--------------|
| NPM_TOKEN | Publishing to NPM | npm-publish.yml |
| GITHUB_TOKEN | Automatic (provided by GitHub) | All workflows |

### Permissions
- Workflows use minimal required permissions
- Dependency review: read-only on contents
- NPM publish: no write access to repo

### Best Practices
- ✅ Use `npm ci` instead of `npm install` in CI
- ✅ Pin action versions (e.g., `actions/checkout@v4`)
- ✅ Run tests before any publish operation
- ✅ Review dependency changes in PRs

---

## 📚 Additional Resources

- [GitHub Actions Documentation](https://docs.github.com/en/actions)
- [NPM Publishing Guide](https://docs.npmjs.com/cli/v9/commands/npm-publish)
- [Semantic Versioning](https://semver.org/)
- [Dependabot Configuration](https://docs.github.com/en/code-security/dependabot)

---

## 🤝 Contributing

If you want to modify workflows:

1. Test changes in a fork first
2. Document any new secrets or configurations needed
3. Update this documentation
4. Get approval from maintainers before merging

---

Last Updated: 2025-10-08
