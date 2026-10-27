import type {Metadata} from 'next';
import {redirect} from 'next/navigation';
import {currentAdmin} from '@/server/admin-auth';
import {login} from '@/server/admin-actions';
import {AdminForm} from '@/components/admin-forms';
export const metadata:Metadata={title:'Giriş'};
export default async function AdminLogin(){
 if(await currentAdmin())redirect('/yonetici');
 return <main className="adm-login"><h1>Yönetici girişi</h1>
  <AdminForm action={login}>
   <label>Kullanıcı adı<input name="kullanici" autoComplete="username" required maxLength={64} autoCapitalize="none" spellCheck={false}/></label>
   <label>Şifre<input name="sifre" type="password" autoComplete="current-password" required maxLength={1024}/></label>
   <button type="submit" className="adm-button">Giriş yap</button>
  </AdminForm>
  <p className="adm-note">Art arda hatalı denemelerde bekleme süresi uzar; 10 hatalı denemeden sonra giriş 15 dakika kapanır.</p>
 </main>;
}
