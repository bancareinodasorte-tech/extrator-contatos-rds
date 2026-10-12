(() => {
  const API_BASE = 'https://extrator-contatos-rds-api.onrender.com';
  const $ = id => document.getElementById(id);
  let session = localStorage.getItem('rds_extrator_session') || sessionStorage.getItem('rds_extrator_session') || '';
  let contacts = [];
  let canExport = false;
  let sellers = [];
  let sellerDrawSignature = '';
  const normalizeSellerName = name => String(name||'').replace(/\uFFFD/g,'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLocaleUpperCase('pt-BR');
  function updateSelectionSummary(){const draws=[...$('draws').selectedOptions].length;const options=[...document.querySelectorAll('#sellerCheckboxes input.seller-option')];const selected=options.filter(o=>o.checked).length;const total=sellers.length||options.length;$('selectionSummary').textContent=draws+' sorteio(s) selecionado(s) · '+total+' vendedores ativos · '+selected+' selecionado(s) · Total '+selected+'/'+total;}
  const setStatus = (message, bad=false) => { $('status').textContent=message; $('status').style.color=bad?'#ff9b9b':''; };
  const setProgress = message => $('progress').textContent=message;
  const appState = text => $('appState').textContent=text;
  async function api(url, options={}) {
    const headers={'Content-Type':'application/json',...(options.headers||{})};
    if(session)headers['X-Extrator-Session']=session;
    const response=await fetch(API_BASE+url,{...options,headers});
    let data;try{data=await response.json();}catch{throw new Error('Resposta inválida do servidor.');}
    if(!response.ok||data.success===false)throw new Error(data.message||('Falha HTTP '+response.status));
    return data;
  }
  function loggedIn(on) {
    $('draws').disabled=!on;$('reloadBtn').disabled=!on;$('extractBtn').disabled=!on;$('selectAllDraws').disabled=!on;$('clearDraws').disabled=!on;
    $('logoutBtn').hidden=!on;$('loginBtn').disabled=on;$('email').disabled=on;$('password').disabled=on;
    appState(on?'Conectado':'Aguardando login');
  }
  async function loadDraws() {
    setStatus('Buscando os sorteios disponíveis na conta oficial…');
    const result=await api('/api/draws');const draws=(result.draws||[]).filter(d=>String(d.draw_status||d.status||'').toLowerCase()==='finalized');const select=$('draws');select.replaceChildren();
    for(const d of draws){
      const id=d.id??d.draw_id??d.drawId;if(id===undefined||id===null)continue;
      const option=document.createElement('option');option.value=String(id);
      option.textContent='#'+id+' — '+(d.title||d.name||d.description||('Sorteio '+id))+(d.draw_date?' · '+new Date(d.draw_date).toLocaleDateString('pt-BR'):'')+(d.draw_status?' · '+d.draw_status:'');
      select.appendChild(option);
    }
    if(!select.options.length){const o=document.createElement('option');o.textContent='Nenhum sorteio finalizado disponível';select.appendChild(o);setStatus('A API não retornou sorteios finalizados para esta conta.',true);}
    else setStatus('Conectado. '+select.options.length+' sorteio(s) carregado(s).');
    $('sellerCheckboxes').replaceChildren();sellers=[];sellerDrawSignature='';$('sellerInfo').textContent='Escolha um ou mais sorteios acima para listar os vendedores participantes.';
    setProgress('Selecione um ou mais sorteios. Os vendedores participantes serão carregados automaticamente.');
    if(select.options.length){select.selectedIndex=-1;updateSelectionSummary();}
  }
  async function loadSellers(){
    const drawIds=[...$('draws').selectedOptions].map(o=>o.value);const signature=[...drawIds].sort().join(',');const list=$('sellerCheckboxes');list.replaceChildren();sellers=[];sellerDrawSignature=signature;updateSelectionSummary();
    if(!drawIds.length){list.innerHTML='<p class="muted">Selecione ao menos um sorteio finalizado.</p>';$('sellerInfo').textContent='Selecione ao menos um sorteio finalizado.';return;}
    $('reloadSellers').disabled=true;$('selectAllSellers').disabled=true;$('clearSellers').disabled=true;$('sellerInfo').textContent='Consultando todos os lotes e páginas para encontrar os vendedores…';
    try{const started=await api('/api/sellers?drawIds='+encodeURIComponent(signature));let status=started;const startedAt=Date.now();
      while(status.status==='running'){$('sellerInfo').textContent=(status.current||status.message||'Buscando vendedores…')+' · '+(status.pagesDone||0)+' páginas consultadas';if(Date.now()-startedAt>12*60*1000)throw new Error('A consulta demorou mais que o esperado. Use “Atualizar vendedores” para tentar novamente.');await new Promise(resolve=>setTimeout(resolve,1500));status=await api('/api/sellers/status?id='+encodeURIComponent(started.jobId));}
      if(status.status!=='complete')throw new Error(status.message||'Não foi possível concluir a consulta.');const unique=new Map();for(const item of (status.sellers||[])){const key=normalizeSellerName(item.name);if(!key)continue;const previous=unique.get(key);if(!previous||String(item.name).length>String(previous.name).length)unique.set(key,item);}sellers=[...unique.values()].sort((x,y)=>x.name.localeCompare(y.name,'pt-BR'));
      if(!sellers.length){list.innerHTML='<p class="muted">Nenhum vendedor encontrado.</p>';$('sellerInfo').textContent=status.message||'A API não retornou vendedores para este sorteio.';return;}
      for(const s of sellers){const label=document.createElement('label');label.className='seller-check';const input=document.createElement('input');input.type='checkbox';input.value=normalizeSellerName(s.name);input.dataset.sellerName=s.name;input.className='seller-option';const name=document.createElement('span');name.textContent=s.name;label.append(input,name);list.appendChild(label);}updateSelectionSummary();
      $('sellerInfo').textContent=sellers.length+' vendedor(es) encontrado(s). Marque as caixas dos vendedores desejados. Se nenhuma caixa for marcada, serão incluídos todos.'+(status.errors?.length?' Atenção: houve falhas parciais; atualize antes de extrair.':'');
    }catch(e){$('sellerInfo').textContent='Não foi possível carregar a lista completa: '+e.message;}
    finally{$('reloadSellers').disabled=false;$('selectAllSellers').disabled=false;$('clearSellers').disabled=false;}
  }
  async function login() {
    const email=$('email').value.trim(),password=$('password').value;
    if($('rememberPassword').checked){localStorage.setItem('rds_extrator_email',email);localStorage.setItem('rds_extrator_password',password);}else{localStorage.removeItem('rds_extrator_email');localStorage.removeItem('rds_extrator_password');}
    if(!email||!password)return setStatus('Informe o e-mail e a senha da conta oficial.',true);
    $('loginBtn').disabled=true;setStatus('Autenticando na API oficial da Reino da Sorte…');
    try{const result=await api('/api/login',{method:'POST',body:JSON.stringify({email,password})});session=result.session;localStorage.setItem('rds_extrator_session',session);$('password').value='';loggedIn(true);await loadDraws();}
    catch(e){session='';sessionStorage.removeItem('rds_extrator_session');localStorage.removeItem('rds_extrator_session');loggedIn(false);setStatus(e.message,true);}
    finally{$('loginBtn').disabled=false;}
  }
  async function logout(){try{if(session)await api('/api/logout',{method:'POST',body:'{}'});}catch{}session='';sessionStorage.removeItem('rds_extrator_session');localStorage.removeItem('rds_extrator_session');contacts=[];canExport=false;sellers=[];$('sellerCheckboxes').replaceChildren();$('draws').replaceChildren();$('ticketsCount').textContent='0';$('contactsCount').textContent='0';$('errorsCount').textContent='0';$('vcfBtn').disabled=true;$('csvBtn').disabled=true;$('previewBtn').disabled=true;$('previewBtn').hidden=true;$('previewPanel').classList.add('hidden');loggedIn(false);setStatus('Sessão encerrada. Entre novamente para extrair contatos.');setProgress('Aguardando autenticação.');}
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  async function extract(){
    const drawIds=[...$('draws').selectedOptions].map(o=>o.value);if(!drawIds.length)return setProgress('Selecione ao menos um sorteio.');
    contacts=[];canExport=false;$('vcfBtn').disabled=true;$('csvBtn').disabled=true;$('previewBtn').disabled=true;$('previewBtn').hidden=true;$('previewPanel').classList.add('hidden');$('extractBtn').disabled=true;$('reloadBtn').disabled=true;
    $('ticketsCount').textContent='0';$('contactsCount').textContent='0';$('errorsCount').textContent='0';
    setProgress('Iniciando extração segura em segundo plano…');
    try{
      const started=await api('/api/extract',{method:'POST',body:JSON.stringify({drawIds,sellerNames:[...document.querySelectorAll('#sellerCheckboxes input.seller-option:checked')].map(o=>o.dataset.sellerName)})});
      let result;
      do{
        await sleep(1800);
        result=await api('/api/extract/status?id='+encodeURIComponent(started.jobId));
        $('ticketsCount').textContent=Number(result.ticketsRead||0).toLocaleString('pt-BR');
        $('errorsCount').textContent=(result.errors||[]).length.toLocaleString('pt-BR');
        setProgress((result.message||'Extração em andamento.')+'\n'+(result.current||'')+'\nPáginas processadas: '+Number(result.pagesDone||0).toLocaleString('pt-BR')+' · Bilhetes vendidos analisados: '+Number(result.ticketsRead||0).toLocaleString('pt-BR'));
      }while(result.status==='running');
      if(result.status!=='complete'||(result.errors||[]).length){setProgress((result.message||'A extração teve falhas.')+'\n'+(result.errors||[]).slice(0,8).join('\n'));return;}
      contacts=result.contacts||[];canExport=true;$('contactsCount').textContent=contacts.length.toLocaleString('pt-BR');
      $('vcfBtn').disabled=!contacts.length;$('csvBtn').disabled=!contacts.length;$('previewBtn').disabled=!contacts.length;$('previewBtn').hidden=!contacts.length;
      setProgress('Concluído sem falhas: '+Number(result.ticketsRead||0).toLocaleString('pt-BR')+' bilhetes vendidos analisados e '+contacts.length.toLocaleString('pt-BR')+' contatos únicos com telefone válido.');
    }catch(e){$('errorsCount').textContent='1';setProgress('Falha: '+e.message+'\nExportação bloqueada para evitar arquivo incompleto.');}
    finally{$('extractBtn').disabled=false;$('reloadBtn').disabled=false;}
  }
  function download(name,type,content){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function vcfEscape(s){return String(s||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');}
  $('togglePassword').addEventListener('click',()=>{const p=$('password');const show=p.type==='password';p.type=show?'text':'password';$('togglePassword').textContent=show?'Ocultar':'Mostrar';$('togglePassword').setAttribute('aria-pressed',String(show));});
  $('rememberPassword').addEventListener('change',()=>{if(!$('rememberPassword').checked){localStorage.removeItem('rds_extrator_email');localStorage.removeItem('rds_extrator_password');}});
  $('loginBtn').addEventListener('click',login);$('password').addEventListener('keydown',e=>{if(e.key==='Enter')login();});$('email').addEventListener('keydown',e=>{if(e.key==='Enter')login();});$('logoutBtn').addEventListener('click',logout);
  $('reloadBtn').addEventListener('click',()=>loadDraws().catch(e=>setStatus(e.message,true)));$('extractBtn').addEventListener('click',extract);
  $('selectAllDraws').addEventListener('click',()=>{[...$('draws').options].forEach(o=>o.selected=true);loadSellers();});$('clearDraws').addEventListener('click',()=>{[...$('draws').options].forEach(o=>o.selected=false);loadSellers();});
  $('draws').addEventListener('change',()=>loadSellers());$('reloadSellers').addEventListener('click',()=>loadSellers());
  $('sellerCheckboxes').addEventListener('change',updateSelectionSummary);
  $('selectAllSellers').addEventListener('click',()=>{document.querySelectorAll('#sellerCheckboxes input.seller-option').forEach(o=>o.checked=true);updateSelectionSummary();});$('clearSellers').addEventListener('click',()=>{document.querySelectorAll('#sellerCheckboxes input.seller-option').forEach(o=>o.checked=false);updateSelectionSummary();});
  $('previewBtn').addEventListener('click',()=>renderPreview());$('closePreview').addEventListener('click',()=> $('previewPanel').classList.add('hidden'));$('previewSearch').addEventListener('input',()=>renderPreview());
  function renderPreview(){if(!canExport)return;const query=$('previewSearch').value.trim().toLocaleUpperCase('pt-BR');const filtered=contacts.filter(c=>!query||(c.name+' '+c.phone).toLocaleUpperCase('pt-BR').includes(query));$('previewTotal').textContent=filtered.length.toLocaleString('pt-BR')+' contato(s) exibido(s) de '+contacts.length.toLocaleString('pt-BR');const tbody=$('previewRows');tbody.replaceChildren();for(const c of filtered){const tr=document.createElement('tr');const tdName=document.createElement('td');tdName.textContent=c.name;const tdPhone=document.createElement('td');tdPhone.textContent=c.phone;tr.append(tdName,tdPhone);tbody.appendChild(tr);}$('previewPanel').classList.remove('hidden');}
  $('vcfBtn').addEventListener('click',()=>{if(!canExport||!contacts.length)return;const data=contacts.map(c=>'BEGIN:VCARD\r\nVERSION:3.0\r\nN:'+vcfEscape(c.name)+';;;;\r\nFN:'+vcfEscape(c.name)+'\r\nTEL;TYPE=CELL:+55'+c.phone+'\r\nEND:VCARD').join('\r\n')+'\r\n';download('contatos-reino-da-sorte.vcf','text/vcard;charset=utf-8',data);});
  $('csvBtn').addEventListener('click',()=>{if(!canExport||!contacts.length)return;const esc=s=>'"'+String(s||'').replace(/"/g,'""')+'"';download('contatos-reino-da-sorte.csv','text/csv;charset=utf-8','\uFEFFNome,Telefone\r\n'+contacts.map(c=>esc(c.name)+','+esc(c.phone)).join('\r\n'));});
  if(localStorage.getItem('rds_extrator_email')){$('email').value=localStorage.getItem('rds_extrator_email');$('rememberPassword').checked=true;}
  if(localStorage.getItem('rds_extrator_password'))$('password').value=localStorage.getItem('rds_extrator_password');
  if(session){loggedIn(true);loadDraws().catch(e=>{session='';sessionStorage.removeItem('rds_extrator_session');localStorage.removeItem('rds_extrator_session');loggedIn(false);setStatus(e.message,true);});}else loggedIn(false);
})();