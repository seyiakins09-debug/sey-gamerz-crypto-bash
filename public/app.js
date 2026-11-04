const socket=io();let role=null,roomKey=null,state=null,selected="BTC",toastTimer;
const $=id=>document.getElementById(id), fmt=n=>new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(n||0), qty=n=>Number(n||0).toLocaleString("en-US",{maximumFractionDigits:6});
const coinMeta={BTC:{name:"Bitcoin",icon:"₿"},ETH:{name:"Ethereum",icon:"Ξ"},SOL:{name:"Solana",icon:"◎"},DOGE:{name:"Dogecoin",icon:"Ð"}};
function notice(msg,error=false){$("toast").textContent=msg;$("toast").classList.remove("hidden","error");if(error)$("toast").classList.add("error");clearTimeout(toastTimer);toastTimer=setTimeout(()=>$("toast").classList.add("hidden"),3500)}
$("create").onclick=()=>socket.emit("createRoom",{name:$("hostName").value});
$("join").onclick=()=>socket.emit("joinRoom",{name:$("playerName").value,key:$("roomKey").value});
$("copyRoom").onclick=()=>navigator.clipboard?.writeText(roomKey).then(()=>notice("Room key copied")).catch(()=>notice("Room key: "+roomKey));
$("startBtn").onclick=()=>socket.emit("hostAction",{action:"start"});
$("pauseBtn").onclick=()=>socket.emit("hostAction",{action:"pause"});
$("resumeBtn").onclick=()=>socket.emit("hostAction",{action:"resume"});
$("nextBtn").onclick=()=>socket.emit("hostAction",{action:"next"});
$("endBtn").onclick=()=>{if(confirm("End the Crypto Bash game for everyone?"))socket.emit("hostAction",{action:"end"})};
$("setSelect").innerHTML=Array.from({length:10},(_,i)=>`<option value="${i+1}">Set ${String(i+1).padStart(2,"0")}</option>`).join("");
$("setSelect").onchange=()=>socket.emit("hostAction",{action:"set",value:$("setSelect").value});
$("buyBtn").onclick=()=>trade("buy");$("sellBtn").onclick=()=>trade("sell");
function trade(side){const q=Number($("quantity").value);if(!q||q<=0)return notice("Enter a quantity first.",true);socket.emit("trade",{side,symbol:selected,quantity:q});$("quantity").value=""}
socket.on("joined",d=>{role=d.role;roomKey=d.key;$("lobby").classList.add("hidden");$("game").classList.remove("hidden");$("roomDisplay").textContent=roomKey;$("roleLabel").textContent=role==="host"?"HOST CONTROL TERMINAL":"PLAYER TRADING TERMINAL";$("hostPanel").classList.toggle("hidden",role!=="host");if(role==="host"){$("tradePanel")?.classList.add("hidden");$("buyBtn").disabled=true;$("sellBtn").disabled=true;notice("Room created! Share key "+roomKey)}else notice("Joined room "+roomKey+" — ₵500,000 game cash ready.");});
socket.on("notice",d=>notice(d.message,d.type==="error"));
socket.on("state",s=>{state=s;render()});
socket.on("roundEnd",()=>notice("Set finished! Host may move to the next set."));
socket.on("tradeNotice",d=>notice(`${d.player} ${d.side==="buy"?"bought":"sold"} ${qty(d.quantity)} ${d.symbol}`));
function render(){if(!state)return;$("roundDisplay").textContent=`${String(state.set).padStart(2,"0")} / 10`;$("setSelect").value=state.set;
const sec=Math.ceil(state.remaining/1000);$("timer").textContent=`${String(Math.floor(sec/60)).padStart(2,"0")}:${String(sec%60).padStart(2,"0")}`;
$("startBtn").textContent=state.ended?"GAME ENDED":state.started?"ROUND RUNNING":"START ROUND";$("startBtn").disabled=state.started||state.ended;$("pauseBtn").disabled=!state.started||state.paused;$("resumeBtn").disabled=!state.started||!state.paused;$("nextBtn").disabled=state.set>=10;
$("coinTabs").innerHTML=Object.entries(state.coins).map(([k,c])=>`<button class="coin-tab ${k===selected?"active":""}" data-coin="${k}">${k} ${fmt(c.price)}</button>`).join("");
document.querySelectorAll("[data-coin]").forEach(b=>b.onclick=()=>{selected=b.dataset.coin;render()});
const c=state.coins[selected];$("chartPrice").textContent=fmt(c.price);const first=c.history[0]||c.price,change=(c.price/first-1)*100;$("chartChange").textContent=(change>=0?"+":"")+change.toFixed(2)+"% since set";$("chartChange").style.color=change>=0?"#32d69a":"#ff6475";
$("selectedIcon").textContent=coinMeta[selected].icon;$("selectedName").textContent=coinMeta[selected].name;$("selectedSymbol").textContent=selected;$("selectedPrice").textContent=fmt(c.price);
drawChart(c.history);
const me=state.players.find(p=>p.id===socket.id);if(me){$("cash").textContent=fmt(me.cash);$("portfolio").textContent=fmt(me.portfolio);$("netWorth").textContent=fmt(me.netWorth);$("cryptoValue").textContent=fmt(me.portfolio);$("pnl").textContent=(me.profit>=0?"+":"")+fmt(me.profit);$("pnl").style.color=me.profit>=0?"#32d69a":"#ff6475";
$("holdings").innerHTML=Object.entries(me.holdings).map(([k,q])=>`<div class="holding"><small>${k} HOLDING</small><b>${qty(q)}</b><small>${fmt(q*state.coins[k].price)}</small></div>`).join("");
$("history").innerHTML=me.trades.length?me.trades.slice().reverse().map(t=>`<div class="trade-row"><span class="${t.side==="buy"?"buy-text":"sell-text"}">${t.side.toUpperCase()} ${qty(t.quantity)} ${t.symbol}</span><span>${fmt(t.total)}</span></div>`).join(""):"No trades yet. Your activity will appear here.";
}
$("leaderboard").innerHTML=state.players.slice().sort((a,b)=>b.netWorth-a.netWorth).map((p,i)=>`<div class="leader-row"><span class="rank">#${i+1}</span><div>${esc(p.name)} ${p.id===socket.id?'<small>YOU</small>':''}<small>Cash ${fmt(p.cash)} · Crypto ${fmt(p.portfolio)}</small></div><strong style="color:${p.profit>=0?"#32d69a":"#ff6475"}">${p.profit>=0?"+":""}${fmt(p.profit)}</strong></div>`).join("")||"<p class='muted'>Waiting for players to join…</p>";
const active=state.started&&!state.paused&&!state.ended;$("buyBtn").disabled=role!=="player"||!active;$("sellBtn").disabled=role!=="player"||!active;$("quantity").disabled=role!=="player"||!active;$("tradeHint").textContent=state.ended?"Game ended. Trading is closed.":state.paused?"Round paused. Wait for host to resume.":!state.started?"Waiting for host to start the round.":"Trading is live. All trades use virtual game coins.";
}
function drawChart(values){const canvas=$("chart"),ctx=canvas.getContext("2d"),dpr=window.devicePixelRatio||1,w=canvas.clientWidth,h=190;canvas.width=w*dpr;canvas.height=h*dpr;ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);for(let i=0;i<4;i++){ctx.strokeStyle="#252c34";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(0,i*h/3);ctx.lineTo(w,i*h/3);ctx.stroke()}if(values.length<2)return;let min=Math.min(...values),max=Math.max(...values);if(max===min){max*=1.001;min*=.999}const pts=values.map((v,i)=>({x:i/(values.length-1)*w,y:h-12-(v-min)/(max-min)*(h-24)}));ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));ctx.strokeStyle=values.at(-1)>=values[0]?"#32d69a":"#ff6475";ctx.lineWidth=2.5;ctx.stroke();ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.closePath();const grad=ctx.createLinearGradient(0,0,0,h);grad.addColorStop(0,values.at(-1)>=values[0]?"#32d69a30":"#ff647530");grad.addColorStop(1,"#10131800");ctx.fillStyle=grad;ctx.fill()}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
setInterval(()=>{if(state&&state.started&&!state.paused&&!state.ended){const sec=Math.ceil(state.remaining/1000)-1;$("timer").textContent=`${String(Math.max(0,Math.floor(sec/60))).padStart(2,"0")}:${String(Math.max(0,sec%60)).padStart(2,"0")}`}},1000);
