// Minimal WebRTC signaling server. Media flows peer-to-peer; this server only relays signaling.
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ port: Number(process.env.PORT || 8787) });
const rooms = new Map();
function send(ws, data){if(ws.readyState===1)ws.send(JSON.stringify(data));}
wss.on('connection', ws => {
 ws.on('message', raw => {let m;try{m=JSON.parse(raw)}catch{return}
  if(m.type==='join'){
   const room=String(m.room||'').replace(/[^a-z0-9_-]/gi,'').slice(0,32).toUpperCase();if(!room)return send(ws,{type:'error',message:'Invalid meeting code'});
   let members=rooms.get(room);if(!members){members=new Map();rooms.set(room,members)}
   if(members.size>=12)return send(ws,{type:'error',message:'This demo room is full (12 participants max).'});
   ws.room=room;ws.id=String(m.id);ws.name=String(m.name||'Guest').slice(0,40);const existing=[...members.values()].map(p=>({id:p.id,name:p.name}));members.set(ws.id,ws);
   send(ws,{type:'joined',room,count:members.size,peers:existing});for(const p of members.values())if(p!==ws)send(p,{type:'peer-joined',id:ws.id,name:ws.name});
  } else if(m.type==='signal'&&ws.room){const target=rooms.get(ws.room)?.get(String(m.to));if(target)send(target,{type:'signal',from:ws.id,data:m.data});}
  else if(m.type==='leave')disconnect(ws);
 });ws.on('close',()=>disconnect(ws));
});
function disconnect(ws){if(!ws.room)return;const r=rooms.get(ws.room);if(r){r.delete(ws.id);for(const p of r.values())send(p,{type:'peer-left',id:ws.id});if(!r.size)rooms.delete(ws.room);}ws.room=null;}
wss.on('listening',()=>console.log('Signaling server listening on '+(process.env.PORT||8787)));
