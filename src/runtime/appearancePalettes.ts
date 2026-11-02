import type { StylePreference } from './types';

/** Curated solid interface finishes. These are Acira colors, not literal device
 * swatches. `name` is the stored preset id and never changes; `label` is what people read (C12: plain color names,
 * no device names). Background, selection and text roles are derived in ui/theme.ts. */
export const appearancePalettes = [
 {name:'Porcelain',label:'Porcelain',category:'Signature',accent:'#1769c2',tint:'#f8fbff',light:'#f4f6f8',dark:'#102638'},
 {name:'Burgundy',label:'Burgundy',category:'Vibrant',accent:'#4d1821',tint:'#4d1821',light:'#4d1821',dark:'#28151f'},
 {name:'Deep Blue',label:'Navy',category:'Muted',accent:'#47678e',tint:'#293c55',light:'#293c55',dark:'#142338'},
 {name:'Ocean Blue',label:'Ocean',category:'Vibrant',accent:'#266a98',tint:'#99c9e8',light:'#99c9e8',dark:'#102c42'},
 {name:'iPhone Blue',label:'Sky',category:'Vibrant',accent:'#477fb8',tint:'#315b89',light:'#315b89',dark:'#142b43'},
 {name:'Emerald Green',label:'Emerald Green',category:'Vibrant',accent:'#208361',tint:'#176b53',light:'#176b53',dark:'#112e25'},
 {name:'Alpine Green',label:'Alpine Green',category:'Muted',accent:'#487667',tint:'#345c50',light:'#345c50',dark:'#142c25'},
 {name:'Deep Purple',label:'Deep Purple',category:'Vibrant',accent:'#885494',tint:'#57345f',light:'#57345f',dark:'#291a30'},
 {name:'Desert Titanium',label:'Sand',category:'Muted',accent:'#79634f',tint:'#b5a596',light:'#b5a596',dark:'#2c241f'},
 {name:'Natural Titanium',label:'Stone',category:'Neutral',accent:'#56616d',tint:'#bbc0c7',light:'#bbc0c7',dark:'#252930'},
 {name:'Silver',label:'Silver',category:'Neutral',accent:'#3d6e9c',tint:'#f7f7f7',light:'#e7edf3',dark:'#25272b'},
 {name:'Black Titanium',label:'Graphite',category:'Neutral',accent:'#65778e',tint:'#262c33',light:'#262c33',dark:'#14191f'},
] as const;
export const defaultAppearancePalette=appearancePalettes.find(p=>p.name==='Porcelain')!;
export const legacyPaletteNames:Record<string,string>={Graphite:'Natural Titanium',Default:'Natural Titanium',Ocean:'Ocean Blue','Sierra Blue':'Ocean Blue',Forest:'Alpine Green',Sand:'Desert Titanium',Rose:'Burgundy'};
export function appearancePalette(name:string){const canonical=legacyPaletteNames[name]||name;return appearancePalettes.find(p=>p.name===canonical);}
export function palettePreference(palette:typeof appearancePalettes[number]){return {colorPreset:palette.name,accentColor:palette.accent,browserTint:palette.tint};}
/** Only known old presets migrate. A custom tint, including one with a stale
 * preset label, keeps its exact colors and becomes Custom. */
export function migrateAppearancePalette(value:StylePreference):StylePreference{
 const previousCollection:Record<string,readonly [string,string]>={
  'Deep Blue':['#32374a','#32374a'],'Ocean Blue':['#80c9f2','#007cad'],
  'iPhone Blue':['#276787','#276787'],'Emerald Green':['#087c59','#087c59'],
  'Alpine Green':['#576856','#576856'],'Deep Purple':['#652baf','#652baf'],
  'Desert Titanium':['#bfa48f','#bfa48f'],'Natural Titanium':['#c2bcb2','#c2bcb2'],
  'Black Titanium':['#3c3c3d','#3c3c3d']
 };
 const old=previousCollection[value.colorPreset],revised=appearancePalette(value.colorPreset);
 if(old&&revised&&value.browserTint.toLowerCase()===old[0]&&value.accentColor.toLowerCase()===old[1])return {...value,...palettePreference(revised)};
 if(value.colorPreset==='Silver'&&value.browserTint.toLowerCase()==='#f7f7f7'&&value.accentColor.toLowerCase()==='#f7f7f7')return {...value,...palettePreference(appearancePalette('Silver')!)};
 if(value.colorPreset==='Deep Purple'&&value.browserTint.toLowerCase()==='#594f63'&&value.accentColor.toLowerCase()==='#594f63')return {...value,...palettePreference(appearancePalette('Deep Purple')!)};
 const oldTints:Record<string,readonly string[]>={Graphite:['#d7dadf','#eef0f2'],Default:['#d7dadf','#eef0f2'],Ocean:['#d6e4ed','#c5d8e6'],Forest:['#dce5df','#c9dacf'],Sand:['#e7e0d4','#e3d8c7'],Rose:['#eadcdd'],Silver:['#e4e6e8','#e4e5e8']};
 if(oldTints[value.colorPreset]?.includes(value.browserTint.toLowerCase())){const preset=appearancePalette(value.colorPreset);if(preset)return {...value,...palettePreference(preset)};}
 if(value.colorPreset==='Sierra Blue'&&value.browserTint.toLowerCase()==='#a7c1d9'&&value.accentColor.toLowerCase()==='#a7c1d9')return {...value,...palettePreference(appearancePalette('Ocean Blue')!)};
 const previousFinishes:Record<string,readonly [string,string]>={Burgundy:['#6b3044','#824658'],'Deep Blue':['#34465e','#456585'],'Sierra Blue':['#a6bdd1','#537b98'],'Alpine Green':['#526758','#4e705c'],'Deep Purple':['#61546b','#755a86'],'Desert Titanium':['#b99a82','#8d6d51'],'Natural Titanium':['#a29c91','#736d62'],Silver:['#c9cbd0','#747b85'],'Black Titanium':['#41434b','#636a76']};
 const previous=previousFinishes[value.colorPreset],preset=appearancePalette(value.colorPreset);
 if(previous&&value.browserTint.toLowerCase()===previous[0]&&value.accentColor.toLowerCase()===previous[1]&&preset)return {...value,...palettePreference(preset)};
 if(legacyPaletteNames[value.colorPreset]||preset&&value.browserTint.toLowerCase()!==preset.tint)return {...value,colorPreset:'Custom'};
 return value;
}
