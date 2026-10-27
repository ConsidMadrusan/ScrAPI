Review the changes in this pull request for security problems. The service accepts untrusted specifications from the internet and runs a code generator on them, so assume hostile input.

Look for hard-coded secrets, missing input validation, injection (command, path traversal), sensitive data in logs, insecure defaults, missing limits (size, time, file count), error messages that leak internals, missed temp file cleanup, and workflow or Docker changes that widen permissions.

Severities: **critical**, **high**, **medium**, **low**.
