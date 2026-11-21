// Only an opaque HttpOnly cookie carries the session. The access phrase is never persisted.
export function createAccess({onReady,onLocked,release}){
  const dialog=document.getElementById('accessDialog'),form=document.getElementById('accessForm'),password=document.getElementById('accessPassword'),error=document.getElementById('accessError'),logout=document.getElementById('logout');
  let required=false,authenticated=false,checking=null;
  function apply(state){
    const was=authenticated;required=!!state.required;authenticated=!!state.authenticated||!required;
    logout.hidden=!required||!authenticated;
    if(authenticated){if(dialog.open)dialog.close();error.textContent='';if(!was)onReady();}
    else{release();onLocked();if(!dialog.open)dialog.showModal();}
  }
  async function check(){
    if(checking)return checking;
    checking=(async()=>{const r=await fetch('/api/session',{credentials:'same-origin',cache:'no-store'});if(!r.ok)throw Error('无法检查访问权限，请确认服务已更新并刷新页面');apply(await r.json());})().catch(e=>{error.textContent=e.message;onLocked();if(!dialog.open)dialog.showModal();}).finally(()=>checking=null);
    return checking;
  }
  form.addEventListener('submit',async e=>{
    e.preventDefault();const button=form.querySelector('button[type=submit]');button.disabled=true;error.textContent='';
    try{const r=await fetch('/api/session',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:password.value})});password.value='';let state;try{state=await r.json();}catch{throw Error('服务响应异常，请稍后重试');}if(!r.ok)throw Error(state.error||'登录失败，请稍后重试');apply(state);}
    catch(e){error.textContent=e.message;}finally{button.disabled=false;}
  });
  dialog.addEventListener('cancel',e=>{if(!authenticated)e.preventDefault();});
  logout.addEventListener('click',async()=>{
    logout.disabled=true;release();
    try{const r=await fetch('/api/session',{method:'DELETE',credentials:'same-origin'});if(!r.ok)throw Error('退出登录失败，请稍后重试');apply({required:true,authenticated:false});password.value='';}
    catch(e){error.textContent=e.message;if(!dialog.open)dialog.showModal();}finally{logout.disabled=false;}
  });
  return {check,get locked(){return required&&!authenticated;},get required(){return required;}};
}
