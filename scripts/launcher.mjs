import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createApp} from '../server.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const APP_ID='kirby-lan-netplay';
export const PROJECT_ID=createHash('sha256').update(ROOT).digest('hex');
export async function probeService(port){
  try{const r=await fetch('http://127.0.0.1:'+port+'/api/info',{signal:AbortSignal.timeout(900)});if(!r.ok)return null;const text=await r.text();if(text.length>32768)return null;return JSON.parse(text);}catch{return null;}
}
export function openPage(url){
  if(process.env.KIRBY_NO_BROWSER==='1')return;
  try{const child=process.platform==='win32'?spawn('rundll32.exe',['url.dll,FileProtocolHandler',url],{detached:true,stdio:'ignore'}):spawn(process.platform==='darwin'?'open':'xdg-open',[url],{detached:true,stdio:'ignore'});child.on('error',()=>{});child.unref();}catch{}
}
export async function startOrReuse({port=8765,host='0.0.0.0',maxAttempts=10,openBrowser=true,romPath,catalogPath,romDirectory,log=console.log}={}){
  if(!Number.isInteger(port)||port<0||port>65535)throw Error('PORT 必须是 1–65535 的整数');
  for(let attempt=0;attempt<maxAttempts;attempt++){
    const candidate=port===0?0:port+attempt;if(candidate>65535)break;
    let app;
    try{app=await createApp({port:candidate,host,...(romPath?{romPath}:{}),...(catalogPath?{catalogPath}:{}),...(romDirectory?{romDirectory}:{})});}
    catch(error){
      if(error.code!=='EADDRINUSE')throw error;
      const info=await probeService(candidate);
      if(info?.appId===APP_ID&&info.projectId===PROJECT_ID){
        const url='http://127.0.0.1:'+candidate;
        log('本项目服务已在运行，直接打开页面：'+url);for(const address of info.addresses||[])log('局域网: '+address);
        if(openBrowser)openPage(url);return {reused:true,port:candidate,url,info,app:null};
      }
      log('端口 '+candidate+' 被其他服务占用，尝试下一个端口…');continue;
    }
    log('GBA 局域网服务已启动: '+app.url);for(const address of app.info.addresses)log('局域网: '+address);
    if(openBrowser)openPage(app.url);return {reused:false,port:app.port,url:app.url,info:app.info,app};
  }
  throw Error('没有可用端口；请关闭此前的服务窗口，或通过 PORT 设置其他端口。');
}
export async function runLauncher(){
  if(process.env.PUBLIC_MODE&&process.env.PUBLIC_MODE!=='false'){console.error('公网部署请使用 node server.mjs，以便执行生产配置校验。');process.exitCode=1;return;}
  try{
    const result=await startOrReuse({port:Number(process.env.PORT||8765),host:process.env.HOST||'0.0.0.0',openBrowser:!process.argv.includes('--no-open'),romPath:process.env.ROM_PATH||undefined,catalogPath:process.env.GAME_CATALOG_PATH||undefined,romDirectory:process.env.ROM_DIRECTORY||undefined});
    if(result.app)for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>result.app.close().then(()=>process.exit(0)));
  }catch(error){console.error('启动失败：'+error.message);process.exitCode=1;}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await runLauncher();
