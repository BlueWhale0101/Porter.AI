# Deployment readiness record — PR #10

Date: 2026-10-04. Source baseline: merged PR #9, main
`511c1d34522599735e31f242d825fa970850fa64`.

| Check | Actual result |
| --- | --- |
| Real Supabase schema | Both Porter migrations applied; tables/RLS/grants/constraints/indexes verified |
| Real Storage | `porter-artifacts` created, private; ownership policies verified |
| Auth provisioning | Blocked: project had zero Auth users; owner must be provisioned through supported Auth flow |
| Production topology | Dedicated VPS Node/systemd service, same-origin HTTPS proxy, real Supabase |
| VPS access | No SSH host/configuration/credential available in this workspace |
| Public origin | Not yet allocated/configured |
| Local automated tests | 89 passing (including 11 deployment regressions) |
| Local production build | Passing; production bundle/manifest/worker checks pass |
| Real authenticated data path | Not run: requires provisioned owner and deployed origin |
| Real artifact upload/download | Not run; repeatable semantic/API script supplied |
| Browser render / IndexedDB / reload | Not run on deployed origin |
| Live manifest / service worker / old cache retirement | Not run; regression tests and build checks only |
| iPhone/PWA acceptance | Reserved for user; not claimed |

Do not treat this readiness PR as a completed live deployment. Review/merge first;
then deploy the resulting main SHA using `docs/deployment.md`, fill in the live URL,
deployed SHA, process/reboot verification, CI run and smoke evidence here.
