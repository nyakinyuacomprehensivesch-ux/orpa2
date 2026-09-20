# Security Policy

## Supported Versions

| Version | Supported |
| ------- | -------- |
| 1.x     | ✅ |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them by emailing the project maintainer directly.

### What to Include

- Description of the vulnerability
- Steps to reproduce or proof-of-concept
- Potential impact
- Any suggested mitigations

### What to Expect

- You will receive an acknowledgment within 48 hours
- We will keep you updated on our progress toward a fix
- We will credit you in the security advisory (unless you prefer to remain anonymous)

## Security Best Practices for Deployment

- **Always run behind HTTPS** in production. Login tokens and passwords travel over the network.
- **Set a strong `JWT_SECRET`** — a long, cryptographically random string.
- **Set a strong `OWNER_PASSWORD`** before the first run.
- **Never commit `.env`** or any file containing secrets to the repository.
- **Keep SMTP credentials** (`EMAIL_SMTP_PASS`) only in environment variables or your hosting platform's secrets manager.
- **Use PostgreSQL** for shared/production deployments — the JSON backend is intended for pilots only.

## Known Security Measures

- Passwords are stored hashed with bcrypt (cost factor 10).
- JWT tokens include a `tokenVersion` claim; revoking a token is immediate.
- Rate limiting: 20 login attempts / 15 min and 10 sign-ups / hour per IP.
- Helmet security headers are applied to every HTTP response.
- Owner-only admin actions are enforced server-side (role check middleware).
- The owner account cannot be suspended or deleted through the admin API.
