// Перекуп — сервер для Telegram Mini App: рынок игроков, приглашения друзей, платежи Telegram Stars.
// Запуск: BOT_TOKEN=... WEBHOOK_SECRET=... node server.js   (Node 18+, без зависимостей)
const http=require('http'),crypto=require('crypto'),fs=require('fs'),path=require('path');
const PORT=+process.env.PORT||3000,BOT_TOKEN=process.env.BOT_TOKEN||'',DEV=process.env.DEV==='1',DB=process.env.DB_FILE||path.join(__dirname,'db.json'),WH=process.env.WEBHOOK_SECRET||'change-me',ORIGIN=process.env.ALLOW_ORIGIN||'*';
const PRODUCTS={premium:{title:'VIP · 30 дней',stars:150},cash1:{title:'7 500 000 ₽',stars:25},cash2:{title:'15 000 000 ₽',stars:50},slots:{title:'+2 места в гараже',stars:35},timers:{title:'Сброс таймеров',stars:15}};
const catalog={};try{for(const[n,y1,y2,p]of JSON.parse(fs.readFileSync(path.join(__dirname,'catalog.json'))))catalog[n]={y1,y2,p}}catch{}
let db={users:{},market:[],inbox:{},paid:{},saves:{},grants:{},seq:1};try{db=Object.assign(db,JSON.parse(fs.readFileSync(DB)))}catch{}db.saves=db.saves||{};db.grants=db.grants||{};
let dirty=false;const save=()=>{dirty=true},flush=()=>{if(!dirty)return;dirty=false;try{fs.writeFileSync(DB+'.tmp',JSON.stringify(db));fs.renameSync(DB+'.tmp',DB)}catch(e){console.error('save',e.message)}};
setInterval(flush,2000).unref();process.on('SIGTERM',()=>{flush();process.exit(0)});
const clean=s=>String(s||'').replace(/[<>"'`&$\\]/g,'').slice(0,60),PLT=/^[АВЕКМНОРСТУХ]\d{3}[АВЕКМНОРСТУХ]{2} \d{2,3}$/,BODIES='shwucmkv';
function verifyInitData(raw){if(!BOT_TOKEN||!raw)return null;const p=new URLSearchParams(raw),hash=p.get('hash');if(!hash)return null;p.delete('hash');
 const str=[...p.entries()].map(([k,v])=>k+'='+v).sort().join('\n'),secret=crypto.createHmac('sha256','WebAppData').update(BOT_TOKEN).digest(),h=crypto.createHmac('sha256',secret).update(str).digest('hex');
 const a=Buffer.from(h),b=Buffer.from(hash);if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return null;if(Date.now()/1000-Number(p.get('auth_date')||0)>86400)return null;try{return JSON.parse(p.get('user'))}catch{return null}}
function auth(req){let id,name;const dev=req.headers['x-dev-user'];
 if(DEV&&dev){id=String(dev).replace(/\D/g,'').slice(0,15);name='Игрок'+id}
 else{const u=verifyInitData(req.headers['x-init-data']);if(!u||!u.id)return null;id=String(u.id);name=clean(u.first_name||u.username)||'Игрок'}
 if(!id)return null;const r=db.users[id]||(db.users[id]={name,created:Date.now(),invited:0,ref:null});r.name=name;return{id,name,rec:r}}
const hits=new Map();function limited(id){const n=Date.now(),a=(hits.get(id)||[]).filter(t=>n-t<6e4);a.push(n);hits.set(id,a);return a.length>120}
const push=(uid,it)=>{(db.inbox[uid]=db.inbox[uid]||[]).push(Object.assign({id:'i'+db.seq++},it));save()};
async function tg(method,body){const r=await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),j=await r.json();if(!j.ok)throw new Error(j.description||'telegram');return j.result}
function validCar(it,price){if(!it||typeof it!=='object')return null;const name=String(it.name||'');const e=catalog[name];if(Object.keys(catalog).length&&!e)return null;
 const year=Math.round(+it.year),mk=Math.round(+it.market);if(!(year>=1900&&year<=2030)||!(mk>0))return null;
 if(e){if(year<e.y1||year>e.y2)return null;if(mk>e.p*(1+(year-e.y1)*.035)*1.001+1)return null}
 if(price>mk*3)return null;if(!PLT.test(it.plate||''))return null;const km=Math.max(0,Math.min(1e6,Math.round(+it.km)||0));
 const def=(Array.isArray(it.def)?it.def:[]).slice(0,4).map(d=>({i:Math.max(0,Math.min(9,Math.round(+d.i)||0)),f:d.f?1:0}));
 return{name:clean(name),year,market:mk,body:BODIES.includes(it.body)?it.body:'s',color:/^#[0-9a-f]{6}$/i.test(it.color)?it.color:'#8c96a0',km,rkm:Math.max(km,Math.min(1e6,Math.round(+it.rkm)||km)),roll:it.roll?1:0,own:Math.max(1,Math.min(9,Math.round(+it.own)||1)),def,plate:it.plate,t:Math.max(0,Math.min(5,Math.round(+it.t)||0))}}
const norm=s=>String(s).toUpperCase().replace(/[ABEKMHOPCTYX]/g,c=>'АВЕКМНОРСТУХ'['ABEKMHOPCTYX'.indexOf(c)]);
const pub=o=>({id:o.id,kind:o.kind,price:o.price,seller:o.sname,item:o.item});
function send(res,code,obj){res.writeHead(code,{'Content-Type':'application/json','Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'Content-Type, X-Init-Data, X-Dev-User','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});res.end(JSON.stringify(obj))}
async function webhook(res,u){try{
 if(u.pre_checkout_query){const q=u.pre_checkout_query;let ok=false;try{const pl=JSON.parse(q.invoice_payload);ok=!!PRODUCTS[pl.p]&&!!pl.u&&q.currency==='XTR'&&q.total_amount===PRODUCTS[pl.p].stars}catch{}
  if(BOT_TOKEN)await tg('answerPreCheckoutQuery',ok?{pre_checkout_query_id:q.id,ok:true}:{pre_checkout_query_id:q.id,ok:false,error_message:'Товар недоступен'})}
 const sp=u.message&&u.message.successful_payment;
 if(sp){const cid=sp.telegram_payment_charge_id;if(cid&&!db.paid[cid]){let pl;try{pl=JSON.parse(sp.invoice_payload)}catch{}
  if(pl&&PRODUCTS[pl.p]&&sp.currency==='XTR'&&sp.total_amount===PRODUCTS[pl.p].stars){db.paid[cid]={u:pl.u,p:pl.p,t:Date.now()};push(String(pl.u),{kind:'product',product:pl.p});save()}}}
 }catch(e){console.error('webhook',e.message)}send(res,200,{ok:true})}
async function route(req,res,url,body){const m=req.method,p=url.pathname;
 if(m=='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Origin':ORIGIN,'Access-Control-Allow-Headers':'Content-Type, X-Init-Data, X-Dev-User','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});return res.end()}
 if(p=='/health')return send(res,200,{ok:true});
 if(p.startsWith('/webhook/')&&m=='POST'){if(p.slice(9)!==WH)return send(res,403,{error:'forbidden'});return webhook(res,body||{})}
 if(p.startsWith('/admin/')){const k=String(url.searchParams.get('key')||''),ok=k.length===WH.length&&crypto.timingSafeEqual(Buffer.from(k),Buffer.from(WH));if(!ok)return send(res,403,{error:'forbidden'});
  if(p=='/admin/payments')return send(res,200,{payments:db.paid,grants:db.grants,users:Object.keys(db.users).length,listings:db.market.length});
  if(p=='/admin/grant'){const q=url.searchParams,uid=String(q.get('uid')||'').trim(),product=q.get('product')||'',amount=Math.round(+q.get('amount')||0),ref=String(q.get('ref')||'').replace(/[^\w.-]/g,'').slice(0,40),note=clean(q.get('note')||'');
   if(!/^\d{3,15}$/.test(uid)||!db.users[uid])return send(res,404,{error:'игрок не найден: он должен хотя бы раз открыть игру'});
   if(!!product===!!amount)return send(res,400,{error:'укажите либо товар, либо сумму'});
   if(product&&!PRODUCTS[product])return send(res,400,{error:'неизвестный товар'});
   if(amount&&!(amount>=1000&&amount<=2e8))return send(res,400,{error:'сумма от 1 000 до 200 000 000'});
   if(ref&&db.grants[ref])return send(res,409,{error:'эта выдача уже была (ref)'});
   const key2=ref||'g'+db.seq++;db.grants[key2]={uid,product:product||null,amount:amount||null,note,t:Date.now()};
   push(uid,product?{kind:'product',product}:{kind:'credit',amount,note:'Выдано администратором: +'+amount.toLocaleString('ru-RU')+' ₽'});save();return send(res,200,{ok:true,player:db.users[uid].name,ref:key2})}
  if(p=='/admin/ui'){const E=s=>String(s).replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c])),K=JSON.stringify(k).replace(/</g,'\\u003c'),opts=Object.entries(PRODUCTS).map(([i,x])=>'<option value="'+E(i)+'">'+E(x.title)+'</option>').join('');
   const rows=Object.entries(db.grants).slice(-15).reverse().map(([r,g])=>'<tr><td>'+E(new Date(g.t).toLocaleString('ru-RU'))+'</td><td>'+E(g.uid)+'</td><td>'+E(g.product||g.amount)+'</td><td>'+E(g.note||'')+'</td></tr>').join('');
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});return res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Админка</title><body style="font:16px system-ui;background:#0e1621;color:#e8eef5;padding:14px;max-width:520px;margin:auto"><h2>Выдача игроку</h2><p>Игрок: <b>'+Object.keys(db.users).length+'</b> · лотов на рынке: <b>'+db.market.length+'</b></p><input id=u placeholder="ID игрока из сообщения" style="width:100%;padding:12px;margin:6px 0;font:inherit"><select id=p style="width:100%;padding:12px;margin:6px 0;font:inherit"><option value="">— или сумма —</option>'+opts+'</select><input id=a placeholder="Сумма в игровых ₽ (если не товар)" inputmode=numeric style="width:100%;padding:12px;margin:6px 0;font:inherit"><input id=n placeholder="Заметка (например, номер платежа)" style="width:100%;padding:12px;margin:6px 0;font:inherit"><button id=b style="width:100%;padding:14px;font:inherit;font-weight:700;background:#2ecc85;border:0;border-radius:10px">Выдать</button><pre id=r style="white-space:pre-wrap"></pre><h3>Последние выдачи</h3><table style="width:100%;font-size:13px">'+rows+'</table><script>const K='+K+';b.onclick=async()=>{b.disabled=true;const q=new URLSearchParams({key:K,uid:u.value,note:n.value,ref:"w"+Date.now()});if(p.value)q.set("product",p.value);else q.set("amount",a.value);try{const j=await(await fetch("/admin/grant?"+q)).json();r.textContent=JSON.stringify(j,null,1)}catch(e){r.textContent="ошибка сети"}setTimeout(()=>b.disabled=false,1500)}</script>')}
  if(p=='/admin/refund'){const cid=String(url.searchParams.get('charge')||''),pay=db.paid[cid];if(!pay)return send(res,404,{error:'no payment'});if(pay.refunded)return send(res,409,{error:'already'});
   try{await tg('refundStarPayment',{user_id:+pay.u,telegram_payment_charge_id:cid});pay.refunded=true;save();return send(res,200,{ok:true})}catch(e){return send(res,502,{error:'telegram'})}}}
 const me=auth(req);if(!me)return send(res,401,{error:'auth'});if(limited(me.id))return send(res,429,{error:'rate'});
 if(p=='/api/me')return send(res,200,{uid:me.id,name:me.name,invited:me.rec.invited||0});
 if(p=='/api/save'&&m=='GET')return send(res,200,{d:(db.saves[me.id]||{}).d||null});
 if(p=='/api/save'&&m=='POST'){if(typeof body.d!=='string'||body.d.length>500000)return send(res,400,{error:'size'});db.saves[me.id]={d:body.d,ts:Date.now()};save();return send(res,200,{ok:true})}
 if(p=='/api/ref'&&m=='POST'){const code=String(body.code||'').replace(/\D/g,''),inv=db.users[code];
  if(me.rec.ref)return send(res,409,{error:'already'});if(!inv||code===me.id)return send(res,400,{error:'bad code'});if((inv.invited||0)>=20)return send(res,409,{error:'limit'});
  me.rec.ref=code;inv.invited=(inv.invited||0)+1;push(code,{kind:'credit',amount:500000,note:'Друг '+me.name+' зашёл по вашей ссылке: +500 000 ₽'});push(me.id,{kind:'credit',amount:300000,note:'Приветственный бонус: +300 000 ₽'});save();return send(res,200,{ok:true})}
 if(p=='/api/market'&&m=='GET'){const kind=url.searchParams.get('kind')=='plate'?'plate':'car',q=norm(url.searchParams.get('q')||'');
  const items=db.market.filter(o=>o.kind==kind&&o.seller!==me.id&&(!q||norm(o.kind=='car'?o.item.name+' '+o.item.year+' '+o.item.plate:o.item.p).includes(q))).slice(-50).reverse().map(pub);return send(res,200,{items})}
 if(p=='/api/market/mine'&&m=='GET')return send(res,200,{items:db.market.filter(o=>o.seller===me.id).map(pub)});
 if(p=='/api/market/list'&&m=='POST'){const price=Math.round(+body.price),kind=body.kind;
  if(!(price>=1000&&price<=2e9))return send(res,400,{error:'price'});if(db.market.filter(o=>o.seller===me.id).length>=10)return send(res,400,{error:'limit'});
  let item=null;if(kind=='car')item=validCar(body.item,price);else if(kind=='plate'&&body.item&&PLT.test(body.item.p||''))item={p:body.item.p,t:Math.max(0,Math.min(5,Math.round(+body.item.t)||0))};
  if(!item)return send(res,400,{error:'item'});const o={id:String(db.seq++),kind,price,seller:me.id,sname:me.name,item,cost:Math.max(0,Math.round(+body.cost)||0),t:Date.now()};db.market.push(o);save();return send(res,200,{id:o.id})}
 if(p=='/api/market/buy'&&m=='POST'){const i=db.market.findIndex(o=>o.id===String(body.id));if(i<0)return send(res,409,{error:'gone'});const o=db.market[i];if(o.seller===me.id)return send(res,400,{error:'own'});
  db.market.splice(i,1);push(o.seller,{kind:'credit',amount:Math.floor(o.price*.95),note:'Продано игроку '+me.name+': '+(o.kind=='car'?o.item.name:o.item.p)+' (+'+Math.floor(o.price*.95).toLocaleString('ru-RU')+' ₽)'});save();return send(res,200,{kind:o.kind,item:o.item,price:o.price})}
 if(p=='/api/market/cancel'&&m=='POST'){const i=db.market.findIndex(o=>o.id===String(body.id)&&o.seller===me.id);if(i<0)return send(res,404,{error:'none'});const o=db.market.splice(i,1)[0];save();return send(res,200,{kind:o.kind,item:o.item,cost:o.cost})}
 if(p=='/api/inbox'&&m=='GET')return send(res,200,{items:db.inbox[me.id]||[]});
 if(p=='/api/inbox/ack'&&m=='POST'){const ids=new Set((body.ids||[]).map(String));db.inbox[me.id]=(db.inbox[me.id]||[]).filter(x=>!ids.has(x.id));save();return send(res,200,{ok:true})}
 if(p=='/api/invoice'&&m=='POST'){const pr=PRODUCTS[body.product];if(!pr)return send(res,400,{error:'product'});if(!BOT_TOKEN)return send(res,503,{error:'no bot'});
  try{const url2=await tg('createInvoiceLink',{title:pr.title,description:pr.title,payload:JSON.stringify({u:me.id,p:body.product,n:crypto.randomBytes(4).toString('hex')}),provider_token:'',currency:'XTR',prices:[{label:pr.title,amount:pr.stars}]});return send(res,200,{url:url2})}catch(e){return send(res,502,{error:'telegram'})}}
 send(res,404,{error:'not found'})}
function createServer(){return http.createServer((req,res)=>{let data='';req.on('data',c=>{data+=c;if(data.length>600000)req.destroy()});req.on('end',()=>{let body={};try{if(data)body=JSON.parse(data)}catch{return send(res,400,{error:'json'})}
 route(req,res,new URL(req.url,'http://x'),body).catch(e=>{console.error(e);send(res,500,{error:'server'})})})})}
module.exports={createServer,verifyInitData,db,flush};
if(require.main===module&&!DEV&&(!process.env.WEBHOOK_SECRET||process.env.WEBHOOK_SECRET.length<12)){console.error('Задайте переменную WEBHOOK_SECRET (длинная случайная строка, от 12 символов)');process.exit(1)}
if(require.main===module&&!DEV&&!BOT_TOKEN){console.error('Задайте переменную BOT_TOKEN');process.exit(1)}
if(require.main===module)createServer().listen(PORT,()=>console.log('Перекуп сервер на порту '+PORT+(DEV?' (DEV)':'')));
