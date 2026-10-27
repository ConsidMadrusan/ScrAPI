Review the changes in this pull request against the architecture principles in CLAUDE.md (sections "Architecture principles", "Runtime and deployment", "Docker rules", and "Things you must not do").

Look for broken principles, server-only code or I/O leaking into the wrong layer, unclear module boundaries, coupling, duplication, unapproved dependencies, and new behavior without tests. Small drift counts.

Severities: **blocker**, **major**, **minor**.
