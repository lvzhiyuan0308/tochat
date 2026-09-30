import { open,stat } from 'node:fs/promises';
export async function imageMime(filename){
  const s=await stat(filename);if(!s.isFile()||s.size>8*1024*1024)throw new Error('预览仅支持 8 MB 以内的图片');
  const f=await open(filename,'r');const bytes=Buffer.alloc(12);try{await f.read(bytes,0,12,0);}finally{await f.close();}
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
  if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
  if(['GIF87a','GIF89a'].includes(bytes.subarray(0,6).toString()))return 'image/gif';
  if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return 'image/webp';
  throw new Error('此文件不支持图片预览');
}
