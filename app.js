(() => {
  const API_BASE = 'https://extrator-contatos-rds-api.onrender.com';
  const $ = id => document.getElementById(id);
  let session = localStorage.getItem('rds_extrator_session') || sessionStorage.getItem('rds_extrator_session') || '';
  let contacts = [];
  let canExport = false;
  let sellers = [];
  let sellerDrawSignature = '';
  let workflowStage='draws';
  let activeExtractionJob=localStorage.getItem('rds_extrator_active_job')||'';
  const normalizeSellerName = name => String(name||'').replace(/\uFFFD/g,'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLocaleUpperCase('pt-BR');
  function updateSelectionSummary(){const draws=[...$('draws').selectedOptions].length;const options=[...document.querySelectorAll('#sellerCheckboxes input.seller-option')];const selected=options.filter(o=>o.checked).length;const total=sellers.length||options.length;$('selectionSummary').textContent=draws+' sorteio(s) selecionado(s) · '+total+' vendedores ativos · '+selected+' selecionado(s) · Total '+selected+'/'+total;}
  const refreshApp = async () => {
    const button=$('refreshAppBtn');
    if(button){button.disabled=true;button.textContent='Atualizando…';}
    try {
      if('serviceWorker' in navigator){
        const registration=await navigator.serviceWorker.getRegistration();
        if(registration){
          await registration.update().catch(()=>{});
          if(registration.waiting){registration.waiting.postMessage({type:'SKIP_WAITING'});}
        }
      }
      window.location.reload();
    } catch {
      window.location.reload();
    }
  };
  $('refreshAppBtn')?.addEventListener('click',refreshApp);
  const setStatus = (message, bad=false) => { $('status').textContent=message; $('status').style.color=bad?'#ff9b9b':''; };
  const setProgress = message => $('progress').textContent=message;
  function setWorkflow(stage){workflowStage=stage;$('extractBtn').textContent=stage==='sellers'?'Carregar vendedores':stage==='extract'?'Iniciar extração':'Carregar vendedores';$('extractBtn').disabled=['draws','loading-sellers','extracting'].includes(stage);$('draws').disabled=['loading-sellers','extracting'].includes(stage);$('reloadBtn').disabled=['loading-sellers','extracting'].includes(stage);$('reloadSellers').disabled=stage!=='extract';$('selectAllSellers').disabled=stage!=='extract';$('clearSellers').disabled=stage!=='extract';}
  const appState = text => $('appState').textContent=text;
  async function api(url, options={}) {
    const headers={'Content-Type':'application/json',...(options.headers||{})};
    if(session)headers['X-Extrator-Session']=session;
    const retryable=(options.method||'GET')==='GET'||!!headers['X-Extrator-Request-Id'];
    let response,lastError;
    const maxAttempts=retryable?14:1;
    for(let attempt=0;attempt<maxAttempts;attempt++){
      try{response=await fetch(API_BASE+url,{...options,headers});break;}
      catch(e){lastError=e;if(attempt<maxAttempts-1){
        const delay=Math.min(1500*(attempt+1),8000);
        if(attempt===0||attempt===3||attempt===7) setStatus('Reconectando ao servidor do Extrator… tentativa '+(attempt+2)+'/'+maxAttempts);
        await new Promise(resolve=>setTimeout(resolve,delay));
      }}
    }
    if(!response)throw new Error('Não foi possível alcançar o servidor do Extrator após tentativas de reconexão. Verifique a conexão e tente novamente. Detalhe: '+(lastError?.message||'falha de rede'));
    let data;try{data=await response.json();}catch{throw new Error('O servidor respondeu sem JSON válido (HTTP '+response.status+'). Tente novamente em instantes.');}
    if(!response.ok||data.success===false)throw new Error(data.message||('Falha HTTP '+response.status));
    return data;
  }
  function loggedIn(on) {
    $('draws').disabled=!on;$('reloadBtn').disabled=!on;$('extractBtn').disabled=!on;$('selectAllDraws').disabled=!on;$('clearDraws').disabled=!on;
    $('logoutBtn').hidden=!on;$('loginBtn').disabled=on;$('email').disabled=on;$('password').disabled=on;
    appState(on?'Conectado':'Aguardando login');$('extractBtn').textContent='Iniciar extração';
  }
  async function loadDraws() {
    setStatus('Buscando os sorteios disponíveis na conta oficial…');
    const result=await api('/api/draws');const draws=(result.draws||[]).filter(d=>String(d.draw_status||d.status||'').toLowerCase()==='finalized');const select=$('draws');$('drawsLabel').textContent='Sorteios finalizados disponíveis ('+draws.length+')';select.replaceChildren();
    for(const d of draws){
      const id=d.id??d.draw_id??d.drawId;if(id===undefined||id===null)continue;
      const option=document.createElement('option');option.value=String(id);
      option.textContent='#'+id+' — '+(d.title||d.name||d.description||('Sorteio '+id))+(d.draw_date?' · '+new Date(d.draw_date).toLocaleDateString('pt-BR'):'')+(d.draw_status?' · '+d.draw_status:'');
      select.appendChild(option);
    }
    if(!select.options.length){const o=document.createElement('option');o.textContent='Nenhum sorteio finalizado disponível';select.appendChild(o);setStatus('A API não retornou sorteios finalizados para esta conta.',true);}
    else setStatus('Conectado. '+select.options.length+' sorteio(s) carregado(s).');
    $('sellerCheckboxes').replaceChildren();sellers=[];sellerDrawSignature='';$('sellerInfo').textContent='Escolha um ou mais sorteios acima para listar os vendedores participantes.';
    setProgress('Selecione os sorteios desejados e, depois, toque em “Iniciar extração”. Nenhuma leitura será iniciada automaticamente.');
    if(select.options.length){for(const option of select.options)option.selected=false;select.selectedIndex=-1;updateSelectionSummary();}$('drawsLabel').textContent='Sorteios finalizados disponíveis ('+select.options.length+')';setWorkflow('draws');
  }
  async function loadSellers(){
    const drawIds=[...$('draws').selectedOptions].map(o=>o.value);const signature=[...drawIds].sort().join(',');const list=$('sellerCheckboxes');list.replaceChildren();sellers=[];sellerDrawSignature=signature;updateSelectionSummary();
    if(!drawIds.length){list.innerHTML='<p class="muted">Selecione ao menos um sorteio finalizado.</p>';$('sellerInfo').textContent='Selecione ao menos um sorteio finalizado.';return;}
    if(drawIds.length>20){$('sellerInfo').textContent='Selecione no máximo 20 sorteios por consulta.';return;}
    setWorkflow('loading-sellers');const unique=new Map();const warnings=[];const batches=[];for(let i=0;i<drawIds.length;i+=3)batches.push(drawIds.slice(i,i+3));
    try{
      for(let batchIndex=0;batchIndex<batches.length;batchIndex++){
        const batch=batches[batchIndex];$('sellerInfo').textContent='Etapa 2 de 3 · grupo '+(batchIndex+1)+'/'+batches.length+' · consultando '+batch.length+' sorteio(s)…';
        const started=await api('/api/sellers?drawIds='+encodeURIComponent(batch.join(',')));let status=started;const startedAt=Date.now();
        while(status.status==='running'){
          $('sellerInfo').textContent='Grupo '+(batchIndex+1)+'/'+batches.length+' · '+(status.current||status.message||'Buscando vendedores…')+' · '+(status.pagesDone||0)+' páginas consultadas neste grupo';
          if(Date.now()-startedAt>45*60*1000)throw new Error('O grupo '+(batchIndex+1)+' ultrapassou 45 minutos. Nenhuma extração de contatos foi iniciada. Tente novamente com menos sorteios.');
          await new Promise(resolve=>setTimeout(resolve,1500));status=await api('/api/sellers/status?id='+encodeURIComponent(started.jobId));
        }
        if(status.status!=='complete')throw new Error('Falha no grupo '+(batchIndex+1)+': '+(status.message||'não foi possível concluir a consulta.'));
        for(const item of (status.sellers||[])){const key=String(item.id||item.ids?.[0]||item.name);if(key&&item.name&&!unique.has(key))unique.set(key,{...item,id:key});}
        if(status.errors?.length)warnings.push(...status.errors);
      }
      sellers=[...unique.values()].sort((x,y)=>x.name.localeCompare(y.name,'pt-BR')||String(x.id).localeCompare(String(y.id)));
      if(!sellers.length){list.innerHTML='<p class="muted">Nenhum vendedor encontrado.</p>';$('sellerInfo').textContent='A consulta terminou, mas não retornou vendedores. Verifique os sorteios selecionados.';return;}
      for(const s of sellers){const label=document.createElement('label');label.className='seller-check';const input=document.createElement('input');input.type='checkbox';input.value=String(s.id);input.dataset.sellerId=String(s.id);input.dataset.sellerName=s.name;input.className='seller-option';const name=document.createElement('span');name.textContent=s.name;label.append(input,name);list.appendChild(label);}updateSelectionSummary();
      $('sellerInfo').textContent=sellers.length+' vendedores/canais encontrados em '+drawIds.length+' sorteio(s). Identidades distintas são mantidas mesmo quando os nomes coincidem. Marque os desejados e toque em “Iniciar extração”.'+(warnings.length?' Atenção: a consulta informou '+warnings.length+' ocorrência(s) de falha parcial; confira a lista antes de extrair.':' Consulta concluída.');
      setWorkflow('extract');
    }catch(e){$('sellerInfo').textContent='Não foi possível carregar a lista completa: '+e.message;}
    finally{if(workflowStage==='loading-sellers')setWorkflow('sellers');}
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
    const drawIds=[...$('draws').selectedOptions].map(o=>o.value);if(!drawIds.length)return setProgress('Selecione ao menos um sorteio.');if(workflowStage==='draws')return setProgress('Selecione os sorteios desejados e toque em “Carregar vendedores”.');if(workflowStage==='sellers'){await loadSellers();return;}if(workflowStage!=='extract')return;
    contacts=[];canExport=false;setWorkflow('extracting');$('vcfBtn').disabled=true;$('csvBtn').disabled=true;$('previewBtn').disabled=true;$('previewBtn').hidden=true;$('previewPanel').classList.add('hidden');$('extractBtn').disabled=true;$('reloadBtn').disabled=true;
    $('ticketsCount').textContent='0';$('contactsCount').textContent='0';$('errorsCount').textContent='0';
    setProgress('Extração solicitada manualmente. Iniciando leitura dos sorteios e vendedores selecionados…');
    try{
      const selectedSellerInputs=[...document.querySelectorAll('#sellerCheckboxes input.seller-option:checked')];if(!selectedSellerInputs.length){setProgress('Marque ao menos um vendedor antes de iniciar a extração.');return;}setProgress('Verificando conexão com o servidor…');await api('/api/health');setProgress('Conexão confirmada. Iniciando extração…');const requestId=localStorage.getItem('rds_extrator_start_request')||('rds-'+Date.now()+'-'+Math.random().toString(36).slice(2));localStorage.setItem('rds_extrator_start_request',requestId);const started=await api('/api/extract',{method:'POST',headers:{'X-Extrator-Request-Id':requestId},body:JSON.stringify({drawIds,sellerIds:selectedSellerInputs.map(o=>o.dataset.sellerId),sellerNames:[]})});localStorage.removeItem('rds_extrator_start_request');activeExtractionJob=started.jobId;localStorage.setItem('rds_extrator_active_job',activeExtractionJob);if(started.resumeToken)localStorage.setItem('rds_extrator_resume_token',started.resumeToken);
      let result;
      do{
        await sleep(1800);
        try {
          result=await api('/api/extract/status?id='+encodeURIComponent(started.jobId),{headers:{'X-Extrator-Resume':localStorage.getItem('rds_extrator_resume_token')||''}});
        } catch(pollError) {
          let recovered=false;
          for(let retry=1;retry<=8;retry++){
            setProgress('Conexão temporariamente instável. Tentativa de retomada '+retry+'/8…\nA extração não será marcada como falha por uma interrupção momentânea.');
            await sleep(Math.min(retry*1800,9000));
            try { result=await api('/api/extract/status?id='+encodeURIComponent(started.jobId),{headers:{'X-Extrator-Resume':localStorage.getItem('rds_extrator_resume_token')||''}}); recovered=true; break; }
            catch(retryError) { pollError=retryError; }
          }
          if(!recovered) throw new Error('Não foi possível restabelecer a consulta após 8 tentativas. Reabra o aplicativo e verifique se a extração ainda está ativa. Detalhe: '+pollError.message);
        }
        $('ticketsCount').textContent=Number(result.ticketsRead||0).toLocaleString('pt-BR');
        $('errorsCount').textContent=(result.errors||[]).length.toLocaleString('pt-BR');
        setProgress((result.message||'Extração em andamento.')+'\n'+(result.current||'')+'\nPáginas processadas: '+Number(result.pagesDone||0).toLocaleString('pt-BR')+' · Bilhetes vendidos analisados: '+Number(result.ticketsRead||0).toLocaleString('pt-BR'));
      }while(result.status==='running');activeExtractionJob='';localStorage.removeItem('rds_extrator_active_job');localStorage.removeItem('rds_extrator_resume_token');
      if(result.status!=='complete'||(result.errors||[]).length){setProgress((result.message||'A extração teve falhas.')+'\n'+(result.errors||[]).slice(0,8).join('\n'));return;}
      contacts=result.contacts||[];canExport=true;$('contactsCount').textContent=contacts.length.toLocaleString('pt-BR');
      $('vcfBtn').disabled=!contacts.length;$('csvBtn').disabled=!contacts.length;$('previewBtn').disabled=!contacts.length;$('previewBtn').hidden=!contacts.length;
      setProgress('Concluído sem falhas: '+Number(result.ticketsRead||0).toLocaleString('pt-BR')+' bilhetes vendidos analisados e '+contacts.length.toLocaleString('pt-BR')+' contatos únicos com telefone válido.');
    }catch(e){$('errorsCount').textContent='1';setProgress('Falha: '+e.message+'\nExportação bloqueada para evitar arquivo incompleto.');}
    finally{if(workflowStage==='extracting')setWorkflow('extract');}
  }
  async function download(name,type,content){
    const isNative=!!(window.Capacitor&&window.Capacitor.isNativePlatform&&window.Capacitor.isNativePlatform());
    if(isNative){
      try{
        const plugins=window.Capacitor.Plugins||{};
        const fs=plugins.Filesystem;
        if(!fs||!fs.writeFile)throw new Error('Recurso de gravação não disponível no aplicativo.');
        const base64=await new Promise((resolve,reject)=>{
          const reader=new FileReader();
          reader.onload=()=>resolve(String(reader.result).split(',')[1]||'');
          reader.onerror=()=>reject(new Error('Não foi possível preparar o arquivo.'));
          reader.readAsDataURL(new Blob([content],{type}));
        });
        const result=await fs.writeFile({path:name,data:base64,directory:'DOCUMENTS',recursive:true});
        setProgress('Arquivo salvo no Android: '+(result.uri||name)+'. Abra Downloads/Documentos ou use o gerenciador de arquivos do aparelho.');
        return;
      }catch(e){
        setProgress('Não foi possível salvar diretamente no Android: '+e.message+'. Tente usar Compartilhar/Salvar arquivo.');
        try{
          const file=new File([content],name,{type});
          if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:name});return;}
        }catch{}
        return;
      }
    }
    const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;a.rel='noopener';a.style.display='none';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }
  async function exportVcf(){if(!canExport||!contacts.length)return;const data=contacts.map(c=>{const phone=String(c.phone||'').replace(/\D/g,'');return 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:'+vcfEscape(c.name)+';;;;\r\nFN:'+vcfEscape(c.name)+'\r\nTEL;TYPE=CELL:+55'+phone+'\r\nEND:VCARD';}).join('\r\n')+'\r\n';const filename='contatos-reino-da-sorte.vcf';const file=new File([data],'contatos-reino-da-sorte.vcf',{type:'text/vcard;charset=utf-8'});try{if(navigator.share&&navigator.canShare&&navigator.canShare({files:[file]})){await navigator.share({files:[file],title:filename});setProgress('Arquivo VCF preparado. No menu do iPhone, escolha “Salvar em Arquivos” para guardar ou “Contatos” para importar.');return;}}catch(e){if(e.name==='AbortError')return;}
    download(filename,'text/vcard;charset=utf-8',data);setProgress('Download VCF solicitado. Se o iPhone abrir o cartão em vez de baixar, toque em Compartilhar e escolha “Salvar em Arquivos” ou “Contatos”.');}
  function vcfEscape(s){return String(s||'').replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');}
  $('togglePassword').addEventListener('click',()=>{const p=$('password');const show=p.type==='password';p.type=show?'text':'password';$('togglePassword').textContent=show?'Ocultar':'Mostrar';$('togglePassword').setAttribute('aria-pressed',String(show));});
  $('rememberPassword').addEventListener('change',()=>{if(!$('rememberPassword').checked){localStorage.removeItem('rds_extrator_email');localStorage.removeItem('rds_extrator_password');}});
  $('loginBtn').addEventListener('click',login);$('password').addEventListener('keydown',e=>{if(e.key==='Enter')login();});$('email').addEventListener('keydown',e=>{if(e.key==='Enter')login();});$('logoutBtn').addEventListener('click',logout);
  $('reloadBtn').addEventListener('click',()=>loadDraws().catch(e=>setStatus(e.message,true)));$('extractBtn').addEventListener('click',extract);
  function drawsChanged(){sellers=[];sellerDrawSignature='';$('sellerCheckboxes').innerHTML='<p class="muted">Toque em “Carregar vendedores” para identificar os participantes destes sorteios.</p>';const selected=[...$('draws').selectedOptions].length;setWorkflow(selected?'sellers':'draws');updateSelectionSummary();$('sellerInfo').textContent=selected?'Etapa 1 de 3 · '+selected+' sorteio(s) selecionado(s). Agora toque em “Carregar vendedores”.':'Selecione sorteios para começar.';canExport=false;contacts=[];$('vcfBtn').disabled=true;$('csvBtn').disabled=true;$('previewBtn').hidden=true;$('previewPanel').classList.add('hidden');}
  $('selectAllDraws').addEventListener('click',()=>{[...$('draws').options].forEach(o=>o.selected=true);drawsChanged();});$('clearDraws').addEventListener('click',()=>{[...$('draws').options].forEach(o=>o.selected=false);drawsChanged();});
  $('draws').addEventListener('change',drawsChanged);$('reloadSellers').addEventListener('click',()=>loadSellers());
  $('sellerCheckboxes').addEventListener('change',updateSelectionSummary);
  $('selectAllSellers').addEventListener('click',()=>{document.querySelectorAll('#sellerCheckboxes input.seller-option').forEach(o=>o.checked=true);updateSelectionSummary();});$('clearSellers').addEventListener('click',()=>{document.querySelectorAll('#sellerCheckboxes input.seller-option').forEach(o=>o.checked=false);updateSelectionSummary();});
  $('previewBtn').addEventListener('click',()=>renderPreview());$('closePreview').addEventListener('click',()=> $('previewPanel').classList.add('hidden'));$('previewSearch').addEventListener('input',()=>renderPreview());
  function renderPreview(){if(!canExport)return;const query=$('previewSearch').value.trim().toLocaleUpperCase('pt-BR');const filtered=contacts.filter(c=>!query||(c.name+' '+c.phone).toLocaleUpperCase('pt-BR').includes(query));$('previewTotal').textContent=filtered.length.toLocaleString('pt-BR')+' contato(s) exibido(s) de '+contacts.length.toLocaleString('pt-BR');const tbody=$('previewRows');tbody.replaceChildren();for(const c of filtered){const tr=document.createElement('tr');const tdName=document.createElement('td');tdName.textContent=c.name;const tdPhone=document.createElement('td');tdPhone.textContent=c.phone;tr.append(tdName,tdPhone);tbody.appendChild(tr);}$('previewPanel').classList.remove('hidden');}
  $('vcfBtn').addEventListener('click',()=>exportVcf());
  $('csvBtn').addEventListener('click',()=>{if(!canExport||!contacts.length)return;const esc=s=>'"'+String(s||'').replace(/"/g,'""')+'"';download('contatos-reino-da-sorte.csv','text/csv;charset=utf-8','\uFEFFNome,Telefone\r\n'+contacts.map(c=>esc(c.name)+','+esc(c.phone)).join('\r\n'));});
  if(localStorage.getItem('rds_extrator_email')){$('email').value=localStorage.getItem('rds_extrator_email');$('rememberPassword').checked=true;}
  if(localStorage.getItem('rds_extrator_password'))$('password').value=localStorage.getItem('rds_extrator_password');
  if(session){loggedIn(true);loadDraws().then(()=>{if(activeExtractionJob)resumeExtraction(activeExtractionJob);}).catch(async e=>{if(e.message.includes('Sessão expirada')&&localStorage.getItem('rds_extrator_email')&&localStorage.getItem('rds_extrator_password')){try{const result=await fetch(API_BASE+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:localStorage.getItem('rds_extrator_email'),password:localStorage.getItem('rds_extrator_password')})});const data=await result.json();if(!result.ok||!data.session)throw new Error(data.message||'Não foi possível renovar a sessão.');session=data.session;localStorage.setItem('rds_extrator_session',session);loggedIn(true);await loadDraws();if(activeExtractionJob){resumeExtraction(activeExtractionJob);setStatus('Conexão restabelecida. Retomando o acompanhamento da extração anterior.');}else setStatus('Conexão restabelecida. Confira os sorteios antes de iniciar uma nova extração.');return;}catch(recoveryError){setStatus('A sessão foi perdida. Entre novamente para continuar: '+recoveryError.message,true);}}else setStatus(e.message,true);session='';sessionStorage.removeItem('rds_extrator_session');localStorage.removeItem('rds_extrator_session');loggedIn(false);});}else loggedIn(false);
  async function resumeExtraction(jobId){
    setWorkflow('extracting');setProgress('Reconectando à extração que já estava em andamento…');
    try{
      let result;
      do{
        await sleep(1800);
        result=await api('/api/extract/status?id='+encodeURIComponent(jobId),{headers:{'X-Extrator-Resume':localStorage.getItem('rds_extrator_resume_token')||''}});
        $('ticketsCount').textContent=Number(result.ticketsRead||0).toLocaleString('pt-BR');
        $('errorsCount').textContent=(result.errors||[]).length.toLocaleString('pt-BR');
        setProgress('Acompanhando a extração…\\n'+(result.current||'')+'\\nPáginas processadas: '+Number(result.pagesDone||0).toLocaleString('pt-BR'));
      }while(result.status==='running');
      activeExtractionJob='';localStorage.removeItem('rds_extrator_active_job');localStorage.removeItem('rds_extrator_resume_token');
      if(result.status==='complete'&&!(result.errors||[]).length){
        contacts=result.contacts||[];canExport=true;
        $('contactsCount').textContent=contacts.length.toLocaleString('pt-BR');
        $('vcfBtn').disabled=!contacts.length;$('csvBtn').disabled=!contacts.length;$('previewBtn').hidden=!contacts.length;
        setProgress('Concluído: '+Number(result.ticketsRead||0).toLocaleString('pt-BR')+' bilhetes vendidos e '+contacts.length.toLocaleString('pt-BR')+' contatos únicos.');
      }else setProgress(result.message||'A extração não pôde ser recuperada.');
    }catch(e){setProgress('Não foi possível recuperar automaticamente: '+e.message+' Se o servidor reiniciou, o trabalho pode ter sido perdido.');}
    finally{setWorkflow('extract');}
  }

})();