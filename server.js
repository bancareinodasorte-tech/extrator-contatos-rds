const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 10000;
const API = 'https://api.reinodasorte.com.br';
const sessions = new Map();
const extractionJobs = new Map();
const sellerJobs = new Map();
const sessionTtl = 12 * 60 * 60 * 1000;
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};

function json(res, status, data) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'https://extrator-contatos-rds.onrender.com','Vary':'Origin'});
  res.end(JSON.stringify(data));
}
function body(req) {
  return new Promise((resolve,reject)=>{
    let s=''; req.on('data',c=>{s+=c;if(s.length>1e6){reject(new Error('Corpo muito grande'));req.destroy();}});
    req.on('end',()=>{try{resolve(s?JSON.parse(s):{});}catch(e){reject(new Error('JSON inválido'));}});
    req.on('error',reject);
  });
}
function requestOfficial(url, method='GET', data=null, token=null, deviceId=null) {
  return new Promise((resolve,reject)=>{
    const u=new URL(url,API);
    const payload=data===null?null:Buffer.from(JSON.stringify(data));
    const headers={'Accept':'application/json','User-Agent':'ExtratorContatosRDS/1.0'};
    if(payload){headers['Content-Type']='application/json';headers['Content-Length']=payload.length;}
    if(token)headers.Authorization='Bearer '+token;
    if(deviceId)headers['x-device-id']=deviceId;
    const req=https.request(u,{method,headers,timeout:45000},res=>{
      let raw='';res.on('data',c=>raw+=c);res.on('end',()=>{
        let parsed;try{parsed=JSON.parse(raw);}catch{parsed={message:raw.slice(0,500)};}
        if(res.statusCode<200||res.statusCode>=300){const e=new Error((parsed&&parsed.message)||('API oficial respondeu HTTP '+res.statusCode));e.status=res.statusCode;e.data=parsed;return reject(e);}
        resolve(parsed);
      });
    });
    req.on('timeout',()=>req.destroy(new Error('Tempo esgotado na API oficial')));
    req.on('error',reject);if(payload)req.write(payload);req.end();
  });
}
function getSession(req) {
  const id=(req.headers['x-extrator-session']||'').toString();
  const s=sessions.get(id);
  if(!s||Date.now()-(s.lastSeenAt||s.createdAt)>sessionTtl){if(id)sessions.delete(id);return null;}
  s.lastSeenAt=Date.now();
  return s;
}
async function official(s, url, method='GET', data=null) {
  try { return await requestOfficial(url,method,data,s.accessToken,s.deviceId); }
  catch(e) {
    if(e.status!==401 || !s.refreshToken) throw e;
    const refreshed=await requestOfficial('/auth/refresh','POST',{refreshToken:s.refreshToken,deviceId:s.deviceId},null,s.deviceId);
    const d=refreshed.data||refreshed;
    if(!d.accessToken)throw new Error('A API não retornou novo token de acesso.');
    s.accessToken=d.accessToken;s.refreshToken=d.refreshToken||s.refreshToken;
    return requestOfficial(url,method,data,s.accessToken,s.deviceId);
  }
}
function extractData(result) { return result && result.data!==undefined ? result.data : result; }
function sendError(res,e){json(res,e.status||500,{success:false,message:e.message||'Erro inesperado na integração oficial.'});}


