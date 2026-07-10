#!/bin/bash
set -e
cd /opt/data/memories-express-mvp-cp
git checkout -b carlos/mas-188-support-inbox 2>/dev/null || git checkout carlos/mas-188-support-inbox
pnpm typecheck 2>&1 | head -100
