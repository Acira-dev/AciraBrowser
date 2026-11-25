/* Beta 14, the one-time "Welcome to Beta 14": the welcome page's side of desktop/welcome-service.cjs. The page asks main ('acira:welcome', window.acira.welcome)
   and hears main's events ('acira:welcome-event', window.acira.subscribeWelcome). The frost behind the welcome and the click-away live in main (the card's Copy image / Save picture /
   Save video go through the member card's own share, src/features/memberCard/share.ts); the page only says what it is doing and shows what main tells it. */

/** Page -> main. Every request has exactly these fields (main refuses anything else). */
export type WelcomeRequest=
 /** The welcome mounted in the overlay page: main starts the frost for this overlay, then sends {type:'frost',phase:'in'}. */
 |{type:'opened'}
 /** The welcome starts leaving: main plays the frost's exact reverse. */
 |{type:'leave'};
/** Main's answer. */
export interface WelcomeAnswer{ok:boolean}
/** Main -> page. 'frost' (phase 'in'): the frost has begun ramping, the entrance starts with it. 'away': a click on the frost outside the welcome's frame (an enlarged coin goes back). 'leave-request': the page scrim was clicked, play the reverse and answer with {type:'leave'} (main closes the overlay itself after 600 ms if nobody does). */
export type WelcomeEvent={type:'frost';phase:'in'}|{type:'away'}|{type:'leave-request'};

declare module './types'{
 interface BrowserRuntime{
  /** Beta 14: the one-time welcome's requests (desktop/welcome-service.cjs). */
  welcome?(request:WelcomeRequest):Promise<WelcomeAnswer>;
  /** Beta 14: main's events for the welcome ('frost', 'away', 'leave-request'). Returns the way to stop listening. */
  subscribeWelcome?(listener:(event:WelcomeEvent)=>void):()=>void;
 }
}
type Bridge={welcome?:(request:WelcomeRequest)=>Promise<WelcomeAnswer>;subscribeWelcome?:(listener:(event:WelcomeEvent)=>void)=>()=>void};
const bridge=():Bridge|undefined=>(typeof window==='undefined'?undefined:(window as unknown as {acira?:Bridge}).acira);

/** One request to main. It never throws: without the desktop bridge (a browser preview), or when main refuses or fails, the answer is {ok:false}. */
export async function welcomeCall(request:WelcomeRequest):Promise<WelcomeAnswer>{
 const api=bridge();
 if(!api?.welcome)return {ok:false};
 try{
  const answer=await api.welcome(request);
  return answer&&typeof answer==='object'?{ok:answer.ok===true}:{ok:false};
 }catch{return {ok:false};}
}

/** Main's events for the welcome. Without the desktop bridge nothing ever arrives (the caller's own fallback timer starts the entrance). */
export function subscribeWelcome(listener:(event:WelcomeEvent)=>void):()=>void{
 const api=bridge();
 if(!api?.subscribeWelcome)return()=>{};
 try{return api.subscribeWelcome(listener);}catch{return()=>{};}
}
