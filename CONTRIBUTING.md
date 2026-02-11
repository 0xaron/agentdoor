# Contributing to AgentDoor

Thank you for your interest in contributing to AgentDoor! This guide will help you get started.

## Development Setup

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) >= 9
- [Python](https://www.python.org/) >= 3.12 (for Python packages only)

### Getting Started

```bash
# Clone the repository
git clone https://github.com/0xaron/agentdoor.git
cd agentdoor

# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck

# Lint
pnpm lint
```

## Project Structure

AgentDoor is a monorepo managed with [pnpm workspaces](https://pnpm.io/workspaces) and [Turborepo](https://turbo.build/repo). Key directories:

- `packages/` — All npm/PyPI packages (core, adapters, integrations)
- `apps/` — Applications (dashboard)
- `examples/` — Example projects
- `tests/` — Integration tests
- `docs/` — Documentation

## Making Changes

### Branch Naming

Create a descriptive branch from `main`:

```bash
git checkout -b feat/your-feature-name
git checkout -b fix/issue-description
```

### Code Style

- **TypeScript:** Strict mode is enforced (`strict: true`, `noUnusedLocals`, `noUnusedParameters`). Run `pnpm typecheck` to verify.
- **Linting:** Run `pnpm lint` to check for code quality issues.
- **Formatting:** Run `pnpm format` to auto-format code with Prettier.

### Testing

All changes should include tests where applicable.

```bash
# Run all tests
pnpm test

# Run tests with coverage
pnpm test:coverage

# Run tests for a specific package
pnpm --filter @agentdoor/core test
```

Coverage thresholds are enforced: 75% lines, 75% branches, 80% functions, 75% statements.

### Commit Conventions

Use clear, descriptive commit messages:

- `feat: add webhook retry logic`
- `fix: handle expired challenge nonce`
- `docs: update API reference for token refresh`
- `test: add integration tests for x402 payments`
- `chore: update dependencies`

## Pull Request Process

1. Ensure all checks pass: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
2. Update documentation if your change affects public APIs.
3. Fill out the PR template with a clear description of your changes.
4. Request a review from a maintainer.

## Reporting Bugs

Open an issue on GitHub with:

- A clear description of the bug
- Steps to reproduce
- Expected vs. actual behavior
- Node.js version and OS

## Requesting Features

Open an issue describing:

- The problem you're trying to solve
- Your proposed solution
- Any alternatives you've considered

## License

By contributing to AgentDoor, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
