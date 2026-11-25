package ru.voicereminder.app.reminders;
import android.app.*;import android.content.*;import android.os.*;import android.media.*;import android.speech.tts.*;import androidx.core.app.NotificationCompat;import java.util.*;import org.json.*;import ru.voicereminder.app.*;
public class DeliveryService extends Service {
 private static final int ALERT_BASE=10000, FOREGROUND_BASE=20000;
 // Один идентификатор на событие.
 //
 // Раньше у напоминания было два номера: отдельный для обычного уведомления
 // и отдельный для служебного, которое ставит сервис озвучки. На экране
 // блокировки это выглядело как два одинаковых уведомления об одном и том
 // же напоминании. Теперь номер один, и запись перезаписывает саму себя.
 private static final int NOTIFY_BASE=10000;
 // Частота дискретизации для синтезированных сигналов.
 private static final int CUE_RATE=22050;
 // Запасная длительность паузы, если сигнал не сообщил свою.
 private static final long CUE_FALLBACK_MS=450;
 private static final String FOREGROUND_CHANNEL="remindme_foreground_v3";
 public static int alertId(JSONObject e){return NOTIFY_BASE+e.optInt("nativeId");}
 // Служебное уведомление сервиса использует тот же номер, что и обычное:
 // так система не покажет две записи об одном напоминании.
 public static int foregroundId(JSONObject e){return NOTIFY_BASE+e.optInt("nativeId");}
 private TextToSpeech tts;private boolean ready;private boolean speakFallback=false;private JSONObject current;private final Queue<JSONObject> queue=new ArrayDeque<>();private final Handler handler=new Handler(Looper.getMainLooper());private PowerManager.WakeLock lock;private static DeliveryService instance;private AudioManager audio;private AudioFocusRequest focus;private AudioTrack alertTone;
 // Длительность только что проигранного сигнала: речь стартует ровно
 // в этот момент, поэтому пауза всегда совпадает со звуком.
 private volatile long lastCueMs=0;
 public static void stopEvent(String id){DeliveryService s=instance;if(s!=null)s.handler.post(()->{s.queue.removeIf(e->e.optString("id").equals(id));if(s.current!=null&&s.current.optString("id").equals(id)){if(s.tts!=null)s.tts.stop();s.finish();}});}
 public static Notification notification(Context c,JSONObject event,JSONObject settings,boolean foreground){NotificationManager nm=c.getSystemService(NotificationManager.class);String channel=foreground?FOREGROUND_CHANNEL:"remindme_alert_v3_"+(settings.optBoolean("sound",true)?"sound":"silent")+(settings.optBoolean("vibration",true)?"_v":"_n");if(Build.VERSION.SDK_INT>=26){NotificationChannel ch=new NotificationChannel(channel,foreground?"Служебные уведомления":"Напоминания",foreground?NotificationManager.IMPORTANCE_LOW:NotificationManager.IMPORTANCE_HIGH);ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);ch.enableVibration(settings.optBoolean("vibration",true));ch.setSound(null,null);if(foreground)ch.enableVibration(false);nm.createNotificationChannel(ch);}
 Intent open=new Intent(c,MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_SINGLE_TOP);PendingIntent content=PendingIntent.getActivity(c,0,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
 String id=event.optString("id"),text=settings.optBoolean("privateNotification")?"Откройте приложение, чтобы посмотреть напоминание":event.optString("text","Напоминание");
 // Смахивание уведомления считается подтверждением.
 //
 // Это то, что человек делает не задумываясь: увидел, прочитал, убрал.
 // Раньше уведомление просто исчезало, напоминание оставалось «висящим»
 // и могло прозвучать снова; приходилось открывать приложение и нажимать
 // «Понятно». Теперь уведомление несёт deleteIntent, и система сама
 // сообщает нам о смахивании — окно открывать не нужно.
 PendingIntent dismissed=AlarmScheduler.pending(c,AlarmScheduler.DISMISS,id);
 NotificationCompat.Builder b=new NotificationCompat.Builder(c,channel).setSmallIcon(ru.voicereminder.app.R.drawable.ic_reminder).setContentTitle("Напомни").setContentText(text).setStyle(new NotificationCompat.BigTextStyle().bigText(text)).setCategory(NotificationCompat.CATEGORY_ALARM).setPriority(foreground?NotificationCompat.PRIORITY_LOW:NotificationCompat.PRIORITY_MAX).setContentIntent(content).setDeleteIntent(dismissed).setVisibility(settings.optBoolean("privateNotification")?NotificationCompat.VISIBILITY_PRIVATE:NotificationCompat.VISIBILITY_PUBLIC).setShowWhen(true).setOnlyAlertOnce(foreground).setAutoCancel(false).setOngoing(false).addAction(0,"Понятно",AlarmScheduler.pending(c,AlarmScheduler.ACK,id)).addAction(0,"Через 5 минут",AlarmScheduler.pending(c,AlarmScheduler.SNOOZE,id));if(!foreground)b.setFullScreenIntent(content,true);return b.build();}
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
   String kind=settings.optString("cue","marimba");
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
   lastCueMs=audibleMs(pcm,rate);
   handler.postDelayed(this::stopAlarmCue,lastCueMs+40);
  }catch(Exception ignored){stopAlarmCue();}
 }

 /**
  * Синтезирует выбранный сигнал в PCM.
  *
  * Аддитивный синтез: каждая нота складывается из основного тона и
  * обертонов, у каждого обертона своя громкость и своя скорость затухания.
  * Верхние обертоны гаснут быстрее нижних — так звучит живой инструмент;
  * именно этого не хватало прежним сигналам из одной-двух синусоид, из-за
  * чего они и воспринимались как «пищалка».
  *
  * Числа здесь должны совпадать с lib/alert-cues.js: предпрослушивание в
  * настройках считается по тем же таблицам, и человек должен услышать ровно
  * то, что прозвучит при напоминании. При правке любой таблицы её надо
  * повторить в обоих файлах.
  */
 private short[] cuePcm(String kind){
  String key=(kind==null||!CUE_NOTES.containsKey(kind))?"marimba":kind;
  double[][] notes=CUE_NOTES.get(key);
  double[][] partials=CUE_PARTIALS.get(key);
  int totalMs=cueDurationMs(key);
  int total=(int)Math.round(totalMs/1000.0*CUE_RATE);
  double[] out=new double[total];
  // Атака 2 мс: без неё начало ноты даёт щелчок — резкий перепад громкости
  // от нуля к полной амплитуде.
  int attack=Math.max(1,(int)Math.round(CUE_RATE*0.002));
  double nyquist=CUE_RATE/2.0;
  for(double[] note:notes){
   double atMs=note[0],freq=note[1],ms=note[2],amp=note[3];
   int start=(int)Math.round(atMs/1000.0*CUE_RATE);
   int length=(int)Math.round(ms/1000.0*CUE_RATE);
   for(double[] p:partials){
    double f=freq*p[0];
    // Обертон выше половины частоты дискретизации не воспроизведётся —
    // пропускаем, иначе получим наложение зеркальной частоты.
    if(f>=nyquist)continue;
    double w=2*Math.PI*f/CUE_RATE;
    double gain=p[1],decay=p[2];
    for(int i=0;i<length;i++){
     int idx=start+i;
     if(idx>=total)break;
     double t=i/(double)CUE_RATE;
     // Затухание у каждого обертона своё: верхние гаснут первыми, поэтому
     // звук с течением времени «темнеет».
     double env=Math.exp(-t*decay)*(i<attack?(double)i/attack:1.0);
     out[idx]+=Math.sin(w*i)*amp*gain*env;
    }
   }
  }
  // Трель накладывается после смешивания: она модулирует весь сигнал, а не
  // отдельные обертоны.
  double[] trem=CUE_TREMOLO.get(key);
  if(trem!=null){
   double hz=trem[0],depth=trem[1];
   for(int i=0;i<total;i++){
    double t=i/(double)CUE_RATE;
    out[i]*=1-depth+depth*Math.sin(2*Math.PI*hz*t);
   }
  }
  // Нормировка по пику: сигналы различаются тембром, а не громкостью.
  double peak=0;
  for(int i=0;i<total;i++)peak=Math.max(peak,Math.abs(out[i]));
  double scale=peak>0?CUE_PEAK/peak:0;
  short[] pcm=new short[total];
  for(int i=0;i<total;i++)pcm[i]=(short)Math.round(out[i]*scale*32767);
  return pcm;
 }

 /**
  * Когда сигнал фактически затихает, в миллисекундах.
  *
  * Речь должна начинаться сразу за звуком, почти без паузы. Раньше задержка
  * бралась по полной длине буфера, а в конце лежит тишина: нота дописана до
  * конца, но слышно её уже нет. У маримбы это около 190 мс — заметный
  * провал между «дзынь» и словами.
  *
  * Считаем по готовому PCM, а не по таблицам нот: ноты перекрываются, и
  * громкость в каждой точке складывается из нескольких источников. Заодно
  * это исключает расхождение с JS — таблицы могут разойтись, а сигнал один
  * и тот же.
  *
  * Порог -34 dB от пика (на слух тишина), окно 6 мс, чтобы не поймать
  * переход через ноль посреди звука, плюс короткий спад от щелчка.
  */
 private long audibleMs(short[] pcm,int rate){
  int total=pcm.length;
  double peak=0;
  for(int i=0;i<total;i++)peak=Math.max(peak,Math.abs(pcm[i]));
  if(peak<=0)return total*1000L/rate;
  double threshold=peak*Math.pow(10,-34/20.0);
  int window=Math.max(1,(int)Math.round(rate*0.006));
  int lastAudible=total;
  for(int start=total-window;start>=0;start-=window){
   double sum=0;
   for(int i=start;i<start+window&&i<total;i++)sum+=(double)pcm[i]*pcm[i];
   if(Math.sqrt(sum/window)>threshold){lastAudible=Math.min(total,start+window);break;}
  }
  long ms=(long)(lastAudible*1000.0/rate)+25;
  return Math.min(total*1000L/rate,ms);
 }

 /** Длительность сигнала в миллисекундах: последняя нота задаёт конец. */
 private int cueDurationMs(String key){
  double end=0;
  for(double[] n:CUE_NOTES.get(key))end=Math.max(end,n[0]+n[2]);
  return (int)Math.round(end);
 }

 /**
  * Ноты сигналов: когда начать (мс), частота (Гц), сколько звучит (мс),
  * громкость относительно остальных.
  *
  * Те же значения, что в NOTES в lib/alert-cues.js.
  */
 private static final Map<String,double[][]> CUE_NOTES=new HashMap<>();
 /**
  * Обертоны: во сколько раз выше основного тона, громкость, скорость
  * затухания в 1/с.
  *
  * Те же значения, что в TIMBRES в lib/alert-cues.js.
  */
 private static final Map<String,double[][]> CUE_PARTIALS=new HashMap<>();
 /** Трель: частота (Гц) и глубина. Есть только у будильника. */
 private static final Map<String,double[]> CUE_TREMOLO=new HashMap<>();
 /** Общая громкость: пик приводится к этому значению. */
 private static final double CUE_PEAK=0.85;
 static{
  CUE_NOTES.put("marimba",new double[][]{
   {0,523.25,320,0.9},
   {130,783.99,620,1.0}});
  CUE_NOTES.put("bell",new double[][]{
   {0,880.0,620,1.0},
   {90,1174.66,520,0.45}});
  CUE_NOTES.put("harp",new double[][]{
   {0,523.25,480,0.8},
   {95,659.25,480,0.75},
   {190,783.99,700,0.9}});
  CUE_NOTES.put("chime",new double[][]{
   {0,880.0,420,0.8},
   {150,1318.51,620,1.0}});
  CUE_NOTES.put("beep",new double[][]{
   {0,1500.0,110,1.0},
   {140,1500.0,110,1.0},
   {280,1500.0,110,1.0}});
  CUE_NOTES.put("alarm",new double[][]{
   {0,1000.0,180,1.0},
   {180,1250.0,180,1.0},
   {360,1000.0,180,0.9}});

  CUE_PARTIALS.put("marimba",new double[][]{
   {1,1.0,8},{3.93,0.26,15},{9.24,0.07,28}});
  CUE_PARTIALS.put("bell",new double[][]{
   {1.0,1.0,4.2},{2.0,0.42,5.6},{2.76,0.3,6.8},{5.4,0.15,9.5},{8.93,0.07,13}});
  CUE_PARTIALS.put("harp",new double[][]{
   {1,1.0,4.5},{2,0.45,6.5},{3,0.22,9},{4,0.12,12},{5,0.06,16}});
  CUE_PARTIALS.put("chime",new double[][]{
   {1,1.0,5},{2,0.22,8},{3,0.08,12}});
  CUE_PARTIALS.put("beep",new double[][]{
   {1,1.0,3},{2,0.3,5},{3,0.12,8}});
  CUE_PARTIALS.put("alarm",new double[][]{
   {1,1.0,2.5},{2,0.35,4},{3,0.14,6}});

  CUE_TREMOLO.put("alarm",new double[]{26,0.22});
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
 private void finish(){handler.removeCallbacks(watchdog);stopAlarmCue();if(current!=null){try(ReminderStore db=new ReminderStore(this)){JSONObject e=db.event(current.optString("id"));if(e!=null&&e.optString("state").equals("ringing")){e.put("state","waiting");db.put("events","eid",e.getString("id"),e);}}catch(Exception ignored){}}
 if(lock!=null&&lock.isHeld())lock.release();if(Build.VERSION.SDK_INT>=26&&focus!=null)audio.abandonAudioFocusRequest(focus);current=null;if(queue.isEmpty()){
   // Уведомление остаётся на экране после того, как речь закончилась.
   //
   // Раньше здесь стояло STOP_FOREGROUND_REMOVE, и уведомление исчезало
   // сразу за голосом: человек не успевал его прочитать, а смахнуть — тем
   // более. Теперь запись отделяется от сервиса (DETACH) и живёт сама:
   // её видно, по ней можно нажать и открыть программу, а смахивание
   // подтверждает напоминание.
   stopForeground(STOP_FOREGROUND_DETACH);stopSelf();}else{try(ReminderStore db=new ReminderStore(this)){JSONObject next=queue.peek();startForeground(foregroundId(next),notification(this,next,db.meta("settings"),true));}drain();}}
 @Override public void onDestroy(){instance=null;handler.removeCallbacksAndMessages(null);stopAlarmCue();if(tts!=null){tts.stop();tts.shutdown();}if(lock!=null&&lock.isHeld())lock.release();if(Build.VERSION.SDK_INT>=26&&focus!=null)audio.abandonAudioFocusRequest(focus);super.onDestroy();}
 @Override public IBinder onBind(Intent i){return null;}
}
