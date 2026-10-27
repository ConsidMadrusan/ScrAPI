Review the changes in this pull request against the architecture principles defined in CLAUDE.md (sections "Architecture principles", "Runtime and deployment", "Docker rules", and "Things you must not do").

Review as a senior developer who owns this architecture and will maintain the code for years. Be critical and direct. Do not soften findings or praise routine work. Question every new module boundary, dependency, and shortcut: does it belong where it is, does it leak server-only code or I/O into the wrong layer, does it duplicate something that already exists, and will it still hold when the next target or feature is added? Flag drift from the principles even when it is small, because small drift accumulates.

Answer:

1. **Violations:** where do the changes break the principles? For each one, give a severity (**blocker**, **major**, **minor**), name the principle, the file and line, why it matters, and what to change.
2. **Risks and design concerns:** changes that do not break a written rule yet but weaken the architecture (unclear responsibilities, coupling, missing boundaries, missing tests for new behavior). Same format.
3. **Alignment:** one or two sentences at most on what the changes do well.

Give concrete file references (`path/to/file.ts:42`). Every finding must be grounded in the diff; do not invent problems. If you find no violations, say so explicitly under Violations and briefly state which principles you checked against.
