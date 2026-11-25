'use strict';
// The page's Media Session, as the browser sees it (Beta 14, the now-playing card). Electron has no browser-side controller for
// navigator.mediaSession: a page's own action handlers (previoustrack, nexttrack, seekto, ...) are reachable only from inside the
// page, and `setActionHandler` has no getter. So, before any page script runs, this notes what the page registers, exactly as a
// browser's media keys would find it, and nothing else: the handlers, the position the page declares (setPositionState, with its playbackState: kept the way Chromium keeps it, below), and which media elements it plays (below).
// Nothing is sent anywhere and nothing the page does changes. desktop/media-controls.cjs reads the note with a fixed script, to call
// a handler for Previous / Next (and for Seek where the media element is out of reach) with a user gesture, as Chromium does for a
// media key. Registered on every session but Tor's (a wrapped prototype is a mark; a Tor tab's Previous / Next step 10 seconds).
//
// Picture in picture (Beta 14, pip-look A): Chromium's small window shows Play/Pause and the 10-second steps only for actions the media
// session supports, and a page that registers none (a Twitch live stream may be one) gets a bare window. While a video of this document is in
// picture in picture, Acira registers its own default handlers for the actions the PAGE has not registered: play, pause and, for a video with a
// length, seekbackward / seekforward (never for a live stream). They are made through the engine's own setActionHandler, so the note above never
// counts them as the page's; a handler the page registers, before or after, always wins and is never touched; when the video leaves picture
// in picture the defaults are taken away again. Entered by the picture-in-picture events (any way in: the site's button, the right-click menu)
// and by `note.pipDefaults(video)`, which Acira's own pop-out (the card, Alt+P, automatic) calls just before it asks.
//
// Every media element the page plays, attached or not (Beta 14.1, Spotify's web player): a player that creates its element with `document.createElement('audio')` or
// `new Audio()` and never puts it in the document (Spotify, SoundCloud, Deezer) cannot be found with `document.querySelectorAll('video,audio')`, so the card could neither
// see nor drive it. `HTMLMediaElement.prototype.play` is wrapped the same way as the two methods above (the page's own call goes first and keeps its result and its errors):
// the element it was called on is remembered through a WeakRef (never kept alive; at most 48, the oldest and the dead dropped first) and `note.all()` answers the live ones, the
// most recently played first. A page that never calls play() (an element with `autoplay` alone) is only found if it is in the document, as before. `note.hooks` is a list of
// functions media-controls.cjs may add (the tab's volume is given to an element the first time it plays); each is called with the element and may throw.
const {contextBridge}=require('electron');
if(/^https?:/.test(location.href)){
  try{
    contextBridge.executeInMainWorld({func:function(){
      const proto=window.MediaSession&&window.MediaSession.prototype,key=Symbol.for('acira.mediaSession');
      if(!proto||window[key])return;
      const note={handlers:Object.create(null),position:null};
      try{Object.defineProperty(window,key,{value:note});}catch(error){return;}
      const setHandler=proto.setActionHandler,setPosition=proto.setPositionState;
      // The page's own call goes first and keeps its result and its errors; only a call the engine accepted is noted.
      const wrap=(name,original,after,target)=>{
        if(typeof original!=='function')return;
        const wrapper={[name](){const result=original.apply(this,arguments);try{after.apply(this,arguments);}catch(error){/* a note that cannot be taken is no loss */}return result;}}[name];
        Object.defineProperty(wrapper,'toString',{value:function toString(){return 'function '+name+'() { [native code] }';},configurable:true,writable:true});
        Object.defineProperty(target||proto,name,{value:wrapper,configurable:true,writable:true,enumerable:true});
      };
      const defaults=Object.create(null);   // action -> Acira's own handler, while a video is in picture in picture
      wrap('setActionHandler',setHandler,function(action,handler){const name=String(action);note.handlers[name]=typeof handler==='function'?handler:null;delete defaults[name];});
      const session=()=>{try{return navigator.mediaSession;}catch(error){return null;}};
      const give=video=>{
        const ms=session();if(!ms||typeof setHandler!=='function'||!video)return;
        const step=detail=>{const n=detail&&Number(detail.seekOffset);return n>0&&n<=600?n:10;};
        const made={
          play(){try{const p=video.play();if(p&&p.catch)p.catch(function(){});}catch(error){}},
          pause(){try{video.pause();}catch(error){}}
        };
        if(Number.isFinite(video.duration)&&video.duration>0){
          made.seekbackward=function(detail){try{video.currentTime=Math.max(0,video.currentTime-step(detail));}catch(error){}};
          made.seekforward=function(detail){try{video.currentTime=Math.min(video.duration,video.currentTime+step(detail));}catch(error){}};
        }
        for(const action of Object.keys(made)){
          if(typeof note.handlers[action]==='function'||defaults[action])continue;   // the page has its own (or ours is already there)
          try{setHandler.call(ms,action,made[action]);defaults[action]=made[action];}catch(error){/* an action this engine does not know */}
        }
      };
      const take=()=>{
        const ms=session();
        for(const action of Object.keys(defaults)){delete defaults[action];if(ms&&typeof setHandler==='function'&&typeof note.handlers[action]!=='function'){try{setHandler.call(ms,action,null);}catch(error){}}}
      };
      try{Object.defineProperty(note,'pipDefaults',{value:give});}catch(error){}
      try{
        document.addEventListener('enterpictureinpicture',function(event){give(event&&event.target);},true);
        document.addEventListener('leavepictureinpicture',function(){take();},true);
      }catch(error){}
      // The position the page declares, kept the way Chromium keeps it (Beta 14.2, D129): blink's MediaSession::setPositionState / setPlaybackState / RecalculatePositionState and
      // media_session::MediaPosition::GetPositionAtTime. The playbackRate is 1 when the page names none and the position 0; an empty dictionary clears the state; a duration of Infinity is a live
      // stream; a call blink refuses (no duration, negative, a position past the duration, a rate of 0) throws before it is noted, as the engine's own state keeps what it had. `rate` is the rate
      // NOW: 0 while the page's playbackState is 'paused', else the declared one (`declared`); when the playbackState changes the position is moved on to that instant with the old rate and
      // the clock starts again (RecalculatePositionState), so a pause freezes it and a play carries on from there. The card reads `position` + `rate` x time since `at`, held between 0 and the duration.
      const stateProp=Object.getOwnPropertyDescriptor(proto,'playbackState');
      let declared=1;
      const stateOf=function(self){try{return stateProp&&typeof stateProp.get==='function'?stateProp.get.call(self):'none';}catch(error){return 'none';}};
      const positionAt=function(p,now){const t=p.position+Math.max(0,now-p.at)/1000*p.rate;return t<=0?0:t>=p.duration?p.duration:t;};
      const recalc=function(self,wasSet){
        const p=note.position;if(!p)return;
        const now=Date.now(),rate=stateOf(self)==='paused'?0:declared;
        if(!wasSet&&rate===p.rate)return;
        if(!wasSet)p.position=positionAt(p,now);
        p.rate=rate;p.at=now;
      };
      wrap('setPositionState',setPosition,function(state){
        const has=function(k){return state[k]!==undefined;};
        if(!state||typeof state!=='object'||(!has('duration')&&!has('playbackRate')&&!has('position'))){note.position=null;declared=0;return;}
        declared=has('playbackRate')?Number(state.playbackRate):1;
        note.position={duration:Number(state.duration),position:has('position')?Number(state.position):0,rate:declared,declared:declared,at:Date.now()};
        recalc(this,true);
      });
      try{
        if(stateProp&&typeof stateProp.get==='function'&&typeof stateProp.set==='function'){
          const nativeSet=stateProp.set,holder={set playbackState(value){nativeSet.call(this,value);try{recalc(this,false);}catch(error){/* a note that cannot be taken is no loss */}}},wrapped=Object.getOwnPropertyDescriptor(holder,'playbackState').set;
          Object.defineProperty(wrapped,'toString',{value:function toString(){return 'function set playbackState() { [native code] }';},configurable:true,writable:true});
          Object.defineProperty(proto,'playbackState',{get:stateProp.get,set:wrapped,enumerable:stateProp.enumerable,configurable:stateProp.configurable});
        }
      }catch(error){/* the position is then carried at the rate the page declared */}
      // Every element the page plays, attached or not (see above).
      try{
        const owner=window.HTMLMediaElement&&window.HTMLMediaElement.prototype,played=owner&&owner.play;
        if(typeof played==='function'){
          const reg=[],hooks=[];let tick=0;
          const remember=function(el){
            if(!(el instanceof window.HTMLMediaElement))return;
            let known=false;
            for(const entry of reg){if(entry.ref.deref()===el){entry.at=++tick;known=true;break;}}
            if(!known){
              if(reg.length>=48){for(let i=reg.length-1;i>=0;i--)if(!reg[i].ref.deref())reg.splice(i,1);if(reg.length>=48){reg.sort(function(a,b){return a.at-b.at;});reg.shift();}}
              reg.push({ref:new WeakRef(el),at:++tick});
            }
            for(const hook of hooks.slice()){try{hook(el);}catch(error){/* a hook that fails is no loss */}}
          };
          wrap('play',played,function(){remember(this);},owner);
          const all=function all(){
            const live=[];
            for(let i=reg.length-1;i>=0;i--){const el=reg[i].ref.deref();if(!el){reg.splice(i,1);continue;}live.push({el:el,at:reg[i].at});}
            live.sort(function(a,b){return b.at-a.at;});
            return live.map(function(entry){return entry.el;});
          };
          Object.defineProperty(note,'all',{value:all});Object.defineProperty(note,'hooks',{value:hooks});
        }
      }catch(error){/* the card then finds only the media in the document */}
    }});
  }catch(error){/* A closing frame: the card then steps 10 seconds for Previous / Next. */}
}
