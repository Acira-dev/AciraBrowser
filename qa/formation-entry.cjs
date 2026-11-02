// QA-only source instrumentation changes just the renderer output directory.
// No desktop input, capture scope, provider or native navigation code is replaced.
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module'),crypto=require('node:crypto');
if(process.env.ACIRA_BROWSER_TEST_HIDDEN!=='1'||!process.env.ACIRA_BROWSER_TEST_DATA||!process.env.ACIRA_MOTION_RENDERER)throw new Error('Isolated motion fixture required');
const root=path.resolve(__dirname,'..'),renderer=path.resolve(process.env.ACIRA_MOTION_RENDERER),allowed=path.join(root,'qa','artifacts')+path.sep;if(!renderer.startsWith(allowed))throw new Error('Motion renderer must be a generated local QA artifact');
const filename=path.join(root,'desktop','main.cjs'),original=fs.readFileSync(filename,'utf8'),source=original.replaceAll("path.resolve(__dirname,'../dist')",'path.resolve(process.env.ACIRA_MOTION_RENDERER)');
globalThis.__aciraMotionBuild={original:crypto.createHash('sha256').update(original).digest('hex'),instrumented:crypto.createHash('sha256').update(source).digest('hex'),renderer};
const entry=new Module(filename,module);entry.filename=filename;entry.paths=Module._nodeModulePaths(path.dirname(filename));entry._compile(source,filename);
