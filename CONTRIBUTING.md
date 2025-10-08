# Contributing to S3CoreDB

Thank you for your interest in contributing to S3CoreDB! We welcome contributions from the community and are grateful for your support.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing Guidelines](#testing-guidelines)
- [Commit Messages](#commit-messages)

---

## Code of Conduct

This project adheres to a code of conduct. By participating, you are expected to uphold this code. Please be respectful and constructive in all interactions.

---

## Getting Started

### Prerequisites

- Node.js 16 or higher
- npm or yarn
- Git
- TypeScript 5.0+

### Fork and Clone

1. Fork the repository on GitHub
2. Clone your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/s3coredb.git
   cd s3coredb
   ```

3. Add the upstream repository:
   ```bash
   git remote add upstream https://github.com/TylorMayfield/s3coredb.git
   ```

### Install Dependencies

```bash
npm install
```

### Build the Project

```bash
npm run build
```

### Run Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

---

## Development Workflow

### 1. Create a Branch

Create a new branch for your feature or bugfix:

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
```

Branch naming conventions:
- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation updates
- `test/` - Test improvements
- `refactor/` - Code refactoring
- `perf/` - Performance improvements

### 2. Make Your Changes

- Write clean, maintainable code
- Follow the existing code style
- Add tests for new features
- Update documentation as needed
- Keep commits focused and atomic

### 3. Test Your Changes

```bash
# Run all tests
npm test

# Run specific test file
npm test -- filename.test.ts

# Check test coverage
npm run test:coverage
```

Ensure all tests pass and maintain or improve code coverage.

### 4. Update Documentation

- Update README.md if you add new features
- Add JSDoc comments for new functions
- Update CHANGELOG.md following [Keep a Changelog](https://keepachangelog.com/)
- Add examples if appropriate

---

## Pull Request Process

### Before Submitting

1. **Sync with upstream**:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Run tests**:
   ```bash
   npm test
   ```

3. **Check for linting errors**:
   ```bash
   npm run build
   ```

4. **Update CHANGELOG.md** with your changes

### Submitting the PR

1. Push your branch to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```

2. Open a Pull Request on GitHub

3. Fill out the PR template with:
   - Clear description of changes
   - Related issue number (if applicable)
   - Test results
   - Screenshots (if UI changes)

4. Wait for review and address feedback

### PR Review Process

- At least one maintainer will review your PR
- CI/CD checks must pass
- Code coverage should not decrease
- All discussions must be resolved
- Squash commits if requested

---

## Coding Standards

### TypeScript Style

```typescript
// ✅ Good
interface User {
  id: string;
  name: string;
  email: string;
}

async function createUser(data: User): Promise<User> {
  // Implementation
}

// ❌ Bad
function createUser(data: any): any {
  // Implementation
}
```

### Naming Conventions

- **Classes**: PascalCase (`S3CoreDB`, `CacheManager`)
- **Functions/Methods**: camelCase (`createNode`, `queryNodes`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_CACHE_SIZE`, `DEFAULT_TTL`)
- **Interfaces/Types**: PascalCase (`Node`, `Relationship`)
- **Files**: kebab-case (`cache-manager.ts`, `s3-storage-adapter.ts`)

### Error Handling

Always use custom error types:

```typescript
// ✅ Good
if (!node) {
  throw new NodeNotFoundError(nodeId);
}

// ❌ Bad
if (!node) {
  throw new Error('Node not found');
}
```

### Async/Await

Prefer async/await over promises:

```typescript
// ✅ Good
async function getData(): Promise<Data> {
  const result = await fetchData();
  return result;
}

// ❌ Bad
function getData(): Promise<Data> {
  return fetchData().then(result => result);
}
```

---

## Testing Guidelines

### Test Structure

```typescript
describe('FeatureName', () => {
  beforeEach(() => {
    // Setup
  });

  afterEach(() => {
    // Cleanup
  });

  describe('method name', () => {
    it('should do something specific', async () => {
      // Arrange
      const input = createTestData();

      // Act
      const result = await methodUnderTest(input);

      // Assert
      expect(result).toBeDefined();
      expect(result.property).toBe(expectedValue);
    });

    it('should handle error cases', async () => {
      await expect(methodUnderTest(invalidInput))
        .rejects.toThrow(ExpectedError);
    });
  });
});
```

### Test Coverage

- Aim for at least 80% coverage
- Cover happy paths and error cases
- Test edge cases and boundary conditions
- Mock external dependencies (S3, filesystem)

### Test Categories

1. **Unit Tests** - Test individual functions/classes
2. **Integration Tests** - Test component interactions
3. **End-to-End Tests** - Test complete workflows

---

## Commit Messages

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `test`: Adding or updating tests
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `chore`: Maintenance tasks
- `ci`: CI/CD changes

### Examples

```
feat(storage): Add S3 bucket versioning support

Implemented versioning for S3 storage adapter to track object history.

Closes #123
```

```
fix(cache): Resolve memory leak in node cache

Fixed issue where deleted nodes were not being removed from cache,
causing memory usage to grow indefinitely.

Fixes #456
```

```
docs(readme): Update installation instructions

Added instructions for using different storage adapters.
```

---

## Questions?

- 💬 [GitHub Discussions](https://github.com/TylorMayfield/s3coredb/discussions)
- 📧 Email the maintainers
- 🐛 [Open an issue](https://github.com/TylorMayfield/s3coredb/issues)

---

## License

By contributing to S3CoreDB, you agree that your contributions will be licensed under the ISC License.

---

Thank you for contributing to S3CoreDB! 🎉

