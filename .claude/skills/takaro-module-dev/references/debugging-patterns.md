# Debugging Patterns

This file documents known debugging patterns for Takaro module development. It starts minimal and grows as we discover new failure modes through real usage.

## Reading Execution Events

Fetch the latest execution event for your component:

```bash
bash scripts/takaro-api.sh POST /event/search '{
  "filters": { "eventName": ["command-executed"] },
  "sortBy": "createdAt",
  "sortDirection": "desc",
  "limit": 3
}'
```

Replace `command-executed` with `hook-executed` or `cronjob-executed` as needed.

## Log Interpretation

| Logs | Success | Meaning |
|------|---------|---------|
| Populated | true | Module ran and made API calls — check if the right calls were made |
| Populated | false | Module ran but an API call or assertion failed — read the error |
| Empty | true | Module code has a bug — likely missing imports, wrong method names, or unhandled exception |
| Empty | false | Module crashed before executing — syntax error or missing dependency |

## Known Pitfalls

- **Missing imports**: Without `import { data, takaro } from '@takaro/helpers'` the code fails silently (empty logs + success)
- **Wrong API method names**: The API client uses camelCase. Check the OpenAPI spec for exact names.
- **Missing `await`**: Forgetting to await an API call means it fires but the result is never checked and errors are swallowed.
- **Wrong command prefix**: Each game server has its own prefix. Always fetch it from the settings API.
- **`commandTrigger` uses `gameServerId` as the `id` parameter**, not the command's own ID.

## Fix-Redeploy-Retest Cycle

1. Identify the issue from execution logs
2. Update the module code via the Takaro API
3. Re-trigger the component
4. Check the new execution event
5. Repeat until the test passes

---

*This file grows as we discover new patterns. Add entries here when you encounter a new failure mode.*
