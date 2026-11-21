export const ACTIONS = [
  {id:'up',label:'上',bit:6,codes:['ArrowUp']},{id:'down',label:'下',bit:7,codes:['ArrowDown']},
  {id:'left',label:'左',bit:5,codes:['ArrowLeft']},{id:'right',label:'右',bit:4,codes:['ArrowRight']},
  {id:'a',label:'A',bit:0,codes:['KeyZ']},{id:'b',label:'B',bit:1,codes:['KeyX']},
  {id:'l',label:'L',bit:9,codes:['KeyA']},{id:'r',label:'R',bit:8,codes:['KeyS']},
  {id:'start',label:'Start',bit:3,codes:['Enter']},{id:'select',label:'Select',bit:2,codes:['ShiftLeft','ShiftRight']},
];
export const BINDINGS_KEY='kirby.keybindings.v1';
const supported=/^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right)|Space|Enter|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Backspace|Tab|Numpad([0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter)|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Backquote|Comma|Period|Slash)$/;
export const isSupportedCode=code=>typeof code==='string'&&supported.test(code);
export const defaultBindings=()=>Object.fromEntries(ACTIONS.map(a=>[a.id,[...a.codes]]));
export function loadBindings(raw){
  try{const parsed=JSON.parse(raw),seen=new Set();if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return defaultBindings();
    for(const a of ACTIONS){const codes=parsed[a.id];if(!Array.isArray(codes)||codes.length<1||codes.length>2)return defaultBindings();for(const code of codes){if(!isSupportedCode(code)||seen.has(code))return defaultBindings();seen.add(code);}}
    return Object.fromEntries(ACTIONS.map(a=>[a.id,[...parsed[a.id]]]));
  }catch{return defaultBindings();}
}
export function rebind(bindings,action,code){
  if(!ACTIONS.some(a=>a.id===action)||!isSupportedCode(code))throw Error('请选择字母、数字、方向键或常用功能键；Esc 取消');
  const next=Object.fromEntries(ACTIONS.map(a=>[a.id,[...bindings[a.id]]]));
  const conflict=ACTIONS.find(a=>a.id!==action&&next[a.id].includes(code));
  const previous=next[action];next[action]=[code];
  if(conflict){next[conflict.id]=next[conflict.id].filter(c=>c!==code);if(!next[conflict.id].length)next[conflict.id]=previous;}
  return {bindings:next,swapped:conflict?.id||null};
}
export function keyLabel(code){
  const labels={ArrowUp:'↑',ArrowDown:'↓',ArrowLeft:'←',ArrowRight:'→',Space:'空格',Enter:'Enter',ShiftLeft:'左 Shift',ShiftRight:'右 Shift',ControlLeft:'左 Ctrl',ControlRight:'右 Ctrl',AltLeft:'左 Alt',AltRight:'右 Alt',Backspace:'退格',Tab:'Tab',Minus:'-',Equal:'=',BracketLeft:'[',BracketRight:']',Backslash:'\\',Semicolon:';',Quote:"'",Backquote:'反引号',Comma:',',Period:'.',Slash:'/'};
  return labels[code]||code.replace(/^Key|^Digit/,'').replace(/^Numpad/,'小键盘 ');
}
export function inputMask(bindings,held){let mask=0;for(const a of ACTIONS)if(bindings[a.id].some(c=>held.has(c)))mask|=1<<a.bit;return mask;}
export const isTyping=element=>!!element&&(!!element.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable=""]')||element.isContentEditable);
