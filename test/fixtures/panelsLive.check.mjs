// Run with the REAL discord.js (no stubs):  node test/fixtures/panelsLive.check.mjs
// Builds genuine interaction objects, records the REST calls they make, and checks WHAT Discord would be told
// (callback types: 4 = new message, 7 = edit the card, 6 = acknowledge then edit, 9 = open a form; EPH = private).
process.env.DISCORD_TOKEN='x';process.env.CLIENT_ID='1';process.env.MONGODB_URI='mongodb://x';process.env.SESSION_SECRET='s'.repeat(40);process.env.ADMIN_IDS='999';process.env.DISCORD_CLIENT_SECRET='x';
import assert from 'node:assert/strict';
const R=new URL('../../src/', import.meta.url).href;
const D=await import('discord.js');
const { Client, ButtonInteraction, StringSelectMenuInteraction, ModalSubmitInteraction, GatewayIntentBits } = D;
const M=async(p,n)=> (await import(R+'models/'+p+'.js'))[n];
const GuildSettings=await M('GuildSettings','GuildSettings'), ReligiousEvent=await M('ReligiousEvent','ReligiousEvent'), CustomStation=await M('CustomStation','CustomStation'), Favorites=await M('Favorites','Favorites');
const lean=(v)=>({lean:async()=>v});
GuildSettings.getLanguage=async()=>'ar'; GuildSettings.findOne=()=>lean({adhkar:{},ayah:{},wird:{}}); GuildSettings.findOneAndUpdate=async()=>({});
const ev={_id:'a'.repeat(24),title:'T',description:'',channelId:'7',roleId:null,time:'21:00',timezone:'Africa/Cairo',startDate:'2027-02-08',endDate:'2027-02-08',enabled:true};
const chain=(v)=>({sort:()=>({limit:()=>({lean:async()=>v}),lean:async()=>v}),lean:async()=>v});
ReligiousEvent.find=()=>chain([ev]);ReligiousEvent.findOne=()=>lean(ev);ReligiousEvent.countDocuments=async()=>1;
CustomStation.find=()=>chain([]);CustomStation.countDocuments=async()=>0;
Favorites.getOrCreate=async()=>({surahs:[1],reciters:[]});

