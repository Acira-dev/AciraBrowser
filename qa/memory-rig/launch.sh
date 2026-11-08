#!/bin/zsh
# usage: launch.sh <one|seven>   — one dev build on /tmp/acira-qa/memory-rig/<run> (never two at once)
D=${0:A:h}
export NODE_OPTIONS="--require /tmp/acira-qa/mock-keychain-hook.cjs"
mkdir -p /tmp/acira-qa/memory-rig
cd $D/../.. && (node qa/memory-rig/driver.mjs ${1:-seven} > /tmp/acira-qa/memory-rig/driver-${1:-seven}.log 2>&1 &)
for i in {1..120}; do sleep 1; grep -q READY /tmp/acira-qa/memory-rig/driver-${1:-seven}.log 2>/dev/null && break; grep -q ABORT /tmp/acira-qa/memory-rig/driver-${1:-seven}.log && break; done
tail -3 /tmp/acira-qa/memory-rig/driver-${1:-seven}.log
