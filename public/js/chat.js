export function createChat({send,getMyId,release}){
  const $=id=>document.getElementById(id),list=$('chatMessages'),input=$('chatInput'),form=$('chatForm');
  let code=null,connected=false,composing=false;const seen=new Set();
  function hint(text){$('chatStatus').textContent=text;}
  function count(){const n=Array.from(input.value).length;$('chatCount').textContent=n+'/300';$('chatCount').classList.toggle('error',n>300);}
  function update(){input.disabled=!code||!connected;$('chatSend').disabled=input.disabled;input.placeholder=code?'和房间里的伙伴说点什么…':'加入房间后可以聊天';}
  function empty(){list.replaceChildren();const p=document.createElement('p');p.className='chat-empty';p.textContent=code?'和伙伴打个招呼吧 ✧':'房间内的消息会显示在这里';list.append(p);}
  function append(m){
    if(m.room!==code||typeof m.id!=='string'||seen.has(m.id))return;
    seen.add(m.id);list.querySelector('.chat-empty')?.remove();
    const follow=list.scrollHeight-list.scrollTop-list.clientHeight<55;
    const item=document.createElement('div'),meta=document.createElement('div'),author=document.createElement('b'),time=document.createElement('time'),text=document.createElement('p');
    item.className='chat-message'+(m.senderId===getMyId()?' own':'');item.dataset.messageId=m.id;
    meta.className='chat-meta';author.textContent=String(m.name)+(m.senderId===getMyId()?'（我）':'');time.textContent=new Date(m.time).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false});text.textContent=m.text;
    meta.append(author,time);item.append(meta,text);list.append(item);
    while(list.children.length>100){const first=list.firstElementChild;seen.delete(first.dataset.messageId);first.remove();}
    if(follow)list.scrollTop=list.scrollHeight;
  }
  form.addEventListener('submit',e=>{
    e.preventDefault();if(composing||!connected||!code)return;
    const text=input.value.trim();if(!text)return;if(Array.from(text).length>300){hint('每条消息最多 300 个字');return;}
    send('chat',{text});input.value='';count();hint('消息仅发送给当前房间成员');
  });
  input.addEventListener('focus',release);input.addEventListener('input',count);
  input.addEventListener('compositionstart',()=>composing=true);input.addEventListener('compositionend',()=>composing=false);
  input.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.isComposing||composing||e.keyCode===229))e.preventDefault();});
  count();empty();update();
  return {
    setRoom(room){const next=room?.code||null;if(next!==code){code=next;seen.clear();input.value='';count();empty();hint(code?'消息仅发送给当前房间成员':'等待加入房间');}update();},
    setConnected(value){connected=value;update();},
    receive(m){if(m.type==='chat')append(m);else if(m.type==='chatHistory'&&m.room===code){for(const item of m.messages||[])append({...item,room:m.room});list.scrollTop=list.scrollHeight;}},
    error:hint,
  };
}
