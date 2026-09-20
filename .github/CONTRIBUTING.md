# Contributing to Orpa

First off, thank you for considering contributing to Orpa! 🎉

## How Can I Contribute?

### Reporting Bugs

- Open a [Bug Report issue](../../issues/new?template=bug_report.md)
- Include steps to reproduce, expected vs actual behaviour, and your environment (Node version, OS, browser)
- Check existing issues first to avoid duplicates

### Suggesting Features

- Open a [Feature Request issue](../../issues/new?template=feature_request.md)
- Describe the problem you're solving and the proposed solution

### Pull Requests

1. **Fork** the repository
2. Create a **feature branch** from `main`:
   ```bash
   git checkout -b feature/my-new-feature
   ```
3. Make your changes with **clear commit messages**
4. Run the test suite:
   ```bash
   node test.js
   ```
5. Ensure no lint errors or security issues are introduced
6. Push to your fork and open a **Pull Request** against `main`
7. Fill in the [PR template](.github/PULL_REQUEST_TEMPLATE.md)

### Code Style

- Use **CommonJS** (`require` / `module.exports`) — the project uses `"type": "commonjs"`
- 2-space indentation
- Single quotes for strings
- Keep functions small and focused
- Add comments for non-obvious logic

### Commit Messages

- Use the present tense ("Add feature" not "Added feature")
- Use the imperative mood ("Move cursor to..." not "Moves cursor to...")
- Limit the first line to 72 characters

### Development Setup

```bash
git clone https://github.com/<you>/Orpa-Server.git
cd Orpa-Server
npm install
npm start
```

The server runs on `http://localhost:8000` by default.

---

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.
