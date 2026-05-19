# Contributing to Frogie

Thank you for your interest in contributing to Frogie! This document provides guidelines and instructions for contributing.

## Getting Started

### Prerequisites

- [Bun](https://bun.sh/) >= 1.0
- Node.js >= 20 (for some tooling)
- Git

### Development Setup

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/frogie.git
   cd frogie
   ```

2. Install dependencies:
   ```bash
   bun install
   ```

3. Copy the environment example:
   ```bash
   cp .env.example .env
   ```

4. Configure your `.env` file with required values (see `.env.example` for details).

5. Start the development server:
   ```bash
   bun run dev
   ```

## Development Workflow

### Project Structure

```
frogie/
├── packages/
│   ├── server/    # Hono backend (API, WebSocket, agent engine)
│   └── web/       # React frontend (Vite, Tailwind)
├── docs/          # Architecture documentation
└── tests/         # E2E tests (Playwright)
```

### Running Tests

```bash
# Run all unit tests
bun run test

# Run with coverage
bun run test -- --coverage

# Run E2E tests (requires Playwright)
bun run test:l3
```

### Code Quality

Before submitting a PR, ensure your code passes all checks:

```bash
# Type checking
bun run typecheck

# Linting
bun run lint

# All tests
bun run test
```

These checks run automatically on pre-commit and pre-push hooks.

## Submitting Changes

### Pull Request Process

1. Create a new branch from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. Make your changes and commit with clear, descriptive messages:
   ```bash
   git commit -m "feat(scope): add new feature"
   ```

3. Push to your fork and create a Pull Request.

4. Ensure all CI checks pass.

5. Wait for review and address any feedback.

### Commit Message Format

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
type(scope): description

[optional body]

[optional footer]
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

Examples:
- `feat(chat): add model selector dropdown`
- `fix(auth): handle expired JWT tokens`
- `docs(readme): update installation instructions`

## Code Style

- **TypeScript**: Strict mode enabled, no `any` types
- **Formatting**: Handled by ESLint (no Prettier)
- **Imports**: Use `@/` path alias for internal imports
- **Components**: Functional components with hooks

## Reporting Issues

When reporting issues, please include:

1. A clear, descriptive title
2. Steps to reproduce the problem
3. Expected vs actual behavior
4. Environment details (OS, Bun version, browser)
5. Relevant logs or error messages

## Questions?

Feel free to open a [Discussion](https://github.com/nocoo/frogie/discussions) for questions or ideas.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
