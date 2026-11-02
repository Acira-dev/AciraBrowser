function navigationKey(url) {
  try {const parsed=new URL(url);parsed.hash='';return parsed.href;} catch {return url;}
}

/** A late failure from an abandoned request must not replace its successor. */
class NavigationState {
  target=null;
  phase='idle';
  /** The last main-frame failure ({url,error}) while its error page is what the view shows: a navigation that is then stopped goes back to it. */
  failure=null;
  start(url) {this.target=navigationKey(url);this.phase='loading';}
  commit(url) {this.target=navigationKey(url);this.phase='committed';this.failure=null;}
  waitingForCommit(url) {return this.phase==='loading'&&navigationKey(url)!==this.target;}
  fail(url,code,isMainFrame) {
    if(!isMainFrame||code===-3||this.phase==='committed'||navigationKey(url)!==this.target)return false;
    this.phase='failed';return true;
  }
}
module.exports={NavigationState};
