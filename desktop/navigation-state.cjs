function navigationKey(url) {
  try {const parsed=new URL(url);parsed.hash='';return parsed.href;} catch {return url;}
}

/** A late failure from an abandoned request must not replace its successor. */
/** ERR_CONTENT_DECODING_FAILED. */
const CONTENT_DECODING_FAILED=-330;

class NavigationState {
  target=null;
  phase='idle';
  /** The last main-frame failure ({url,error}) while its error page is what the view shows: a navigation that is then stopped goes back to it. */
  failure=null;
  start(url) {this.target=navigationKey(url);this.phase='loading';}
  commit(url) {this.target=navigationKey(url);this.phase='committed';this.failure=null;}
  waitingForCommit(url) {return this.phase==='loading'&&navigationKey(url)!==this.target;}
  fail(url,code,isMainFrame) {
    if(!isMainFrame||code===-3||navigationKey(url)!==this.target)return false;
    // A page whose body cannot be decoded (a gzip header that is not gzip) commits first and fails after: it is blank, so it gets the error page.
    // Other failures after the commit (a connection cut mid-page) keep what was already shown.
    if(this.phase==='committed'&&code!==CONTENT_DECODING_FAILED)return false;
    this.phase='failed';return true;
  }
}
module.exports={NavigationState};
