/** Long tab titles (founder, Round 2): while the pointer rests on a tab whose title does not fit, the title scrolls
 * like a marquee: it waits a beat, glides to its end, holds, glides back, holds, and loops. On leave it eases home
 * from wherever it is. Transform only, so it runs on the compositor; reduced motion keeps the faded title still.
 * `box` is the clipping title element and its first child is the text that moves (strip, compact strip, sidebar). */
const running=new WeakMap<HTMLElement,Animation>();
const speed=42; // px per second, slow enough to read

export function startTitleMarquee(box:HTMLElement|null){
 const text=box?.firstElementChild as HTMLElement|null;
 if(!box||!text||running.has(box)||box.closest('[data-reduced-motion=true]')||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
 const distance=Math.ceil(text.scrollWidth-box.clientWidth)+18; // past the end fade, so the last word reads
 if(distance<24)return;
 const lead=650,glide=Math.min(7000,Math.max(700,distance/speed*1000)),hold=1100,back=Math.min(1200,Math.max(450,glide*.45));
 const total=lead+glide+hold+back+hold,at=(ms:number)=>ms/total;
 // A right-to-left title (its box has dir=auto) starts at the right and runs past the left edge: it glides the other way.
 const glideEase='cubic-bezier(.45,0,.55,1)',home=`translateX(0)`,end=`translateX(${getComputedStyle(box).direction==='rtl'?distance:-distance}px)`;
 box.dataset.marquee='on';
 running.set(box,text.animate([
  {offset:0,transform:home},
  {offset:at(lead),transform:home,easing:glideEase},
  {offset:at(lead+glide),transform:end},
  {offset:at(lead+glide+hold),transform:end,easing:glideEase},
  {offset:at(lead+glide+hold+back),transform:home},
  {offset:1,transform:home}
 ],{duration:total,iterations:Infinity}));
}

export function stopTitleMarquee(box:HTMLElement|null){
 const text=box?.firstElementChild as HTMLElement|null,animation=box&&running.get(box);
 if(!box||!text||!animation)return;
 running.delete(box);
 const x=new DOMMatrixReadOnly(getComputedStyle(text).transform).m41;
 animation.cancel();
 if(Math.abs(x)<1){delete box.dataset.marquee;return;}
 const back=text.animate([{transform:`translateX(${x}px)`},{transform:'translateX(0)'}],{duration:Math.min(420,180+Math.abs(x)*2),easing:'cubic-bezier(.2,0,0,1)'});
 back.onfinish=back.oncancel=()=>{if(!running.has(box))delete box.dataset.marquee;};
}