async function runExtraction(s, b, job) {
  const ids=Array.isArray(b.drawIds)?b.drawIds.map(Number).filter(n=>Number.isFinite(n)&&n>0):[];
  const sellerIds=new Set(Array.isArray(b.sellerIds)?b.sellerIds.map(String):[]);const sellerNames=new Set(Array.isArray(b.sellerNames)?b.sellerNames.map(v=>String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLocaleUpperCase('pt-BR')):[]);
  const byPhone=new Map();let ticketsRead=0,pagesDone=0;const errors=[];
  const normalizePhone=v=>{
    let n=String(v||'').replace(/\D/g,'');
    if(n.startsWith('00'))n=n.slice(2);
    if(n.startsWith('55')&&(n.length===12||n.length===13))n=n.slice(2);
    if(n.length===12&&n.startsWith('0'))n=n.slice(1);
    if(n.length!==10&&n.length!==11)return '';
    const ddd=Number(n.slice(0,2));const validDdds=new Set([11,12,13,14,15,16,17,18,19,21,22,24,27,28,31,32,33,34,35,37,38,41,42,43,44,45,46,47,48,49,51,53,54,55,61,62,63,64,65,66,67,68,69,71,73,74,75,77,79,81,82,83,84,85,86,87,88,89,91,92,93,94,95,96,97,98,99]);if(!validDdds.has(ddd))return '';
    const subscriber=n.slice(2);
    if(n.length===11){if(subscriber[0]!=='9')return '';}
    else if(!/^[2-5]/.test(subscriber))return '';
    return n;
  };
  const consume=t=>{
    const buyer=t.buyer??t.customer??null;
    const status=String(t.status??t.ticket_status??t.sale_status??'').toLowerCase();
    const hasBuyer=buyer!==null&&buyer!==undefined&&buyer!==''&&(typeof buyer!=='object'||Object.keys(buyer).length>0);
    const soldStatuses=['sold','paid','approved','completed','vendido','pago','aprovado','concluido','concluído'];
    if(!hasBuyer&&!soldStatuses.includes(status))return;
    const seller=t.seller??t.vendor??{};
    const sellerName=typeof seller==='string'?seller:(seller.name||seller.fullName||seller.full_name||seller.nome||t.sellerName||t.seller_name||'');
    const sellerId=String(typeof seller==='object'?(seller.id??seller.seller_id??seller.user_id??seller.uuid??sellerName):sellerName);
    const sellerKey=String(sellerName).replace(/\uFFFD/g,'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toLocaleUpperCase('pt-BR');if((sellerIds.size||sellerNames.size)&&!sellerIds.has(sellerId)&&!sellerIds.has(String(sellerName))&&!sellerNames.has(sellerKey))return;
    ticketsRead++;
    const buyerName=typeof buyer==='string'?buyer:(buyer?.name||buyer?.fullName||buyer?.full_name||buyer?.nome||t.buyerName||t.buyer_name||'');
    const phone=typeof buyer==='object'?(buyer?.phone||buyer?.cellphone||buyer?.mobile||buyer?.telephone||buyer?.phoneNumber||buyer?.phone_number||buyer?.whatsapp||t.buyerPhone||t.buyer_phone||t.telephone||t.phone||''):(t.buyerPhone||t.buyer_phone||t.telephone||t.phone||'');
    const normalized=normalizePhone(phone);if(!normalized)return;
    if(!byPhone.has(normalized)){const name=String(buyerName||'').normalize('NFC').trim().replace(/^(?:CLIENTE\s*)+/iu,'').replace(/\s+/g,' ').toLocaleUpperCase('pt-BR');byPhone.set(normalized,{name:name||'SEM NOME',phone:normalized});}
  };
  const fetchPage=async(drawId,lot,page,limit=500)=>{
    try{return await official(s,'/admin/draws/'+drawId+'/lots/'+lot+'/tickets?page='+page+'&limit='+limit+'&status=sold');}
    catch(e){if(page===1&&(e.status===400||e.status===422))return await official(s,'/admin/draws/'+drawId+'/lots/'+lot+'/tickets?page=1&limit=100');throw e;}
  };
  for(const drawId of ids){
    let drawInfo=null;
    try{const dr=extractData(await official(s,'/admin/draws/'+drawId));drawInfo=dr?.draw||dr;}
    catch(e){errors.push('Sorteio '+drawId+': não foi possível consultar os lotes — '+e.message);continue;}
    let lots=[];
    if(drawInfo&&Array.isArray(drawInfo.lots)&&drawInfo.lots.length)lots=drawInfo.lots.map(x=>Number(typeof x==='object'?(x.lot_number??x.lotNumber??x.number??x.id):x)).filter(n=>Number.isFinite(n)&&n>0);
    else{const count=Number(drawInfo?.lotsCount??drawInfo?.totalLots??drawInfo?.lot_count??drawInfo?.lots);lots=Array.from({length:Math.max(1,Math.min(100,count||5))},(_,i)=>i+1);}
    const tasks=[];
    for(const lot of lots){
      job.current='Sorteio '+drawId+' · lote '+lot+' · preparando leitura…';
      try{
        const first=await fetchPage(drawId,lot,1,500);const d=extractData(first);const tickets=Array.isArray(d?.tickets)?d.tickets:(Array.isArray(d)?d:[]);const p=d?.pagination||first?.pagination||{};
        const totalPages=Math.max(1,Number(p.totalPages||p.total_pages||p.pages)||1);
        for(const t of tickets)consume(t);
        pagesDone++;job.ticketsRead=ticketsRead;job.pagesDone=pagesDone;
        for(let page=2;page<=totalPages;page++)tasks.push({drawId,lot,page,totalPages});
      }catch(e){errors.push('Sorteio '+drawId+', lote '+lot+', página 1: '+e.message);}
    }
    let cursor=0;const workers=Array.from({length:Math.min(10,tasks.length)},async()=>{
      while(cursor<tasks.length){
        const task=tasks[cursor++];job.current='Sorteio '+task.drawId+' · lote '+task.lot+' · página '+task.page+'/'+task.totalPages+' (leitura paralela)';
        try{const result=await fetchPage(task.drawId,task.lot,task.page,500);const d=extractData(result);const tickets=Array.isArray(d?.tickets)?d.tickets:(Array.isArray(d)?d:[]);for(const t of tickets)consume(t);pagesDone++;job.pagesDone=pagesDone;job.ticketsRead=ticketsRead;}
        catch(e){errors.push('Sorteio '+task.drawId+', lote '+task.lot+', página '+task.page+': '+e.message);}
      }
    });
    await Promise.all(workers);
  }
  job.ticketsRead=ticketsRead;job.pagesDone=pagesDone;
  if(errors.length){job.status='failed';job.message='A leitura teve '+errors.length+' falha(s); nenhum arquivo foi liberado.';job.errors=errors.slice(0,100);job.contacts=[];return;}
  const grouped=new Map();for(const c of byPhone.values())grouped.set(c.name,(grouped.get(c.name)||0)+1);
  const counts=new Map();const contacts=[];
  for(const c of byPhone.values()){const n=(counts.get(c.name)||0)+1;counts.set(c.name,n);contacts.push({name:'CLIENTE '+c.name+(grouped.get(c.name)>1?' '+n:''),phone:c.phone});}
  job.status='complete';job.message='Leitura concluída sem falhas.';job.contacts=contacts;job.contactsCount=contacts.length;job.errors=[];job.ticketsRead=ticketsRead;
}
const app=http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':'https://extrator-contatos-rds.onrender.com','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,X-Extrator-Session,X-Extrator-Resume','Access-Control-Max-Age':'86400','Vary':'Origin'});return res.end();}
  const u=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&u.pathname==='/api/health')return json(res,200,{success:true,service:'extrator-contatos-rds'});
  if(req.method==='POST'&&u.pathname==='/api/login'){
    try{
      const b=await body(req);
      if(!b.email||!b.password)return json(res,400,{success:false,message:'Informe e-mail e senha da conta oficial.'});
      const deviceId='rds_extrator_'+crypto.randomBytes(16).toString('hex');
      const result=await requestOfficial('/auth/login','POST',{email:String(b.email).trim(),password:String(b.password),deviceId},null,deviceId);
      const d=extractData(result);
      if(!d||!d.accessToken)return json(res,502,{success:false,message:'Login respondeu sem token. Verifique a resposta da API oficial.'});
      const id=crypto.randomBytes(32).toString('hex');
      sessions.set(id,{accessToken:d.accessToken,refreshToken:d.refreshToken||null,deviceId,createdAt:Date.now(),lastSeenAt:Date.now()});
      return json(res,200,{success:true,session:id,user:d.user||d.admin||null});
    }catch(e){return sendError(res,e);}
  }
  if(req.method==='POST'&&u.pathname==='/api/logout'){
    const id=(req.headers['x-extrator-session']||'').toString();sessions.delete(id);return json(res,200,{success:true});
  }
  if(req.method==='GET'&&!u.pathname.startsWith('/api/')) {
    const filePath=path.join(__dirname,u.pathname==='/'?'index.html':decodeURIComponent(u.pathname).slice(1)); 
    if(!filePath.startsWith(__dirname))return json(res,403,{success:false,message:'Acesso negado.'});
    return fs.readFile(filePath,(err,content)=>{if(err){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Não encontrado');}res.writeHead(200,{'Content-Type':mime[path.extname(filePath)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(content);});
  }
  const s=getSession(req);
  if(!s)return json(res,401,{success:false,message:'Sessão expirada. Entre novamente com sua conta oficial.'});
  if(req.method==='GET'&&u.pathname==='/api/draws'){
    try{
      const params=u.searchParams;
      const query=params.toString();
      const result=await official(s,'/admin/draws'+(query?'?'+query:'?startDate=2000-01-01&endDate=2099-12-31'));
      const d=extractData(result);
      const draws=Array.isArray(d)?d:(Array.isArray(d?.draws)?d.draws:[]);
      return json(res,200,{success:true,draws});
    }catch(e){return sendError(res,e);}
  }
  if(req.method==='GET'&&u.pathname==='/api/sellers'){
    try{
      const ids=(u.searchParams.get('drawIds')||'').split(',').map(Number).filter(n=>Number.isFinite(n)&&n>0);
      if(!ids.length)return json(res,400,{success:false,message:'Selecione ao menos um sorteio para carregar os vendedores.'});
      if(ids.length>20)return json(res,400,{success:false,message:'Selecione no máximo 20 sorteios para listar vendedores.'});
      const jobId=crypto.randomBytes(16).toString('hex');
      const job={id:jobId,status:'running',message:'Consultando todos os lotes e páginas para localizar os vendedores participantes…',sellers:[],current:'Preparando consulta…',pagesDone:0,errors:[]};
      sellerJobs.set(jobId,{job,sessionId:String(req.headers['x-extrator-session']||'')});
      (async()=>{
        const sellers=new Map();const errors=[];
        const addSeller=(id,name)=>{name=String(name||'').replace(/\uFFFD/g,'').trim();if(!name)return;const identity=String(id||name).trim();const key=identity||name;const old=sellers.get(key)||{id:key,name,ids:[identity]};if(name.length>old.name.length)old.name=name;sellers.set(key,old);};const addItems=(payload)=>{const d=extractData(payload);const list=Array.isArray(d)?d:(Array.isArray(d?.sellers)?d.sellers:(Array.isArray(d?.vendors)?d.vendors:(Array.isArray(d?.items)?d.items:[])));for(const x of list){const name=typeof x==='string'?x:(x.name||x.fullName||x.full_name||x.nome||x.seller_name||x.vendor_name||'');const id=typeof x==='object'?(x.id??x.seller_id??x.user_id??x.uuid??name):name;addSeller(id,name);}return list.length>0;};
        const getSessionForJob=()=>{const rec=sellerJobs.get(jobId);if(!rec)throw new Error('Consulta expirada');const ses=sessions.get(rec.sessionId);if(!ses)throw new Error('Sessão expirada');ses.lastSeenAt=Date.now();return ses;};
        try{
          for(const drawId of ids){
            const session=getSessionForJob();job.current='Sorteio '+drawId+': consultando cadastro de vendedores…';let sellerRouteWorked=false;
            for(const route of ['/admin/draws/'+drawId+'/sellers','/admin/draws/'+drawId+'/vendors','/admin/draws/'+drawId+'/sales/sellers']){try{sellerRouteWorked=addItems(await official(session,route))||sellerRouteWorked;}catch(e){if(e.status!==404&&e.status!==405)errors.push('Sorteio '+drawId+': '+e.message);}}
            if(sellerRouteWorked)continue;
            let drawInfo=null;try{const dr=extractData(await official(session,'/admin/draws/'+drawId));drawInfo=dr?.draw||dr;}catch(e){errors.push('Sorteio '+drawId+': '+e.message);continue;}
            const lots=Array.isArray(drawInfo?.lots)&&drawInfo.lots.length?drawInfo.lots.map(x=>Number(typeof x==='object'?(x.lot_number??x.lotNumber??x.number??x.id):x)).filter(n=>Number.isFinite(n)&&n>0):[1,2,3,4,5];
            for(const lot of lots){let page=1,totalPages=1;do{job.current='Sorteio '+drawId+' · lote '+lot+' · página '+page+'/'+totalPages;try{const result=await official(getSessionForJob(),'/admin/draws/'+drawId+'/lots/'+lot+'/tickets?page='+page+'&limit=100&status=sold');const d=extractData(result);const tickets=Array.isArray(d?.tickets)?d.tickets:(Array.isArray(d)?d:[]);const p=d?.pagination||result?.pagination||{};totalPages=Math.max(1,Number(p.totalPages||p.total_pages||p.pages)||totalPages);for(const t of tickets){const x=t.seller||t.vendor||{};const name=typeof x==='string'?x:(x.name||x.fullName||x.full_name||x.nome||t.sellerName||t.seller_name||'');if(!String(name).trim())continue;const id=typeof x==='object'?(x.id??x.seller_id??x.user_id??x.uuid??name):name;addSeller(id,name);}job.pagesDone++;job.sellers=[...sellers.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));if(!tickets.length)break;}catch(e){errors.push('Sorteio '+drawId+', lote '+lot+', página '+page+': '+e.message);break;}page++;}while(page<=totalPages);}
          }
          job.sellers=[...sellers.values()].sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
          if(errors.length&&!job.sellers.length){job.status='failed';job.message='Não foi possível concluir a consulta de vendedores.';job.errors=errors.slice(0,20);}else{job.status='complete';job.message=errors.length?'Lista encontrada, mas houve falhas parciais. Atualize para tentar novamente.':'Lista completa de vendedores carregada.';job.errors=errors.slice(0,20);}
        }catch(e){job.status='failed';job.message=e.message||'Falha ao consultar vendedores.';job.errors=[job.message];}
      })();
      return json(res,202,{success:true,jobId,status:'running'});
    }catch(e){return sendError(res,e);}
  }
  if(req.method==='GET'&&u.pathname==='/api/sellers/status'){
    const id=u.searchParams.get('id')||'';const rec=sellerJobs.get(id);if(!rec||rec.sessionId!==String(req.headers['x-extrator-session']||''))return json(res,404,{success:false,message:'Consulta de vendedores não encontrada ou sessão diferente.'});
    return json(res,200,{success:true,status:rec.job.status,message:rec.job.message,current:rec.job.current,pagesDone:rec.job.pagesDone,sellers:rec.job.sellers||[],errors:rec.job.errors||[]});
  }
  if(req.method==='POST'&&u.pathname==='/api/extract'){
    try{
      const b=await body(req);const ids=Array.isArray(b.drawIds)?b.drawIds.map(Number).filter(n=>Number.isFinite(n)&&n>0):[];
      if(!ids.length)return json(res,400,{success:false,message:'Selecione ao menos um sorteio.'});
      if(ids.length>50)return json(res,400,{success:false,message:'Selecione no máximo 50 sorteios por extração.'});
      const jobId=crypto.randomBytes(18).toString('hex');
      const resumeToken=crypto.randomBytes(32).toString('hex');
      const job={id:jobId,status:'running',message:'Extração iniciada.',ticketsRead:0,pagesDone:0,current:'Preparando leitura…',contacts:[],contactsCount:0,errors:[],createdAt:Date.now()};
      extractionJobs.set(jobId,{job,sessionId:String(req.headers['x-extrator-session']||''),resumeToken});
      runExtraction(s,b,job).catch(e=>{job.status='failed';job.message=e.message||'Falha inesperada';job.errors=[job.message];job.contacts=[];});
      return json(res,202,{success:true,jobId,resumeToken,status:'running'});
    }catch(e){return sendError(res,e);}
  }
  if(req.method==='GET'&&u.pathname==='/api/extract/status'){
    const jobId=u.searchParams.get('id')||'';const record=extractionJobs.get(jobId);
    const sameSession=record&&record.sessionId===String(req.headers['x-extrator-session']||'');
    const sameResumeToken=record&&record.resumeToken&&record.resumeToken===String(req.headers['x-extrator-resume']||'');
    if(!record||(!sameSession&&!sameResumeToken))return json(res,404,{success:false,message:'Extração não encontrada ou autorização de retomada inválida.'});
    const j=record.job;
    return json(res,200,{success:true,status:j.status,message:j.message,current:j.current,ticketsRead:j.ticketsRead,pagesDone:j.pagesDone,contactsCount:j.contactsCount,contacts:j.status==='complete'?j.contacts:[],errors:j.errors||[]});
  }
  return json(res,404,{success:false,message:'Rota não encontrada.'});
});
app.listen(PORT,'0.0.0.0',()=>console.log('Extrator Contatos RDS listening on '+PORT));