function mk(Cls, customId, {ephemeral=true, perms='8', extra={}}={}){
  const calls=[]; const client=new Client({intents:[GatewayIntentBits.Guilds]});
  const rec=(verb)=>async(route,opts)=>{calls.push(`${verb} ${String(route).split('/').pop()} type=${opts?.body?.type??'-'}${(opts?.body?.data?.flags&64)?' EPH':''}${opts?.body?.data?.custom_id?' modal='+opts.body.data.custom_id:''}`);
    return {id:'900',channel_id:'7',resource:{message:{id:'900',channel_id:'7',author:{id:'1'},content:'',flags:64,components:[],embeds:[]}}};};
  client.guilds.cache.set('55555555555555555',{id:'55555555555555555',channels:{cache:new Map([['7',{id:'7'}]])},roles:{cache:new Map()},members:{me:{},_add:(m)=>m}});
  client.rest.post=rec('POST');client.rest.patch=rec('PATCH');client.rest.get=async()=>[];client.rest.delete=rec('DELETE');
  const msg={id:'800000000000000001',channel_id:'77777777777777777',author:{id:'1',username:'bot',discriminator:'0',avatar:null},content:'',flags:ephemeral?64:0,type:0,embeds:[],components:[],attachments:[],mentions:[],mention_roles:[],pinned:false,tts:false,timestamp:new Date().toISOString(),edited_timestamp:null};
  const base={id:'100000000000000001',application_id:'1',token:'t'.repeat(90),version:1,guild_id:'55555555555555555',channel_id:'77777777777777777',entitlements:[],authorizing_integration_owners:{'0':'55555555555555555'},context:0,app_permissions:'8',locale:'en-US',guild_locale:'en-US',
    member:{user:{id:'42',username:'u',discriminator:'0',avatar:null},roles:[],permissions:perms,joined_at:new Date().toISOString(),deaf:false,mute:false,flags:0},message:msg,...extra};
  let i;
  if(Cls===ModalSubmitInteraction) i=new Cls(client,{...base,type:5,data:{custom_id:customId,components:extra._fields??[]}});
  else if(Cls===StringSelectMenuInteraction) i=new Cls(client,{...base,type:3,data:{custom_id:customId,component_type:3,values:extra._values??[]}});
  else i=new Cls(client,{...base,type:3,data:{custom_id:customId,component_type:2}});
  return {i,calls};
}
const row=(id,v)=>({type:1,components:[{type:4,custom_id:id,value:v}]});
const T=[
 // [name, class, custom id, options, expected sequence of REST calls (regex per call)]
 ['panel:more opens the tools card privately',        ButtonInteraction,'panel:more',{ephemeral:false},[/type=4 EPH/]],
 ['tools menu → memorize edits the card in place',    StringSelectMenuInteraction,'panel:tool',{extra:{_values:['mem']}},[/type=7/]],
 ['tools menu → favourites acknowledges then fills',  StringSelectMenuInteraction,'panel:tool',{extra:{_values:['fav']}},[/type=6/,/PATCH/]],
 ['reciter menu "another reciter" opens the form',    StringSelectMenuInteraction,'panel:pick_reciter',{ephemeral:false,extra:{_values:['__search']}},[/type=9 modal=panel:rec_modal/]],
 ['search form with nothing typed warns in place',    ModalSubmitInteraction,'panel:rec_modal',{extra:{_fields:[row('q',''),row('r','')]}},[/type=7/]],
 ['sleep timer without a session is refused',         StringSelectMenuInteraction,'panel:sleep_set',{extra:{_values:['30']}},[/type=4 EPH/]],
 ['/setup menu → events (admin)',                     StringSelectMenuInteraction,'hub:go',{extra:{_values:['events']}},[/type=7/]],
 ['/setup menu (NOT admin) is refused',               StringSelectMenuInteraction,'hub:go',{perms:'0',extra:{_values:['events']}},[/type=4 EPH/]],
 ['events: add opens the form',                       ButtonInteraction,'events:add',{},[/type=9 modal=events:add_modal/]],
 ['events: pick shows the event card',                StringSelectMenuInteraction,'events:pick',{extra:{_values:['a'.repeat(24)]}},[/type=7/]],
 ['events form, bad time → private error note',       ModalSubmitInteraction,'events:add_modal',{extra:{_fields:[row('title','x'),row('time','25:99'),row('start',''),row('end',''),row('description','')]}},[/type=6/,/POST/]],
 ['stations: add opens the form',                     ButtonInteraction,'stations:add',{},[/type=9 modal=stations:add_modal:guild/]],
 ['stations form, not a URL → note on the page',      ModalSubmitInteraction,'stations:add_modal:guild',{extra:{_fields:[row('name','x'),row('url','not a url')]}},[/type=6/,/PATCH/]],
 ['stations: public station by a non-owner refused',  ModalSubmitInteraction,'stations:add_modal:global',{extra:{_fields:[row('name','x'),row('url','https://x.y/s')]}},[/type=4 EPH/]],
 ['adhkar page (admin) edits the card',               ButtonInteraction,'adhkar:view:ayah',{},[/type=7/]],
 ['hadith page (admin) edits the card with real components', ButtonInteraction,'adhkar:view:hadith',{},[/type=7/]],
 ['hadith page: turning on without a room is refused privately', ButtonInteraction,'adhkar:hadith:toggle',{},[/type=4 EPH/]],
 ['hadith page (NOT admin) is refused',               ButtonInteraction,'adhkar:hadith:toggle',{perms:'0'},[/type=4 EPH/]],
 ['adhkar page (NOT admin) is refused',               ButtonInteraction,'adhkar:toggle',{perms:'0'},[/type=4 EPH/]],
];
const handlers = {
  panel: async (i) => (await import(R + 'components/buttonHandler.js')).handleButton(i),
  hub: async (i) => (await import(R + 'panels/hub.js')).handleHub(i),
  events: async (i) => (await import(R + 'panels/eventsPanel.js')).handleEventsComponent(i),
  stations: async (i) => (await import(R + 'panels/stationsPanel.js')).handleStationsComponent(i),
  adhkar: async (i) => (await import(R + 'panels/adhkarPanel.js')).handleAdhkarComponent(i)
};
for (const [name, Cls, id, o, expect] of T) {
  const { i, calls } = mk(Cls, id, o);
  await handlers[id.split(':')[0]](i);
  assert.equal(calls.length, expect.length, `${name}: ${calls.join(' ; ')}`);
  expect.forEach((re, k) => assert.match(calls[k], re, `${name}: ${calls[k]}`));
  console.log('ok', name);
}

// The /help menu buttons that reuse the wird screens: a NEW private message, never an edit of the menu card.
const { WirdSubscription } = await import(R + 'models/WirdSubscription.js');
const { handleMenu } = await import(R + 'panels/menu.js');
let SUB = null;
WirdSubscription.findOne = () => lean(SUB);
{ const { i, calls } = mk(ButtonInteraction, 'menu:wird', {}); await handleMenu(i);
  assert.equal(calls.length, 1); assert.match(calls[0], /type=9/);            // not subscribed yet → the subscribe form
  assert.equal(i.replied || i.deferred, false);                                // the real interaction is untouched
  console.log('ok /help → wird (new member) opens the form'); }
SUB = { userId: '42', active: true, pagesPerDay: 2, time: '08:00', timezone: 'Africa/Cairo', startPage: 0, donePage: 10, lang: 'ar', expiresAt: new Date(Date.now() + 864e5 * 20), createdAt: new Date(), streak: 1, lastReadDate: null };
{ const { i, calls } = mk(ButtonInteraction, 'menu:wird', {}); await handleMenu(i);
  assert.equal(calls.length, 1); assert.match(calls[0], /type=4 EPH/);        // a new private message, the menu stays
  console.log('ok /help → wird (subscribed) sends a new private card'); }
{ const { i, calls } = mk(ButtonInteraction, 'menu:mushaf', {}); await handleMenu(i);
  assert.match(calls[0], /type=5 EPH/);                                        // acknowledges privately, then fills a new message
  console.log('ok /help → mushaf opens a new private message'); }
console.log('all live-interaction checks passed');
process.exit(0);
