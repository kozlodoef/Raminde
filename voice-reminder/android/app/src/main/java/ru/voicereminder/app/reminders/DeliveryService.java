package ru.voicereminder.app.reminders;
import android.app.*;import android.content.*;import android.os.*;import android.media.*;import android.speech.tts.*;import androidx.core.app.NotificationCompat;import java.util.*;import org.json.*;import ru.voicereminder.app.*;
public class DeliveryService extends Service {
 private static final int ALERT_BASE=10000, FOREGROUND_BASE=20000;
 // Частота дискретизации для синтезированных сигналов.
 private static final int CUE_RATE=22050;
 // Запасная длительность паузы, если сигнал не сообщил свою.
 private static final long CUE_FALLBACK_MS=450;
 private static final String FOREGROUND_CHANNEL="remindme_foreground_v3";
 public static int alertId(JSONObject e){return ALERT_BASE+e.optInt("nativeId");} public static int foregroundId(JSONObject e){return FOREGROUND_BASE+e.optInt("nativeId");}
 private TextToSpeech tts;private boolean ready;private boolean speakFallback=false;private JSONObject current;private final Queue<JSONObject> queue=new ArrayDeque<>();private final Handler handler=new Handler(Looper.getMainLooper());private PowerManager.WakeLock lock;private static DeliveryService instance;private AudioManager audio;private AudioFocusRequest focus;private AudioTrack alertTone;
 // Длительность только что проигранного сигнала: речь стартует ровно
 // в этот момент, поэтому пауза всегда совпадает со звуком.
 private volatile long lastCueMs=0;
 public static void stopEvent(String id){DeliveryService s=instance;if(s!=null)s.handler.post(()->{s.queue.removeIf(e->e.optString("id").equals(id));if(s.current!=null&&s.current.optString("id").equals(id)){if(s.tts!=null)s.tts.stop();s.finish();}});}
 public static Notification notification(Context c,JSONObject event,JSONObject settings,boolean foreground){NotificationManager nm=c.getSystemService(NotificationManager.class);String channel=foreground?FOREGROUND_CHANNEL:"remindme_alert_v3_"+(settings.optBoolean("sound",true)?"sound":"silent")+(settings.optBoolean("vibration",true)?"_v":"_n");if(Build.VERSION.SDK_INT>=26){NotificationChannel ch=new NotificationChannel(channel,foreground?"Служебные уведомления":"Напоминания",foreground?NotificationManager.IMPORTANCE_LOW:NotificationManager.IMPORTANCE_HIGH);ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);ch.enableVibration(settings.optBoolean("vibration",true));ch.setSound(null,null);if(foreground)ch.enableVibration(false);nm.createNotificationChannel(ch);}
 Intent open=new Intent(c,MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP);PendingIntent content=PendingIntent.getActivity(c,0,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
 String id=event.optString("id"),text=settings.optBoolean("privateNotification")?"Откройте приложение, чтобы посмотреть напоминание":event.optString("text","Напоминание");
 NotificationCompat.Builder b=new NotificationCompat.Builder(c,channel).setSmallIcon(ru.voicereminder.app.R.drawable.ic_reminder).setContentTitle("Remind me").setContentText(text).setStyle(new NotificationCompat.BigTextStyle().bigText(text)).setCategory(NotificationCompat.CATEGORY_ALARM).setPriority(foreground?NotificationCompat.PRIORITY_LOW:NotificationCompat.PRIORITY_MAX).setContentIntent(content).setVisibility(settings.optBoolean("privateNotification")?NotificationCompat.VISIBILITY_PRIVATE:NotificationCompat.VISIBILITY_PUBLIC).setShowWhen(true).setOnlyAlertOnce(foreground).setAutoCancel(false).setOngoing(foreground).addAction(0,"Понятно",AlarmScheduler.pending(c,AlarmScheduler.ACK,id)).addAction(0,"Через 5 минут",AlarmScheduler.pending(c,AlarmScheduler.SNOOZE,id));if(!foreground)b.setFullScreenIntent(content,true);return b.build();}
 public static void notifyEvent(Context c,JSONObject event,JSONObject settings,boolean foreground){try{c.getSystemService(NotificationManager.class).notify(foreground?foregroundId(event):alertId(event),notification(c,event,settings,foreground));}catch(SecurityException ignored){}}
 /**
  * Звуковой сигнал перед напоминанием.
  *
  * Громкость. Раньше сигнал шёл через поток уведомлений
  * (USAGE_NOTIFICATION_EVENT), а он на телефоне обычно приглушён — сигнал
  * звучал тихо. Теперь используется поток будильника (USAGE_ALARM): он
  * играет на громкости будильника, которая почти всегда выставлена выше, и
  * не глушится режимом «не беспокоить» так, как уведомления.
  *
  * Пауза. Речь запускается ровно в момент окончания сигнала, поэтому
  * задержка между сигналом и голосом близка к нулю. Длительность сигнала
  * берётся из самого буфера, а не из константы — так пауза не «плывёт».
  *
  * Выбор. Вид сигнала приходит из настроек (ключ cue): chime, beep,
  * alarm, bell. Неизвестное значение даёт сигнал по умолчанию.
  */
 private void playAlarmCue(JSONObject settings){
  if(!settings.optBoolean("sound",true))return;
  try{
   String kind=settings.optString("cue","alarm");
   short[] pcm=cuePcm(kind);
   int rate=CUE_RATE;
   AudioAttributes attrs=new AudioAttributes.Builder()
     .setUsage(AudioAttributes.USAGE_ALARM)
     .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
     .build();
   alertTone=new AudioTrack(attrs,
     new AudioFormat.Builder().setSampleRate(rate)
       .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
       .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build(),
     pcm.length*2,AudioTrack.MODE_STATIC,AudioManager.AUDIO_SESSION_ID_GENERATE);
   alertTone.write(pcm,0,pcm.length);
   // Громкость на максимум: сигнал должен разбудить, а не намекнуть.
   alertTone.setVolume(1.0f);
   alertTone.play();
   // Запоминаем фактическую длительность: речь начнётся точно по её концу.
   lastCueMs=(long)(pcm.length*1000L/rate);
   handler.postDelayed(this::stopAlarmCue,lastCueMs+40);
  }catch(Exception ignored){stopAlarmCue();}
 }

