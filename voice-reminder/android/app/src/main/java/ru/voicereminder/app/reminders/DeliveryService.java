package ru.voicereminder.app.reminders;
import android.app.*;import android.content.*;import android.os.*;import android.media.*;import android.speech.tts.*;import androidx.core.app.NotificationCompat;import java.util.*;import org.json.*;import ru.voicereminder.app.*;
public class DeliveryService extends Service {
 private static final int ALERT_BASE=10000, FOREGROUND_BASE=20000;
 // Р”Р»РёС‚РµР»СЊРЅРѕСЃС‚СЊ Р·РІСѓРєРѕРІРѕРіРѕ СЃРёРіРЅР°Р»Р°. Р Р°РЅСЊС€Рµ РѕРЅ Р·РІСѓС‡Р°Р» 1800 РјСЃ Рё РЅР°РєР»Р°РґС‹РІР°Р»СЃСЏ
 // РЅР° СЂРµС‡СЊ: TTS Р·Р°РїСѓСЃРєР°Р»СЃСЏ РѕРґРЅРѕРІСЂРµРјРµРЅРЅРѕ СЃ СЃРёРіРЅР°Р»РѕРј, Рё РЅР°С‡Р°Р»Рѕ РЅР°РїРѕРјРёРЅР°РЅРёСЏ
 // С‚РѕРЅСѓР»Рѕ РІ Р·РІСѓРєРµ. РўРµРїРµСЂСЊ СЃРёРіРЅР°Р» РєРѕСЂРѕС‚РєРёР№, Р° СЂРµС‡СЊ РЅР°С‡РёРЅР°РµС‚СЃСЏ СЃСЂР°Р·Сѓ Р·Р° РЅРёРј.
 private static final int CUE_MS=700;
 private static final String FOREGROUND_CHANNEL="remindme_foreground_v3";
 public static int alertId(JSONObject e){return ALERT_BASE+e.optInt("nativeId");} public static int foregroundId(JSONObject e){return FOREGROUND_BASE+e.optInt("nativeId");}
 private TextToSpeech tts;private boolean ready;private boolean speakFallback=false;private JSONObject current;private final Queue<JSONObject> queue=new ArrayDeque<>();private final Handler handler=new Handler(Looper.getMainLooper());private PowerManager.WakeLock lock;private static DeliveryService instance;private AudioManager audio;private AudioFocusRequest focus;private AudioTrack alertTone;
 public static void stopEvent(String id){DeliveryService s=instance;if(s!=null)s.handler.post(()->{s.queue.removeIf(e->e.optString("id").equals(id));if(s.current!=null&&s.current.optString("id").equals(id)){if(s.tts!=null)s.tts.stop();s.finish();}});}
 public static Notification notification(Context c,JSONObject event,JSONObject settings,boolean foreground){NotificationManager nm=c.getSystemService(NotificationManager.class);String channel=foreground?FOREGROUND_CHANNEL:"remindme_alert_v3_"+(settings.optBoolean("sound",true)?"sound":"silent")+(settings.optBoolean("vibration",true)?"_v":"_n");if(Build.VERSION.SDK_INT>=26){NotificationChannel ch=new NotificationChannel(channel,foreground?"РЎР»СѓР¶РµР±РЅС‹Рµ СѓРІРµРґРѕРјР»РµРЅРёСЏ":"РќР°РїРѕРјРёРЅР°РЅРёСЏ",foreground?NotificationManager.IMPORTANCE_LOW:NotificationManager.IMPORTANCE_HIGH);ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);ch.enableVibration(settings.optBoolean("vibration",true));ch.setSound(null,null);if(foreground)ch.enableVibration(false);nm.createNotificationChannel(ch);}
 Intent open=new Intent(c,MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP);PendingIntent content=PendingIntent.getActivity(c,0,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
 String id=event.optString("id"),text=settings.optBoolean("privateNotification")?"РћС‚РєСЂРѕР№С‚Рµ РїСЂРёР»РѕР¶РµРЅРёРµ, С‡С‚РѕР±С‹ РїРѕСЃРјРѕС‚СЂРµС‚СЊ РЅР°РїРѕРјРёРЅР°РЅРёРµ":event.optString("text","РќР°РїРѕРјРёРЅР°РЅРёРµ");
 NotificationCompat.Builder b=new NotificationCompat.Builder(c,channel).setSmallIcon(ru.voicereminder.app.R.drawable.ic_reminder).setContentTitle("Remind me").setContentText(text).setStyle(new NotificationCompat.BigTextStyle().bigText(text)).setCategory(NotificationCompat.CATEGORY_ALARM).setPriority(foreground?NotificationCompat.PRIORITY_LOW:NotificationCompat.PRIORITY_MAX).setContentIntent(content).setVisibility(settings.optBoolean("privateNotification")?NotificationCompat.VISIBILITY_PRIVATE:NotificationCompat.VISIBILITY_PUBLIC).setShowWhen(true).setOnlyAlertOnce(foreground).setAutoCancel(false).setOngoing(foreground).addAction(0,"РџРѕРЅСЏС‚РЅРѕ",AlarmScheduler.pending(c,AlarmScheduler.ACK,id)).addAction(0,"Р§РµСЂРµР· 5 РјРёРЅСѓС‚",AlarmScheduler.pending(c,AlarmScheduler.SNOOZE,id));if(!foreground)b.setFullScreenIntent(content,true);return b.build();}
 public static void notifyEvent(Context c,JSONObject event,JSONObject settings,boolean foreground){try{c.getSystemService(NotificationManager.class).notify(foreground?foregroundId(event):alertId(event),notification(c,event,settings,foreground));}catch(SecurityException ignored){}}
 private void playAlarmCue(JSONObject settings){if(!settings.optBoolean("sound",true))return;try{int rate=22050;short[] pcm=new short[rate/2];int[] notes={880,0,990};int noteSamples=pcm.length/notes.length;for(int i=0;i<notes.length;i++){int f=notes[i];for(int j=0;j<noteSamples;j++){double env=Math.min(1,j/1200.0)*Math.min(1,(noteSamples-j)/1200.0);pcm[i*noteSamples+j]=(short)(Math.sin(2*Math.PI*f*j/rate)*2600*env);}}AudioAttributes attrs=new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build();alertTone=new AudioTrack(attrs, new AudioFormat.Builder().setSampleRate(rate).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build(),pcm.length*2,AudioTrack.MODE_STATIC,AudioManager.AUDIO_SESSION_ID_GENERATE);alertTone.write(pcm,0,pcm.length);alertTone.play();handler.postDelayed(this::stopAlarmCue,CUE_MS);}catch(Exception ignored){stopAlarmCue();}}
 private void stopAlarmCue(){if(alertTone!=null){try{alertTone.stop();}catch(Exception ignored){}try{alertTone.release();}catch(Exception ignored){}alertTone=null;}}
 // Речь запускается сразу ЗА сигналом, а не одновременно с ним.
 //
 // Раньше TTS стартовал в тот же момент, что и сигнал: первые слова
 // напоминания заглушались звуком, и человек слышал обрывок. Теперь
 // сигнал короткий, и как только он отзвучал — сразу начинается речь.
 // Задержка живёт в обработчике главного потока, поэтому не зависит
 // от версии Android и не требует разрешений.
 private void speakAfterCue(final String text){
  final String id=current!=null?current.optString("id"):"";
  handler.postDelayed(() -> {
   try{
    stopAlarmCue();
    if(tts==null){finish();return;}
    int result=tts.speak(text,TextToSpeech.QUEUE_FLUSH,null,id);
    if(result==TextToSpeech.ERROR){
     try(ReminderStore db=new ReminderStore(this)){db.diagnostic("TTS недоступен");}
     finish();return;
    }
    handler.postDelayed(watchdog,30000);
   }catch(Exception ignored){finish();}
  },CUE_MS);
 }
 @Override public void onCreate(){super.onCreate();instance=this;audio=getSystemService(AudioManager.class);tts=new TextToSpeech(this,status->{
  if(status!=TextToSpeech.SUCCESS){
   ready=false;
   // РЎРёРЅС‚РµР·Р°С‚РѕСЂ РЅРµ РїРѕРґРЅСЏР»СЃСЏ: С‚РµР»РµС„РѕРЅ Р±РµР· TTS-РґРІРёР¶РєР°. РќР°РїРѕРјРёРЅР°РЅРёРµ РІСЃС‘ СЂР°РІРЅРѕ
   // РґРѕР»Р¶РЅРѕ СЃСЂР°Р±РѕС‚Р°С‚СЊ вЂ” Р·РІСѓРє Рё СѓРІРµРґРѕРјР»РµРЅРёРµ Р±РµР· РіРѕР»РѕСЃР°.
   try(ReminderStore db=new ReminderStore(this)){db.diagnostic("TTS РЅРµРґРѕСЃС‚СѓРїРµРЅ. РџСЂРѕРІРµСЂСЊС‚Рµ СЃРёСЃС‚РµРјРЅС‹Р№ РіРѕР»РѕСЃ.");}
   speakFallback=true;drain();
   return;
  }
  // РџСЂРѕРІРµСЂСЏРµРј, РµСЃС‚СЊ Р»Рё Р РЈРЎРЎРљРР™ РіРѕР»РѕСЃ. РќР° С‡Р°СЃС‚Рё С‚РµР»РµС„РѕРЅРѕРІ (РѕСЃРѕР±РµРЅРЅРѕ
  // РЅРµРґРѕСЂРѕРіРёС… Рё СЃ СѓСЂРµР·Р°РЅРЅРѕР№ РїСЂРѕС€РёРІРєРѕР№) СЂСѓСЃСЃРєРёР№ РїР°РєРµС‚ РЅРµ СѓСЃС‚Р°РЅРѕРІР»РµРЅ:
  // setLanguage() С‚РѕРіРґР° РІРѕР·РІСЂР°С‰Р°РµС‚ РѕС€РёР±РєСѓ, Рё РѕР·РІСѓС‡РєР° РјРѕР»С‡Р° РЅРµ СЂР°Р±РѕС‚Р°РµС‚ вЂ”
  // Р° РіРѕР»РѕСЃРѕРІРѕРµ РЅР°РїРѕРјРёРЅР°РЅРёРµ СЌС‚Рѕ РіР»Р°РІРЅР°СЏ С„СѓРЅРєС†РёСЏ РїСЂРёР»РѕР¶РµРЅРёСЏ.
  int res=tts.setLanguage(new Locale("ru","RU"));
  if(res==TextToSpeech.LANG_MISSING_DATA||res==TextToSpeech.LANG_NOT_SUPPORTED){
   // Р СѓСЃСЃРєРѕРіРѕ РЅРµС‚ вЂ” РїСЂРѕР±СѓРµРј С…РѕС‚СЏ Р±С‹ Р»СЋР±РѕР№ РґРѕСЃС‚СѓРїРЅС‹Р№ РіРѕР»РѕСЃ, С‡С‚РѕР±С‹ С‚РµРєСЃС‚
   // РІСЃС‘-С‚Р°РєРё РїСЂРѕР·РІСѓС‡Р°Р», РїСѓСЃС‚СЊ Рё СЃ Р°РєС†РµРЅС‚РѕРј.
   Locale fallback=Locale.getDefault();
   int second=tts.setLanguage(fallback);
   speakFallback=second==TextToSpeech.LANG_MISSING_DATA||second==TextToSpeech.LANG_NOT_SUPPORTED;
   try(ReminderStore db=new ReminderStore(this)){
    db.diagnostic(speakFallback
      ? "Р СѓСЃСЃРєРёР№ РіРѕР»РѕСЃ РЅРµ СѓСЃС‚Р°РЅРѕРІР»РµРЅ. РќР°РїРѕРјРёРЅР°РЅРёРµ РїРѕРєР°Р¶РµС‚СЃСЏ Р±РµР· РѕР·РІСѓС‡РєРё вЂ” СѓСЃС‚Р°РЅРѕРІРёС‚Рµ РіРѕР»РѕСЃРѕРІС‹Рµ РґР°РЅРЅС‹Рµ РІ РЅР°СЃС‚СЂРѕР№РєР°С… Android."
      : "Р СѓСЃСЃРєРёР№ РіРѕР»РѕСЃ РЅРµ СѓСЃС‚Р°РЅРѕРІР»РµРЅ, РёСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ СЃРёСЃС‚РµРјРЅС‹Р№ РїРѕ СѓРјРѕР»С‡Р°РЅРёСЋ.");
   }
  }
  ready=true;drain();
});tts.setOnUtteranceProgressListener(new UtteranceProgressListener(){public void onStart(String id){}public void onDone(String id){handler.post(()->finish());}public void onError(String id){handler.post(()->{try(ReminderStore db=new ReminderStore(DeliveryService.this)){db.diagnostic("РќРµ СѓРґР°Р»РѕСЃСЊ РѕР·РІСѓС‡РёС‚СЊ РЅР°РїРѕРјРёРЅР°РЅРёРµ: РїСЂРѕРІРµСЂСЊС‚Рµ TTS-РіРѕР»РѕСЃ");}finish();});}});lock=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"raminde:voice");}
 @Override public int onStartCommand(Intent intent,int flags,int startId){if(intent==null){stopSelf();return START_NOT_STICKY;}try(ReminderStore db=new ReminderStore(this)){JSONObject e=db.event(intent.getStringExtra("eventId"));if(e==null){stopSelf();return START_NOT_STICKY;}startForeground(foregroundId(e),notification(this,e,db.meta("settings"),true));if(!lock.isHeld())lock.acquire(10000);playAlarmCue(db.meta("settings"));queue.add(e);drain();}return START_NOT_STICKY;}
 private void drain(){if(current!=null||queue.isEmpty()||!ready)return;current=queue.remove();try(ReminderStore db=new ReminderStore(this)){JSONObject e=db.event(current.getString("id"));if(e==null||e.optString("state").equals("acknowledged")||e.optString("state").equals("snoozed")){finish();return;}JSONObject settings=db.meta("settings");NotificationManager nm=getSystemService(NotificationManager.class);if(nm.getCurrentInterruptionFilter()==NotificationManager.INTERRUPTION_FILTER_NONE||audio.getMode()!=AudioManager.MODE_NORMAL){db.diagnostic("РћР·РІСѓС‡РёРІР°РЅРёРµ РїСЂРѕРїСѓС‰РµРЅРѕ: РІРєР»СЋС‡С‘РЅ СЂРµР¶РёРј В«РќРµ Р±РµСЃРїРѕРєРѕРёС‚СЊВ»");finish();return;}
 if(!lock.isHeld())lock.acquire(30000);AudioAttributes attrs=new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();tts.setAudioAttributes(attrs);tts.setSpeechRate((float)settings.optDouble("rate",0.95));if(Build.VERSION.SDK_INT>=26){focus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(attrs).setOnAudioFocusChangeListener(change->{if(change==AudioManager.AUDIOFOCUS_LOSS){tts.stop();finish();}}).build();if(audio.requestAudioFocus(focus)!=AudioManager.AUDIOFOCUS_REQUEST_GRANTED){db.diagnostic("РђСѓРґРёРѕ Р·Р°РЅСЏС‚Рѕ РґСЂСѓРіРёРј РїСЂРёР»РѕР¶РµРЅРёРµРј");finish();return;}}
 String name=settings.optString("name").trim(),text=(name.isEmpty()?"":name+"! ")+current.getString("text");startForeground(foregroundId(current),notification(this,current,settings,true));speakAfterCue(text);
 }catch(Exception ex){finish();}}
 private final Runnable watchdog=()->{if(tts!=null)tts.stop();finish();};
 private void finish(){handler.removeCallbacks(watchdog);stopAlarmCue();if(current!=null){try(ReminderStore db=new ReminderStore(this)){JSONObject e=db.event(current.optString("id"));if(e!=null&&e.optString("state").equals("ringing")){e.put("state","waiting");db.put("events","eid",e.getString("id"),e);}JSONObject settings=db.meta("settings");if(e!=null&&settings.optString("mode","voiceAndNotification").equals("voiceAndNotification")&&!e.optString("state").equals("acknowledged"))notifyEvent(this,e,settings,true);}catch(Exception ignored){}}
 if(lock!=null&&lock.isHeld())lock.release();if(Build.VERSION.SDK_INT>=26&&focus!=null)audio.abandonAudioFocusRequest(focus);current=null;if(queue.isEmpty()){stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}else{try(ReminderStore db=new ReminderStore(this)){JSONObject next=queue.peek();startForeground(foregroundId(next),notification(this,next,db.meta("settings"),true));}drain();}}
 @Override public void onDestroy(){instance=null;handler.removeCallbacksAndMessages(null);stopAlarmCue();if(tts!=null){tts.stop();tts.shutdown();}if(lock!=null&&lock.isHeld())lock.release();if(Build.VERSION.SDK_INT>=26&&focus!=null)audio.abandonAudioFocusRequest(focus);super.onDestroy();}
 @Override public IBinder onBind(Intent i){return null;}
}
