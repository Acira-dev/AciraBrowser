import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {MaterialHost,popupOpacity}=require('../desktop/composition.cjs');
const tokens=require('../design-tokens.json');

class View {
  bounds={x:0,y:0,width:0,height:0};visible=false;blur=0;color='';blurs:number[]=[];colors:string[]=[];log:{alpha:number;blur:number}[]=[];
  setBounds(b:typeof this.bounds){this.bounds=b;}
  getBounds(){return this.bounds;}
  setVisible(v:boolean){this.visible=v;}
  // Every native paint is recorded as the pair the compositor shows: tint alpha with blur radius.
  setBackgroundBlur(v:number){assert.ok(Number.isInteger(v),'Electron requires an integer blur radius');this.blur=v;this.blurs.push(v);if(this.visible)this.log.push({alpha:alphaOf(this.color),blur:v});}
  setBackgroundColor(color:string){this.color=color;this.colors.push(color);if(this.visible)this.log.push({alpha:alphaOf(color),blur:this.blur});}
  setBorderRadius(){}
}
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const alphaOf=(color:string)=>parseInt(color.slice(1,3),16)/255;
const menu={id:7,kind:'menu',bounds:{x:900,y:80,width:320,height:420},origin:{x:1,y:0}};

// On Windows, native background blur turns a see-through backdrop (the acrylic sidebar) opaque dark. The tint must be
// thick enough to cover that before any blur is on, or a dark patch shows while a menu opens or closes.
const thin=tokens.material.tint*.6;
const exposed=(log:{alpha:number;blur:number}[])=>log.filter(paint=>paint.blur>0&&paint.alpha<thin);

test('opening frost condenses: the tint rises first and blur only joins once it can cover it',async()=>{
  const backdrop=new View(),host=new MaterialHost(new View(),new View(),()=>{},()=>backdrop);
  host.place(menu,{style:'acira',appearance:'light'},[1440,960]);
  assert.equal(host.ready(7,'material'),true);
  assert.ok(alphaOf(backdrop.color)<=.03,`frost starts nearly transparent, got ${backdrop.color}`);
  assert.equal(backdrop.blur,0,'no blur under a thin tint');
  assert.equal(host.ready(7,'content'),true);
  await wait(tokens.motion.vapor*1.3);
  assert.equal(backdrop.blur,tokens.material.blur);
  // Popovers settle at the denser popover glass, not the chrome's opacity.
  assert.ok(Math.abs(alphaOf(backdrop.color)-popupOpacity(tokens.material.tint))<.01,`final tint, got ${backdrop.color}`);
  assert.deepEqual(exposed(backdrop.log),[],'blur never shows under a thin tint while opening');
  host.hide({style:'acira',reducedMotion:true});
});

test('closing drops the blur at once, so a fading menu never leaves a dark patch',async()=>{
  const backdrop=new View(),host=new MaterialHost(new View(),new View(),()=>{},()=>backdrop);
  host.place(menu,{style:'acira',appearance:'dark'},[1440,960]);
  host.ready(7,'material');host.ready(7,'content');
  await wait(tokens.motion.vapor*1.3);
  backdrop.log.length=0;
  host.hide({style:'acira',appearance:'dark'});
  assert.equal(backdrop.blur,0,'blur is off on the first closing frame');
  assert.ok(alphaOf(backdrop.color)>thin,'the tint is still there to fade');
  await wait(tokens.motion.vaporExit+60);
  assert.deepEqual(exposed(backdrop.log),[],'blur never shows under a thin tint while closing');
  assert.equal(backdrop.visible,false);
  assert.equal(host.ready(7,'material'),false,'dismissed surfaces cannot reappear after a late renderer acknowledgement');
});

test('reduced motion paints the finished frost at once',()=>{
  const backdrop=new View(),host=new MaterialHost(new View(),new View(),()=>{},()=>backdrop);
  host.place(menu,{style:'acira',appearance:'light',reducedMotion:true},[1440,960]);
  host.ready(7,'material');host.ready(7,'content');
  assert.equal(host.ready(7,'material'),true,'a reloaded renderer can recover the already-painted native material');
  assert.equal(host.ready(7,'content'),true,'foreground readiness is idempotent for the current popup');
  assert.equal(host.ready(6,'content'),false,'a stale generation remains rejected');
  assert.equal(backdrop.blur,tokens.material.blur);
  assert.ok(Math.abs(alphaOf(backdrop.color)-popupOpacity(tokens.material.tint))<.01);
  host.hide({style:'acira',reducedMotion:true});
});

test('Profiles and Extensions share denser frost while respecting solid surfaces',()=>{
  for(const kind of ['profile','extensions'])for(const reducedTransparency of [false,true]){
    const backdrop=new View(),host=new MaterialHost(new View(),new View(),()=>{},()=>backdrop);
    host.place({...menu,kind},{style:'acira',appearance:'light',reducedMotion:true,reducedTransparency,materialOpacity:.64},[1440,960]);
    host.ready(7,'material');host.ready(7,'content');
    assert.equal(backdrop.blur,reducedTransparency?0:tokens.material.identityBlur);
    assert.ok(Math.abs(alphaOf(backdrop.color)-(reducedTransparency?1:tokens.material.identityTint))<.01);
    host.hide({style:'acira',reducedMotion:true});
  }
});
