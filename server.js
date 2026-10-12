const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 10000;
const API = 'https://api.reinodasorte.com.br';
const sessions = new Map();
const sessionTtl = 12 * 60 * 60 * 1000;
const mime = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};

function json(res, status, data) {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'same-origin'});
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
  if(!s||Date.now()-s.createdAt>sessionTtl){if(id)sessions.delete(id);return null;}
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

const app=http.createServer(async(req,res)=>{
  if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,X-Extrator-Session','Access-Control-Max-Age':'86400'});return res.end();}
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
      sessions.set(id,{accessToken:d.accessToken,refreshToken:d.refreshToken||null,deviceId,createdAt:Date.now()});
      return json(res,200,{success:true,session:id,user:d.user||d.admin||null});
    }catch(e){return sendError(res,e);}
  }
  if(req.method==='POST'&&u.pathname==='/api/logout'){
    const id=(req.headers['x-extrator-session']||'').toString();sessions.delete(id);return json(res,200,{success:true});
  }
  const s=getSession(req);
  if(!s)return json(res,401,{success:false,message:'Sessão expirada. Entre novamente com sua conta oficial.'});
  if(req.method==='GET'&&u.pathname==='/api/draws'){
    try{
      const params=u.searchParams;
      const query=params.toString();
      const result=await official(s,'/admin/draws'+(query?'?'+query:''));
      const d=extractData(result);
      const draws=Array.isArray(d)?d:(Array.isArray(d?.draws)?d.draws:[]);
      return json(res,200,{success:true,draws});
    }catch(e){return sendError(res,e);}
  }
  if(req.method==='POST'&&u.pathname==='/api/extract'){
    try{
      const b=await body(req);const ids=Array.isArray(b.drawIds)?b.drawIds.map(Number).filter(n=>Number.isFinite(n)&&n>0):[];
      if(!ids.length)return json(res,400,{success:false,message:'Selecione ao menos um sorteio.'});
      if(ids.length>50)return json(res,400,{success:false,message:'Selecione no máximo 50 sorteios por extração.'});
      const sellerFilter=String(b.seller||'').trim().toLocaleLowerCase('pt-BR');
      const all=[];const errors=[];let ticketsRead=0;
      for(const drawId of ids){
        let drawInfo;
        try{
          const dr=extractData(await official(s,'/admin/draws/'+drawId));
          drawInfo=dr?.draw||dr;
        }catch(e){drawInfo=null;}
        let lots=[];
        if(drawInfo&&Array.isArray(drawInfo.lots)&&drawInfo.lots.length){
          lots=drawInfo.lots.map(x=>Number(typeof x==='object'?(x.lot_number??x.lotNumber??x.number??x.id):x)).filter(n=>Number.isFinite(n)&&n>0);
        }else{
          const count=Number(drawInfo?.lotsCount??drawInfo?.totalLots??drawInfo?.lot_count??drawInfo?.lots);
          lots=Array.from({length:Math.max(1,Math.min(100,count||5))},(_,i)=>i+1);
        }
        for(const lot of lots){
          let page=1,totalPages=1;
          do{
            try{
              const result=await official(s,'/admin/draws/'+drawId+'/lots/'+lot+'/tickets?page='+page+'&limit=100');
              const d=extractData(result);const tickets=Array.isArray(d?.tickets)?d.tickets:(Array.isArray(d)?d:[]);
              const pagination=d?.pagination||result?.pagination||{};
              totalPages=Math.max(1,Number(pagination.totalPages)||page);
              for(const t of tickets){
                ticketsRead++;
                const buyer=t.buyer||{};const seller=t.seller||{};
                const sellerName=typeof seller==='string'?seller:(seller.name||seller.fullName||seller.full_name||'');
                if(sellerFilter&&!String(sellerName).toLocaleLowerCase('pt-BR').includes(sellerFilter))continue;
                const buyerName=typeof buyer==='string'?buyer:(buyer.name||buyer.fullName||buyer.full_name||buyer.nome||'');
                const phone=typeof buyer==='object'?(buyer.phone||buyer.phoneNumber||buyer.phone_number||buyer.whatsapp||buyer.mobile||''):(t.buyer_phone||t.phone||'');
                all.push({name:String(buyerName||'').trim(),phone:String(phone||'').trim(),drawId,lot,ticketNumber:t.ticket_number??t.ticketNumber??'',sellerName:String(sellerName||'').trim()});
              }
            }catch(e){errors.push('Sorteio '+drawId+', lote '+lot+', página '+page+': '+e.message);break;}
            page++;
          }while(page<=totalPages);
        }
      }
      if(errors.length)return json(res,200,{success:false,message:'A extração teve falhas. Os arquivos não foram liberados; corrija a conexão e tente novamente.',ticketsRead,errors:errors.slice(0,100),contacts:[]});
      const normalizePhone=v=>{let n=String(v||'').replace(/\D/g,'');if(n.startsWith('00'))n=n.slice(2);if(n.length===10||n.length===11){if(!n.startsWith('55'))n='55'+n;}if(n.length<12||n.length>13)return '';return '+'+n;};
      const byPhone=new Map();
      for(const t of all){
        const phone=normalizePhone(t.phone);if(!phone)continue;
        const name=t.name.toLocaleUpperCase('pt-BR').replace(/^CLIENTE\s*/,'').trim();
        if(!byPhone.has(phone))byPhone.set(phone,{name:name||'SEM NOME',phone});
      }
      const grouped=new Map();
      for(const c of byPhone.values()){const base=c.name;grouped.set(base,(grouped.get(base)||0)+1);c._base=base;}
      const counts=new Map();const contacts=[];
      for(const c of byPhone.values()){const n=(counts.get(c._base)||0)+1;counts.set(c._base,n);contacts.push({name:'CLIENTE '+c._base+(grouped.get(c._base)>1?' '+n:''),phone:c.phone});}
      return json(res,200,{success:true,ticketsRead,contactsCount:contacts.length,contacts,errors:[]});
    }catch(e){return sendError(res,e);}
  }
  const filePath=path.join(__dirname,u.pathname==='/'?'index.html':decodeURIComponent(u.pathname).replace(/^\/+/,'')); 
  if(!filePath.startsWith(__dirname))return json(res,403,{success:false,message:'Acesso negado.'});
  fs.readFile(filePath,(err,content)=>{if(err){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});return res.end('Não encontrado');}res.writeHead(200,{'Content-Type':mime[path.extname(filePath)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(content);});
});
app.listen(PORT,'0.0.0.0',()=>console.log('Extrator Contatos RDS listening on '+PORT));
