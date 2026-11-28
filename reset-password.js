import{createClient}from'https://esm.sh/@supabase/supabase-js@2';
const $=id=>document.getElementById(id);
const copy={
 en:{eyebrow:'YOUR CREATION WORKSPACE',heading:'Choose a new password',subtitle:'Enter and confirm your new password below.',password:'New password',confirm:'Confirm new password',submit:'Update password',wait:'Updating…',mismatch:'Passwords do not match.',success:'Your password has been updated. You can now sign in.',invalid:'This reset link is invalid or has expired. Request a new password reset email.',generic:'Something went wrong. Please request a new reset link.',signin:'Back to sign in',back:'← Back to home',placeholder:'At least 8 characters',again:'Enter your password again'},
 ar:{eyebrow:'مساحة إبداعك',heading:'اختر كلمة مرور جديدة',subtitle:'أدخل كلمة المرور الجديدة وأكدها أدناه.',password:'كلمة المرور الجديدة',confirm:'تأكيد كلمة المرور الجديدة',submit:'تحديث كلمة المرور',wait:'جارٍ التحديث…',mismatch:'كلمتا المرور غير متطابقتين.',success:'تم تحديث كلمة المرور. يمكنك تسجيل الدخول الآن.',invalid:'رابط إعادة التعيين غير صالح أو منتهي الصلاحية. اطلب رسالة جديدة.',generic:'حدث خطأ. يرجى طلب رابط جديد.',signin:'العودة إلى تسجيل الدخول',back:'العودة إلى الرئيسية ←',placeholder:'8 أحرف على الأقل',again:'أدخل كلمة المرور مرة أخرى'}
};
let lang=localStorage.getItem('lang')||((navigator.language||'').startsWith('ar')?'ar':'en');
const cfg=window.SCREENSTUDIO_SUPABASE||{};
const supabase=cfg.url&&cfg.anonKey?createClient(cfg.url,cfg.anonKey):null;
function render(){const t=copy[lang];document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';document.documentElement.dataset.theme=localStorage.getItem('screenstudio-theme')||'dark';$('eyebrow').textContent=t.eyebrow;$('heading').textContent=t.heading;$('subtitle').textContent=t.subtitle;$('passwordLabel').textContent=t.password;$('confirmLabel').textContent=t.confirm;$('submit').textContent=t.submit;$('signin').textContent=t.signin;$('back').textContent=t.back;$('lang').textContent=lang==='ar'?'English':'العربية';$('theme').textContent=document.documentElement.dataset.theme==='light'?'🌙':'☀️';$('password').placeholder=t.placeholder;$('confirm').placeholder=t.again}
function note(message,error=false){$('status').textContent=message;$('status').classList.toggle('error',error)}
$('lang').onclick=()=>{lang=lang==='ar'?'en':'ar';localStorage.setItem('lang',lang);render()};
$('theme').onclick=()=>{const v=document.documentElement.dataset.theme==='light'?'dark':'light';localStorage.setItem('screenstudio-theme',v);render()};
render();
if(!supabase){note(copy[lang].generic,true);$('submit').disabled=true}
else{
 const{data,error}=await supabase.auth.getSession();
 if(error||!data.session){note(copy[lang].invalid,true);$('submit').disabled=true}
}
$('form').onsubmit=async e=>{
 e.preventDefault();if(!supabase)return;
 const password=$('password').value;
 if(password!==$('confirm').value){note(copy[lang].mismatch,true);return}
 $('submit').disabled=true;$('submit').textContent=copy[lang].wait;
 try{const{error}=await supabase.auth.updateUser({password});if(error)throw error;note(copy[lang].success);$('form').hidden=true;setTimeout(()=>location.assign('auth.html'),1800)}
 catch(err){note(err.message||copy[lang].generic,true);$('submit').disabled=false;$('submit').textContent=copy[lang].submit}
};