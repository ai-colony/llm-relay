# Security Policy

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities.

Use GitHub's private advisory feature instead:

1. Go to the [Security tab](https://github.com/ai-colony/llm-relay/security) of this repository.
2. Click **"Report a vulnerability"**.
3. Describe the issue, steps to reproduce, and potential impact.

We will acknowledge the report within **7 days** and aim to release a patch within **90 days** for confirmed vulnerabilities.

## Scope

Issues we consider in scope:

- **SSRF** — `callbackUrl` accepting internal network targets
- **API key exposure** — `API_KEY` or `OPENAI_KEY` leaking via logs, responses, or errors
- **Prompt injection** — manipulating the relay to alter LLM behaviour in unintended ways
- **SQLite file access** — path traversal or unintended exposure of the database file
- **Authentication bypass** — circumventing the Bearer token middleware on `/prompt/*` routes

## Out of Scope

- Theoretical issues without a working proof of concept
- Vulnerabilities in self-hosted deployments caused by misconfiguration (e.g. exposing the server to the public internet without `API_KEY` set)
- Issues in dependencies that are already publicly disclosed upstream
