#!/bin/bash
set -e
cd /opt/data/repos/architect-ai

# Create branch and commit all prep work
git checkout -b dev/sandbox-mail-resend-config
git add -A
git status
git diff --cached --stat