 /**
  * Синтезирует выбранный сигнал в PCM.
  *
  * Все сигналы короткие (0.3–0.6 с): их задача — привлечь внимание, а не
  * развлекать. Амплитуда близка к пределу шкалы, потому что сигнал играет
  * один раз и обрезаться ему нечем.
  */
 private short[] cuePcm(String kind){
  int rate=CUE_RATE;
  double amp=30000.0;
  switch(kind==null?"":kind){
   case "beep":{
    // Три резких коротких пика — самый заметный вариант.
    int total=(int)(rate*0.30);
    short[] pcm=new short[total];
    int on=(int)(rate*0.07),off=(int)(rate*0.03);
    for(int i=0,pos=0;pos<total;i++){
     boolean loud=(i%(on+off))<on;
     if(loud){
      for(int j=0;j<on&&pos<total;j++,pos++){
       double env=Math.min(1,j/220.0)*Math.min(1,(on-j)/220.0);
       pcm[pos]=(short)(Math.sin(2*Math.PI*1500*pos/(double)rate)*amp*env);
      }
     }else{
      pos+=off;
     }
    }
    return pcm;
   }
   case "alarm":{
    // Классический будильник: два тона попеременно, как у механического.
    int total=(int)(rate*0.55);
    short[] pcm=new short[total];
    for(int i=0;i<total;i++){
     double t=i/(double)rate;
     int freq=((int)(t*12))%2==0?1000:1250;
     double env=Math.min(1,i/400.0)*Math.min(1,(total-i)/400.0);
     // Лёгкая «трель», чтобы звук не был чистой синусоидой.
     double trem=0.75+0.25*Math.sin(2*Math.PI*24*t);
     pcm[i]=(short)(Math.sin(2*Math.PI*freq*t)*amp*env*trem);
    }
    return pcm;
   }
   case "bell":{
    // Мягкий «дон-дон» с затуханием: громко, но не резко.
    int total=(int)(rate*0.60);
    short[] pcm=new short[total];
    int half=total/2;
    for(int i=0;i<total;i++){
     double t=i/(double)rate;
     double env=i<half?Math.exp(-3.0*i/half):Math.exp(-3.0*(i-half)/half);
     int base=i<half?880:1175;
     double s=Math.sin(2*Math.PI*base*t)+0.35*Math.sin(2*Math.PI*base*2.02*t);
     pcm[i]=(short)(s*amp*0.55*env);
    }
    return pcm;
   }
   default:{
    // chime: два восходящих тона, нейтральный и приятный.
    int total=(int)(rate*0.45);
    short[] pcm=new short[total];
    int half=total/2;
    for(int i=0;i<total;i++){
     double t=i/(double)rate;
     int base=i<half?880:1320;
     double env=Math.min(1,i/300.0)*Math.min(1,(total-i)/500.0);
     pcm[i]=(short)(Math.sin(2*Math.PI*base*t)*amp*0.8*env);
    }
    return pcm;
   }
  }
 }
 private void stopAlarmCue(){if(alertTone!=null){try{alertTone.stop();}catch(Exception ignored){}try{alertTone.release();}catch(Exception ignored){}alertTone=null;}}
 // Речь начинается в тот момент, когда сигнал закончился.
 //
 // Раньше здесь стояла фиксированная пауза 700 мс: сигнал уже отзвучал, а
 // человек ждал голос — получалось «немое» окно. Теперь пауза равна
 // фактической длительности только что проигранного сигнала, поэтому речь
 // вступает сразу за последней нотой. Длительность известна точно: сигнал
 // синтезируется здесь же, и её можно посчитать по числу отсчётов.
 private void speakAfterCue(final String text){
  final String id=current!=null?current.optString("id"):"";
  final Runnable start=()->{
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
  };
  // Задержка = длительность сигнала. Считаем её по факту, чтобы она всегда
  // совпадала со звуком, даже если сигнал длиннее или короче обычного.
  long cueMs=lastCueMs>0?lastCueMs:CUE_FALLBACK_MS;
  handler.postDelayed(start,cueMs);
 }
 @Override public void onCreate(){super.onCreate();instance=this;audio=getSystemService(AudioManager.class);tts=new TextToSpeech(this,status->{
  if(status!=TextToSpeech.SUCCESS){
   ready=false;
   // Синтезатор не поднялся: телефон без TTS-движка. Напоминание всё равно
   // должно сработать — звук и уведомление без голоса.
   try(ReminderStore db=new ReminderStore(this)){db.diagnostic("TTS недоступен. Проверьте системный голос.");}
   speakFallback=true;drain();
   return;
  }
  // Проверяем, есть ли РУССКИЙ голос. На части телефонов (особенно
  // недорогих и с урезанной прошивкой) русский пакет не установлен:
  // setLanguage() тогда возвращает ошибку, и озвучка молча не работает —
  // а голосовое напоминание это главная функция приложения.
  int res=tts.setLanguage(new Locale("ru","RU"));
  if(res==TextToSpeech.LANG_MISSING_DATA||res==TextToSpeech.LANG_NOT_SUPPORTED){
   // Русского нет — пробуем хотя бы любой доступный голос, чтобы текст
   // всё-таки прозвучал, пусть и с акцентом.
   Locale fallback=Locale.getDefault();
   int second=tts.setLanguage(fallback);
   speakFallback=second==TextToSpeech.LANG_MISSING_DATA||second==TextToSpeech.LANG_NOT_SUPPORTED;
   try(ReminderStore db=new ReminderStore(this)){
    db.diagnostic(speakFallback
      ? "Русский голос не установлен. Напоминание покажется без озвучки — установите голосовые данные в настройках Android."
      : "Русский голос не установлен, используется системный по умолчанию.");
   }
  }
  ready=true;drain();
});tts.setOnUtteranceProgressListener(new UtteranceProgressListener(){public void onStart(String id){}public void onDone(String id){handler.post(()->finish());}public void onError(String id){handler.post(()->{try(ReminderStore db=new ReminderStore(DeliveryService.this)){db.diagnostic("Не удалось озвучить напоминание: проверьте TTS-голос");}finish();});}});lock=((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"raminde:voice");}
 @Override public int onStartCommand(Intent intent,int flags,int startId){if(intent==null){stopSelf();return START_NOT_STICKY;}try(ReminderStore db=new ReminderStore(this)){JSONObject e=db.event(intent.getStringExtra("eventId"));if(e==null){stopSelf();return START_NOT_STICKY;}startForeground(foregroundId(e),notification(this,e,db.meta("settings"),true));if(!lock.isHeld())lock.acquire(10000);playAlarmCue(db.meta("settings"));queue.add(e);drain();}return START_NOT_STICKY;}
 private void drain(){if(current!=null||queue.isEmpty()||!ready)return;current=queue.remove();try(ReminderStore db=new ReminderStore(this)){JSONObject e=db.event(current.getString("id"));if(e==null||e.optString("state").equals("acknowledged")||e.optString("state").equals("snoozed")){finish();return;}JSONObject settings=db.meta("settings");NotificationManager nm=getSystemService(NotificationManager.class);if(nm.getCurrentInterruptionFilter()==NotificationManager.INTERRUPTION_FILTER_NONE||audio.getMode()!=AudioManager.MODE_NORMAL){db.diagnostic("Озвучивание пропущено: включён режим «Не беспокоить»");finish();return;}
 if(!lock.isHeld())lock.acquire(30000);AudioAttributes attrs=new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();tts.setAudioAttributes(attrs);tts.setSpeechRate((float)settings.optDouble("rate",0.95));if(Build.VERSION.SDK_INT>=26){focus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK).setAudioAttributes(attrs).setOnAudioFocusChangeListener(change->{if(change==AudioManager.AUDIOFOCUS_LOSS){tts.stop();finish();}}).build();if(audio.requestAudioFocus(focus)!=AudioManager.AUDIOFOCUS_REQUEST_GRANTED){db.diagnostic("Аудио занято другим приложением");finish();return;}}
 String name=settings.optString("name").trim(),text=(name.isEmpty()?"":name+"! ")+current.getString("text");startForeground(foregroundId(current),notification(this,current,settings,true));speakAfterCue(text);
 }catch(Exception ex){finish();}}
 private final Runnable watchdog=()->{if(tts!=null)tts.stop();finish();};
 private void finish(){handler.removeCallbacks(watchdog);stopAlarmCue();if(current!=null){try(ReminderStore db=new ReminderStore(this)){JSONObject e=db.event(current.optString("id"));if(e!=null&&e.optString("state").equals("ringing")){e.put("state","waiting");db.put("events","eid",e.getString("id"),e);}JSONObject settings=db.meta("settings");if(e!=null&&settings.optString("mode","voiceAndNotification").equals("voiceAndNotification")&&!e.optString("state").equals("acknowledged"))notifyEvent(this,e,settings,true);}catch(Exception ignored){}}
 if(lock!=null&&lock.isHeld())lock.release();if(Build.VERSION.SDK_INT>=26&&focus!=null)audio.abandonAudioFocusRequest(focus);current=null;if(queue.isEmpty()){stopForeground(STOP_FOREGROUND_REMOVE);stopSelf();}else{try(ReminderStore db=new ReminderStore(this)){JSONObject next=queue.peek();startForeground(foregroundId(next),notification(this,next,db.meta("settings"),true));}drain();}}
 @Override public void onDestroy(){instance=null;handler.removeCallbacksAndMessages(null);stopAlarmCue();if(tts!=null){tts.stop();tts.shutdown();}if(lock!=null&&lock.isHeld())lock.release();if(Build.VERSION.SDK_INT>=26&&focus!=null)audio.abandonAudioFocusRequest(focus);super.onDestroy();}
 @Override public IBinder onBind(Intent i){return null;}
}
