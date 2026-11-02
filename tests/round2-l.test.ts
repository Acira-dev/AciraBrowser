import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {createInitialState,reduceBrowser} from '../src/runtime/core';
import {bookmarkControl} from '../src/ui/bookmarkControl';
import {onSettingsTarget,openSettings,requestSettingsTarget,settingsDestination,settingsTargetAction,takeSettingsTarget} from '../src/ui/settingsView';

const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8').replace(/\r/g,'');

test('Manage profiles opens Settings on the Profiles section, not just a new Settings tab',()=>{
  const source=read('src/features/accounts/ProfileSwitcher.tsx');
  assert.match(source,/openSettings\(state, dispatch, \{ section: "Profiles" \}\)/);
  assert.doesNotMatch(source,/type: "tab\.new", url: "acira:\/\/settings"/);
  assert.match(read('src/features/settings/panels/profiles.tsx'),/section: 'Profiles'/);
});

test('Ctrl+W in the tab viewer closes the selected row; the key reaches the viewer instead of closing the page behind it',()=>{
  const app=read('src/App.tsx');
  assert.match(app,/kind === 'tabs' && \(e\.ctrlKey \|\| e\.metaKey\)[^)]*e\.key\.toLowerCase\(\) === 'w'[\s\S]{0,200}closeResult\(keyboardTab\)/);
  assert.match(read('desktop/main.cjs'),/command\.action==='close-tab'&&wc===overlayView\?\.webContents&&layout\.overlay\?\.kind==='tabs'\)return/);
});

