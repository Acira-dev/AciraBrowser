#!/usr/bin/env bash
# Runs the probe for each slug given, one after another: bash qa/extension-matrix/run-lane.sh <lane> <slug>...
lane=$1; shift
for slug in "$@"; do
  echo "=== $slug $(date +%T)" >> "qa/artifacts/ext-matrix/lane-$lane.log"
  env -u ELECTRON_RUN_AS_NODE REUSE=${REUSE:-0} timeout 900 node qa/extension-matrix/probe.mjs "$slug" >> "qa/artifacts/ext-matrix/lane-$lane.log" 2>&1
done
echo "=== lane $lane finished $(date +%T)" >> "qa/artifacts/ext-matrix/lane-$lane.log"
