// Proven d-harness session supplied by m-gap-audit: no launch, popup guessing or extra app.
// Reads every Settings section, scroll viewport, disclosure and custom dropdown without changing preferences.
export async function broadSweep({h,scale,report,scan,capture,write,mainWindow,sleep,deadline}) {
  const pages = ['history','bookmarks','downloads','rewind','routines'];
  const seenFindings = new Set();
  let savedFindings = 0;
  const bounded = () => {if (Date.now()>deadline) throw Error('Broad sweep reached its shared time budget');};
  await h.act({type:'tab.new',url:'acira://history'});
  const tabId=(await h.state()).activeTabId;
  const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  const inspect = async (name, representative=false) => {
    bounded();
    const item = await scan(h.ui,name,'.lib-head,.lib-search,.bs-page>h1,.st-row,.st-select-list',false,false);
    item.broad = await h.ui.evaluate(() => {
      const visible = e => {
        if (e.closest('[aria-hidden=true],[inert],[hidden],.sr-only,.st-sr-only')) return false;
        const r=e.getBoundingClientRect();
        if(r.width<2||r.height<2||r.right<=0||r.left>=innerWidth||r.bottom<=0||r.top>=innerHeight)return false;
        for(let q=e;q&&q!==document.documentElement;q=q.parentElement){const c=getComputedStyle(q);if(c.display==='none'||c.visibility==='hidden'||+c.opacity===0)return false;const b=q.getBoundingClientRect();if((c.overflowX!=='visible'&&(r.right<=b.left||r.left>=b.right))||(c.overflowY!=='visible'&&(r.bottom<=b.top||r.top>=b.bottom)))return false;}
        return true;
      };
      const clipping=[],overlap=[],alignment=[],contrast=[];
      const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
      const colorContext=canvas.getContext('2d',{willReadFrequently:true}),colors=new Map();
      const rgb=value=>{if(colors.has(value))return colors.get(value);colorContext.clearRect(0,0,1,1);colorContext.fillStyle=value;colorContext.fillRect(0,0,1,1);const p=colorContext.getImageData(0,0,1,1).data,result=[p[0],p[1],p[2],p[3]/255];colors.set(value,result);return result;};
      const blend=(a,b)=>[0,1,2].map(i=>a[i]*a[3]+b[i]*(1-a[3]));
      const luminance=c=>c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      const rect=r=>[r.x,r.y,r.width,r.height].map(n=>Math.round(n*10)/10);
      for(const e of document.querySelectorAll('.page-zoom-content *,.st-select-list *')) {
        if(!visible(e))continue;
        const nodes=[...e.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim());if(!nodes.length)continue;
        const c=getComputedStyle(e),r=e.getBoundingClientRect(),label=nodes.map(n=>n.textContent.trim()).join(' ').slice(0,100);
        let deliberate=false;
        for(let q=e;q&&q!==document.body;q=q.parentElement){const s=getComputedStyle(q);if(s.textOverflow==='ellipsis'||s.maskImage!=='none'||s.webkitMaskImage!=='none'||s.webkitLineClamp!=='none'){deliberate=true;break;}}
        if(!deliberate&&e.scrollWidth>e.clientWidth+1&&c.overflowX!=='visible')clipping.push({label,kind:'clipped text without ellipsis',rect:rect(r)});
        if(!deliberate)for(const n of nodes){const range=document.createRange();range.selectNodeContents(n);for(const tr of range.getClientRects()){if(tr.right<=0||tr.left>=innerWidth)continue;for(let q=e.parentElement;q&&q!==document.body;q=q.parentElement){const s=getComputedStyle(q);if(s.overflowX==='visible')continue;const b=q.getBoundingClientRect();if(tr.right>b.right+.6||tr.left<b.left-.6){clipping.push({label,kind:'text crosses horizontal clip',by:Math.round(Math.max(tr.right-b.right,b.left-tr.left)*10)/10,rect:rect(tr)});break;}}}}
        if(e.matches('.st-row-title,.st-row-label,.bs-row>span,.lib-head h1'))alignment.push({label,x:r.x});
        if(e.closest(':disabled,[aria-disabled=true]'))continue;
        const fg=rgb(c.color);if(!fg)continue;
        let bg=[255,255,255],approximate=false;const ancestors=[];
        for(let q=e;q;q=q.parentElement)ancestors.unshift(q);
        for(const q of ancestors){const s=getComputedStyle(q),b=rgb(s.backgroundColor);if(b)bg=blend(b,bg);if(s.backgroundImage!=='none'||s.backdropFilter!=='none'||+s.opacity<1)approximate=true;}
        const ink=blend(fg,bg),a=luminance(ink),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05),large=parseFloat(c.fontSize)>=24||parseFloat(c.fontSize)>=18.66&&+c.fontWeight>=700;
        if(ratio<(large?3:4.5))contrast.push({label,ratio:Math.round(ratio*100)/100,color:c.color,background:bg.map(Math.round),approximate,rect:rect(r)});
      }
      for(const row of document.querySelectorAll('.st-row,.bs-row')){
        if(!visible(row))continue;const a=row.querySelector('.st-row-copy,.st-row-main,.st-row-label'),b=row.querySelector('.st-select,.st-switch,.st-input,.st-button');if(!a||!b)continue;
        const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();if(Math.min(x.right,y.right)-Math.max(x.left,y.left)>1&&Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>1)overlap.push({label:row.textContent.trim().slice(0,100),copy:rect(x),control:rect(y)});
      }
      return {clipping,overlap,alignment,contrast};
    });
    // Repeated fixed chrome findings are kept once in the compact screenshot set; JSON keeps every scan.
    const relevant = [...item.edge,...item.broad.clipping,...item.broad.overlap,...item.broad.contrast];
    const novel = relevant.some(f=>{const key=JSON.stringify(f);if(seenFindings.has(key))return false;seenFindings.add(key);return true;});
    if(representative || novel&&savedFindings<24){item.screenshot=await capture(name);if(!representative)savedFindings++;}
    if(item.screenshot||report.checks.length%10===0)await write();
  };
  const walk = async (name, scope, representative=false) => {
    const hovered=new Set();
    // Discover the actual content scroller rather than assuming the library and Settings share one.
    const info=await h.ui.evaluate(scope=>{
      const root=document.querySelector(scope)||document.body;
      const candidates=[root,...root.querySelectorAll('*')].filter(e=>{const c=getComputedStyle(e),r=e.getBoundingClientRect();return /auto|scroll/.test(c.overflowY)&&e.scrollHeight>e.clientHeight+2&&r.width>250&&r.height>100;});
      let s=candidates.sort((a,b)=>(b.scrollHeight-b.clientHeight)-(a.scrollHeight-a.clientHeight))[0];
      if(!s&&scope!=='.st-select-list')for(let q=root.parentElement;q;q=q.parentElement){if(q.scrollHeight>q.clientHeight+2&&/auto|scroll/.test(getComputedStyle(q).overflowY)){s=q;break;}}
      if(s)s.dataset.mAuditScroll='content';
      return {height:s?.clientHeight||innerHeight,max:s?Math.max(0,s.scrollHeight-s.clientHeight):0};
    },scope);
    const stops=Math.min(24,Math.max(1,Math.ceil(info.max/Math.max(100,info.height*.8))+1));
    for(let i=0;i<stops;i++){
      bounded();await h.ui.evaluate(({i,stops,max})=>{const s=document.querySelector('[data-m-audit-scroll]');if(s)s.scrollTop=stops===1?0:max*i/(stops-1);},{i,stops,max:info.max});
      await sleep(45);await inspect(`${name}-scroll-${i}`,representative&&i===0);
      const candidates=await h.ui.evaluate(scope=>{
        const root=document.querySelector(scope)||document.body;
        window.__mHover=window.__edge.candidates().filter(e=>root.contains(e)&&!e.closest('[aria-hidden=true],[inert]')).filter(e=>{
          const r=e.getBoundingClientRect();if(r.top<0||r.bottom>innerHeight||r.left<0||r.right>innerWidth)return false;
          for(let q=e.parentElement;q;q=q.parentElement){const c=getComputedStyle(q),b=q.getBoundingClientRect();if(c.overflowY!=='visible'&&(r.top<b.top||r.bottom>b.bottom))return false;}return true;
        }).slice(0,6);
        return window.__mHover.map((e,index)=>({index,key:(e.getAttribute('aria-label')||e.textContent.trim()).slice(0,120),pos:window.__edge.rect(e)}));
      },scope);
      const findings=[];
      for(const c of candidates){
        if(hovered.has(c.key))continue;bounded();hovered.add(c.key);await h.ui.mouse.move(...c.pos);await sleep(18);
        const hits=await h.ui.evaluate(index=>window.__edge.el(window.__mHover[index]),c.index);findings.push(...hits);
        const key=JSON.stringify(hits);
        if(hits.length&&!seenFindings.has(key)&&savedFindings<24){seenFindings.add(key);const shot=await capture(`${name}-scroll-${i}-hover-${c.index}`);(report.checks.at(-1).hoverScreenshots??=[]).push({control:c.key,screenshot:shot});savedFindings++;}
      }
      if(findings.length)report.checks.at(-1).hover=findings;
      await h.ui.mouse.move(2,2);
    }
    await h.ui.evaluate(()=>{const s=document.querySelector('[data-m-audit-scroll]');if(s){s.scrollTop=0;delete s.dataset.mAuditScroll;}});
  };
  for(const theme of ['light','dark'])for(const size of ['small','max']){
    bounded();await h.act({type:'settings.update',patch:{appearance:theme,verticalTabs:false,zoom:100}});await mainWindow(size==='max');await sleep(260);
    const context=`${scale}-${theme}-${size}`;
    for(const page of pages){
      await h.act({type:'tab.navigate',tabId,url:`acira://${page}`});await sleep(320);
      await walk(`${context}-library-${page}`,'.page-zoom-content',page==='history');
      // Search-empty states have different text and action layouts. Restore immediately afterwards.
      const search=h.ui.locator('.lib-search input').first();
      if(await search.count()){await search.fill('m-qa-no-results-9f31');await sleep(160);await inspect(`${context}-${page}-no-results`);await search.fill('');}
    }
    await h.act({type:'tab.navigate',tabId,url:'acira://settings'});await sleep(400);
    const labels=await h.ui.locator('.bs-sidebar nav button').evaluateAll(nodes=>nodes.map(e=>e.getAttribute('aria-label')||e.textContent.trim()));
    if(!labels.length||labels.length>24)throw Error(`Unexpected Settings section count ${labels.length}`);
    for(const label of labels){
      bounded();
      await h.ui.locator('.bs-sidebar nav').getByRole('button',{name:label,exact:true}).click();await sleep(340);
      const name=`${context}-settings-${slug(label)}`;
      await walk(name,'.bs-main',label==='Appearance');
      // All custom dropdown options are inspected, including the New tab fill-image choice.
      const triggers=h.ui.locator('.bs-main .st-select-trigger:not(:disabled)');
      const count=await triggers.count();if(count>32)throw Error(`Dropdown cap in ${label}: ${count}`);
      for(let i=0;i<count;i++){
        bounded();await triggers.nth(i).scrollIntoViewIfNeeded();await triggers.nth(i).click();await sleep(170);
        if(await h.ui.locator('.st-select-list').count())await walk(`${name}-options-${i}`,'.st-select-list');
        await h.ui.keyboard.press('Escape');
      }
      const details=h.ui.locator('.bs-main details:not([open])');
      const detailCount=await details.count();
      if(detailCount>20)throw Error(`Disclosure cap in ${label}: ${detailCount}`);
      if(detailCount){await details.evaluateAll(nodes=>nodes.forEach(e=>e.open=true));await sleep(170);await walk(`${name}-expanded`,'.bs-main');await h.ui.locator('.bs-main details[open]').evaluateAll(nodes=>nodes.forEach(e=>e.open=false));}
    }
  }
  await h.act({type:'tab.select',id:tabId});
  report.broadComplete=true;await write();
}
