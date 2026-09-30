import test from 'node:test';
import assert from 'node:assert/strict';
import { envelope, packets, Reassembler, toxAddress } from '../protocol/envelope.js';
test('UTF-8 fragments survive reordering, duplicates and peer isolation',()=>{
  const p=envelope('chat',{text:'中文🙂'.repeat(1000)});const wire=packets(p);assert.ok(wire.length>1);assert.ok(wire.every(s=>Buffer.byteLength(s)<=1372));
  const r=new Reassembler();assert.equal(r.read('other',wire[0]),null);assert.equal(r.read('peer',wire[0]),null);assert.equal(r.read('peer',wire[0]),null);
  let full;for(const packet of wire.slice(1).reverse())full=r.read('peer',packet);assert.deepEqual(full,p);
});
test('rejects malformed and expired assemblies',()=>{
  const r=new Reassembler();assert.throws(()=>r.read('p',JSON.stringify({v:1,t:'fragment',id:'x',i:0,n:999,data:''})));
  const p=envelope('chat',{text:'a'.repeat(3000)}),wire=packets(p);r.read('p',wire[0],0);assert.equal(r.read('p',wire[1],60001),null);assert.equal(r.pending.size,1);
});
test('validates Tox ID checksum',()=>{
  const pk='01'.repeat(36),addr=pk+'0000';assert.equal(toxAddress('tox:'+addr.toLowerCase()),addr);assert.throws(()=>toxAddress(addr.slice(0,-1)+'1'));
});
