import { useCallback,useEffect,useRef } from 'react';

/** Color drag events publish at most once per paint; blur and unmount retain the last value. */
export function useRafChange<T>(onChange:(value:T)=>void){
 const callback=useRef(onChange);callback.current=onChange;
 const pending=useRef<{value:T}|null>(null),frame=useRef(0);
 const flush=useCallback(()=>{cancelAnimationFrame(frame.current);frame.current=0;const queued=pending.current;pending.current=null;if(queued)callback.current(queued.value);},[]);
 const change=useCallback((value:T)=>{pending.current={value};if(!frame.current)frame.current=requestAnimationFrame(flush);},[flush]);
 useEffect(()=>flush,[flush]);
 return{change,flush};
}
