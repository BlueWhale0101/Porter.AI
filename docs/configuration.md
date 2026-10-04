# Porter runtime configuration

See [deployment and rollback runbook](deployment.md) for the authoritative production
configuration, authentication, process management, migration and smoke procedures.
See [deployment status](deployment-status.md) for checks actually performed.

Porter uses a Supabase publishable/anon key with a verified user JWT and RLS;
no service-role key is needed. Browser sessions use same-origin HttpOnly cookies.
The shell and IndexedDB are readable before any authentication/network work.

`npm start` serves the production build and client API on `127.0.0.1:8790`.
`npm run mcp` optionally serves the private MCP endpoint on `127.0.0.1:8791`,
using the same validated runtime configuration and authenticated owner.
A Secure MCP Tunnel key does not replace the required Supabase user JWT.
