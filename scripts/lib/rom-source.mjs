import {readFile,lstat} from 'node:fs/promises';
import {inflateRawSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const MAX_ROM=32*1024*1024,MAX_ARCHIVE=40*1024*1024;
const table=Uint32Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
export function crc32(bytes){let crc=0xffffffff;for(const value of bytes)crc=table[(crc^value)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function check(condition,message){if(!condition)throw Error(message);}
function safeName(name){return name.length<=512&&!/[\\:\p{Cc}]/u.test(name)&&!name.startsWith('/')&&name.split('/').every(part=>part&&part!=='.'&&part!=='..');}
export function extractGbaZip(bytes){
  check(bytes.length>=22&&bytes.length<=MAX_ARCHIVE,'ZIP 大小无效');let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(bytes.readUInt32LE(i)===0x06054b50&&i+22+bytes.readUInt16LE(i+20)===bytes.length){end=i;break;}
  check(end>=0,'ZIP 中央目录缺失');const total=bytes.readUInt16LE(end+10),offset=bytes.readUInt32LE(end+16),size=bytes.readUInt32LE(end+12);
  check(bytes.readUInt16LE(end+4)===0&&bytes.readUInt16LE(end+6)===0&&bytes.readUInt16LE(end+8)===total&&total>0&&total<=128&&offset+size<=end,'不支持多卷、ZIP64 或过多条目的归档');
  const candidates=[];let cursor=offset,expanded=0;
  for(let i=0;i<total;i++){
    check(cursor+46<=offset+size&&bytes.readUInt32LE(cursor)===0x02014b50,'ZIP 中央目录损坏');
    const flags=bytes.readUInt16LE(cursor+8),method=bytes.readUInt16LE(cursor+10),crc=bytes.readUInt32LE(cursor+16),packed=bytes.readUInt32LE(cursor+20),length=bytes.readUInt32LE(cursor+24),nameLen=bytes.readUInt16LE(cursor+28),extraLen=bytes.readUInt16LE(cursor+30),commentLen=bytes.readUInt16LE(cursor+32),local=bytes.readUInt32LE(cursor+42),mode=bytes.readUInt32LE(cursor+38)>>>16;
    check(cursor+46+nameLen+extraLen+commentLen<=offset+size,'ZIP 条目超出边界');const nameBytes=bytes.subarray(cursor+46,cursor+46+nameLen),name=new TextDecoder(flags&2048?'utf-8':'latin1',{fatal:true}).decode(nameBytes);
    check(!(flags&1)&&bytes.readUInt16LE(cursor+34)===0&&length!==0xffffffff&&packed!==0xffffffff&&local!==0xffffffff,'不支持加密、多卷或 ZIP64 条目');
    expanded+=length;check(expanded<=64*1024*1024,'ZIP 解压大小超限');const directory=name.endsWith('/');check(safeName(directory?name.slice(0,-1):name),'ZIP 包含不安全路径');check((mode&0xf000)!==0xa000,'ZIP 不允许符号链接');
    if(!directory&&!name.startsWith('__MACOSX/')&&!name.split('/').some(part=>part.startsWith('.'))&&/\.gba$/i.test(name))candidates.push({name,nameBytes,flags,method,crc,packed,length,local});
    cursor+=46+nameLen+extraLen+commentLen;
  }
  check(cursor===offset+size&&candidates.length===1,'ZIP 必须恰好包含一个有效 .gba 文件');const entry=candidates[0];
  check(entry.length>=192&&entry.length<=MAX_ROM&&[0,8].includes(entry.method),'ZIP 中的 ROM 大小或压缩方法不支持');
  const at=entry.local;check(at+30<=offset&&bytes.readUInt32LE(at)===0x04034b50,'ZIP 本地文件头无效');const n=bytes.readUInt16LE(at+26),extra=bytes.readUInt16LE(at+28),start=at+30+n+extra;
  check(start+entry.packed<=offset&&bytes.subarray(at+30,at+30+n).equals(entry.nameBytes)&&bytes.readUInt16LE(at+6)===entry.flags&&bytes.readUInt16LE(at+8)===entry.method,'ZIP 本地头和中央目录不一致');
  const compressed=bytes.subarray(start,start+entry.packed),rom=entry.method===0?Buffer.from(compressed):inflateRawSync(compressed,{maxOutputLength:MAX_ROM});
  check(rom.length===entry.length&&crc32(rom)===entry.crc,'ZIP 长度或 CRC 校验失败');return {bytes:rom,member:entry.name};
}
export function inspectGba(bytes){
  check(bytes.length>=192&&bytes.length<=MAX_ROM,'ROM 必须为 192 字节至 32 MiB');check(bytes[0xb2]===0x96,'文件缺少有效 GBA 标头（可能仍是压缩包或其他格式）');
  const clean=(a,b)=>bytes.subarray(a,b).toString('ascii').replace(/\0/g,'').trim();let checksum=-0x19;for(let i=0xa0;i<=0xbc;i++)checksum-=bytes[i];
  return {title:clean(0xa0,0xac),gameCode:clean(0xac,0xb0),maker:clean(0xb0,0xb2),revision:bytes[0xbc],headerChecksumValid:(checksum&255)===bytes[0xbd],size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
}
export async function readRomSource(filename){const metadata=await lstat(filename);check(metadata.isFile()&&metadata.size>=4&&metadata.size<=MAX_ARCHIVE,'输入必须是普通、大小受限的 GBA/ZIP 文件');const raw=await readFile(filename);check(raw.length===metadata.size,'读取期间源文件发生变化');const archive=raw.readUInt32LE(0)===0x04034b50;const extracted=archive?extractGbaZip(raw):{bytes:raw,member:null};return {...extracted,archive,sourceSha256:createHash('sha256').update(raw).digest('hex'),metadata:inspectGba(extracted.bytes)};}
