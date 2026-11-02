import{useEffect,useState}from'react';
const period=(date:Date,hourly:boolean)=>hourly?date.toISOString().slice(0,13):`${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
export function useArtworkDay(enabled:boolean,hourly=false){
 const [date,setDate]=useState(()=>new Date());
 useEffect(()=>{if(!enabled)return;let timer:ReturnType<typeof setTimeout>;const typing=()=>document.activeElement?.matches('input,textarea,[contenteditable="true"]');const check=()=>{const now=new Date();if(!typing())setDate(previous=>period(previous,hourly)===period(now,hourly)?previous:now);};const schedule=()=>{check();const now=new Date(),next=hourly?Math.floor(now.getTime()/3600000)*3600000+3600000:new Date(now.getFullYear(),now.getMonth(),now.getDate()+1).getTime();timer=setTimeout(schedule,Math.min(60000,Math.max(100,next-now.getTime()+50)));};const afterFocus=()=>queueMicrotask(check);document.addEventListener('focusout',afterFocus);document.addEventListener('visibilitychange',check);window.addEventListener('focus',check);schedule();return()=>{clearTimeout(timer);document.removeEventListener('focusout',afterFocus);document.removeEventListener('visibilitychange',check);window.removeEventListener('focus',check);};},[enabled,hourly]);
 return date;
}
