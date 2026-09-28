# Security Policy

## Supported versions

Only the latest commit on `main` is supported. This is a personal project with no
release train — pull the latest and you are up to date.

## Where API keys live

**No API key is committed to this repository.** `api.js` ships with empty `KEYS`
arrays on purpose, so the repo is safe to publish.

| File | Purpose | Git | Served to browsers |
|---|---|---|---|
| `keys.local.json` | your real keys | ❌ ignored | ❌ `403` |
| `.env` | your real keys | ❌ ignored | ❌ `403` |
| `keys.example.json` | empty template | ✅ committed | ✅ |
| `.env.example` | empty template | ✅ committed | ✅ |
| `api.js`, `server.js` | code | ✅ committed | ❌ `403` |

Set up a key with one of:

```bash
cp keys.example.json keys.local.json   # then paste your key in
cp .env.example .env                  # then paste your key in
```

or use the Settings UI in the app, or export `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` /
`ANTHROPIC_API_KEY` / `GEMINI_API_KEY`.

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Email the maintainer privately, or use GitHub's
[private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
on this repository.

Expect an acknowledgement within a few days. Because this is a local-first personal
app with no server component, most findings are low severity — but a leaked key is
treated as urgent.

## If you think you leaked a key

1. **Rotate it immediately** at the provider. Treat it as burned; do not wait.
2. If it reached git history, removing the file is not enough — rewrite history with
   `git filter-repo`, or start a clean repository.
3. Check the provider's usage page for unexpected spend.

## Things worth knowing

- Keys are stored **in plaintext**. There is no encryption and no OS keychain
  integration. Anyone with access to the file, the browser profile, or the running
  process can read them.
- `node server.js --host 0.0.0.0` shares your keys with every machine on the network.
  Localhost is the safe default, and the server warns you when you change it.
- Browser-only mode (opening `index.html` directly) keeps keys in `localStorage`,
  which is not encrypted and is readable by anyone using that browser profile.
- There is no analytics, tracking, or telemetry. The only outbound request is the
  message you send to the AI provider you configured.
