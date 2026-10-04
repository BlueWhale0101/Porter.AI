#!/usr/bin/env bash
set -euo pipefail
# Run as root after review/merge: deploy/release.sh /opt/porter/source EXACT_MAIN_SHA
repo=${1:?Pass the dedicated Porter source checkout}
revision=${2:?Pass the reviewed merged-main SHA}
[[ "$revision" =~ ^[0-9a-f]{40}$ ]] || { echo 'A full Git SHA is required' >&2; exit 1; }
[[ $(id -u) == 0 ]] || { echo 'Run with sudo on the VPS' >&2; exit 1; }
git -C "$repo" fetch origin main
[[ $(git -C "$repo" rev-parse FETCH_HEAD) == "$revision" ]] || { echo 'Refusing to deploy anything except current origin/main' >&2; exit 1; }
[[ -z $(git -C "$repo" status --porcelain) ]] || { echo 'Source checkout is dirty' >&2; exit 1; }
[[ $(node -p 'Number(process.versions.node.split(".")[0])') -ge 22 ]] || { echo 'Node 22+ required' >&2; exit 1; }
release="/opt/porter/releases/$revision"
[[ ! -e "$release" ]] || { echo 'Release already exists; inspect or use the documented rollback procedure' >&2; exit 1; }
mkdir -p /opt/porter/releases
git -C "$repo" worktree add --detach "$release" "$revision"
cd "$release"
npm ci --ignore-scripts
npm test
npm run build
node scripts/check-build.mjs "$revision"
chown -R root:porter "$release"
chmod -R go-w "$release"
previous=$(readlink -f /opt/porter/current || true)
ln -s "$release" /opt/porter/current.next
mv -Tf /opt/porter/current.next /opt/porter/current
if systemctl restart porter-web.service && node scripts/wait-health.mjs "$revision"; then
    echo "Porter deployed: $revision"
else
    echo 'Health/revision verification failed; restoring previous release' >&2
    if [[ -n "$previous" && -d "$previous" ]]; then
        ln -s "$previous" /opt/porter/current.rollback
        mv -Tf /opt/porter/current.rollback /opt/porter/current
        systemctl restart porter-web.service
    else
        systemctl stop porter-web.service
    fi
    exit 1
fi
if systemctl is-enabled --quiet porter-mcp.service; then systemctl restart porter-mcp.service; fi
