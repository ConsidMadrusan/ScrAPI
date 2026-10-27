Go through the changes in this pull request and look for:

- hard-coded secrets or credentials,
- missing input validation,
- injection risks (SQL, command, path traversal),
- sensitive data in logs,
- insecure default values.

List each finding with file name and line number (`path/to/file.ts:42`), the category, why it is a risk, and a suggested fix. Order findings from most to least severe. If there are no findings, write "No findings".
