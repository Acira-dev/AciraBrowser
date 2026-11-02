'use strict';
// Local stand-ins for the result pages of the six engines the search Preview chip knows (R4-58): the same structure the
// content script looks for (class names, test ids, heading-in-link or link-in-heading), plain styling in light or dark. Used
// by tests/search-preview.test.cjs (Electron runner) and qa/r4-preview.mjs (the real app), so no engine is ever contacted.
const RESULTS=[
 ['Acira — a calm, private browser','The browser that stays out of your way: no AI, no clutter, privacy on by default.'],
 ['Reading without the noise','Reader view, quiet pages and a typeface tuned for long articles on every site.'],
 ['Split view and Peek, explained','Open two pages side by side, or preview a link in a floating card and close it again.'],
 ['Privacy protections compared','How tracker blocking, fingerprint farbling and cookie isolation work in practice.'],
 ['Keyboard shortcuts for power users','Every command has a shortcut, and every shortcut can be changed in Settings.'],
];
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const bing=url=>'https://www.bing.com/ck/a?!&&p=0f1e2d&ptn=3&u=a1'+Buffer.from(url).toString('base64url')+'&ntb=1';
const ENGINES={
 google:{address:'https://www.google.com/search?q=acira+browser',own:'https://www.google.com/search?q=acira+browser&tbm=isch',
  results:(items)=>`<div id="search"><div id="rso">${items.map(([title,text,url],i)=>`<div class="MjjYud"><div class="g tF2Cxc" data-hveid="C${i}"><div data-hveid="D${i}"><a href="${esc(url)}" jsname="UWckNb"><br><h3 class="LC20lb">${esc(title)}</h3><div class="cite"><cite>${esc(new URL(url).host)} › ${i}</cite></div></a></div><div class="VwiC3b">${esc(text)}</div></div></div>`).join('')}</div></div>`},
 bing:{address:'https://www.bing.com/search?q=acira+browser',own:'https://www.bing.com/images/search?q=acira',wrap:bing,
  results:(items)=>`<ol id="b_results">${items.map(([title,text,url])=>`<li class="b_algo"><div class="b_attribution"><cite>${esc(new URL(url).host)}</cite></div><h2><a href="${esc(bing(url))}">${esc(title)}</a></h2><div class="b_caption"><p>${esc(text)}</p></div></li>`).join('')}</ol>`},
 duckduckgo:{address:'https://duckduckgo.com/?q=acira+browser',own:'https://duckduckgo.com/?q=acira&ia=images',
  results:(items)=>`<ol class="react-results--main">${items.map(([title,text,url])=>`<li data-layout="organic"><article data-testid="result"><div class="url">${esc(new URL(url).host)}</div><h2><a data-testid="result-title-a" href="${esc(url)}"><span>${esc(title)}</span></a></h2><div class="result-snippet">${esc(text)}</div></article></li>`).join('')}</ol>`},
 brave:{address:'https://search.brave.com/search?q=acira+browser',own:'https://search.brave.com/images?q=acira',
  results:(items)=>`<div id="results">${items.map(([title,text,url],i)=>`<div class="snippet" data-type="web" data-pos="${i+1}"><a href="${esc(url)}" class="l1"><div class="site-name-wrapper">${esc(new URL(url).host)}</div><div class="title search-snippet-title">${esc(title)}</div></a><div class="snippet-description">${esc(text)}</div></div>`).join('')}</div>`},
 startpage:{address:'https://www.startpage.com/sp/search?query=acira+browser',own:'https://www.startpage.com/sp/search?query=acira&cat=images',
  results:(items)=>`<div class="w-gl">${items.map(([title,text,url])=>`<div class="w-gl__result result"><a class="w-gl__result-url" href="${esc(url)}">${esc(new URL(url).host)}</a><a class="w-gl__result-title result-link" href="${esc(url)}"><h2>${esc(title)}</h2></a><p class="w-gl__description">${esc(text)}</p></div>`).join('')}</div>`},
 ecosia:{address:'https://www.ecosia.org/search?q=acira+browser',own:'https://www.ecosia.org/images?q=acira',
  results:(items)=>`<section class="mainline">${items.map(([title,text,url])=>`<article data-test-id="mainline-result-web" class="result"><div class="result__header">${esc(new URL(url).host)}</div><div class="result__title"><a data-test-id="result-link" class="result__link" href="${esc(url)}"><h2>${esc(title)}</h2></a></div><p class="result__description">${esc(text)}</p></article>`).join('')}</section>`},
};
/** One engine's result page. `dest(i)` is where result i goes (example.org addresses unless the caller serves its own). */
function page(engine,{theme='light',dest=i=>`https://example.org/result-${i}`}={}){
 const e=ENGINES[engine];if(!e)throw new Error('unknown engine '+engine);
 const items=RESULTS.map(([title,text],i)=>[title,text,dest(i)]),dark=theme==='dark';
 const css=`body{margin:0;font:14px/1.58 Arial,system-ui,sans-serif;background:${dark?'#1f1f1f':'#ffffff'};color:${dark?'#e3e3e3':'#202124'}}
header{display:flex;gap:18px;align-items:center;height:64px;padding:0 28px;border-bottom:1px solid ${dark?'#3c4043':'#ebebeb'}}header b{font-size:20px;margin-right:24px}header a{color:inherit;text-decoration:none;font-size:13px}
main{max-width:652px;padding:18px 0 80px 160px}h2,h3{margin:2px 0 3px;font-size:20px;line-height:1.3;font-weight:400}a{color:${dark?'#99c3ff':'#1a0dab'};text-decoration:none}a:hover h3,a:hover h2,h2 a:hover,a:hover .title{text-decoration:underline}
.MjjYud,.b_algo,[data-layout],.snippet,.w-gl__result,.result{margin:0 0 28px;list-style:none}ol{padding:0;margin:0}cite,.url,.site-name-wrapper,.w-gl__result-url,.result__header{display:block;font-style:normal;font-size:12.5px;color:${dark?'#bdc1c6':'#4d5156'}}
.title{font-size:20px;line-height:1.3}p,.VwiC3b,.snippet-description,.result-snippet{margin:0;color:${dark?'#bdc1c6':'#4d5156'}}`;
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>acira browser - ${engine}</title><style>${css}</style></head><body><header><b>${engine}</b><a id="own" href="${esc(e.own)}">Images</a><a href="${esc(e.own)}&n=2">News</a><input id="q" value="acira browser" aria-label="Search"></header><main role="main">${e.results(items)}</main></body></html>`;
}
module.exports={page,ENGINES,RESULTS,bing};