function addressStarClick() {
  const ts=createRequire(import.meta.url)('typescript') as typeof import('typescript');
  const source=ts.createSourceFile('App.tsx',read('src/App.tsx'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  let handler:import('typescript').Expression|undefined;
  const visit=(node:import('typescript').Node)=>{
    if(ts.isJsxOpeningElement(node)||ts.isJsxSelfClosingElement(node)) {
      const attributes=node.attributes.properties.filter(ts.isJsxAttribute);
      const className=attributes.find(attribute=>attribute.name.getText(source)==='className');
      if(className?.initializer?.getText(source).includes('address-star')) {
        const click=attributes.find(attribute=>attribute.name.getText(source)==='onClick')?.initializer;
        if(click&&ts.isJsxExpression(click))handler=click.expression;
      }
    }
    ts.forEachChild(node,visit);
  };
  visit(source);assert.ok(handler,'the actual address-star click handler exists');
  return new Function('bookmark','dispatch','tab','open','overlay','setOverlay',`return (${handler!.getText(source)});`);
}

test('the address star saves once, opens its editor and keeps an existing bookmark selected',()=>{
  const click=addressStarClick();
  let state=reduceBrowser(createInitialState(),{type:'tab.navigate',url:'https://bookmark.fixture/'});
  const tab=state.tabs.find(item=>item.id===state.activeTabId)!;
  const events:string[]=[];
  const dispatch=(action:Parameters<typeof reduceBrowser>[1])=>{events.push(action.type);state=reduceBrowser(state,action);};
  const open=(kind:string,url:string)=>{assert.equal(kind,'bookmark-edit');assert.equal(url,tab.url);assert.equal(bookmarkControl(state,tab).saved,true,'save precedes editing');events.push('edit');};
  click(bookmarkControl(state,tab),dispatch,tab,open)();
  assert.deepEqual(events,['bookmark.toggle','edit']);
  const saved=state.bookmarkNodes.find(node=>node.url===tab.url)!;
  events.length=0;
  click(bookmarkControl(state,tab),dispatch,tab,open)();
  assert.deepEqual(events,['edit'],'clicking a selected star edits without removing it');
  assert.equal(state.bookmarkNodes.find(node=>node.url===tab.url)?.id,saved.id);
  assert.equal(bookmarkControl(state,tab).saved,true);
  // R3-19: with the editor open, the star closes it like every other trigger (no save, no second editor).
  const closed:string[]=[];events.length=0;
  click(bookmarkControl(state,tab),dispatch,tab,open,'bookmark-edit',(value:unknown)=>closed.push(String(value)))();
  assert.deepEqual(closed,['null']);assert.deepEqual(events,[]);
  assert.match(read('src/styles/toolbar-controls.css'),/\.address-star\.bookmarked\{color:var\(--accent\)\}/);
});

test('the address star keeps internal and private pages and Tor windows unavailable without saving or opening an editor',()=>{
  const click=addressStarClick(),state=createInitialState(),tab=state.tabs.find(item=>item.id===state.activeTabId)!;
  const forbidden=()=>assert.fail('unavailable star must not dispatch or open an editor');
  click(bookmarkControl(state,tab),forbidden,tab,forbidden)();
  {const privateTab={...tab,url:'https://bookmark.fixture/',contentKind:'web' as const,privacy:'private' as const};click(bookmarkControl(state,privateTab),forbidden,privateTab,forbidden)();}
  // A private profile (a private or Tor window) saves nothing, its Tor tabs included; a Tor tab of an ordinary window saves a Tor
  // bookmark (bookmark-control.test.ts).
  const privateState={...state,browserProfiles:state.browserProfiles.map(profile=>({...profile,private:true}))};
  for(const privacy of [undefined,'tor'] as const){const privateTab={...tab,url:'https://bookmark.fixture/',contentKind:'web' as const,...(privacy?{privacy}:{})};click(bookmarkControl(privateState,privateTab),forbidden,privateTab,forbidden)();}
});

test('a data: or javascript: address gets a plain message, not the raw validation error (S07)',()=>{
  const main=read('desktop/main.cjs');
  assert.ok(main.includes("(a.type==='tab.new'||a.type==='tab.navigate')&&/unsupported protocol/.test("));
  assert.ok(main.includes('text:tm("toast.addressUnsupported")'));
});

test('tab menu has Split view (current + this tab), engine list collapses, settings icons share a tile',()=>{
  assert.ok(/row\(tr\("[\w.]+"\), Columns2, \(\) => \{ dispatch\(\{ type: 'split\.open', tabIds: \[tab\.id, context\.id\] \}\)/.test(read('src/App.tsx')));
  assert.ok(read('src/features/settings/panels/search-engines.tsx').includes("t('searchEngines.moreEngines', { count: providers.engines.length - 1 })"));
  assert.equal(JSON.parse(read('src/i18n/en.json'))['searchEngines.moreEngines'], 'More engines… ({count})');
  assert.ok(read('src/features/BrowserSettings.tsx').includes('className="bs-nav-icon"'));
  assert.match(read('src/features/browser-settings.css'),/\.bs-nav-icon\{flex:none;display:grid;place-items:center;width:20px;height:20px/);
});

function settingsStorage() {
  const store = new Map<string,string>(), listeners = new Set<(event: {key:string;newValue:string})=>void>();
  const scope = globalThis as any;
  scope.window = {addEventListener:(type:string,listener:any)=>{if(type==='storage')listeners.add(listener);},removeEventListener:(type:string,listener:any)=>{if(type==='storage')listeners.delete(listener);}};
  scope.localStorage = {getItem:(key:string)=>store.get(key)??null,setItem:(key:string,value:string)=>{store.set(key,value);for(const listener of listeners)listener({key,newValue:value});},removeItem:(key:string)=>store.delete(key)};
  return store;
}

test('Settings arrivals stay in the intended window with duplicate tab IDs and either shared or different profiles',()=>{
  for(const differentProfile of [false,true]) {
    settingsStorage();
    const owner=createInitialState(), other=createInitialState();
    owner.windowId='window-owner';other.windowId='window-other';
    owner.tabs[0].url=other.tabs[0].url='acira://settings';
    if(differentProfile)other.tabs[0].browserProfileId='profile-work';
    const wanted=settingsDestination('tab-home',owner.windowId), foreign=settingsDestination('tab-home',other.windowId);
    const received:{window:string;section?:string}[]=[], dispatched:unknown[]=[];
    const stopOther=onSettingsTarget(()=>{const target=takeSettingsTarget(foreign);if(target)received.push({window:'other',section:target.section});},foreign);
    const stopOwner=onSettingsTarget(()=>{const target=takeSettingsTarget(wanted);if(target)received.push({window:'owner',section:target.section});},wanted);
    openSettings(owner,action=>dispatched.push(action),{section:'Profiles'});
    assert.deepEqual(received,[{window:'owner',section:'Profiles'}]);
    assert.deepEqual(dispatched,[{type:'tab.select',id:'tab-home'}]);
    stopOther();stopOwner();
  }
});

test('new Settings arrivals have an explicit dispatch ID and coexist until their exact tab consumes them',()=>{
  settingsStorage();
  const state=createInitialState();state.windowId='window-owner';
  const actions:any[]=[];
  openSettings(state,action=>actions.push(action),{section:'Privacy'});
  openSettings(state,action=>actions.push(action),{section:'New tab'});
  assert.equal(actions.length,2);
  assert.notEqual(actions[0].id,actions[1].id);
  for(const action of actions)assert.match(action.id,/^tab-[0-9a-f-]{36}$/);
  assert.deepEqual(takeSettingsTarget(settingsDestination(actions[1].id,state.windowId)),{section:'New tab',setting:undefined});
  assert.deepEqual(takeSettingsTarget(settingsDestination(actions[0].id,state.windowId)),{section:'Privacy',setting:undefined});
});

test('stale, malformed, future and contextless Settings arrivals cannot redirect another window',()=>{
  const store=settingsStorage(), destination=settingsDestination('tab-home','window-owner');
  requestSettingsTarget({section:'Privacy'});
  assert.equal(store.size,0);
  assert.equal(takeSettingsTarget(),null);
  for(const value of [{at:Date.now()-9000,section:'Privacy'},{at:Date.now()+9000,section:'Privacy'},null,{section:'Privacy'}]) {
    requestSettingsTarget({section:'Profiles'},destination);
    const key=[...store.keys()][0];store.set(key,JSON.stringify(value));
    assert.equal(takeSettingsTarget(destination),null);
    assert.equal(store.size,0);
  }
  store.set('acira-settings-target',JSON.stringify({at:Date.now(),section:'Privacy'}));
  assert.equal(takeSettingsTarget(destination),null,'old global key is never consumed');
});

test('direct Settings commands retain their dispatch options and carry a destination across popup renderers',()=>{
  settingsStorage();
  (globalThis as any).window.acira={initialSnapshot:{windowId:'window-popup'}};
  const action=settingsTargetAction({type:'tab.new',url:'acira://settings',browserProfileId:'profile-work'},{setting:'known-limits'});
  assert.equal(action.type,'tab.new');
  if(action.type!=='tab.new')throw Error('Expected Settings tab');
  assert.equal(action.browserProfileId,'profile-work');
  assert.deepEqual(takeSettingsTarget(settingsDestination(action.id!,'window-popup')),{section:undefined,setting:'known-limits'});
  const unrelated={type:'tab.new' as const,url:'https://example.test/'};
  assert.equal(settingsTargetAction(unrelated,{setting:'known-limits'}),unrelated);
});

test('Settings arrivals cannot cross a process restart even when main and tab-home identities repeat within eight seconds',()=>{
 settingsStorage();const {createWindowUiIdentity}=createRequire(import.meta.url)('../desktop/window-ui-identity.cjs');
 const before=createWindowUiIdentity(),after=createWindowUiIdentity();assert.equal(before('main'),before('main'));assert.notEqual(before('main'),after('main'));
 const old=settingsDestination('tab-home',before('main')),restarted=settingsDestination('tab-home',after('main'));
 requestSettingsTarget({section:'Privacy'},old);assert.equal(takeSettingsTarget(restarted),null);assert.deepEqual(takeSettingsTarget(old),{section:'Privacy',setting:undefined});
 requestSettingsTarget({section:'Profiles'},restarted);assert.deepEqual(takeSettingsTarget(restarted),{section:'Profiles',setting:undefined});
});
