In the changes in this pull request, identify:

- functions that do more than one thing,
- unclear naming (variables, functions, classes),
- missing error handling for external calls,
- code that is hard to read without comments.

Review as a demanding senior developer doing a code review before merge. Hold the code to a high standard: the next developer must understand it without asking. Be critical and specific. Do not praise routine work and do not soften findings. Also flag duplicated logic, dead code, needless complexity, misleading comments, and new behavior without tests.

List the five most serious problems, most serious first. For each, give a severity (**major**, **minor**, **nit**), the file and line (`path/to/file.ts:42`), the problem, and a concrete improvement (a short code suggestion where it helps). After the five, you may add a short "Also noticed" list of smaller issues.

Every finding must be grounded in the diff; do not invent problems. If there are fewer than five real problems, list only those. If there are none, say so explicitly and briefly state what you checked.
