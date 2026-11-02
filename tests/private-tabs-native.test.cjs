'use strict';
// main.cjs cannot be loaded outside Electron, so the native rows of docs/launch/PRIVATE_TABS.md that have no live test of their own are held in place
// by looking at the source: each guard below is one place where a private tab would otherwise leak. qa/d-private-tabs.mjs proves the rest live.
const {test} = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\r\n/g, '\n');
const main = read('desktop/main.cjs');
const has = (source, needle, message) => assert.ok(source.includes(needle), message || `missing: ${needle}`);
const ts=require('typescript'),source=ts.createSourceFile('main.cjs',main,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
let ensurePage;
const findEnsurePage=node=>{if(ts.isFunctionDeclaration(node)&&node.name?.text==='ensurePage')ensurePage=node;ts.forEachChild(node,findEnsurePage);};
findEnsurePage(source);
assert.ok(ensurePage?.body,'the actual native page factory exists');
const factoryStatements=[...ensurePage.body.statements];
const declaration=name=>factoryStatements.flatMap(statement=>ts.isVariableStatement(statement)?[...statement.declarationList.declarations]:[]).find(item=>item.name.getText(source)===name);
const adopted=declaration('adopted');
assert.ok(adopted?.initializer,'the actual Peek adoption expression exists');
const fromPage=declaration('fromPage');
assert.ok(fromPage?.initializer,'the window.open adoption expression exists');
const adoptPeek=new Function('tab','peek','openedViews',`const fromPage=(${fromPage.initializer.getText(source)});return (${adopted.initializer.getText(source)});`);

test('a private page gets its own in-memory profile, session and cleanup', () => {
  has(main, "partition:'acira-private-tab-'+randomUUID()", 'a partition without persist: is in memory only');
  has(main, "id:'private-tab-'+randomUUID()", 'the private- prefix is what permissions, downloads, spelling and blocking read as "keep nothing"');
  has(main, 'const profile=pageProfile(tab);', 'ensurePage builds the page from pageProfile');
  has(main, 'view.webContents.once(\'destroyed\',()=>retirePrivateTab(entry))', 'the session is retired when the page goes, however it goes');
  has(main, 'privateRetirement.begin({session,profileId:profile.id,partition:profile.partition,ownerId:key,privateMode:true})', 'the verified retirement a private window gets');
  has(main, 'privateRetirement.commit(ticket)'); has(main, 'privateOwnerCleanup.set(key,{profileId:profile.id', 'downloads, permissions, certificate exceptions and blocking let go of it');
  assert.equal((main.match(/function pageProfile\(tab\)/g) || []).length, 1);
  assert.ok(!main.includes('privateFavicon'), 'one icon path: tab-icons, through the page session');
});

test('nothing a private page does is remembered by the services', () => {
  has(main, "if(!privateMode&&!entry.privateTab)closedPages.remember(id,wc);", 'no undo-close memory');
  has(main, 'void tabIcons().fetchIcon(wc.session,icon)', 'the icon comes through the page\'s own (private) session');
  has(main, 'if(icon&&!torMode&&!entry.privateTab)void require(\'./browser-services/favicon-store.cjs\')', 'and is never stored');
  has(main, "if(entry.privateTab)return 'private';", 'a private tab never sleeps or freezes (its session would lose its place)');
  has(main, 'profileId:tab.privacy?pages.get(tab.id)?.profileId||tab.browserProfileId:tab.browserProfileId,privateMode:privateMode||Boolean(tab.privacy)', 'site data, Reader, output and forget-site see a private tab as private');
  has(main, 'private:privateMode||Boolean(tab.privacy),privateTab:Boolean(tab.privacy)', 'the context menu offers private-safe commands');
  has(main, "const ownPrivate=state.downloads.filter(d=>d.private)", 'other windows never receive private downloads'); has(main, 'downloads=state.downloads.filter(d=>!privateDownload(d))'); has(main, "structuredClone(key==='downloads'?downloads:state[key])");
  has(main, "if(item.private&&request.command==='retry')throw", 'a private transfer is never retried through the ordinary profile (service)'); has(main, "if(!item||(action.command==='retry'&&item.private))return true;", 'nor from a toast');
  has(read('desktop/browser-services/download-engine.cjs'), 'canRetry:terminal&&!!httpURL(url)&&!recovery.private', 'no Retry button for a private transfer');
  has(main, "private:held.privateTab||undefined", 'download records carry the private flag'); has(main, "{...event,browserProfileId:held.tabProfileId,private:true}");
});

test('everything a private page opens stays private, and the exits to the ordinary session are closed', () => {
  has(main, "browserProfileId:tab.browserProfileId,afterId:tab.id,...(entry.privateTab?{privacy:entry.privacy}:{})", 'links opened from a private page');
  has(main, "if(route.route==='window'){if(entry.privateTab)dispatch({type:'tab.new',url:details.url,browserProfileId:tab.browserProfileId,afterId:tab.id,privacy:entry.privacy});else createBrowserWindow(", 'a new-window request becomes a private tab, not an ordinary window');
  has(main, "privateTab:Boolean(entry.privateTab||tab.privacy),tor:Boolean(torMode||tab.privacy==='tor')", 'the window-open route is told whether the opener is private or Tor: such a tab never gets an opener-linked ordinary view');
  has(main, "if(moving?.privacy){dispatch({type:'toast',text:tm(\"main.aPrivateTabCanT\"),tone:'info'});return true;}", 'moving would hand the session to another window');
  has(main, "pages.get(pageOwner(pages,event.sender))?.privateTab)return;", 'Peek from a private page would open its link in the ordinary session');
  has(main, "if(entry.privateTab)return {ok:false,error:'Extensions are not available in private tabs.'};", 'no extension install from a private page');
  for(const privacy of [undefined,'private','tor']){
    const tab={id:'fixture-tab',...(privacy?{privacy}:{})},calls=[],ordinaryView={fixture:'ordinary-peek'};
    const opened=[],result=adoptPeek(tab,{adopt:id=>{calls.push(id);return ordinaryView;}},{adopt:id=>{opened.push(id);return null;}});
    assert.equal(result,privacy?null:ordinaryView,'private and Tor tabs never adopt an ordinary Peek view');
    assert.deepEqual(calls,privacy?[]:['fixture-tab'],'private and Tor tabs never call Peek adoption');
    assert.deepEqual(opened,privacy?[]:['fixture-tab'],'private and Tor tabs never adopt a view a page opened');
  }
  has(read('desktop/rewind/peek.cjs'), "if(source?.privacy)return {ok:false,code:'private'};", 'Peek refuses a private source tab');
  has(read('desktop/rewind/split-commands.cjs'), '...(source.privacy?{privacy:source.privacy}:{})', 'split-view links from a private tab are private');
  has(read('desktop/browser-services/context-commands.cjs'), '!owner.privateTab&&item(\'link-peek\'', 'no Peek item');
});

test('the page session is configured from its selected profile before Peek adoption or native view creation',()=>{
  const profile=declaration('profile');
  assert.ok(profile?.initializer&&ts.isCallExpression(profile.initializer));
  assert.equal(profile.initializer.expression.getText(source),'pageProfile');
  assert.equal(profile.initializer.arguments[0]?.getText(source),'tab');
  const profileAt=factoryStatements.findIndex(statement=>statement===profile.parent.parent);
  const adoptedAt=factoryStatements.findIndex(statement=>statement===adopted.parent.parent);
  const setupAt=factoryStatements.findIndex(statement=>ts.isTryStatement(statement)&&statement.tryBlock.statements.some(item=>ts.isExpressionStatement(item)&&ts.isCallExpression(item.expression)&&item.expression.expression.getText(source)==='configureSession'));
  assert.ok(profileAt>=0&&setupAt>profileAt&&adoptedAt>setupAt,'profile selection precedes session setup, which precedes Peek adoption/view construction');
  const setup=factoryStatements[setupAt];
  assert.ok(setup.finallyBlock?.getText(source).includes('preparingPageProfile=null'),'temporary canonical owner is cleared even when setup fails');
  const configure=new Function('tab','profile','torMode','require','configureSession',`let preparingPageProfile=profile;${setup.getText(source)};return preparingPageProfile;`);
  for(const privacy of [undefined,'private','tor']){
    const tab={browserProfileId:'ordinary-fixture',...(privacy?{privacy}:{})},profile={id:privacy?'ephemeral-fixture':'ordinary-fixture',partition:privacy?'memory-fixture':'persist:fixture'},session={fixture:profile.partition},calls=[];
    const preparing=configure(tab,profile,false,name=>{assert.equal(name,'electron');return {session:{fromPartition:partition=>{assert.equal(partition,profile.partition);return session;}}};},(...args)=>calls.push(args));
    assert.equal(preparing,null,'temporary ownership is cleared after native setup');
    assert.deepEqual(calls,[[session,profile.id,{tor:privacy==='tor',inheritProfileId:tab.browserProfileId}]],'session setup uses the selected isolated profile and preserves Tor routing');
  }
});

test('Tor tabs hook in by kind: an unregistered kind is still a plain private tab', () => {
  has(main, 'const privateTabKinds=new Map();'); has(main, 'kind?.release?.({key,session,profileId:profile.id,tabId:entry.tabId})', 'release gets the key, session, profile and tab');
  has(main, 'kind.prepare({key:entry.privateKey,session:wc.session,profileId:profile.id,tabId:tab.id,emit})', 'prepare runs before the session is configured');
  has(main, 'if(entry.ready){try{await entry.ready;}catch{entry.loadedURL=tab.url;', 'and the page never loads if it fails: no fallback to a direct connection');
  assert.ok(!/privateTabKinds\.get\([^)]*\)\.prepare/.test(main), 'a missing kind never throws');
});
