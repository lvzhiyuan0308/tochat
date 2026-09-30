import { randomUUID } from 'node:crypto';
export const MAX_BODY_BYTES = 65536;
export const TYPES = new Set(['chat','ack','hello','agent.request','stream.begin','stream.chunk','stream.end','stream.error']);
export function envelope(t, body, id = randomUUID()) { return {v:1,id,t,ts:Date.now(),body}; }
export function validate(p) {
  if (!p || p.v !== 1 || !TYPES.has(p.t) || typeof p.id !== 'string' || p.id.length > 80 || !p.id || !Number.isSafeInteger(p.ts) || !p.body || typeof p.body !== 'object' || Array.isArray(p.body)) throw new Error('Invalid ToChat envelope');
  const b=p.body;
  if ((p.t==='chat'||p.t==='agent.request') && (typeof b.text!=='string'||!b.text.trim()||Buffer.byteLength(b.text)>16384)) throw new Error('Message must contain 1–16384 bytes');
  if(p.t==='ack' && (typeof b.id!=='string'||b.id.length>80))throw new Error('Invalid ACK');
  if(p.t.startsWith('stream.') && (typeof b.stream!=='string'||b.stream.length>80))throw new Error('Invalid stream');
  if(p.t==='stream.chunk' && (!Number.isSafeInteger(b.seq)||b.seq<0||b.seq>8192||typeof b.text!=='string'||Buffer.byteLength(b.text)>4096))throw new Error('Invalid stream chunk');
  if(p.t==='stream.end' && (!Number.isSafeInteger(b.total)||b.total<0||b.total>8192))throw new Error('Invalid stream end');
  return p;
}
export function packets(p) {
  validate(p);const raw=Buffer.from(JSON.stringify(p));if(raw.length>MAX_BODY_BYTES)throw new Error('Envelope too large');
  if(raw.length<=1372)return [raw.toString()];
  const total=Math.ceil(raw.length/750);
  return Array.from({length:total},(_,i)=>JSON.stringify({v:1,t:'fragment',id:p.id,i,n:total,data:raw.subarray(i*750,(i+1)*750).toString('base64')}));
}
export class Reassembler {
  constructor(){this.pending=new Map();}
  read(peer, raw, now=Date.now()) {
    if(Buffer.byteLength(raw)>1372)throw new Error('Oversize packet');
    for(const [key,value] of this.pending)if(now-value.time>60000)this.pending.delete(key);
    const p=JSON.parse(raw);if(p.t!=='fragment')return validate(p);
    if(p.v!==1||typeof p.id!=='string'||!p.id||p.id.length>80||!Number.isInteger(p.i)||!Number.isInteger(p.n)||p.n<2||p.n>88||p.i<0||p.i>=p.n||typeof p.data!=='string'||p.data.length>1000||!/^[A-Za-z0-9+/]*={0,2}$/.test(p.data))throw new Error('Invalid fragment');
    const key=peer+':'+p.id;let group=this.pending.get(key);
    if(!group){if(this.pending.size>=128)throw new Error('Too many unfinished packets');group={time:now,n:p.n,parts:new Map()};this.pending.set(key,group);}
    if(group.n!==p.n)throw new Error('Fragment count changed');group.parts.set(p.i,Buffer.from(p.data,'base64'));
    if(group.parts.size!==p.n)return null;
    this.pending.delete(key);const full=Buffer.concat(Array.from({length:p.n},(_,i)=>group.parts.get(i)));if(full.length>MAX_BODY_BYTES)throw new Error('Envelope too large');
    const decoded=validate(JSON.parse(full.toString('utf8')));if(decoded.id!==p.id)throw new Error('Fragment identity mismatch');return decoded;
  }
}
export function toxAddress(input) {
  const address=input.trim().replace(/^tox:/i,'').toUpperCase();
  if(!/^[0-9A-F]{76}$/.test(address))throw new Error('请输入 76 位 Tox ID，或 tox: 链接');
  const bytes=Buffer.from(address,'hex');let a=0,b=0;for(let i=0;i<36;i++)if(i%2)a^=bytes[i];else b^=bytes[i];
  if(bytes[36]!==b||bytes[37]!==a)throw new Error('Tox ID 校验失败，请检查是否完整');return address;
}
