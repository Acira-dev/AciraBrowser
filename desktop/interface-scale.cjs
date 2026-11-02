'use strict';

// Renderers speak CSS pixels; Electron views and native pointer events use DIPs.
// Keep website zoom independent when Acira's own interface is scaled.
const sizes=[80,90,100,110,125,150];
const interfaceScale=settings=>sizes.includes(settings?.interfaceScale)?settings.interfaceScale/100:1;
const rect=(value,factor)=>value&&({...value,...Object.fromEntries(['x','y','width','height'].filter(key=>typeof value[key]==='number').map(key=>[key,value[key]*factor]))});
function scaleLayout(layout,factor){
 if(!layout)return layout;
 return {...layout,
  views:layout.views.map(view=>({...view,bounds:rect(view.bounds,factor)})),
  ...(layout.viewport?{viewport:rect(layout.viewport,factor)}:{}),
  ...(layout.pageBounds?{pageBounds:rect(layout.pageBounds,factor)}:{}),
  ...(layout.pageRadius!==undefined?{pageRadius:layout.pageRadius*factor}:{}),
  ...(layout.captionHeight!==undefined?{captionHeight:layout.captionHeight*factor}:{}),
  ...(layout.edge?{edge:{topHeight:layout.edge.topHeight*factor,sideWidth:layout.edge.sideWidth*factor}}:{}),
  ...(layout.assistant?{assistant:{...layout.assistant,bounds:rect(layout.assistant.bounds,factor)}}:{}),
  ...(layout.overlay?{overlay:{...layout.overlay,bounds:rect(layout.overlay.bounds,factor),
   ...(layout.overlay.anchor?{anchor:rect(layout.overlay.anchor,factor)}:{}),
   ...(layout.overlay.auxiliaryBounds?{auxiliaryBounds:rect(layout.overlay.auxiliaryBounds,factor)}:{}),
   ...(layout.overlay.contentHeight!==undefined?{contentHeight:layout.overlay.contentHeight*factor}:{}),
   ...(layout.overlay.context?{context:{...layout.overlay.context,
    ...(layout.overlay.context.lockedTop!==undefined?{lockedTop:layout.overlay.context.lockedTop*factor}:{}),
    ...(layout.overlay.context.trigger?{trigger:rect(layout.overlay.context.trigger,factor)}:{})}}:{})}}:{})};
}
const scaleAnchor=(message,factor)=>message?.type==='ui'&&message.anchor?{...message,anchor:rect(message.anchor,factor)}:message;
module.exports={interfaceScale,scaleLayout,scaleAnchor};
