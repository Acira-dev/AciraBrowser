// First import of every rig that drives Google or YouTube itself. Automated traffic from this PC earns Google's unusual-traffic page for everyone on its
// one address, the founder included (see desktop/browser-services/quiet-network.cjs). These rigs refuse to run unless asked: at most a handful of page
// loads, by hand, with ACIRA_QA_LIVE_GOOGLE=1. Modes that only read a saved report or stay on a local page pass.
const local = process.argv.slice(2).some(arg => ['--show', '--echo-only'].includes(arg) || /^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(arg));
if (process.env.ACIRA_QA_LIVE_GOOGLE !== '1' && !local) {
  console.error('This rig contacts Google or YouTube. Use a local fixture, or set ACIRA_QA_LIVE_GOOGLE=1 for a few deliberate page loads.');
  process.exit(2);
}
