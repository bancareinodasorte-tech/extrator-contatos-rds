(() => {
  const $ = id => document.getElementById(id);
  let session = sessionStorage.getItem('rds_extrator_session') || '';
  let contacts = [];
  let canExport = false;
  const setStatus = (message, bad=false) => { $('status').textContent=message; $('status').style.color=bad?'#ff9b9b':''; };
  const setProgress = message => $('progress').textContent=message;
  const appState = text => $('appState').textContent=text;
  async function api(url, options={}) {
    const headers={'Content-Type':'application/json',...(options.headers||{})};
    if(session)headers['X-Extrator-Session']=session;
    const response=await fetch(url,{...options,headers});
    let data;try{data=await response.json();}catch{throw new Error('Resposta inválida do servidor.');}
    if(!response.ok||data.success===false)throw new Error(data.message||('Falha HTTP '+response.status));
    return data;
  }
  function loggedIn(on) {
    $('draws').disabled=!on;$('seller').disabled=!on;$('reloadBtn').disabled=!on;$('extractBtn').disabled=!on;
    $('logoutBtn').hidden=!on;$('loginBtn').disabled=on;$('email').disabled=on;$('password').disabled=on;
    appState(on?'Conectado':'Aguardando login');
  }
  async function loadDraws() {
    setStatus('Buscando os sorteios disponíveis na conta oficial…');
    const result=await api('/api/draws');const draws=result.draws||[];const select=$('draws');select.replaceChildren();
    for(const d of draws){
      const id=d.id??d.draw_id??d.drawId;if(id===undefined||id===null)continue;
      const option=document.createElement('option');option.value=String(id);
      option.textContent='#'+id+' — '+(d.title||d.name||d.description||('Sorteio '+id))+(d.draw_date?' · '+new Date(d.draw_date).toLocaleDateString('pt-BR'):'')+(d.draw_status?' · '+d.draw_status:'');
      select.appendChild(option);
    }
    if(!select.options.length){const o=document.createElement('option');o.textContent='Nenhum sorteio retornado pela API';select.appendChild(o);setStatus('A API autenticou, mas não retornou sorteios para esta conta.',true);}
    else setStatus('Conectado. '+select.options.length+' sorteio(s) carregado(s).');
    setProgress('Selecione um ou mais sorteios. Opcionalmente, filtre pelo nome do vendedor.');
  }
  async function login() {
    const email=$('email').value.trim(),password=$('password').value;
    if(!email||!password)return setStatus('Informe o e-mail e a senha da conta oficial.',true);
    $('loginBtn').disabled=true;setStatus('Autenticando na API oficial da Reino da Sorte…');
    try{const result=await api('/api/login',{method:'POST',body:JSON.stringify({email,password})});session=result.session;sessionStorage.setItem('rds_extrator_session',session);$('password').value='';loggedIn(true);await loadDraws();}
    catch(e){session='';sessionStorage.removeItem('rds_extrator_session');loggedIn(false);setStatus(e.message,true);}
    finally{$('loginBtn').disabled=false;}
  }
  async function logout(){try{if(session)await api('/api/logout',{method:'POST',body:'{}'});}catch{}session='';sessionStorage.removeItem('rds_extrator_session');contacts=[];canExport=false;$('draws').replaceChildren();$('ticketsCount').textContent='0';$('contactsCount').textContent='0';$('errorsCount').textContent='0';$('vcfBtn').disabled=true;$('csvBtn').disabled=true;loggedIn(false);setStatus('Sessão encerrada. Entre novamente para extrair contatos.');setProgress('Aguardando autenticação.');}
  async function extract(){
    const drawIds=[...$('draws').selectedOptions].map(o=>o.value);if(!drawIds.length)return setProgress('Selecione ao menos um sorteio.');
    contacts=[];canExport=false;$('vcfBtn').disabled=true;$('csvBtn').disabled=true;$('extractBtn').disabled=true;$('reloadBtn').disabled=true;
    $('ticketsCount').textContent='…';$('contactsCount').textContent='…';$('errorsCount').textContent='…';setProgress('Extração em andamento. O servidor está percorrendo lotes e páginas; não feche esta página.');
    try{const r=await api('/api/extract',{method:'POST',body:JSON.stringify({drawIds,seller:$('seller').value.trim()})});
      $('ticketsCount').textContent=Number(r.ticketsRead||0).toLocaleString('pt-BR');$('errorsCount').textContent=(r.errors||[]).length.toLocaleString('pt-BR');
      if(!r.success||(r.errors||[]).length){setProgress((r.message||'A extração teve falhas.')+'\n'+(r.errors||[]).slice(0,8).join('\n'));return;}
      contacts=r.contacts||[];canExport=true;$('contactsCount').textContent=contacts.length.toLocaleString('pt-BR');$('vcfBtn').disabled=!contacts.length;$('csvBtn').disabled=!contacts.length;
      setProgress('Concluído sem falhas: '+Number(r.ticketsRead||0).toLocaleString('pt-BR')+' bilhetes lidos e '+contacts.length.toLocaleString('pt-BR')+' contatos únicos com telefone válido.');
    }catch(e){$('ticketsCount').textContent='—';$('contactsCount').textContent='—';$('errorsCount').textContent='1';setProgress('Falha: '+e.message+'\nExportação bloqueada para evitar arquivo incompleto.');}
    finally{$('extractBtn').disabled=false;$('reloadBtn').disabled=false;}
  }
  function download(name,type,content){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function vcfEscape(s){return String(s||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');}
  $('loginBtn').addEventListener('click',login);$('password').addEventListener('keydown',e=>{if(e.key==='Enter')login();});$('email').addEventListener('keydown',e=>{if(e.key==='Enter')login();});$('logoutBtn').addEventListener('click',logout);
  $('reloadBtn').addEventListener('click',()=>loadDraws().catch(e=>setStatus(e.message,true)));$('extractBtn').addEventListener('click',extract);
  $('vcfBtn').addEventListener('click',()=>{if(!canExport||!contacts.length)return;const data=contacts.map(c=>'BEGIN:VCARD\r\nVERSION:3.0\r\nN:'+vcfEscape(c.name)+';;;;\r\nFN:'+vcfEscape(c.name)+'\r\nTEL;TYPE=CELL:'+c.phone+'\r\nEND:VCARD').join('\r\n')+'\r\n';download('contatos-reino-da-sorte.vcf','text/vcard;charset=utf-8',data);});
  $('csvBtn').addEventListener('click',()=>{if(!canExport||!contacts.length)return;const esc=s=>'"'+String(s||'').replace(/"/g,'""')+'"';download('contatos-reino-da-sorte.csv','text/csv;charset=utf-8','\uFEFFNome,Telefone\r\n'+contacts.map(c=>esc(c.name)+','+esc(c.phone)).join('\r\n'));});
  if(session){loggedIn(true);loadDraws().catch(e=>{session='';sessionStorage.removeItem('rds_extrator_session');loggedIn(false);setStatus(e.message,true);});}else loggedIn(false);
})();