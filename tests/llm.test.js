import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { completion } from '../desktop/src/llm.js';
test('OpenAI-compatible SSE decodes UTF-8 across TCP chunks',async()=>{
  const server=http.createServer((req,res)=>{assert.equal(req.url,'/v1/chat/completions');res.writeHead(200,{'Content-Type':'text/event-stream'});const data=Buffer.from('data: {"choices":[{"delta":{"content":"你好🙂"}}]}\r\n\r\ndata: [DONE]\n\n');for(const byte of data)res.write(Buffer.from([byte]));res.end();});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{let text='';for await(const delta of completion({baseURL:`http://127.0.0.1:${server.address().port}/v1`,model:'test',text:'hi'}))text+=delta;assert.equal(text,'你好🙂');}finally{server.close();}
});
test('joins a Unicode surrogate pair split across model deltas',async()=>{
  const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/event-stream'});for(const content of ['你\ud83d','\ude42好'])res.write('data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\n');res.end('data: [DONE]\n\n');});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{const chunks=[];for await(const delta of completion({baseURL:`http://127.0.0.1:${server.address().port}/v1`,model:'test',text:'hi'}))chunks.push(delta);assert.deepEqual(chunks,['你','🙂好']);}finally{server.close();}
});
