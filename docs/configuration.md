# Porter runtime configuration

The MCP server is deliberately an authenticated server-side service. Do not expose its token or Supabase secret keys to a phone client.

| Variable | Purpose |
| --- | --- |
| `PORTER_SUPABASE_URL` | Supabase project URL |
| `PORTER_SUPABASE_KEY` | Supabase publishable key used with RLS |
| `PORTER_ARTIFACT_BUCKET` | optional, defaults to `porter-artifacts` |
| `PORTER_MCP_HOST` / `PORTER_MCP_PORT` | optional listener values; default `127.0.0.1:8788` |

Run `npm run mcp`; `GET /health` is a non-sensitive health check and `POST /mcp` is the Streamable HTTP MCP endpoint. Every `POST /mcp` request must present `Authorization: Bearer <Supabase user JWT>`. The runtime resolves that caller with `auth.getUser(accessToken)`; MCP tools never accept an owner ID as authority. The backend uses RLS with that per-request JWT rather than a service role key.
