/* ANON_ME! live app. Talks to Supabase for accounts, messages and live updates. */
(function(){
const C=window.ANON_CONFIG||{};
const CAP=10, MAXLEN=300;
const phone=document.getElementById('phone');
const configured=!!(C.supabaseUrl&&C.supabaseAnonKey&&!/YOUR-PROJECT/.test(C.supabaseUrl)&&!/YOUR-ANON/.test(C.supabaseAnonKey)&&window.supabase);
const BASE=location.origin+location.pathname;
// What the email link brought back (read before Supabase tidies the address bar).
const LINK=new URLSearchParams(location.hash.replace(/^#/,'')+'&'+location.search.replace(/^\?/,''));
const linkType=LINK.get('type'), linkError=LINK.get('error_description')||LINK.get('error');
let recovering=linkType==='recovery';
const sb=configured?window.supabase.createClient(C.supabaseUrl,C.supabaseAnonKey,{auth:{flowType:'implicit',detectSessionInUrl:true,persistSession:true}}):null;
if(sb)sb.auth.onAuthStateChange(ev=>{ if(ev==='PASSWORD_RECOVERY')recovering=true; });

/* ---------- state ---------- */
let me=null;                 // {id,email,username}
let threads=[], msgs=[];     // owner's inbox, and messages of the open chat
let V={name:'splash'}, overlay=null;
let toastMsg='', toastTimer=null, otpTimer=null, otpLeft=59, pollTimer=null, channel=null, rtTimer=null;
let pending={};              // email address carried between auth steps

/* ---------- this browser's anonymous identity (never tied to a person) ---------- */
function uuid(){ if(window.crypto&&crypto.randomUUID)return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return(c==='x'?r:(r&3|8)).toString(16);});}
function lsGet(k,d){try{const v=localStorage.getItem(k);return v?JSON.parse(v):d;}catch(e){return d;}}
function lsSet(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(e){}}
let memToken=null;
function token(){let t=lsGet('anonme-token',null)||memToken; if(!t){t=uuid(); memToken=t; lsSet('anonme-token',t);} return t;}
const sentList=()=>lsGet('anonme-sent',[]);
function rememberSent(id,username,preview){const l=sentList().filter(x=>x.id!==id); l.unshift({id,username,preview:preview.slice(0,60)}); lsSet('anonme-sent',l.slice(0,30));}

/* ---------- helpers ---------- */
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const linkFor=u=>BASE+'?u='+encodeURIComponent(u);
const myLink=()=>linkFor(me?me.username:'');
const unread=()=>threads.filter(t=>t.unread).length;
function ago(t){const d=Date.now()-new Date(t).getTime(),H=3600e3,D=24*H; if(d<60e3)return'just now'; if(d<H)return Math.floor(d/60e3)+' min ago'; if(d<D)return Math.floor(d/H)+' h ago'; return Math.floor(d/D)+' d ago';}
async function q(p){const r=await p; if(r.error)throw r.error; return r.data;}
function friendly(e){const m=(e&&e.message)||String(e);
  if(/Invalid login credentials/i.test(m))return'Wrong email or password.';
  if(/already registered|already been registered/i.test(m))return'That email already has an account. Log in instead.';
  if(/expired|invalid/i.test(m)&&/token|otp|link/i.test(m))return'That email link has expired or was already used. Request a new one.';
  if(/rate limit|security purposes|too many/i.test(m))return'Too many attempts. Wait a minute and try again.';
  if(/blocked_words/.test(m))return'Your message contains language that is not allowed. Rewrite it and try again.';
  if(/rate_limited/.test(m))return'You are sending too fast. Wait a few minutes and try again.';
  if(/thread_closed/.test(m))return'This chat reached its '+CAP+'-message limit and is closed.';
  if(/thread_blocked/.test(m))return'This person is not accepting messages from you.';
  if(/no_user|not_found/.test(m))return'We could not find that. The link may be wrong.';
  if(/Failed to fetch|NetworkError/i.test(m))return'No connection. Check your internet and try again.';
  return m;}
function setUrl(qs){try{history.replaceState(null,'',BASE+(qs||''));}catch(e){}}
function toast(m){toastMsg=m; clearTimeout(toastTimer); toastTimer=setTimeout(()=>{toastMsg=''; const t=phone.querySelector('.toast'); if(t)t.remove();},2800);
  const old=phone.querySelector('.toast'); if(old)old.remove(); phone.insertAdjacentHTML('beforeend','<div class="toast" role="status">'+esc(m)+'</div>');}
function copy(text,done){const fail=()=>toast('Press and hold the link to copy it'); try{navigator.clipboard.writeText(text).then(()=>toast(done),fail);}catch(e){fail();}}
const val=id=>{const e=document.getElementById(id);return e?e.value.trim():'';};
const showErr=(id,m)=>{const e=document.getElementById(id); if(e)e.textContent=m;};

const ic={
  gear:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l2-1.5-2-3.4-2.3 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.5 2.6A7.6 7.6 0 0 0 6.9 6.6l-2.3-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 3l-2 1.5 2 3.4 2.3-1a7.6 7.6 0 0 0 2.6 1.5l.5 2.6h4l.5-2.6a7.6 7.6 0 0 0 2.6-1.5l2.3 1 2-3.4z"/></svg>',
  back:'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 12H5M11 5l-7 7 7 7"/></svg>',
  chev:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 5l7 7-7 7"/></svg>',
  tg:'<svg width="16" height="16" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#2AA3DF"/><path fill="#fff" d="M5.5 11.8l11-4.3c.5-.2 1 .1.8.9l-1.9 8.8c-.1.6-.5.8-1 .5l-2.9-2.1-1.4 1.3c-.2.2-.3.3-.6.3l.2-3 5.4-4.9c.2-.2 0-.3-.3-.1l-6.7 4.2-2.9-.9c-.6-.2-.6-.6.3-.7z"/></svg>',
  share:'<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 5l6 6-6 6M20 11H9a5 5 0 0 0-5 5v3"/></svg>',
  send:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 3L10 14M21 3l-7 18-4-7-7-4z"/></svg>',
  flag:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 21V4m0 1h11l-2 4 2 4H5"/></svg>',
  block:'<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
  plane:'<svg viewBox="0 0 150 130" fill="none"><path d="M18 70l112-52-34 96-24-34z" fill="#F5B93A"/><path d="M130 18L72 80l-4 30 14-22z" fill="#D9911C"/><path d="M18 70l54 10 58-62z" fill="#FFD262"/><circle cx="116" cy="98" r="15" fill="#3B7BE0"/><path d="M109 98l5 5 9-10" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M30 104l14-12M22 92l10-6M44 116l10-10" stroke="#59C36A" stroke-width="3" stroke-linecap="round"/></svg>',
  fail:'<svg viewBox="0 0 150 130" fill="none"><path d="M24 14h92a8 8 0 0 1 8 8v56a8 8 0 0 1-8 8H66l-22 22V86H24a8 8 0 0 1-8-8V22a8 8 0 0 1 8-8z" fill="#2F8FE8"/><path d="M16 50h108v28a8 8 0 0 1-8 8H66L44 108V86H24a8 8 0 0 1-8-8z" fill="#1F6FD0"/><circle cx="112" cy="92" r="22" fill="#E53535"/><path d="M103 83l18 18M121 83l-18 18" stroke="#fff" stroke-width="5" stroke-linecap="round"/></svg>'
};
const logo=box=>box?'<span class="logo-box logo">ANON_ME! 😉</span>':'<span class="logo">ANON_ME! 😉</span>';
const ADS=C.ads||[], SPON=C.sponsors||[];
const ad=i=>{ if(!ADS.length)return''; const a=ADS[i%ADS.length];
  return'<div class="ad"><span class="ad-icon" style="background:'+esc(a.color||'#0A2E45')+'">'+esc(a.icon||'Ad')+'</span><span class="ad-txt"><b>'+esc(a.title)+'</b><span class="ad-tag">AD</span>'+esc(a.meta||'')+'</span><a class="pill" href="'+esc(a.url||'#')+'" target="_blank" rel="noopener sponsored">'+esc(a.cta||'OPEN')+'</a></div>';};
const sponsors=()=>SPON.length?'<div class="sponsors" aria-label="Sponsors">'+SPON.map(s=>'<a href="'+esc(s.url||'#')+'" target="_blank" rel="noopener sponsored">'+esc(s.name)+'</a>').join('')+'</div>':'';
const field=(id,label,type,ph,v)=>'<label class="field" for="'+id+'"><span>'+label+'</span><input id="'+id+'" type="'+type+'" placeholder="'+ph+'" value="'+esc(v||'')+'"></label>';
const authShell=(title,inner)=>'<div class="screen">'+ad(0)+'<div class="auth-title">'+title+'</div><div class="card-navy"><div class="logo-wrap">'+logo(true)+'</div>'+inner+'</div><div class="grow"></div>'+ad(1)+sponsors()+'</div>';
const subTop=back=>'<div class="top"><button type="button" class="side left" data-act="nav" data-to="'+back+'" aria-label="Back">'+ic.back+'</button>'+logo()+'</div>';
const mainTop=tab=>'<div class="top"><div class="seg"><button type="button" class="'+(tab==='home'?'on':'')+'" data-act="nav" data-to="home">PLAY</button><button type="button" class="'+(tab==='inbox'?'on':'')+'" data-act="nav" data-to="inbox">INBOX'+(unread()?'<span class="dot" aria-label="unread messages"></span>':'')+'</button></div><button type="button" class="side right" data-act="nav" data-to="prefs" aria-label="Settings">'+ic.gear+'</button></div>';
const createPrompt=()=>'<p class="label">Join the fun!!! Create your own link</p><button type="button" class="btn" data-act="createown">Click here to Create link</button>';
const communityBtn=label=>C.communityUrl?'<a class="btn" href="'+esc(C.communityUrl)+'" target="_blank" rel="noopener">'+label+' '+ic.tg+'</a>':'';
const loading='<div class="empty"><span>Loading…</span></div>';

/* ---------- screens ---------- */
const screens={
  splash:()=>'<div class="splash">'+logo(true)+'</div>',
  setup:()=>'<div class="screen"><div class="top">'+logo()+'</div><hr class="rule"><h2>Almost there</h2><div class="prose"><p>This app is not connected to its database yet.</p><p>Open <b>config.js</b>, paste in your Supabase project URL and key, save, and upload the folder again. The README file walks you through it.</p></div></div>',
  missing:()=>'<div class="screen"><div class="top">'+logo()+'</div><hr class="rule"><div class="empty"><b>We could not find that page</b><span>The link may be mistyped, or the account was deleted.</span></div>'+createPrompt()+'</div>',

  signup:()=>authShell('CREATE ACCOUNT','<form data-form="signup" novalidate style="display:contents">'
    +field('su-user','Username','text','Enter username')+field('su-email','Email','email','Enter email')+field('su-pass','Password','password','At least 6 characters')
    +'<p class="err" id="su-err" role="alert"></p><button class="btn" type="submit">Create account</button></form>'
    +'<p class="small">Already have an account? <button type="button" class="link" data-act="nav" data-to="login">Log in</button></p>'),
  login:()=>authShell('LOG IN','<form data-form="login" novalidate style="display:contents">'
    +field('li-email','Email','email','Enter email',pending.email)+field('li-pass','Password','password','Enter password')
    +'<p class="err" id="li-err" role="alert"></p><button class="btn" type="submit">Log in</button></form>'
    +'<p class="small"><button type="button" class="link" data-act="nav" data-to="forgot">Forgot Password</button></p>'
    +'<p class="small">Don\'t have an account? <button type="button" class="link" data-act="nav" data-to="signup">Register</button></p>'),
  forgot:()=>authShell('FORGOT PASSWORD','<form data-form="forgot" novalidate style="display:contents">'
    +'<p class="small">Enter your account email and we will send you a link to set a new password.</p>'+field('fp-email','Email','email','Your account email',pending.email)
    +'<p class="err" id="fp-err" role="alert"></p><button class="btn" type="submit">Send reset link</button></form>'
    +'<p class="small"><button type="button" class="link" data-act="nav" data-to="login">Back to Log in</button></p>'),
  checkemail:()=>authShell(V.ctx==='reset'?'FORGOT PASSWORD':'CREATE ACCOUNT','<div class="auth-title">CHECK YOUR EMAIL</div>'
    +'<p class="small" style="font-size:13px">We sent a link to <b>'+esc(pending.email||'your email')+'</b>. Open the email and tap the link to '+(V.ctx==='reset'?'set a new password':'finish creating your account')+'.</p>'
    +'<p class="small">Can\'t find it? Check your spam or promotions folder.</p>'
    +'<p class="small" id="otp-timer">You can resend in 00:'+String(otpLeft).padStart(2,'0')+'</p><p class="err" id="otp-err" role="alert"></p>'
    +'<button class="btn" type="button" id="otp-resend" data-act="resend" '+(otpLeft>0?'disabled':'')+'>Resend email</button>'
    +'<p class="small"><button type="button" class="link" data-act="nav" data-to="login">Back to Log in</button></p>'),
  newpass:()=>authShell('NEW PASSWORD','<form data-form="newpass" novalidate style="display:contents">'
    +'<p class="small">Choose a new password for '+esc(me?me.email:'your account')+'.</p>'
    +field('np-new','New Password','password','At least 6 characters')+field('np-conf','Confirm Password','password','Type it again')
    +'<p class="err" id="np-err" role="alert"></p><button class="btn" type="submit">Save</button></form>'),

  home:()=>{const today=new Date(), mem=threads.filter(t=>{const d=new Date(t.created_at);return d.getMonth()===today.getMonth()&&d.getDate()===today.getDate()&&d.getFullYear()<today.getFullYear();});
    return'<div class="screen">'+mainTop('home')+ad(0)
    +(mem.length?'<p class="label">On This Day</p><div class="mem">'+mem.slice(0,5).map(t=>'<button type="button" data-act="share" data-id="'+t.id+'"><i>“</i>'+(today.getFullYear()-new Date(t.created_at).getFullYear())+' yr ago</button>').join('')+'</div>':'')
    +'<div class="hero"><p class="a">Enjoy the fun, Copy and share your link!!!</p><p class="b">Send me messages anonymously!</p></div>'
    +'<p class="label">Step 1: Copy and Share your link</p><div class="linkrow"><code id="mylink">'+esc(myLink())+'</code><button type="button" data-act="copylink">Copy</button></div>'
    +'<p class="textlink"><a class="link" href="'+esc(myLink())+'" target="_blank" rel="noopener">See what visitors see at your link</a></p>'
    +(C.communityUrl?'<p class="label">Step 2: Join our community</p>'+communityBtn('Join'):'')
    +'<div class="grow"></div>'+ad(1)+sponsors()+'</div>';},

  inbox:()=>'<div class="screen">'+mainTop('inbox')+'<h2>All Messages</h2><h2 style="font-weight:400;color:var(--muted)">@'+esc(me.username)+'</h2>'
    +(V.loading?loading:threads.length?threads.map(t=>'<div class="msg '+(t.unread?'unread':'')+'"><button type="button" class="body" data-act="open" data-id="'+t.id+'"><p>'+esc(t.preview)+'</p><span class="meta">'+(t.unread?'<span class="tag">NEW</span>':'')+'<span>'+ago(t.last_at)+'</span><span>'+(t.message_count>1?t.message_count+' messages in chat':'Tap to reply')+'</span>'+(t.blocked?'<span>Blocked</span>':'')+'</span></button>'
      +'<button type="button" class="btn" data-act="share" data-id="'+t.id+'">Share Message '+ic.share+'</button></div>').join('')
      :'<div class="empty"><b>No messages yet</b><span>Share your link and anonymous messages will show up here.</span><button type="button" class="btn" data-act="copylink">Copy my link</button></div>')
    +'<div class="grow"></div>'+sponsors()+'</div>',

  chat:()=>{const t=threads.find(x=>x.id===V.id); if(!t)return screens.inbox(); const closed=t.blocked||t.message_count>=CAP;
    return'<div class="screen"><div class="chat-head"><button type="button" class="icon-btn" data-act="nav" data-to="inbox" aria-label="Back">'+ic.back+'</button>'
      +'<div class="who"><b>Anonymous</b><small>'+t.message_count+' of '+CAP+' messages</small></div>'
      +'<button type="button" class="icon-btn" data-act="report" aria-label="Report this chat" title="Report">'+ic.flag+'</button><button type="button" class="icon-btn" data-act="block" aria-label="Block this sender" title="Block">'+ic.block+'</button></div>'
      +'<div class="bubbles" id="bubbles">'+(V.loading?loading:msgs.map(b=>'<div class="bub '+(b.from_owner?'mine':'them')+'">'+esc(b.body)+'<small>'+ago(b.created_at)+'</small></div>').join(''))+'</div>'
      +(closed?'<div class="notice">'+(t.blocked?'You blocked this sender. The chat is closed.':'This chat reached its '+CAP+'-message limit and is now closed.')+'</div>':composer())+sponsors()+'</div>';},

  send:()=>{const mine=sentList().filter(x=>x.username.toLowerCase()===V.username.toLowerCase());
    return'<div class="screen">'+(me?'<div class="banner"><span>You are viewing as a visitor</span><button type="button" class="link" data-act="nav" data-to="home">Back to my account</button></div>':'')
    +'<div class="top">'+logo()+'</div><hr class="rule"><h2>Send your messages</h2><h2 style="font-weight:400;color:var(--muted)">@'+esc(V.username)+'</h2>'
    +'<form data-form="send" novalidate style="display:contents"><label for="send-text" class="sr">Your anonymous message</label>'
    +'<textarea id="send-text" class="ta" maxlength="'+MAXLEN+'" placeholder="Type in your messages"></textarea><div class="count" id="send-count">0 / '+MAXLEN+'</div><p class="err on-light" id="send-err" role="alert"></p>'
    +'<button class="btn" type="submit">Send</button></form>'
    +(mine.length?'<p class="label">Your chats with @'+esc(V.username)+'</p><div class="rows">'+mine.slice(0,5).map(x=>'<button type="button" class="row" data-act="mythread" data-id="'+x.id+'"><span class="clip">'+esc(x.preview)+'</span>'+ic.chev+'</button>').join('')+'</div>':'')
    +ad(0)+createPrompt()+'<div class="grow"></div>'+sponsors()+'</div>';},

  sent:()=>'<div class="screen"><div class="top">'+logo()+'</div><hr class="rule"><h2>Congratulations</h2>'
    +'<div class="result">'+ic.plane+'<b>Message Sent Successfully</b><small>@'+esc(V.username)+' can reply, and you stay anonymous. Come back on this device to see replies.</small></div>'
    +'<button type="button" class="btn" data-act="backsend">Go Back Home</button><button type="button" class="btn ghost" data-act="mythread" data-id="'+V.id+'">Check for replies</button>'
    +ad(0)+createPrompt()+'<div class="grow"></div>'+sponsors()+'</div>',

  declined:()=>'<div class="screen"><div class="top">'+logo()+'</div><hr class="rule"><h2>Declined</h2>'
    +'<div class="result">'+ic.fail+'<b>Message not sent Successfully</b><small>'+esc(V.reason||'Something went wrong. Try again.')+'</small></div>'
    +'<button type="button" class="btn" data-act="backsend">Go Back</button>'+ad(0)+createPrompt()+'<div class="grow"></div>'+sponsors()+'</div>',

  schat:()=>{const d=V.data; if(!d)return'<div class="screen">'+loading+'</div>';
    return'<div class="screen"><div class="chat-head"><button type="button" class="icon-btn" data-act="backsend" aria-label="Back">'+ic.back+'</button>'
      +'<div class="who"><b>@'+esc(d.username)+'</b><small>'+d.count+' of '+CAP+' messages · you are anonymous</small></div></div>'
      +'<div class="bubbles" id="bubbles">'+d.messages.map(b=>'<div class="bub '+(b.o?'them':'mine')+'">'+esc(b.b)+'<small>'+ago(b.t)+'</small></div>').join('')+'</div>'
      +(d.closed?'<div class="notice">This chat is closed. You can start a new one from their link.</div>':composer())+sponsors()+'</div>';},

  prefs:()=>'<div class="screen">'+subTop('home')+'<hr class="rule"><h2>Settings</h2><div class="rows">'
    +[['editprofile','Edit Profile'],['community','Our Community'],['about','About Us'],['delete','Delete Account']].map(r=>'<button type="button" class="row" data-act="nav" data-to="'+r[0]+'">'+r[1]+ic.chev+'</button>').join('')
    +'<button type="button" class="row" data-act="asklogout">Logout'+ic.chev+'</button></div><div class="grow"></div>'+sponsors()+'</div>',

  editprofile:()=>'<div class="screen">'+subTop('prefs')+'<hr class="rule"><h2>Edit Profile</h2><form data-form="profile" novalidate style="display:contents">'
    +'<label class="light-field" for="ep-email">Email Address<input id="ep-email" type="email" value="'+esc(me.email)+'"></label>'
    +'<label class="light-field" for="ep-old">Old Password<input id="ep-old" type="password" placeholder="Needed only to change your password"></label>'
    +'<label class="light-field" for="ep-new">New Password<input id="ep-new" type="password" placeholder="At least 6 characters"></label>'
    +'<p class="err on-light" id="ep-err" role="alert"></p><div class="grow"></div><button class="btn" type="submit">Save</button></form>'+sponsors()+'</div>',

  community:()=>'<div class="screen">'+subTop('prefs')+'<hr class="rule"><h2>Our Community</h2><div class="center">'
    +'<svg width="150" height="120" viewBox="0 0 150 120" fill="none" aria-hidden="true"><path d="M20 96l55-26 55 26-55 20z" fill="#D7E0E6"/><g fill="#0A2E45"><circle cx="50" cy="42" r="8"/><rect x="43" y="52" width="14" height="34" rx="5"/><rect x="68" y="42" width="16" height="46" rx="6"/><circle cx="102" cy="44" r="8"/><rect x="95" y="54" width="14" height="32" rx="5"/></g><circle cx="76" cy="30" r="9" fill="#2AA3DF"/></svg>'
    +'<p class="prose" style="margin:0">Connect with amazing minds and personalities on our anonymous platform, freaky games and lots more....</p></div>'
    +(communityBtn('Connect')||'<div class="notice">The community link is coming soon.</div>')+'<div class="grow"></div>'+sponsors()+'</div>',

  about:()=>'<div class="screen">'+subTop('prefs')+'<hr class="rule"><h2>About Us</h2><div class="prose">'
    +'<p>At Anon Me we believe in the power of privacy. We\'ve built a space where you can share your thoughts, connect with others, and express yourself completely anonymously.</p>'
    +'<p>No sender profiles. No sender names. Just genuine conversations. Whether you want to ask questions, seek advice, or simply be heard, Anon Me is here to provide a safe and supportive platform.</p>'
    +'<p>Chats are short on purpose: each one closes after '+CAP+' messages. You can block or report any chat from inside it.</p></div><div class="grow"></div>'+sponsors()+'</div>',

  delete:()=>'<div class="screen">'+subTop('prefs')+'<hr class="rule"><h2>Delete Account</h2><div class="grow"></div><div class="center"><b>Are you sure?</b>'
    +'<small style="color:var(--muted)">Your link and every message will be removed for good.</small><p class="err on-light" id="del-err" role="alert"></p>'
    +'<div class="yn"><button type="button" class="btn" data-act="nav" data-to="prefs">NO</button><button type="button" class="btn danger" data-act="dodelete">Yes</button></div></div><div class="grow"></div>'+sponsors()+'</div>'
};
function composer(){return'<form data-form="chat" class="composer"><label for="chat-text" class="sr">Message</label><input id="chat-text" maxlength="'+MAXLEN+'" placeholder="Message" autocomplete="off"><button type="submit" class="icon-btn" aria-label="Send">'+ic.send+'</button></form><p class="err on-light" id="chat-err" role="alert"></p>';}

function overlayHTML(){ if(!overlay)return'';
  if(overlay.type==='logout')return'<div class="overlay" role="dialog" aria-modal="true" aria-label="Log out"><div class="sheet"><b>Log out of ANON_ME!?</b><span style="color:var(--muted);font-size:12px">Your messages stay safe until you log back in.</span><div class="yn"><button type="button" class="btn ghost" data-act="closeov">Cancel</button><button type="button" class="btn" data-act="dologout">Logout</button></div></div></div>';
  const t=overlay.text, body=encodeURIComponent('"'+t+'"\n\nSend me anonymous messages: '+myLink()), u=encodeURIComponent(myLink());
  const opt=(href,bg,ab,lab)=>'<a href="'+href+'" target="_blank" rel="noopener"><i style="background:'+bg+'">'+ab+'</i>'+lab+'</a>';
  return'<div class="overlay" role="dialog" aria-modal="true" aria-label="Share message"><h3>Share Message</h3><div class="share-card"><div class="logo">ANON_ME! 😉</div><p>'+esc(t)+'</p></div><div class="share-opts">'
    +opt('https://wa.me/?text='+body,'#25D366','W','WhatsApp')+opt('https://www.facebook.com/sharer/sharer.php?u='+u,'#1877F2','f','Facebook')
    +opt('https://t.me/share/url?url='+u+'&text='+encodeURIComponent('"'+t+'"'),'#2AA3DF','T','Telegram')
    +opt('https://mail.google.com/mail/?view=cm&su='+encodeURIComponent('An anonymous message I got')+'&body='+body,'#EA4335','M','Gmail')
    +'<button type="button" data-act="copylink"><i style="background:#5C7280">⧉</i>Copy Link</button></div>'
    +'<button type="button" class="link" data-act="closeov" style="color:var(--on-navy);font-size:12px">Close</button></div>';}

function render(keep){
  clearInterval(otpTimer);
  const draft=keep?val('chat-text'):'';
  phone.innerHTML=(screens[V.name]||screens.home)()+overlayHTML()+(toastMsg?'<div class="toast" role="status">'+esc(toastMsg)+'</div>':'');
  if(V.name==='checkemail')startOtp();
  if(V.name==='chat'||V.name==='schat'){const b=document.getElementById('bubbles'); if(b)b.scrollTop=b.scrollHeight; const i=document.getElementById('chat-text'); if(i&&keep){i.value=draft; i.focus();}}
}
function startOtp(){otpTimer=setInterval(()=>{ if(otpLeft>0)otpLeft--; const t=document.getElementById('otp-timer'),r=document.getElementById('otp-resend'); if(!t){clearInterval(otpTimer);return;}
  t.textContent=otpLeft>0?'You can resend in 00:'+String(otpLeft).padStart(2,'0'):'Didn\'t get it? Check spam, or resend it below.'; if(r)r.disabled=otpLeft>0; if(otpLeft===0)clearInterval(otpTimer);},1000);}

const OWNER=['home','inbox','chat','prefs','editprofile','community','about','delete'];
async function go(name,extra){
  if((OWNER.includes(name)||name==='newpass')&&!me)name='login';
  clearInterval(pollTimer); pollTimer=null;
  V=Object.assign({name},extra||{}); overlay=null;
  if(OWNER.includes(name)||['login','signup','forgot','checkemail','newpass'].includes(name))setUrl('');
  if(name==='send')setUrl('?u='+encodeURIComponent(V.username));
  if(name==='schat')setUrl('?t='+encodeURIComponent(V.id));
  if(name==='inbox'&&!threads.length){V.loading=true; render(); await loadThreads(); V.loading=false; if(V.name==='inbox')render(); return;}
  if(name==='chat'){V.loading=true; render(); await openChat(V.id); return;}
  if(name==='schat'){render(); await loadSender(true); pollTimer=setInterval(()=>loadSender(false),3000); return;}
  render();
}

/* ---------- data ---------- */
async function loadMe(){const r=await sb.auth.getUser(); const u=r.data&&r.data.user; if(!u){me=null;return;}
  let name=(u.user_metadata&&u.user_metadata.username)||''; try{const p=await q(sb.from('profiles').select('username').eq('id',u.id).maybeSingle()); if(p)name=p.username;}catch(e){}
  me={id:u.id,email:u.email,username:name}; subscribe(); await loadThreads();}
async function loadThreads(){ if(!me)return; try{threads=await q(sb.from('threads').select('*').order('last_at',{ascending:false}).limit(200));}catch(e){toast(friendly(e));}}
async function openChat(id){
  try{msgs=await q(sb.from('messages').select('from_owner,body,created_at').eq('thread_id',id).order('id'));
    const t=threads.find(x=>x.id===id); if(t&&t.unread){t.unread=false; sb.rpc('mark_read',{p_thread:id}).then(()=>{});} }
  catch(e){toast(friendly(e));}
  if(V.name==='chat'&&V.id===id){V.loading=false; render(true);}
}
function subscribe(){ if(channel||!me)return;
  channel=sb.channel('inbox-'+me.id).on('postgres_changes',{event:'INSERT',schema:'public',table:'messages',filter:'owner_id=eq.'+me.id},()=>{
    clearTimeout(rtTimer); rtTimer=setTimeout(async()=>{await loadThreads(); if(V.name==='chat')await openChat(V.id); else if(V.name==='home'||V.name==='inbox')render();},150);
  }).subscribe();}
function unsubscribe(){ if(channel){sb.removeChannel(channel); channel=null;}}
async function loadSender(first){const id=V.id;
  try{const d=await q(sb.rpc('sender_thread',{p_thread:id,p_token:token()})); if(V.name!=='schat'||V.id!==id)return;
    const changed=!V.data||V.data.count!==d.count||V.data.closed!==d.closed; V.data=d; V.username=d.username; if(changed)render(true);}
  catch(e){ if(first&&V.name==='schat'){clearInterval(pollTimer); V={name:'missing'}; render();}}}

/* ---------- actions ---------- */
const acts={
  nav(el){go(el.dataset.to);},
  copylink(){copy(myLink(),'Link copied. Share it anywhere.');},
  createown(){ if(me)go('home'); else go('signup');},
  backsend(){ if(V.username)go('send',{username:V.username}); else go(me?'home':'login');},
  share(el){const t=threads.find(x=>x.id===el.dataset.id); if(!t)return; overlay={type:'share',text:t.preview}; render();},
  open(el){go('chat',{id:el.dataset.id});},
  mythread(el){go('schat',{id:el.dataset.id,username:V.username});},
  async report(){try{await q(sb.rpc('report_thread',{p_thread:V.id})); toast('Reported. We will review this chat.');}catch(e){toast(friendly(e));}},
  async block(){const t=threads.find(x=>x.id===V.id); try{await q(sb.rpc('block_thread',{p_thread:V.id})); if(t)t.blocked=true; render(); toast('Sender blocked. They can no longer message you.');}catch(e){toast(friendly(e));}},
  asklogout(){overlay={type:'logout'}; render();},
  closeov(){overlay=null; render();},
  async dologout(){unsubscribe(); await sb.auth.signOut(); me=null; threads=[]; go('login'); toast('You are logged out.');},
  async dodelete(el){el.disabled=true; try{await q(sb.rpc('delete_my_account')); unsubscribe(); await sb.auth.signOut(); me=null; threads=[]; go('signup'); toast('Account deleted.');}catch(e){el.disabled=false; showErr('del-err',friendly(e));}},
  async resend(el){el.disabled=true; try{ if(V.ctx==='reset')await q(sb.auth.resetPasswordForEmail(pending.email,{redirectTo:BASE})); else await q(sb.auth.resend({type:'signup',email:pending.email,options:{emailRedirectTo:BASE}})); otpLeft=59; render(); toast('A new email is on its way.');}catch(e){el.disabled=false; showErr('otp-err',friendly(e));}}
};
const forms={
  async signup(){const u=val('su-user'),e=val('su-email'),p=val('su-pass');
    if(!/^[A-Za-z0-9_]{3,20}$/.test(u))return showErr('su-err','Username needs 3 to 20 letters, numbers or underscores.');
    if(!/^\S+@\S+\.\S+$/.test(e))return showErr('su-err','Enter a valid email address.');
    if(p.length<6)return showErr('su-err','Password needs at least 6 characters.');
    try{ if(await q(sb.rpc('username_taken',{p_username:u})))return showErr('su-err','That username is taken. Try another.');
      const d=await q(sb.auth.signUp({email:e,password:p,options:{data:{username:u},emailRedirectTo:BASE}}));
      pending={email:e}; if(d.session){await loadMe(); go('home'); toast('Account created. Your link is ready.');} else {otpLeft=59; go('checkemail',{ctx:'signup'});}}
    catch(err){showErr('su-err',friendly(err));}},
  async login(){const e=val('li-email'),p=val('li-pass'); if(!e||!p)return showErr('li-err','Enter your email and password.');
    try{await q(sb.auth.signInWithPassword({email:e,password:p})); await loadMe(); go('home');}
    catch(err){ if(/not confirmed/i.test(err.message||'')){pending={email:e}; try{await sb.auth.resend({type:'signup',email:e,options:{emailRedirectTo:BASE}});}catch(x){} otpLeft=59; go('checkemail',{ctx:'signup'}); toast('Confirm your email to finish signing up.');} else showErr('li-err',friendly(err));}},
  async forgot(){const e=val('fp-email'); if(!/^\S+@\S+\.\S+$/.test(e))return showErr('fp-err','Enter your account email.');
    try{await q(sb.auth.resetPasswordForEmail(e,{redirectTo:BASE})); pending={email:e}; otpLeft=59; go('checkemail',{ctx:'reset'});}catch(err){showErr('fp-err',friendly(err));}},
  async newpass(){const a=val('np-new'),b=val('np-conf'); if(a.length<6)return showErr('np-err','Password needs at least 6 characters.'); if(a!==b)return showErr('np-err','The two passwords do not match.');
    try{await q(sb.auth.updateUser({password:a})); recovering=false; go('home'); toast('Password changed. You are logged in.');}
    catch(err){showErr('np-err',/different from the old/i.test(err.message||'')?'Choose a password different from your old one.':friendly(err));}},
  async send(){const t=val('send-text'); if(!t)return showErr('send-err','Type a message before you send.');
    try{const id=await q(sb.rpc('send_message',{p_username:V.username,p_body:t,p_token:token()})); rememberSent(id,V.username,t); go('sent',{id,username:V.username});}
    catch(err){go('declined',{username:V.username,reason:friendly(err)});}},
  async chat(){const t=val('chat-text'); if(!t)return; const i=document.getElementById('chat-text'); if(i)i.value='';
    try{ if(V.name==='schat'){await q(sb.rpc('sender_reply',{p_thread:V.id,p_token:token(),p_body:t})); await loadSender(false);}
      else{await q(sb.rpc('owner_reply',{p_thread:V.id,p_body:t})); await loadThreads(); await openChat(V.id);} }
    catch(err){const j=document.getElementById('chat-text'); if(j)j.value=t; showErr('chat-err',friendly(err));}},
  async profile(){const e=val('ep-email'),o=val('ep-old'),n=val('ep-new'); if(!/^\S+@\S+\.\S+$/.test(e))return showErr('ep-err','Enter a valid email address.');
    if(n&&!o)return showErr('ep-err','Enter your old password to set a new one.'); if(n&&n.length<6)return showErr('ep-err','New password needs at least 6 characters.');
    try{let note='Nothing to change.';
      if(n){await q(sb.auth.signInWithPassword({email:me.email,password:o})); await q(sb.auth.updateUser({password:n})); note='Password changed.';}
      if(e.toLowerCase()!==me.email.toLowerCase()){await q(sb.auth.updateUser({email:e},{emailRedirectTo:BASE})); note='Check your new email inbox to confirm the change.';}
      go('prefs'); toast(note);}
    catch(err){showErr('ep-err',/Invalid login/i.test(err.message||'')?'Your old password is wrong.':friendly(err));}}
};

document.addEventListener('click',e=>{const el=e.target.closest('[data-act]'); if(!el||el.disabled)return; const f=acts[el.dataset.act]; if(f)f(el);});
document.addEventListener('submit',async e=>{const f=e.target.closest('[data-form]'); if(!f)return; e.preventDefault(); const h=forms[f.dataset.form]; if(!h||f.dataset.busy)return;
  const b=f.querySelector('button[type=submit]'); f.dataset.busy='1'; if(b)b.disabled=true;
  try{await h();}finally{ if(f.isConnected){delete f.dataset.busy; if(b)b.disabled=false;}}});
document.addEventListener('input',e=>{const t=e.target;
  if(t.id==='send-text'){const c=document.getElementById('send-count'); if(c)c.textContent=t.value.length+' / '+MAXLEN; showErr('send-err','');}});
document.addEventListener('keydown',e=>{ if(e.key==='Escape'&&overlay){overlay=null; render();}});

/* ---------- start ---------- */
async function boot(){
  render();
  if(!configured){V={name:'setup'}; return render();}
  const p=new URLSearchParams(location.search), u=p.get('u'), t=p.get('t');
  try{await loadMe();}catch(e){me=null;}
  if(linkError&&!me){go('login'); toast(/expired|invalid/i.test(linkError)?'That email link has expired or was already used. Log in, or use Forgot Password for a new one.':linkError); return;}
  if(recovering&&me)return go('newpass');
  if(me&&linkType==='signup'){go('home'); toast('Email confirmed. Your link is ready.'); return;}
  if(me&&linkType==='email_change'){go('home'); toast('Email change confirmed.'); return;}
  if(t)return go('schat',{id:t});
  if(u){let name=null; try{name=await q(sb.rpc('find_user',{p_username:u}));}catch(e){} if(name)return go('send',{username:name}); V={name:'missing'}; return render();}
  go(me?'home':'login');
}
boot();
})();
