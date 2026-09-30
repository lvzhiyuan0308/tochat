import test from 'node:test';
import assert from 'node:assert/strict';
import '../desktop/ui/markdown.js';
test('formats headings, paragraphs, lists and fenced code while retaining raw HTML as ordinary text',()=>{
  const blocks=globalThis.tochatMarkdown.parse('# 北京\n\n**首都**\n- 故宫\n- 天坛\n```js\n<script>evil()</script>\n```\n<img src=x onerror=evil()>');
  assert.deepEqual(blocks.map(b=>b.type),['heading','paragraph','list','list','code','paragraph']);assert.equal(blocks[4].text,'<script>evil()</script>');assert.equal(blocks[5].text,'<img src=x onerror=evil()>');
});
