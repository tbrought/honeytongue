# Security

## Reporting a vulnerability

Please report security problems privately, not in a public issue. Use GitHub's private vulnerability reporting: on the [Security tab](https://github.com/tbrought/honeytongue/security) of this repository, choose **Report a vulnerability**.

Useful things to include: the version of Honeytongue, what you found and how to reproduce it, and what an attacker could do with it.

Examples of what counts: a way to make the proxy (`createProxyHandler`) forward requests it should refuse, or leak an API key; a way for player input to change a character's verdict other than by persuading them; or anything in the published package that runs or sends data unexpectedly.

## Supported versions

Honeytongue is in alpha. Fixes go into the newest release only, so please upgrade before reporting.

## Keep Node.js up to date

Honeytongue has no dependencies, so on a server it runs on whatever Node.js you give it, and the security of that matters more than any package version. Run the newest patch release of a supported Node.js line, and at least Node.js 22.23.4, 24.22.1, or 26.12.1: those fix CVE-2026-111497 ("Node2Shell", a Brotli decompression bug that can allow remote code execution) and several TLS hostname-check bypasses, released in October 2026.

Honeytongue itself never decompresses data. On an older Node.js, its only exposure is Node's built-in `fetch()`, which decompresses TypeSafe's replies to the proxy and `createJevClient`, so it would take a compromised API to reach the bug that way. But an app on an older Node.js is exposed through other routes, such as Express 5 decompressing Brotli request bodies, whatever Honeytongue does. Honeytongue contains no PHP, so PHP2Shell (CVE-2026-109618 and CVE-2026-109619) doesn't apply to it.
