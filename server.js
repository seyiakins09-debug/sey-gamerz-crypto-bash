const express=require("express"), http=require("http"), {Server}=require("socket.io");
const app=express(), server=http.createServer(app), io=new Server(server);
app.use(express.static("public"));
const PORT=process.env.PORT||3000;
const STARTING_CASH=500000, ROUND_MS=10*60*1000;
const COINS={
 BTC:{name:"Bitcoin",symbol:"BTC",price:65000,vol:0.018},
 ETH:{name:"Ethereum",symbol:"ETH",price:3400,vol:0.025},
 SOL:{name:"Solana",symbol:"SOL",price:165,vol:0.04},
 DOGE:{name:"Dogecoin",symbol:"DOGE",price:0.18,vol:0.055}
};
let rooms={};
function newRoom(key,hostId){
 let coins={}; for(const [k,v] of Object.entries(COINS)) coins[k]={...v,price:v.price,history:[v.price]};
 return rooms[key]={key,hostId,hostName:"HOST",players:{},set:1,round:1,started:false,paused:false,ended:false,deadline:null,remaining:ROUND_MS,coins,interval:null};
}
function roomState(r){
 const players=Object.values(r.players).map(p=>({id:p.id,name:p.name,cash:p.cash,holdings:p.holdings,portfolio:portfolio(p,r),netWorth:netWorth(p,r),profit:netWorth(p,r)-STARTING_CASH, trades:p.trades.slice(-8)}));
 return {key:r.key,set:r.set,round:r.round,started:r.started,paused:r.paused,ended:r.ended,remaining:r.started&&!r.paused&&!r.ended?Math.max(0,r.deadline-Date.now()):r.remaining,coins:r.coins,players,startingCash:STARTING_CASH};
}
function portfolio(p,r){return Object.entries(p.holdings).reduce((s,[k,q])=>s+q*r.coins[k].price,0)}
function netWorth(p,r){return p.cash+portfolio(p,r)}
function emitRoom(r){io.to(r.key).emit("state",roomState(r))}
function tick(r){
 if(!r.started||r.paused||r.ended)return;
 const now=Date.now();
 for(const [k,c] of Object.entries(r.coins)){
   const drift=(Math.random()-.49)*c.vol;
   const jump=(Math.random()<.025?(Math.random()-.5)*c.vol*3:0);
   c.price=Math.max(c.price*.02,c.price*(1+drift+jump));
   c.history.push(c.price); if(c.history.length>90)c.history.shift();
 }
 r.remaining=Math.max(0,r.deadline-now);
 if(r.remaining<=0){r.ended=true;r.started=false;clearInterval(r.interval);r.interval=null;io.to(r.key).emit("roundEnd",roomState(r))}
 emitRoom(r);
}
function fail(s,msg){s.emit("notice",{type:"error",message:msg})}
io.on("connection",s=>{
 s.on("createRoom",({name})=>{
  let key; do{key=Math.random().toString(36).slice(2,7).toUpperCase()}while(rooms[key]);
  const r=newRoom(key,s.id);r.hostName=(name||"Host").trim().slice(0,24)||"Host";s.join(key);s.data.room=key;s.data.role="host";
  s.emit("joined",{role:"host",key,name:r.hostName,startingCash:STARTING_CASH});emitRoom(r);
 });
 s.on("joinRoom",({key,name})=>{
  key=(key||"").trim().toUpperCase();const r=rooms[key];if(!r)return fail(s,"Room key not found.");
  if(r.ended)return fail(s,"This game has ended.");
  if(Object.keys(r.players).length>=50)return fail(s,"Room is full (50 players maximum).");
  const nickname=(name||"Player").trim().slice(0,24)||"Player";
  const id=s.id;r.players[id]={id,name:nickname,cash:STARTING_CASH,holdings:{BTC:0,ETH:0,SOL:0,DOGE:0},trades:[]};
  s.join(key);s.data.room=key;s.data.role="player";s.emit("joined",{role:"player",key,name:nickname,startingCash:STARTING_CASH});emitRoom(r);
 });
 s.on("hostAction",({action,value})=>{
  const r=rooms[s.data.room];if(!r||s.data.role!=="host"||r.hostId!==s.id)return;
  if(action==="start"){if(r.ended)return;r.started=true;r.paused=false;r.deadline=Date.now()+r.remaining;if(!r.interval)r.interval=setInterval(()=>tick(r),1000)}
  if(action==="pause"&&r.started&&!r.paused){r.remaining=Math.max(0,r.deadline-Date.now());r.paused=true}
  if(action==="resume"&&r.started&&r.paused){r.paused=false;r.deadline=Date.now()+r.remaining}
  if(action==="next"||action==="set"){if(r.interval){clearInterval(r.interval);r.interval=null}r.set=action==="set"?Math.min(10,Math.max(1,Number(value)||1)):Math.min(10,r.set+1);r.round=r.set;r.started=false;r.paused=false;r.ended=false;r.remaining=ROUND_MS;r.deadline=null}
  if(action==="end"){r.ended=true;r.started=false;r.paused=false;if(r.interval)clearInterval(r.interval);r.interval=null}
  emitRoom(r);
 });
 s.on("trade",({side,symbol,quantity})=>{
  const r=rooms[s.data.room],p=r&&r.players[s.id];if(!r||!p||s.data.role!=="player")return;
  if(!r.started||r.paused||r.ended)return fail(s,"Trading is available only while the round is running.");
  const c=r.coins[symbol],q=Number(quantity);if(!c||!Number.isFinite(q)||q<=0||q>1e12)return fail(s,"Enter a valid quantity.");
  const cost=q*c.price;
  if(side==="buy"){if(cost>p.cash+0.00001)return fail(s,"Not enough available game coins.");p.cash-=cost;p.holdings[symbol]+=q}
  else if(side==="sell"){if(q>p.holdings[symbol]+1e-10)return fail(s,"You don't own enough of this crypto.");p.holdings[symbol]-=q;p.cash+=cost}
  else return;
  p.trades.push({side,symbol,quantity:q,price:c.price,total:cost,time:new Date().toISOString()});
  io.to(r.key).emit("tradeNotice",{player:p.name,side,symbol,quantity:q,price:c.price});emitRoom(r);
 });
 s.on("disconnect",()=>{const r=rooms[s.data.room];if(!r)return;if(s.data.role==="player"&&r.players[s.id]){delete r.players[s.id];emitRoom(r)}});
});
server.listen(PORT,()=>console.log("Crypto Bash running on "+PORT));