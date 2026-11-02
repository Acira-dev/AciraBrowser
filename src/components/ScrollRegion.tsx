import { useLayoutEffect,useRef,useState,type ReactNode,type RefObject } from 'react';
import '../styles/scroll-region.css';

/** Edge fades describe overflow; fixed controls stay outside the masked viewport. A popup never shows the stock
 * scrollbar (V02): a thin overlay thumb inside the radius appears while the list is hovered or scrolling. */
export function ScrollRegion({children,contentRef}:{children:ReactNode;contentRef:RefObject<HTMLDivElement|null>}) {
  const viewport=useRef<HTMLDivElement>(null),thumb=useRef<HTMLDivElement>(null);
  const [edges,setEdges]=useState({top:false,bottom:false});
  useLayoutEffect(()=>{
    const node=viewport.current,content=contentRef.current;if(!node||!content)return;
    let idle:ReturnType<typeof setTimeout>|undefined;
    const update=(scrolled=false)=>{
      const top=node.scrollTop>1,bottom=node.scrollHeight-node.clientHeight-node.scrollTop>1;
      setEdges(old=>old.top===top&&old.bottom===bottom?old:{top,bottom});
      const bar=thumb.current,overflow=node.scrollHeight-node.clientHeight;if(!bar)return;
      if(overflow<=1){bar.dataset.idle='';bar.hidden=true;return;}
      bar.hidden=false;const track=node.clientHeight-12,size=Math.max(24,track*node.clientHeight/node.scrollHeight);
      bar.style.height=`${size}px`;bar.style.transform=`translateY(${6+(track-size)*node.scrollTop/overflow}px)`;
      if(scrolled){delete bar.dataset.idle;clearTimeout(idle);idle=setTimeout(()=>{bar.dataset.idle='';},800);}
    };
    const scrolled=()=>update(true);
    const observer=new ResizeObserver(()=>update());observer.observe(node);observer.observe(content);
    node.addEventListener('scroll',scrolled,{passive:true});update();
    return()=>{observer.disconnect();node.removeEventListener('scroll',scrolled);clearTimeout(idle);};
  },[contentRef]);
  return <div className="scroll-region" data-overflow-top={edges.top} data-overflow-bottom={edges.bottom}>
    <div className="popup-scroll" ref={viewport}><div className="popup-body-content" ref={contentRef}>{children}</div></div>
    <div className="scroll-thumb" ref={thumb} data-idle="" hidden aria-hidden="true"/>
  </div>;
}
