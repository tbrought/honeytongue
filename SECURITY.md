# Security

## Reporting a vulnerability

Please report security problems privately, not in a public issue. Use GitHub's private vulnerability reporting: on the [Security tab](https://github.com/tbrought/honeytongue/security) of this repository, choose **Report a vulnerability**.

Useful things to include: the version of Honeytongue, what you found and how to reproduce it, and what an attacker could do with it.

Examples of what counts: a way to make the proxy (`createProxyHandler`) forward requests it should refuse, or leak an API key; a way for player input to change a character's verdict other than by persuading them; or anything in the published package that runs or sends data unexpectedly.

## Supported versions

Honeytongue is in alpha. Fixes go into the newest release only, so please upgrade before reporting.
