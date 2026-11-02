import {_electron} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// The agent tab core in a hidden, disposable Electron app: Acira's voice in the thread, boundaries,
// the agent's browsers, tab states and approvals. Pixel review of the captures remains separate.
const require=createRequire(import.meta.url),root=process.cwd(),out=path.join(root,'qa/agent-tab-core');
const {createInitialState,persistedSnapshot}=require('../desktop/runtime.cjs');
const P1="Go to Volta, Harbor Audio, Meridian and Pulse. Add the Aria ANC headphones to the cart, go to checkout and try the code ACIRA20 at each one. Don't buy anything.";
const P4=P1+" Also, don't press the rewards sync thing on Pulse.";
await fs.rm(out,{recursive:true,force:true});await fs.mkdir(out,{recursive:true});
const seed=createInitialState();seed.settings.aiEnabled=true;seed.demo.speed=4;seed.settings.reducedMotion=false;seed.settings.interfaceScale=100;seed.settings.automaticCompact=false;
const profile=await fs.mkdtemp(path.join(out,'profile-'));
await fs.writeFile(path.join(profile,'demo-state.json'),JSON.stringify(persistedSnapshot(seed)));
const report={checks:[],errors:[],captures:[],scope:'Hidden Electron renderer checks of the agent tab core; OS compositor pixels are reviewed separately.'};
const check=(name,result)=>{assert.ok(result,name);report.checks.push(name);console.log('PASS '+name);};
let app;
try{
 app=await _electron.launch({executablePath:require('electron'),args:[path.join(root,'desktop/main.cjs')],env:{...process.env,ACIRA_DEV:'1',ACIRA_DEMO_TEST_HIDDEN:'1',ACIRA_DEMO_TEST_DATA:profile}});
 const ui=await app.firstWindow();ui.on('pageerror',e=>report.errors.push(e.message));
 await ui.waitForFunction(()=>window.__acira&&window.acira);await ui.evaluate(()=>document.fonts.ready);
 await app.evaluate(({BaseWindow})=>BaseWindow.getAllWindows()[0].setContentSize(1440,900));
 const act=action=>ui.evaluate(action=>window.acira.dispatch(action),action);
 const state=()=>ui.evaluate(()=>window.acira.getSnapshot());
 const waitFor=async(predicate,ms=20000)=>{const end=Date.now()+ms;for(;;){if(await predicate())return true;if(Date.now()>end)return false;await ui.waitForTimeout(100);}};
 // Content pages form in over ~1s; capture the settled frame.
 const capture=async name=>{await ui.waitForTimeout(1000);const data=await app.evaluate(async({webContents})=>{const wc=webContents.getAllWebContents().find(w=>w.getURL()==='http://127.0.0.1:5188/');for(let i=0;i<2;i++){await wc.capturePage(undefined,{stayHidden:true,stayAwake:true});await new Promise(r=>setTimeout(r,100));}return(await wc.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64');});await fs.writeFile(path.join(out,name+'.png'),Buffer.from(data,'base64'));report.captures.push(name);};

 // Task 8: two voices in the thread.
 await act({type:'run.start',prompt:P1,tabId:'tab-home'});
 const card=ui.locator('.acira-card[data-kind="boundaries"]');
 check('Starting a task shows its boundaries as an Acira card',await waitFor(()=>card.isVisible()));
 check('The words that set a boundary are marked in your message',await ui.locator('.ed-msg-user mark.ed-src',{hasText:"Don't buy anything"}).count()===1);
 check('Acira cards never sit inside the agent reply',await ui.locator('.ed-msg-assistant .acira-card').count()===0);
 // Acira speaks with its symbol and name in sentence case, never a mono uppercase eyebrow (in-page style study).
 check('Acira speaks in its own voice, not a mono label',await ui.locator('.ed-msg-acira').evaluateAll(items=>items.length>0&&items.every(item=>item.textContent.includes('Acira')&&!item.textContent.includes('ACIRA')&&(!!item.querySelector('.acira-mark')||!!item.querySelector('.acira-event,.acira-card.is-compact')))));
 await capture('01-boundaries-proposed');

 // Task 9: the boundaries card, adjusting it, starting, unclear instructions and learning.
 const rows=card.locator('.boundary-row');
 check('The boundaries card states what this task may do',await card.getByText('Boundaries for this task').isVisible()&&await rows.count()===3&&await card.getByText('Turning on the Checkout guard.').isVisible()&&await card.getByText(/^Spending \$0/).isVisible());
 await rows.filter({hasText:'Place an order'}).hover();
 check('Pointing at a boundary marks the words that set it',await waitFor(async()=>await ui.locator('mark.ed-src.is-hovered',{hasText:"Don't buy anything"}).count()===1,3000));
 await card.getByRole('button',{name:'Adjust',exact:true}).click();
 await rows.filter({hasText:'Place an order'}).getByRole('radio',{name:'Ask',exact:true}).click();
 check('Adjusting a boundary is recorded on the task',await waitFor(async()=>(await state()).runs[0].boundaries?.adjusted===true,3000));
 await card.getByRole('button',{name:'Start task',exact:true}).click();
 check('Start task runs the agent and the card settles to one line',await waitFor(async()=>(await state()).runs[0].status==='running',3000)&&await waitFor(()=>card.getByText('Started · 3 boundaries').isVisible(),3000));
 await capture('02-boundaries-started');
 await act({type:'run.control',id:(await state()).runs[0].id,command:'stop'});
 await act({type:'tab.new'});await act({type:'run.start',prompt:P4,tabId:(await state()).activeTabId});
 const unclear=card.locator('.boundary-row',{hasText:'rewards sync thing'});
 check('An unclear instruction offers to block anything like it',await waitFor(()=>unclear.getByRole('button',{name:'Block anything like it',exact:true}).isVisible(),5000));
 await unclear.getByRole('button',{name:'Block anything like it',exact:true}).click();
 check('Blocking an unclear control records it as blocked',await waitFor(async()=>(await state()).runs[0].boundaries.lines.find(line=>line.id==='unclear-1')?.decision==='block',3000));
 await act({type:'run.control',id:(await state()).runs[0].id,command:'stop'});
 for(let i=0;i<3;i++){await act({type:'tab.new'});await act({type:'run.start',prompt:P1,tabId:(await state()).activeTabId});const run=(await state()).runs[0];await act({type:'run.boundaries.confirm',id:run.id});await act({type:'run.control',id:run.id,command:'stop'});}
 await act({type:'tab.new'});await act({type:'run.start',prompt:P1,tabId:(await state()).activeTabId});
 check('A familiar task runs within its learned boundaries',await waitFor(()=>card.getByText(/learned from 3 shopping tasks/).isVisible(),5000)&&(await state()).runs[0].status==='running');
 await capture('03-boundaries-learned');
 await card.getByRole('button',{name:'Show the card anyway',exact:true}).click();
 check('Show the card anyway brings back the full card',await waitFor(()=>card.getByRole('button',{name:'Start task',exact:true}).isVisible(),3000)&&(await state()).runs[0].status==='proposed');
 await act({type:'run.control',id:(await state()).runs[0].id,command:'stop'});

 // Task 10: talking to a running agent.
 await act({type:'tab.new'});await act({type:'run.start',prompt:P1,tabId:(await state()).activeTabId});
 await waitFor(async()=>(await state()).runs[0].status==='running',5000);
 const composer=ui.getByRole('textbox',{name:'Message Acira',exact:true});
 check('A running task keeps its composer open for replies',await waitFor(()=>composer.isEditable(),3000)&&await composer.getAttribute('placeholder')==='Reply to Acira…'&&await ui.locator('.task-running-note').count()===0);
 await composer.fill("Actually, buy the cheapest one if it's under $250. Ask me first.");await composer.press('Enter');
 const change=ui.locator('.acira-card[data-kind="boundary-change"]');
 check('Loosening a boundary asks before it applies',await waitFor(()=>change.getByText("Change this task's boundaries?").isVisible(),5000)&&await change.getByText('(was Block)').isVisible()&&await change.getByText(/was \$0/).isVisible());
 check('The agent waits while you decide',(await state()).runs[0].status==='waiting');
 await capture('04-boundary-change');
 await change.getByRole('button',{name:'Confirm change',exact:true}).click();
 check('Confirming the change lets the agent continue',await waitFor(async()=>(await state()).runs[0].status==='running',3000)&&await waitFor(()=>change.getByText('Confirmed').isVisible(),3000));
 await act({type:'run.control',id:(await state()).runs[0].id,command:'stop'});

 // Task 11: the agent's browsers run inside its tab.
 const startP1=async()=>{await act({type:'tab.new'});await act({type:'run.start',prompt:P1,tabId:(await state()).activeTabId});await waitFor(async()=>(await state()).runs[0].status==='running',5000);};
 await startP1();
 const live=ui.locator('.agent-browser[data-mode="live"]');
 check('The agent works in a live view beside its chat',await waitFor(()=>live.isVisible(),8000)&&await live.evaluate(node=>node.classList.contains('is-driving')));
 check('The live view never widens the page into a scrollbar',await ui.waitForTimeout(800).then(()=>ui.locator('.page-pane').first().evaluate(node=>node.scrollWidth<=node.clientWidth+1)));
 check('Captions say what the agent is doing on the page',await waitFor(()=>live.getByText('Filling shipping from your profile').isVisible(),20000));
 await waitFor(async()=>(await state()).runs[0].browsers.find(b=>b.store==='volta')?.recognized===true,5000);
 const tags=text=>live.locator('.protection-tag',{hasText:text}).count();
 check("Volta's checkout shows what the agent may not touch",await waitFor(async()=>await tags("Agents can't type here")===3&&await tags('Blocked by this task')===1,5000));
 await capture('live-checkout');
 const chips=ui.locator('.browsers-strip .browser-chip');
 check('Every browser the agent opens is listed in its strip',await waitFor(async()=>await chips.count()===4,45000));
 await chips.filter({hasText:'Harbor Audio'}).click();
 check('Choosing a browser pins it to the live view',await waitFor(async()=>(await state()).runs[0].live?.mode==='pinned',3000)&&await waitFor(()=>live.locator('.agent-browser-where',{hasText:'Harbor Audio'}).isVisible(),3000));
 await live.getByRole('button',{name:'Close live view',exact:true}).click();
 check('Closing the live view hides the pane',await waitFor(async()=>await live.count()===0,3000));
 await act({type:'run.control',id:(await state()).runs[0].id,command:'stop'});
 await startP1();
 await waitFor(()=>live.isVisible(),8000);
 await live.locator('.agent-browser-canvas').click({position:{x:220,y:140}});
 check('Touching the page asks before taking over',await waitFor(()=>live.getByText('Take over?').isVisible(),3000));
 await live.getByRole('button',{name:'Yes',exact:true}).click();
 check('Taking over pauses the agent and says so',await waitFor(async()=>{const run=(await state()).runs[0];return run.status==='paused'&&run.takenOver===true;},3000)&&await waitFor(()=>live.getByText("You're in control").isVisible(),3000));
 await live.getByRole('button',{name:'Give back to agent',exact:true}).click();
 check('Giving control back resumes the agent',await waitFor(async()=>(await state()).runs[0].status==='running',3000));
 await act({type:'run.control',id:(await state()).runs[0].id,command:'stop'});

 // Task 12: pop a browser out into its own tab and back.
 await startP1();
 await waitFor(()=>live.isVisible(),8000);
 const agentTab=(await state()).activeTabId,popped=ui.locator('.agent-browser[data-mode="tab"]');
 await live.getByRole('button',{name:'Open as tab',exact:true}).click();
 check('Open as tab puts the browser in a tab right after its agent',await waitFor(async()=>{const s=await state(),next=s.tabs[s.tabs.findIndex(t=>t.id===agentTab)+1];return !!next?.agentLink&&s.activeTabId===next.id;},3000)&&await waitFor(()=>popped.isVisible(),3000)&&await popped.evaluate(node=>node.classList.contains('is-driving')));
 check("The popped tab's address follows the agent",await waitFor(async()=>{const s=await state();return /\/checkout$/.test(s.tabs.find(t=>t.id===s.activeTabId)?.url||'');},20000));
 await capture('popped-tab');
 await popped.getByRole('button',{name:'Return to chat',exact:true}).click();
 check('Return to chat closes the tab and shows the live view again',await waitFor(async()=>{const s=await state();return s.activeTabId===agentTab&&!s.tabs.some(t=>t.agentLink);},3000)&&await waitFor(()=>live.isVisible(),3000));
 await live.getByRole('button',{name:'Open as tab',exact:true}).click();
 await waitFor(()=>popped.isVisible(),3000);
 const poppedTitle=(await state()).tabs.find(t=>t.agentLink).title;
 // Narrow tabs reveal their close button on hover, as in Chrome, and the strip is still settling after the
 // insert; click that tab's own button rather than a screen position a neighbour may slide under.
 await ui.getByRole('button',{name:`Close ${poppedTitle}`,exact:true}).first().evaluate(button=>button.click());
 check('Closing a popped browser tab needs no confirmation',await waitFor(async()=>!(await state()).tabs.some(t=>t.agentLink),3000)&&!(await state()).closeRequest&&await ui.locator('.experience-close').count()===0);
 await act({type:'run.control',id:(await state()).runs[0].id,command:'stop'});

 // Task 13: tab states, the sidebar Agents section and the address-bar guard chip.
 const P2="Go to Volta, Harbor Audio, Meridian and Pulse. Add the Aria ANC headphones to the cart, go to checkout and try the code ACIRA20 at each one. Buy the cheapest one if it's under $250. Ask me first.";
 const tabRoot=id=>ui.locator(`[data-tab-id="${id}"]`).first(),agentState=id=>tabRoot(id).getAttribute('data-agent-state');
 await startP1();const doneTab=(await state()).activeTabId,doneRun=(await state()).runs[0];
 await act({type:'tab.new'});const askTab=(await state()).activeTabId;await act({type:'run.start',prompt:P2,tabId:askTab});
 check('A task waiting on its boundaries shows Ready on its tab',await waitFor(async()=>await agentState(askTab)==='ready',3000));
 await act({type:'run.boundaries.confirm',id:(await state()).runs[0].id});
 check('A started task shows it is working on its tab',await waitFor(async()=>['working','reading'].includes(await agentState(askTab)),3000));
 check('At a checkout the chat header names the guard on duty',await waitFor(async()=>(await ui.locator('.at-guard').textContent().catch(()=>''))?.includes('Checkout guard'),20000));
 check('An agent chat has no address bar, reload or home button',await ui.locator('.acira-persistent-toolbar .address-bar').count()===0&&await ui.getByRole('button',{name:'Reload page',exact:true}).count()===0&&await ui.locator('.agent-chat-gap').count()===1);
 check('A finished task you have not seen shows a dot check on its tab',await waitFor(async()=>await agentState(doneTab)==='done',60000)&&await tabRoot(doneTab).locator('.tab-agent-icon .dot-matrix').getAttribute('data-preset')==='done');
 check('A task that needs you tints and pulses its tab once',await waitFor(async()=>await agentState(askTab)==='needs-you',60000)&&await tabRoot(askTab).evaluate(node=>{const style=getComputedStyle(node);return style.animationName==='agent-needs-pulse'&&style.backgroundColor!=='rgba(0, 0, 0, 0)';}));
 await capture('tab-states');
 await act({type:'tab.select',id:doneTab});
 await ui.waitForTimeout(2500);
 check('A finished chat keeps its check while you read it',await tabRoot(doneTab).locator('.tab-agent-icon .dot-matrix').getAttribute('data-preset')==='done');
 await act({type:'tab.select',id:askTab});
 check('Once you leave a finished chat you have read, its matrix switches off',await waitFor(async()=>await tabRoot(doneTab).locator('.tab-agent-icon .dot-matrix').getAttribute('data-preset')==='off',3000));
 const agents=ui.locator('.ed-rail-section[aria-label="Agents"]');
 check('The sidebar lists agents, with finished ones under Recent',await agents.count()===1&&await waitFor(async()=>await agents.locator('.ed-rail-recent .ed-rail-run',{hasText:doneRun.title.slice(0,20)}).count()>0,3000));
 await act({type:'settings.update',patch:{reducedMotion:true}});
 check('Reduced motion stops the pulse and the shimmer',await waitFor(async()=>await tabRoot(askTab).evaluate(node=>getComputedStyle(node).animationName==='none')&&await ui.locator('.ed-shimmer').evaluateAll(nodes=>nodes.every(node=>getComputedStyle(node).animationName==='none')),3000));
 await act({type:'settings.update',patch:{reducedMotion:false}});
 await agents.getByRole('button',{name:'Overview',exact:true}).click();
 check('Overview opens the agents overview',await waitFor(async()=>{const s=await state();return s.tabs.find(t=>t.id===s.activeTabId)?.url==='acira://tasks';},3000));
 await act({type:'run.control',id:(await state()).runs.find(r=>r.tabId===askTab||r.title.startsWith('Go to Volta')&&r.status==='waiting')?.id||(await state()).runs[0].id,command:'stop'});

 // Task 14: the exact approval says why it is asked and exactly what it covers.
 const startP2=async()=>{await act({type:'tab.new'});const tab=(await state()).activeTabId;await act({type:'run.start',prompt:P2,tabId:tab});const run=(await state()).runs[0].id;await act({type:'run.boundaries.confirm',id:run});return {tab,run};};
 const runOf=async id=>(await state()).runs.find(r=>r.id===id);
 const approveRun=await startP2(),disownRun=await startP2();
 await waitFor(async()=>(await runOf(approveRun.run))?.status==='waiting'&&(await runOf(disownRun.run))?.status==='waiting',70000);
 await act({type:'tab.select',id:approveRun.tab});
 const review=ui.locator('.op-review').first();
 check('The approval asks for this exact order and says why',await waitFor(()=>review.getByText('Approve this exact order?').isVisible(),5000)&&await review.getByText(/min left/).isVisible()&&await review.getByText('$223.99').first().isVisible()&&(await review.locator('.op-why').textContent()).includes('Ask me first')&&await review.getByText('Covers only this:').isVisible());
 await capture('approval');
 await review.getByRole('button',{name:'Approve once',exact:true}).click();
 check('Approving once completes the order at the exact total',await waitFor(async()=>{const r=await runOf(approveRun.run);return r?.status==='completed'&&r.spent===223.99;},10000));
 await act({type:'tab.select',id:disownRun.tab});
 await ui.locator('.op-review').first().getByRole('button',{name:"I didn't start this",exact:true}).click();
 check("I didn't start this pauses the task and flags it",await waitFor(async()=>(await runOf(disownRun.run))?.status==='paused',3000)&&await waitFor(()=>ui.getByText('Paused. This request is flagged for review.').first().isVisible(),3000));
 await act({type:'run.control',id:disownRun.run,command:'stop'});

 // Task 15: one end-to-end walkthrough at 1440×900, a capture at each beat of the story.
 await fs.mkdir(path.join(out,'walkthrough'),{recursive:true});
 const beat=name=>capture(`walkthrough/${name}`),latest=async()=>(await state()).runs[0];
 await act({type:'tab.new'});await act({type:'run.start',prompt:P4,tabId:(await state()).activeTabId});
 const story=(await latest()).id,storyRun=async()=>(await state()).runs.find(r=>r.id===story);
 await waitFor(()=>card.getByText('Boundaries for this task').isVisible(),5000);await beat('01-boundaries');
 await act({type:'run.boundaries.confirm',id:story});
 await waitFor(async()=>(await storyRun()).browsers.find(b=>b.store==='volta')?.recognized===true,20000);await beat('02-live-recognized');
 await waitFor(async()=>(await storyRun()).events.some(e=>/Card number: blocked/.test(e)),20000);await beat('03-card-blocked');
 // A note appearing under the promo field moves the card fields without resizing them; Acira's guards must follow.
 await waitFor(async()=>(await storyRun()).events.some(e=>/Volta Electronics: ACIRA20 applied/.test(e)),20000);await ui.waitForTimeout(400);
 check('Guards stay on their fields when the page shifts',await live.evaluate(node=>{const guard=node.querySelector('.protection-guard.on-field'),field=node.querySelector('[data-element="card-number"]');if(!guard||!field)return false;const a=guard.getBoundingClientRect(),b=field.getBoundingClientRect();return Math.abs(a.top-b.top)<1&&Math.abs(a.left-b.left)<1;}));
 await waitFor(async()=>(await storyRun()).events.some(e=>/Ignored an instruction/.test(e)),45000);await beat('04-pulse-ignored');
 await waitFor(async()=>(await storyRun()).status==='completed',30000);await beat('05-done');
 await startP1();const learnedRun=(await latest()).id;
 await waitFor(()=>card.getByText(/learned from \d+ shopping tasks/).isVisible(),5000);await beat('08-learned');
 await composer.fill("Actually, buy the cheapest one if it's under $250. Ask me first.");await composer.press('Enter');
 await waitFor(()=>change.getByText("Change this task's boundaries?").isVisible(),5000);await beat('06-change-card');
 await change.getByRole('button',{name:'Keep it blocked',exact:true}).click();await act({type:'run.control',id:learnedRun,command:'stop'});
 const approvalBeat=await startP2();
 await waitFor(async()=>(await runOf(approvalBeat.run))?.status==='waiting',70000);await act({type:'tab.select',id:approvalBeat.tab});
 await waitFor(()=>ui.locator('.op-review').first().isVisible(),5000);await beat('07-approval');
 await act({type:'run.control',id:approvalBeat.run,command:'stop'});
 const beats=['01-boundaries','02-live-recognized','03-card-blocked','04-pulse-ignored','05-done','06-change-card','07-approval','08-learned'];
 check('The walkthrough captured every beat',(await Promise.all(beats.map(name=>fs.stat(path.join(out,'walkthrough',name+'.png')).then(()=>true,()=>false)))).every(Boolean));

 // Finishes and dark mode: the in-page language must hold on a deep finish and in the dark.
 await startP1();await waitFor(async()=>(await state()).runs[0].browsers.find(b=>b.store==='volta')?.recognized===true,20000);
 await act({type:'settings.update',patch:{colorPreset:'Burgundy',browserTint:'#4d1821',accentColor:'#4d1821'}});await capture('finish-burgundy');
 await act({type:'settings.update',patch:{appearance:'dark'}});await capture('appearance-dark');
 await act({type:'settings.update',patch:{appearance:'light',colorPreset:'Natural Titanium'}});
 await act({type:'run.control',id:(await state()).runs[0].id,command:'stop'});

 check('No renderer errors',report.errors.length===0);
}finally{if(app)await app.close().catch(()=>{});await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2));}
