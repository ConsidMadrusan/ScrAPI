Go through the changes in this pull request and look for:

- hard-coded secrets or credentials,
- missing input validation,
- injection risks (SQL, command, path traversal),
- sensitive data in logs,
- insecure default values.

Review as a senior developer responsible for the security of this service, which accepts untrusted specifications from the internet and runs a code generator on them. Be critical and assume hostile input. Trace untrusted data from where it enters (request bodies, uploaded files, specification content, generated output) to where it is used (file paths, child processes, ZIP entries, logs, responses). Check limits (size, time, file count), error messages that leak internals, temp file cleanup on every path, and workflow or Docker changes that widen permissions or expose secrets. Do not dismiss a weakness because exploiting it seems unlikely.

List each finding with a severity (**critical**, **high**, **medium**, **low**), file name and line number (`path/to/file.ts:42`), the category, a concrete attack or failure scenario, and a suggested fix. Order findings from most to least severe.

Every finding must be grounded in the diff; do not invent problems. If there are no findings, say so explicitly and briefly list which entry points and risks you checked.
