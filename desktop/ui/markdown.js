// Deliberately small Markdown renderer: every untrusted value becomes a text
// node. Raw HTML, remote images and active content are never interpreted.
(() => {
  function parse(text){
    const blocks=[];let code=null,paragraph=[];
    const flush=()=>{if(paragraph.length){blocks.push({type:'paragraph',text:paragraph.join('\n')});paragraph=[];}};
    for(const line of text.split('\n')){
      if(/^\s*```/.test(line)){flush();if(code){blocks.push({type:'code',text:code.join('\n')});code=null;}else code=[];continue;}
      if(code){code.push(line);continue;}
      if(!line.trim()){flush();continue;}
      const heading=line.match(/^(#{1,6})\s+(.+)$/),list=line.match(/^\s*(?:[-*+]\s+|\d+\.\s+)(.+)$/),quote=line.match(/^>\s?(.*)$/);
      if(heading||list||quote){flush();blocks.push(heading?{type:'heading',level:heading[1].length,text:heading[2]}:list?{type:'list',text:list[1]}:{type:'quote',text:quote[1]});}
      else paragraph.push(line);
    }
    if(code)blocks.push({type:'code',text:code.join('\n')});flush();return blocks;
  }
  function inline(text){
    const result=document.createDocumentFragment();const parts=text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g);
    for(const part of parts){let node;
      if(part.startsWith('**')&&part.endsWith('**')){node=document.createElement('strong');node.textContent=part.slice(2,-2);}
      else if(part.startsWith('`')&&part.endsWith('`')){node=document.createElement('code');node.textContent=part.slice(1,-1);}
      else {const link=part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);if(link){node=document.createElement('a');node.textContent=link[1];node.href=link[2];node.target='_blank';node.rel='noopener noreferrer';}else node=document.createTextNode(part);}
      result.append(node);
    }
    return result;
  }
  function render(text){
    const result=document.createDocumentFragment();let list=null;
    for(const block of parse(text)){
      if(block.type==='list'){if(!list){list=document.createElement('ul');result.append(list);}const li=document.createElement('li');li.append(inline(block.text));list.append(li);continue;}
      list=null;const node=document.createElement(block.type==='heading'?'h'+Math.min(4,block.level+1):block.type==='code'?'pre':block.type==='quote'?'blockquote':'p');
      if(block.type==='code'){const code=document.createElement('code');code.textContent=block.text;node.append(code);}else node.append(inline(block.text));result.append(node);
    }
    return result;
  }
  globalThis.tochatMarkdown={parse,render};
})();
