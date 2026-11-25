import { useLayoutEffect,useRef,useState,type ReactNode,type RefObject } from 'react';
import '../styles/scroll-region.css';
import { EdgeThumb } from './EdgeThumb';

/** Edge fades describe overflow; fixed controls stay outside the masked viewport. A popup never shows the stock
 * scrollbar (V02): a thin overlay thumb inside the radius (EdgeThumb: Rule 12, only while scrolling or with the pointer near the edge it sits on). */
export function ScrollRegion({children,contentRef}:{children:ReactNode;contentRef:RefObject<HTMLDivElement|null>}) {
  const viewport=useRef<HTMLDivElement>(null);
  const [edges,setEdges]=useState({top:false,bottom:false});
  useLayoutEffect(()=>{
    const node=viewport.current,content=contentRef.current;if(!node||!content)return;
    const update=()=>{
      const top=node.scrollTop>1,bottom=node.scrollHeight-node.clientHeight-node.scrollTop>1;
      setEdges(old=>old.top===top&&old.bottom===bottom?old:{top,bottom});
    };
    const observer=new ResizeObserver(update);observer.observe(node);observer.observe(content);
    node.addEventListener('scroll',update,{passive:true});update();
    return()=>{observer.disconnect();node.removeEventListener('scroll',update);};
  },[contentRef]);
  return <div className="scroll-region" data-overflow-top={edges.top} data-overflow-bottom={edges.bottom}>
    <div className="popup-scroll" ref={viewport}><div className="popup-body-content" ref={contentRef}>{children}</div></div>
    <EdgeThumb scroller={viewport}/>
  </div>;
}
